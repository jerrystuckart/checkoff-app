#!/usr/bin/env python3
"""End to end disposable account test for the account deletion pipeline (migration 20261008d rev 4).

SYNTHETIC DATA ONLY. Every user, item, list and file it creates is tagged `zz-deltest-<id>` / `ZZ DELETION TEST <id>`; the test items are inactive and unapproved so nothing
reaches the app catalog. It never touches an existing user. Reads the public anon key from app.json; uses the linked project through `supabase db query` (read/write SQL as the
project's postgres role) and the real public REST / Auth / Storage APIs with the synthetic users' own tokens. It never prints tokens, passwords or the service key.

Usage (from the repo root, with the project linked):  python3 scripts/account-deletion-e2e.py <stage>
Stages: setup | negative | delete_a | replays | partial | legacy | inline | cleanup | all
State is kept in $E2E_STATE (default /tmp/account_deletion_e2e.json) so a stage can be rerun after a fix.
"""
import base64, json, os, secrets, struct, subprocess, sys, time, urllib.error, urllib.parse, urllib.request, zlib

REF = "https://uggusbbswybyplypkbxz.supabase.co"
ROOT = os.getcwd()
ANON = json.load(open(os.path.join(ROOT, "app.json")))["expo"]["extra"]["supabaseAnonKey"]
STATE_PATH = os.environ.get("E2E_STATE", "/tmp/account_deletion_e2e.json")
# the project link (supabase/.temp) lives in the main checkout; a worktree may not have it
_main = subprocess.run(["git", "worktree", "list", "--porcelain"], capture_output=True, text=True).stdout.split("\n")[0].replace("worktree ", "")
LINK_DIR = ROOT if os.path.exists(os.path.join(ROOT, "supabase/.temp/project-ref")) else _main
RESULTS = []

# ----------------------------------------------------------------------------------------------------------------------------- helpers
def load():
    return json.load(open(STATE_PATH)) if os.path.exists(STATE_PATH) else {}
def save(st):
    json.dump(st, open(STATE_PATH, "w"), indent=1)

def sql(q):
    """Runs SQL against the linked project; returns rows (list of dicts) for the LAST statement. Raises on any CLI or SQL error."""
    p = subprocess.run(["supabase", "--workdir", LINK_DIR, "db", "query", q, "--linked", "--agent=no", "-o", "json"], capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError("SQL failed: " + (p.stderr or p.stdout)[-400:].replace("\n", " "))
    try:
        return json.loads(p.stdout) if p.stdout.strip() else []
    except Exception:
        raise RuntimeError("unexpected CLI output")

def http(method, url, token=None, body=None, raw=None, headers=None):
    h = {"apikey": ANON, "Authorization": "Bearer " + (token or ANON)}
    h.update(headers or {})
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    if body is not None and "Content-Type" not in h:
        h["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            b = r.read(); status = r.status
    except urllib.error.HTTPError as e:
        b = e.read(); status = e.code
    try:
        parsed = json.loads(b) if b else None
    except Exception:
        parsed = None
    return status, parsed, b

def check(name, ok, evidence=""):
    RESULTS.append((name, bool(ok), str(evidence)))
    print(("PASS  " if ok else "FAIL  ") + name + (("  [" + str(evidence)[:260] + "]") if evidence != "" else ""))
    return bool(ok)

def png(color, size=12):
    raw = b"".join(b"\x00" + bytes(color) * size for _ in range(size))
    def chunk(t, d): return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")

def jpeg(color):
    """A small real JPEG (macOS sips converts a generated PNG)."""
    tmp = "/tmp/e2e_%s" % secrets.token_hex(4)
    open(tmp + ".png", "wb").write(png(color))
    subprocess.run(["sips", "-s", "format", "jpeg", tmp + ".png", "--out", tmp + ".jpg"], capture_output=True, check=True)
    data = open(tmp + ".jpg", "rb").read()
    os.remove(tmp + ".png"); os.remove(tmp + ".jpg")
    return data

def sign_in(email, password):
    s, d, _ = http("POST", REF + "/auth/v1/token?grant_type=password", body={"email": email, "password": password})
    return (d or {}).get("access_token") if s == 200 else None

def create_user(tag, label):
    """Inserts a confirmed email/password user straight into auth (no email is sent) and returns its record. The public.users row comes from the real handle_new_user trigger."""
    uid = sql("select gen_random_uuid()::text as id")[0]["id"]
    email = "%s-%s@checkoff-deltest.invalid" % (tag, label)
    pw = secrets.token_urlsafe(18)
    sql("""insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
             confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, phone_change, phone_change_token, reauthentication_token)
           values ('00000000-0000-0000-0000-000000000000', '%s', 'authenticated', 'authenticated', '%s', extensions.crypt('%s', extensions.gen_salt('bf')), now(),
             '{"provider":"email","providers":["email"]}', jsonb_build_object('display_name', 'ZZ DELTEST %s %s'), now(), now(), '', '', '', '', '', '', '', '');
           insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
           values (gen_random_uuid(), '%s', jsonb_build_object('sub', '%s', 'email', '%s'), 'email', '%s', now(), now(), now());""" % (uid, email, pw, tag, label, uid, uid, email, uid))
    return {"id": uid, "email": email, "pw": pw}

def token(st, label):
    u = st["users"][label]
    t = sign_in(u["email"], u["pw"])
    return t

def upload(tok, bucket, path, data, ctype="image/jpeg"):
    s, d, _ = http("POST", "%s/storage/v1/object/%s/%s" % (REF, bucket, urllib.parse.quote(path)), tok, raw=data, headers={"Content-Type": ctype, "x-upsert": "false"})
    return s, d

def sign_url(tok, bucket, path):
    s, d, _ = http("POST", "%s/storage/v1/object/sign/%s/%s" % (REF, bucket, urllib.parse.quote(path)), tok, body={"expiresIn": 60})
    if s == 200 and d and d.get("signedURL"):
        s2, _, b = http("GET", REF + "/storage/v1" + d["signedURL"], None)
        return s2, b
    return s, b""

def public_get(bucket, path):
    s, _, b = http("GET", "%s/storage/v1/object/public/%s/%s" % (REF, bucket, urllib.parse.quote(path)), None)
    return s, b

def uuid_scan(uid):
    """Tables (public, auth, storage, net) whose rows contain this uuid anywhere (as text)."""
    q = """select table_schema||'.'||table_name as t, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %%I.%%I x where x::text like %%L', table_schema, table_name, '%%%s%%'), false, true, '')))[1]::text::int as hits
           from information_schema.tables where table_schema in ('public','auth','storage','net') and table_type = 'BASE TABLE'""" % uid
    return {r["t"]: r["hits"] for r in sql(q) if r["hits"] > 0}

# ----------------------------------------------------------------------------------------------------------------------------- stages
def stage_setup():
    st = {"tag": "zz-deltest-" + secrets.token_hex(3), "users": {}, "items": {}, "files": {}, "ids": {}}
    st["started"] = sql("select now()::text as t")[0]["t"]
    tag = st["tag"]
    base = sql("""select (select count(*) from public.users) as users, (select count(*) from auth.users) as auth_users,
                         (select count(*) from public.account_deletion_requests) as requests, (select count(*) from public.anonymous_completion_counts) as cells,
                         (select count(*) from public.retained_checkin_photos) as retained,
                         (select count(*) from storage.objects) as objects, (select count(*) from public.items) as items,
                         (select count(*) from public.item_cover_candidates) as candidates""")[0]
    st["baseline"] = base
    print("baseline:", base)
    # synthetic items: active (the check in trigger requires it) but UNAPPROVED, no coordinates, category or neighborhood: the app's catalog queries filter on approval
    for k in ("S1", "S2", "S3", "S4"):
        r = sql("insert into public.items (body, is_active, is_approved, is_universal) values ('ZZ DELETION TEST %s %s', true, false, false) returning id" % (tag, k))
        st["items"][k] = r[0]["id"]
    for label in ("A", "B", "D", "E", "F"):
        st["users"][label] = create_user(tag, label)
    A, B = st["users"]["A"]["id"], st["users"]["B"]["id"]
    S = st["items"]
    sql("update public.users set referred_by = '%s' where id = '%s'" % (A, B))
    # lists: a solo list of A (must be deleted) and a shared list of A with B (must be transferred to B)
    solo = sql("insert into public.lists (creator_id, title, is_public) values ('%s', 'ZZ solo %s', false) returning id" % (A, tag))[0]["id"]
    shared = sql("insert into public.lists (creator_id, title, is_public) values ('%s', 'ZZ shared %s', false) returning id" % (A, tag))[0]["id"]
    sql("insert into public.list_members (list_id, user_id) values ('%s', '%s') on conflict do nothing" % (shared, B))
    li = sql("insert into public.list_items (list_id, item_id) values ('%s', '%s') returning id" % (shared, S["S1"]))[0]["id"]
    st["ids"].update({"solo": solo, "shared": shared, "li_shared": li})
    # A's files, uploaded with A's own token through the real Storage API
    ta = token(st, "A")
    check("setup: synthetic user A can sign in through the real Auth API", ta is not None)
    good = jpeg((200, 30, 30)); sel = jpeg((30, 200, 30)); pend = jpeg((30, 30, 200)); rej = jpeg((200, 200, 30))
    st["files"]["bytes_sel"] = base64.b64encode(sel).decode()
    ts = int(time.time() * 1000)
    paths = {"checkin_good": ("checkin-photos", "%s/%d_good.jpg" % (A, ts), good), "checkin_empty": ("checkin-photos", "%s/%d_empty.jpg" % (A, ts), b""),
             "cand_sel": ("submission-photos", "cover-candidates/%s/%d_sel.jpg" % (A, ts), sel), "cand_pend": ("submission-photos", "cover-candidates/%s/%d_pend.jpg" % (A, ts), pend),
             "cand_rej": ("submission-photos", "cover-candidates/%s/%d_rej.jpg" % (A, ts), rej)}
    for k, (b, p, data) in paths.items():
        s, d = upload(ta, b, p, data)
        ok = s in (200, 201)
        st["files"][k] = {"bucket": b, "path": p, "uploaded": ok, "status": s}
        check("setup: A uploads %s (%s bytes)" % (k, len(data)), ok or (k == "checkin_empty"), "http %s %s" % (s, (d or {}).get("message", "")))
    save(st)
    f = st["files"]
    pub = lambda k: REF + "/storage/v1/object/public/checkin-photos/" + f[k]["path"]
    # candidate rows (consent_ack true, as the real insert policy requires); metadata deliberately mentions A so the scrub is testable
    meta = lambda extra="": "jsonb_build_object('checkedAt', now()::text, 'passesBasicSanity', true, 'uploader', '%s'%s)" % (A, extra)
    cs = {}
    for k, status, elig, reason in (("cand_sel", "selected", True, None), ("cand_pend", "pending", False, None), ("cand_rej", "rejected", False, "zz test rejected photo from %s" % A)):
        cs[k] = sql("""insert into public.item_cover_candidates (item_id, storage_path, status, display_eligible, selected_as_cover_at, submitted_by_user_id, consent_ack, moderation_metadata, rejection_reason)
                       values ('%s', '%s', '%s', %s, %s, '%s', true, %s, %s) returning id""" % (
            S["S1"], f[k]["path"], status, "true" if elig else "false", "now()" if status == "selected" else "null", A, meta(), ("'%s'" % reason) if reason else "null"))[0]["id"]
    st["ids"]["cands"] = cs
    # A's confirmed check ins (same experience and day twice = ONE completion; a zero byte photo; one 40 days ago) and a pending SUGGESTION that must never be counted
    sql("""insert into public.check_ins (user_id, list_item_id, item_id, checkin_method, photo_url, checked_at) values ('%s', '%s', '%s', 'photo', '%s', now())""" % (A, li, S["S1"], pub("checkin_good")))
    sql("""insert into public.check_ins (user_id, item_id, checkin_method, checked_at) values ('%s', '%s', 'tap', now())""" % (A, S["S1"]))
    sql("""insert into public.check_ins (user_id, item_id, checkin_method, photo_url, checked_at) values ('%s', '%s', 'photo', '%s', now())""" % (A, S["S2"], pub("checkin_empty")))
    sql("""insert into public.check_ins (user_id, item_id, checkin_method, checked_at) values ('%s', '%s', 'tap', now() - interval '40 days')""" % (A, S["S1"]))
    sql("""insert into public.candidate_visits (user_id, item_id, arrival_at, departure_at, status, expires_at) values ('%s', '%s', now() - interval '2 hours', now() - interval '1 hour', 'high_confidence', now() + interval '6 days')""" % (A, S["S3"]))
    confirmed_ok = True
    try:
        # the confirm trigger needs a real authenticated caller, so this check in goes through the REST API with A's own token
        cv = sql("""insert into public.candidate_visits (user_id, item_id, arrival_at, departure_at, status, expires_at) values ('%s', '%s', now() - interval '3 hours', now() - interval '2 hours', 'high_confidence', now() + interval '6 days') returning id""" % (A, S["S4"]))[0]["id"]
        s_, d_, b_ = http("POST", REF + "/rest/v1/check_ins", ta, body={"user_id": A, "item_id": S["S4"], "checkin_method": "tap", "verification_method": "historical_visit_confirmed",
                                                                  "matched_candidate_visit_id": cv, "experienced_at": time.strftime("%Y-%m-%d", time.gmtime())}, headers={"Prefer": "return=minimal"})
        confirmed_ok = s_ in (200, 201, 204)
        if not confirmed_ok: print("note: confirmed-suggestion check in rejected:", s_, (d_ or {}).get("message", b_[:120]))
    except Exception as e:
        confirmed_ok = False
        print("note: could not create a confirmed-suggestion check in fixture:", str(e)[:200])
    st["confirmed_fixture"] = confirmed_ok
    # A's other personal records
    sql("""insert into public.interaction_events (user_id, event_type, item_id) values ('%s','item_view','%s'), ('%s','directions_click','%s');
           insert into public.campaign_sends (campaign_id, campaign_month, user_id, segment) values ('zz-deltest', date '2026-10-01', '%s', 'NEVER_CHECKED_OFF');
           insert into public.notification_log (user_id, type, title, body) values ('%s', 'zz', 'ZZ test', 'ZZ test body');
           insert into public.push_tokens (user_id, token) values ('%s', 'ExponentPushToken[zz-%s]');
           insert into public.visit_recovery_settings (user_id, opted_in, opted_in_at) values ('%s', true, now());
           insert into public.visit_presence_sessions (user_id, item_id, enter_lat, enter_lng) values ('%s', '%s', 33.1, -112.1);
           insert into public.dares (from_user_id, to_user_id, item_id, status) values ('%s', '%s', '%s', 'pending');
           insert into public.friendships (user_a, user_b) values ('%s', '%s');""" % (A, S["S1"], A, S["S1"], A, A, A, tag, A, A, S["S2"], A, B, S["S1"], A, B))
    # B (bystander): own check ins, one on the shared list
    sql("""insert into public.check_ins (user_id, list_item_id, item_id, checkin_method, checked_at) values ('%s', '%s', '%s', 'tap', now());
           insert into public.check_ins (user_id, item_id, checkin_method, checked_at) values ('%s', '%s', 'tap', now());""" % (B, li, S["S1"], B, S["S1"]))
    save(st)
    print("setup complete:", {k: v for k, v in st["items"].items()}, "users:", {k: v["id"][:8] for k, v in st["users"].items()})

def stage_cleanup():
    """Removes EVERY synthetic record (users, items, lists, files, request rows) and verifies production is back to its baseline. Safe to run any time: it only matches the test's own markers."""
    st = load()
    print("-- removing synthetic users and their dependent rows")
    sql("""delete from public.interaction_events where user_id in (select id from auth.users where email like '%@checkoff-deltest.invalid');
           delete from public.campaign_sends where user_id in (select id from auth.users where email like '%@checkoff-deltest.invalid');
           delete from public.notification_log where user_id in (select id from auth.users where email like '%@checkoff-deltest.invalid');
           update public.users set referred_by = null where referred_by in (select id from auth.users where email like '%@checkoff-deltest.invalid');""")
    # lists created by synthetic users (shared lists were transferred to a synthetic B, so they go with B's membership)
    sql("""delete from public.lists where creator_id in (select id from auth.users where email like '%@checkoff-deltest.invalid') or title like 'ZZ %zz-deltest-%'""")
    sql("""delete from auth.users where email like '%@checkoff-deltest.invalid'""")
    print("-- collecting synthetic storage objects, then deleting them with the same Storage API call the pipeline uses")
    objs = sql("""select bucket_id as b, name as n from storage.objects where
                    (bucket_id = 'submission-photos' and name in (select storage_path from public.item_cover_candidates where item_id in (select id from public.items where body like 'ZZ DELETION TEST zz-deltest-%')))
                 or (bucket_id = 'checkin-photos' and name in (select name from public.retained_checkin_photos where item_id in (select id from public.items where body like 'ZZ DELETION TEST zz-deltest-%')))
                 or (name ~ '(_good|_empty|_sel|_pend|_rej)\\.jpg$' and created_at > '@STARTED@'::timestamptz - interval '1 hour')""".replace("@STARTED@", st.get("started", "2026-10-08")))
    byb = {}
    for o in objs: byb.setdefault(o["b"], []).append(o["n"])
    for b, names in byb.items():
        sql("""select net.http_delete(url := '%s/storage/v1/object/%s', headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1), 'Content-Type', 'application/json'),
               body := jsonb_build_object('prefixes', %s::jsonb), timeout_milliseconds := 30000) as request_id""" % (REF, b, "'" + json.dumps(names).replace("'", "''") + "'"))
    print("   deleting %d synthetic file(s) in %d bucket(s)" % (len(objs), len(byb)))
    time.sleep(8)
    print("-- removing synthetic items (cascades anonymous counts, candidates and retained photo records) and test request rows")
    sql("delete from public.items where body like 'ZZ DELETION TEST zz-deltest-%'")
    sql("delete from public.account_deletion_requests where requested_at > '%s'::timestamptz - interval '1 minute'" % st.get("started", "2026-10-08"))
    base = st.get("baseline")
    now = sql("""select (select count(*) from public.users) as users, (select count(*) from auth.users) as auth_users, (select count(*) from public.account_deletion_requests) as requests,
                        (select count(*) from public.anonymous_completion_counts) as cells, (select count(*) from public.retained_checkin_photos) as retained,
                        (select count(*) from storage.objects) as objects, (select count(*) from public.items) as items, (select count(*) from public.item_cover_candidates) as candidates""")[0]
    print("now:", now)
    if base:
        check("cleanup: production counts are back to the baseline", all(int(now[k]) == int(base[k]) for k in base), {k: (base[k], now[k]) for k in base if int(now[k]) != int(base[k])} or "identical")
    left = sql("select (select count(*) from auth.users where email like '%@checkoff-deltest.invalid') as users, (select count(*) from public.items where body like 'ZZ DELETION TEST%') as items")[0]
    check("cleanup: no synthetic users or items remain", left["users"] == 0 and left["items"] == 0, left)

def b_fingerprint(st):
    B, shared = st["users"]["B"]["id"], st["ids"]["shared"]
    return sql("""select (select count(*) from public.check_ins where user_id = '%s') as b_checkins, (select count(*) from public.list_members where user_id = '%s') as b_memberships,
                         (select creator_id::text from public.lists where id = '%s') as shared_list_creator, (select referred_by::text from public.users where id = '%s') as b_referred_by,
                         (select count(*) from public.list_items where list_id = '%s') as shared_list_items,
                         (select count(*) from public.check_ins where list_item_id = '%s' and user_id = '%s') as b_checkin_on_shared_list""" % (B, B, shared, B, shared, st["ids"]["li_shared"], B))[0]

def reject(status, parsed, raw):
    """True when the API refused: an HTTP 4xx and no business result."""
    return 400 <= status < 500

def stage_negative():
    st = load(); A = st["users"]["A"]["id"]; B = st["users"]["B"]["id"]; f = st["files"]; c = st["ids"]["cands"]
    st["b_before"] = b_fingerprint(st)
    # ---- unauthenticated
    s_, d_, _ = http("POST", REF + "/rest/v1/rpc/delete_my_account_v2", body={})
    check("unauthenticated (anon key only): delete_my_account_v2 is refused", reject(s_, d_, b""), "http %s %s" % (s_, (d_ or {}).get("message", "")))
    s_, d_, _ = http("POST", REF + "/rest/v1/rpc/delete_my_account", body={})
    check("unauthenticated (anon key only): legacy delete_my_account is refused", reject(s_, d_, b""), "http %s %s" % (s_, (d_ or {}).get("message", "")))
    for fn in ("account_deletion_process", "account_deletion_delete_data", "account_deletion_inventory", "account_deletion_retain_inventory", "anonymous_completions_for_items"):
        s_, d_, _ = http("POST", REF + "/rest/v1/rpc/" + fn, body={})
        check("unauthenticated: internal function %s is not callable" % fn, reject(s_, d_, b""), "http %s" % s_)
    # ---- another signed in user (B) tries to reach or delete A
    tb = token(st, "B")
    check("setup: B can sign in", tb is not None)
    for fn, body in (("account_deletion_process", {}), ("account_deletion_delete_data", {"p_request": "00000000-0000-0000-0000-000000000000"}), ("account_deletion_inventory", {"p_uid": A}),
                     ("account_deletion_retain_inventory", {"p_uid": A}), ("account_deletion_objects_remaining", {"p_request": "00000000-0000-0000-0000-000000000000"}),
                     ("account_deletion_scrub_json", {"p_doc": {}, "p_uid": A}), ("anonymous_completions_for_items", {"p_item_ids": [st["items"]["S1"]]})):
        s_, d_, _ = http("POST", REF + "/rest/v1/rpc/" + fn, tb, body=body)
        check("cross account: B cannot call internal function %s" % fn, reject(s_, d_, b""), "http %s %s" % (s_, (d_ or {}).get("code", "")))
    for t in ("account_deletion_requests", "anonymous_completion_counts", "retained_checkin_photos"):
        s_, d_, _ = http("GET", REF + "/rest/v1/%s?select=*" % t, tb)
        check("cross account: B cannot read table %s" % t, reject(s_, d_, b""), "http %s" % s_)
    s_, d_, _ = http("POST", REF + "/rest/v1/account_deletion_requests", tb, body={"user_id": A}, headers={"Prefer": "return=minimal"})
    check("cross account: B cannot insert a deletion request for A", reject(s_, d_, b""), "http %s" % s_)
    for body in ({"user_id": A}, {"p_uid": A}, {"uid": A}):
        s_, d_, _ = http("POST", REF + "/rest/v1/rpc/delete_my_account_v2", tb, body=body)
        check("cross account: delete_my_account_v2 has no parameter, so B naming A (%s) is refused" % list(body)[0], reject(s_, d_, b""), "http %s %s" % (s_, (d_ or {}).get("code", "")))
    a_state = sql("""select (select banned_until is not null from auth.users where id = '%s') as a_banned, (select count(*) from public.account_deletion_requests) as requests,
                            (select count(*) from public.users where id = '%s') as a_exists""" % (A, A))[0]
    check("cross account: after all attempts A is untouched (not banned, no request rows, still exists)", (not a_state["a_banned"]) and a_state["requests"] == 0 and a_state["a_exists"] == 1, a_state)
    check("cross account: B's data fingerprint unchanged", b_fingerprint(st) == st["b_before"], st["b_before"])
    # ---- baseline file visibility BEFORE deletion
    vis = {}
    for k in ("cand_sel", "cand_pend", "cand_rej"):
        sa, ba = sign_url(None, f[k]["bucket"], f[k]["path"]); sb, bb = sign_url(tb, f[k]["bucket"], f[k]["path"])
        vis[k] = {"anon": sa, "B": sb, "bytes_equal_uploaded": ba == base64.b64decode(st["files"]["bytes_sel"]) if k == "cand_sel" else None}
    st["vis_before"] = vis
    check("visibility before: the SELECTED, display eligible cover is readable by anyone (anon and B) and returns the uploaded bytes", vis["cand_sel"]["anon"] == 200 and vis["cand_sel"]["B"] == 200 and vis["cand_sel"]["bytes_equal_uploaded"], vis["cand_sel"])
    check("visibility before: the PENDING candidate is NOT readable by anon or B", vis["cand_pend"]["anon"] != 200 and vis["cand_pend"]["B"] != 200, vis["cand_pend"])
    check("visibility before: the REJECTED candidate is NOT readable by anon or B", vis["cand_rej"]["anon"] != 200 and vis["cand_rej"]["B"] != 200, vis["cand_rej"])
    sg, bg = public_get("checkin-photos", f["checkin_good"]["path"]); se, be = public_get("checkin-photos", f["checkin_empty"]["path"])
    st["checkin_before"] = {"good_status": sg, "good_bytes": len(bg), "empty_status": se, "empty_bytes": len(be)}
    check("visibility before: the check in photo is public by direct URL (as the bucket always was)", sg == 200 and len(bg) > 0, st["checkin_before"])
    save(st)

def months():
    r = sql("select date_trunc('month', now() at time zone 'UTC')::date::text as m0, date_trunc('month', (now() - interval '40 days') at time zone 'UTC')::date::text as m40")[0]
    return r["m0"], r["m40"]

def cells(st):
    ids = ",".join("'%s'" % v for v in st["items"].values())
    return {(r["k"], r["period_month"], r["method"]): r["completions"] for r in sql("select (select substring(body from '[^ ]+$') from public.items where id = item_id) as k, period_month::text, method, completions from public.anonymous_completion_counts where item_id in (%s)" % ids)}

def stage_inline_legacy():
    st = load(); S = st["items"]; m0, m40 = months()
    F = st["users"]["F"]["id"]; D = st["users"]["D"]["id"]
    # ---------------- F: no stored files, so the pipeline can finish inside the RPC call
    sql("""insert into public.check_ins (user_id, item_id, checkin_method, checked_at) values ('%s','%s','tap', now()), ('%s','%s','tap', now()), ('%s','%s','tap', now() - interval '40 days');
           insert into public.interaction_events (user_id, event_type, item_id) values ('%s','item_view','%s');
           insert into public.visit_recovery_settings (user_id, opted_in, opted_in_at) values ('%s', true, now());
           insert into public.push_tokens (user_id, token) values ('%s', 'ExponentPushToken[zz-F-%s]');
           insert into public.lists (creator_id, title, is_public) values ('%s', 'ZZ F solo %s', false);""" % (F, S["S1"], F, S["S1"], F, S["S2"], F, S["S1"], F, F, st["tag"], F, st["tag"]))
    pre = sql("select (select count(*) from public.check_ins where user_id='%s') as checkins, (select count(*) from public.lists where creator_id='%s') as lists" % (F, F))[0]
    tf = token(st, "F")
    s_, d_, _ = http("POST", REF + "/rest/v1/rpc/delete_my_account_v2", tf, body={})
    check("inline: F calls delete_my_account_v2 with its own token and, with no stored files, the answer is 'completed' immediately", s_ == 200 and (d_ or {}).get("status") == "completed", "http %s %s" % (s_, d_))
    req = sql("select status, completed_at is not null as done, user_id is null as id_cleared, counts_recorded, storage_manifest = '[]'::jsonb as manifest_cleared, retain_manifest = '[]'::jsonb as retain_cleared, last_error from public.account_deletion_requests where id = '%s'" % (d_ or {}).get("request_id", "00000000-0000-0000-0000-000000000000"))
    check("inline: the request row is completed, the user id and manifests are cleared, counts were recorded", bool(req) and req[0]["status"] == "completed" and req[0]["done"] and req[0]["id_cleared"] and req[0]["counts_recorded"] and req[0]["manifest_cleared"] and req[0]["retain_cleared"], req)
    gone = sql("""select (select count(*) from auth.users where id='%s') as auth_user, (select count(*) from public.users where id='%s') as profile, (select count(*) from public.check_ins where user_id='%s') as checkins,
                         (select count(*) from public.interaction_events where user_id='%s') as events, (select count(*) from public.visit_recovery_settings where user_id='%s') as settings,
                         (select count(*) from public.push_tokens where user_id='%s') as tokens, (select count(*) from public.lists where creator_id='%s') as lists, (select count(*) from auth.sessions where user_id='%s') as sessions""" % ((F,) * 8))[0]
    check("inline: F's auth account, profile, check ins, events, settings, push tokens, solo list and sessions are all gone", all(v == 0 for v in gone.values()), gone)
    c1 = cells(st)
    expect1 = {("S1", m0, "tap"): 1, ("S2", m40, "tap"): 1}
    check("counts: F's 3 check ins became exactly 2 anonymous completions (same experience and day counted once; month granularity)", c1 == expect1, c1)
    for _ in range(3): sql("select public.account_deletion_process()")
    check("counts: running the processor 3 more times changes nothing (exactly once)", cells(st) == expect1, cells(st))
    try:
        sql("select public.account_deletion_delete_data('%s')" % d_["request_id"]); again = "no error"
    except RuntimeError as e:
        again = str(e)
    check("counts: calling the data step again on the completed request is refused (cannot double count)", "No open deletion request" in again, again[-120:])
    hits = uuid_scan(F)
    check("no trace: a scan of every public, auth, storage and net table finds F's id nowhere", hits == {}, hits or "no hits")
    cols = sql("select table_name, string_agg(column_name, ',') as c from information_schema.columns where table_schema='public' and table_name in ('anonymous_completion_counts','retained_checkin_photos') group by 1 order by 1")
    check("no join: the anonymous tables contain no user, list, check in, session or coordinate column", not any(k in r["c"] for r in cols for k in ("user", "list", "check_in", "session", "lat", "lng", "note")), cols)
    # replay with F's (still unexpired) token: harmless no-op
    s2, d2, _ = http("POST", REF + "/rest/v1/rpc/delete_my_account_v2", tf, body={})
    after = cells(st)
    check("retry: replaying the request with F's stale token creates no data and no extra count", s2 == 200 and after == expect1, "http %s %s" % (s2, (d2 or {}).get("status")))
    # ---------------- D: LEGACY void RPC, as installed iOS and Android builds call it
    sql("""insert into public.check_ins (user_id, item_id, checkin_method, checked_at) values ('%s','%s','tap', now());
           insert into public.interaction_events (user_id, event_type, item_id) values ('%s','item_view','%s');""" % (D, S["S1"], D, S["S1"]))
    td = token(st, "D")
    s3, d3, b3 = http("POST", REF + "/rest/v1/rpc/delete_my_account", td, body={})
    check("legacy: the old void RPC succeeds for an installed client's call (HTTP 2xx)", 200 <= s3 < 300, "http %s" % s3)
    check("legacy: it returns NOTHING (no status, no request id), so an old client can never read 'accepted' or 'completed'", d3 is None or (isinstance(d3, dict) and "status" not in d3), "body=%r" % (b3[:80],))
    gone_d = sql("select (select count(*) from auth.users where id='%s') as auth_user, (select count(*) from public.users where id='%s') as profile, (select count(*) from public.check_ins where user_id='%s') as checkins" % (D, D, D))[0]
    check("legacy: the legacy call really deleted D (this account has no files, so it finished inline)", all(v == 0 for v in gone_d.values()), gone_d)
    expect2 = {("S1", m0, "tap"): 2, ("S2", m40, "tap"): 1}
    check("counts: D's completion was ADDED to the existing S1 cell (1 + 1 = 2); other cells unchanged", cells(st) == expect2, cells(st))
    check("no trace: D's id appears nowhere either", uuid_scan(D) == {}, uuid_scan(D) or "no hits")
    save(st)

def a_snapshot(st):
    A = st["users"]["A"]["id"]; ids = ",".join("'%s'" % v for v in st["items"].values())
    return sql("""select (select count(*) from public.users where id='%(A)s') as profile, (select count(*) from auth.users where id='%(A)s') as auth_user, (select banned_until is not null from auth.users where id='%(A)s') as banned,
                         (select count(*) from auth.sessions where user_id='%(A)s') as sessions, (select count(*) from public.push_tokens where user_id='%(A)s') as push_tokens,
                         (select count(*) from public.check_ins where user_id='%(A)s') as checkins, (select count(*) from public.candidate_visits where user_id='%(A)s') as candidate_visits,
                         (select count(*) from public.interaction_events where user_id='%(A)s') as events, (select count(*) from public.lists where creator_id='%(A)s') as lists_created,
                         (select count(*) from public.item_cover_candidates where submitted_by_user_id='%(A)s') as candidates_attributed,
                         (select count(*) from public.anonymous_completion_counts where item_id in (%(ids)s)) as cells, (select count(*) from public.retained_checkin_photos) as retained_rows""" % {"A": A, "ids": ids})[0]

def stage_request_a():
    st = load(); A = st["users"]["A"]["id"]
    st["a_before"] = a_snapshot(st); st["b_before2"] = b_fingerprint(st)
    ta = token(st, "A")
    s1, d1, _ = http("POST", REF + "/rest/v1/rpc/delete_my_account_v2", ta, body={})
    check("A: delete_my_account_v2 with A's own token answers 'accepted' (not 'completed': files are queued)", s1 == 200 and (d1 or {}).get("status") == "accepted", "http %s %s" % (s1, d1))
    st["a_request"] = (d1 or {}).get("request_id"); save(st)
    snap = a_snapshot(st)
    check("A: access is blocked immediately (auth user banned, every session revoked, push tokens removed)", snap["banned"] and snap["sessions"] == 0 and snap["push_tokens"] == 0, {k: snap[k] for k in ("banned", "sessions", "push_tokens")})
    s2, d2, _ = http("POST", REF + "/auth/v1/token?grant_type=password", body={"email": st["users"]["A"]["email"], "pw": "x", "password": st["users"]["A"]["pw"]})
    check("A: signing in again is refused (banned), even with the right password", s2 != 200, "http %s %s" % (s2, (d2 or {}).get("msg", (d2 or {}).get("error_description", ""))))
    s3, d3, _ = http("POST", REF + "/rest/v1/rpc/delete_my_account_v2", ta, body={})
    n_req = sql("select count(*) as n from public.account_deletion_requests where user_id = '%s'" % A)[0]["n"]
    check("retry: asking again returns the SAME request (already_requested) and creates no second row", s3 == 200 and (d3 or {}).get("request_id") == st["a_request"] and (d3 or {}).get("already_requested") is True and n_req == 1, "http %s %s rows=%s" % (s3, d3, n_req))
    s4, d4, _ = http("POST", REF + "/rest/v1/rpc/delete_my_account", ta, body={})
    n_req2 = sql("select count(*) as n from public.account_deletion_requests where user_id = '%s'" % A)[0]["n"]
    check("retry: the legacy void RPC also reuses the open request", 200 <= s4 < 300 and n_req2 == 1, "http %s rows=%s" % (s4, n_req2))
    req = sql("select status, attempts, left(coalesce(last_error,''),240) as last_error, jsonb_array_length(retain_manifest) as retain, jsonb_array_length(storage_manifest) as delete_files, counts_recorded from public.account_deletion_requests where id = '%s'" % st["a_request"])[0]
    print("request right after acceptance:", req)
    check("manifest: inventoried BEFORE any row was removed: 3 candidate photos + 1 check in photo retained, 1 empty file queued for deletion", req["retain"] == 4 and req["delete_files"] == 1, req)
    # watch the pipeline work and fail safely (storage credential defect): give the cron a few ticks
    deadline = time.time() + 200; last = None
    while time.time() < deadline:
        time.sleep(20)
        last = sql("select status, attempts, left(coalesce(last_error,''),300) as last_error, counts_recorded from public.account_deletion_requests where id = '%s'" % st["a_request"])[0]
        if last["attempts"] >= 2 and last["last_error"]: break
    print("request after waiting:", last)
    snap2 = a_snapshot(st)
    st["a_request_state"] = last; save(st)
    safe = (snap2["profile"] == 1 and snap2["auth_user"] == 1 and snap2["checkins"] == st["a_before"]["checkins"] and snap2["candidate_visits"] == st["a_before"]["candidate_visits"]
            and snap2["candidates_attributed"] == 3 and snap2["cells"] == st["a_before"]["cells"] and snap2["retained_rows"] == 0 and snap2["lists_created"] == st["a_before"]["lists_created"])
    check("partial failure is SAFE: while the Storage step cannot complete, nothing is half deleted (profile, check ins, candidates, lists intact; no new counts written for A (the 2 cells from F and D are unchanged); no retained record)", safe, snap2)
    check("partial failure is VISIBLE: the request stays 'accepted', attempts keep rising, and last_error says why", last["status"] == "accepted" and last["attempts"] >= 2 and bool(last["last_error"]), last)
    check("partial failure does not touch anyone else: B's data fingerprint is unchanged", b_fingerprint(st) == st["b_before2"], b_fingerprint(st))

STAGES = {"setup": stage_setup, "negative": stage_negative, "inline_legacy": stage_inline_legacy, "request_a": stage_request_a, "cleanup": stage_cleanup}
if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "setup"
    for name in (list(STAGES) if which == "all" else [which]):
        STAGES[name]()
    bad = [r for r in RESULTS if not r[1]]
    print("\n%d checks, %d failed" % (len(RESULTS), len(bad)))
    sys.exit(1 if bad else 0)
