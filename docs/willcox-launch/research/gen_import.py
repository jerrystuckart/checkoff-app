import json,importlib.util
spec=importlib.util.spec_from_file_location('d','candidates_data.py'); d=importlib.util.module_from_spec(spec); spec.loader.exec_module(d)
prod=json.load(open('/private/tmp/claude-501/-Users-jerrystuckart-Downloads-checkoff/d433b474-2097-436e-8b92-88fd0f856ded/scratchpad/prod_items.json'))
FULL={p['id'][:8]:p['id'] for p in prod}
DEST='bb4f0caf-c6ce-4eae-a7fd-c622bf115639'
def q(s): return 'NULL' if s is None or s=='' else '$q$'+s+'$q$'
out=["-- Willcox candidate review import (2026-10-06). Writes ONLY to destination_item_candidates and destination_item_decisions.",
     "-- Never touches public.items. Idempotent: candidates are skipped if the same place_name + candidate_type already exists.",
     "begin;","-- 1. Prefill CheckOff recommendations on the 26 LIVE items (does not overwrite Chamber decisions or owners)."]
for pre,(mem,rec,status,note,lists,internal) in d.LIVE.items():
    iid=FULL[pre]
    out.append(f"""insert into public.destination_item_decisions (destination_id, item_id, chamber_membership_status, recommended_decision, recommendation_note, list_recommendation, research_notes, content_status, decided_by, updated_at)
values ('{DEST}'::uuid, '{iid}'::uuid, '{mem}', '{rec}', {q(note)}, {q(lists)}, {q(internal)}, '{status}', 'checkoff-research-2026-10-06', now())
on conflict (destination_id, item_id) do update set chamber_membership_status = excluded.chamber_membership_status, recommended_decision = excluded.recommended_decision,
  recommendation_note = excluded.recommendation_note, list_recommendation = excluded.list_recommendation, research_notes = excluded.research_notes,
  content_status = coalesce(public.destination_item_decisions.content_status, excluded.content_status), updated_at = now();""")
out.append("-- 2. Candidates.")
for c in d.CANDS:
    ex = f"'{ {**{k:v for k,v in FULL.items()}}[c['existing']] }'::uuid" if c['existing'] else 'NULL'
    srcs=json.dumps([{'url':d.S[k],'checked':d.DATE} for k in c['sources']])
    out.append(f"""insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select '{DEST}'::uuid, '{c['ctype']}', {q(c['group'])}, {q(c['place'])}, {q(c['body'])}, (select id from public.categories where name = {q(c['cat'])}), '{c['origin']}', {ex},
  '{c['membership']}', '{c['rec']}', {q(c['reason'])}, '{c['status']}', '{c['owner']}', {q(c['ownername'])},
  '{c['rstatus']}', {q(c['lists'])}, {q(c['internal'])}, $j${srcs}$j$::jsonb, {q(c['confirm'])}
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = '{DEST}'::uuid and x.place_name = {q(c['place'])} and x.candidate_type = '{c['ctype']}');""")
out.append("commit;")
open('../import-candidates.sql','w').write('\n'.join(out)+'\n')
print(len(d.CANDS),'candidates,',len(d.LIVE),'live prefills')
