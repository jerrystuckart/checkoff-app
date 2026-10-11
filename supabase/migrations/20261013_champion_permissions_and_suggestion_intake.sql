-- Champion permissions boundary + CheckOff-controlled suggestion intake. Additive/hardening only; no data is changed.

-- 1. Suggestions from Champions land here, NOT in the candidate inventory. Service role only (RLS on, no policies).
create table if not exists public.destination_item_suggestions (
  id uuid primary key default gen_random_uuid(),
  destination_id uuid not null references public.destinations(id) on delete cascade,
  place_name text not null check (char_length(place_name) <= 160),
  experience text check (char_length(experience) <= 600),
  note text check (char_length(note) <= 1000),
  suggested_by text not null,
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  reviewed_by text,
  reviewed_at timestamptz,
  review_note text check (char_length(review_note) <= 1000),
  accepted_candidate_id uuid references public.destination_item_candidates(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists destination_item_suggestions_dest_idx on public.destination_item_suggestions (destination_id, status, created_at desc);
alter table public.destination_item_suggestions enable row level security;
revoke all on public.destination_item_suggestions from anon, authenticated;

-- 2. Database backstop: nothing may put a raw Champion suggestion into the approvable candidate inventory.
create or replace function public.block_champion_request_candidates() returns trigger language plpgsql as $t$
begin
  if new.origin = 'champion_request' or new.candidate_type = 'request' then
    raise exception 'Champion suggestions go to destination_item_suggestions and need CheckOff acceptance before they become candidates' using errcode = '42501';
  end if;
  return new;
end $t$;
drop trigger if exists trg_block_champion_request_candidates on public.destination_item_candidates;
create trigger trg_block_champion_request_candidates before insert or update of origin, candidate_type on public.destination_item_candidates
  for each row execute function public.block_champion_request_candidates();

-- 3. Who may call privileged, security-definer helpers: the service role (server routes) or a CheckOff admin.
create or replace function public.caller_is_admin_or_service() returns boolean
language sql stable security definer set search_path = public as $f$
  select coalesce(auth.role(), '') = 'service_role'
      or exists (select 1 from public.users u where u.id = auth.uid() and u.is_admin = true)
$f$;
revoke all on function public.caller_is_admin_or_service() from public;
grant execute on function public.caller_is_admin_or_service() to anon, authenticated, service_role;

-- 4. update_item_location and create_seasonal_list were executable by anonymous callers. They now require an admin or the service role.
CREATE OR REPLACE FUNCTION public.update_item_location(item_id uuid, new_lat double precision, new_lng double precision)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.caller_is_admin_or_service() THEN
    RAISE EXCEPTION '% requires an administrator', 'update_item_location' USING ERRCODE = '42501';
  END IF;

  IF new_lat IS NULL OR new_lng IS NULL THEN
    RAISE EXCEPTION 'update_item_location: new_lat and new_lng are required';
  END IF;

  UPDATE items
  SET
    maps_lat     = new_lat,
    maps_lng     = new_lng,
    geo_location = ST_SetSRID(ST_MakePoint(new_lng, new_lat), 4326)
  WHERE id = item_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'update_item_location: no item found with id %', item_id;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_seasonal_list(p_metro_id uuid, p_season_id uuid, p_title text DEFAULT NULL::text, p_emoji text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_list_id    uuid;
  v_season     record;
  v_metro      record;
  v_hood_ids   uuid[];
  v_item_ids   uuid[];
  v_title      text;
  v_emoji      text;
BEGIN
  IF NOT public.caller_is_admin_or_service() THEN
    RAISE EXCEPTION '% requires an administrator', 'create_seasonal_list' USING ERRCODE = '42501';
  END IF;

  -- Load season and metro
  SELECT * INTO v_season FROM public.seasons WHERE id = p_season_id;
  SELECT * INTO v_metro  FROM public.metro_areas WHERE id = p_metro_id;

  IF v_season IS NULL THEN RAISE EXCEPTION 'Season not found'; END IF;
  IF v_metro  IS NULL THEN RAISE EXCEPTION 'Metro not found'; END IF;

  -- Build title
  v_title := COALESCE(p_title,
    initcap(v_season.name) || ' ' || v_season.year || ' — ' || v_metro.name);

  -- Build emoji
  v_emoji := COALESCE(p_emoji, CASE v_season.name
    WHEN 'summer' THEN '☀'
    WHEN 'fall'   THEN '🍂'
    WHEN 'winter' THEN '❄'
    WHEN 'spring' THEN '🌸'
    ELSE '📋'
  END);

  -- Check if this seasonal list already exists for this metro
  SELECT id INTO v_list_id
  FROM public.lists
  WHERE is_official = true
    AND metro_id    = p_metro_id
    AND season_id   = p_season_id
  LIMIT 1;

  IF v_list_id IS NOT NULL THEN
    RAISE NOTICE 'Seasonal list already exists: %', v_list_id;
    RETURN v_list_id;
  END IF;

  -- Create the list
  INSERT INTO public.lists (
    creator_id, title, metro_id, season_id,
    starts_at, ends_at, is_public, is_official, cover_emoji,
    invite_code
  )
  VALUES (
    (SELECT id FROM public.users WHERE is_admin = true LIMIT 1),
    v_title,
    p_metro_id,
    p_season_id,
    v_season.starts_at,
    v_season.ends_at,
    true,   -- public
    true,   -- official
    v_emoji,
    encode(gen_random_bytes(6), 'hex')
  )
  RETURNING id INTO v_list_id;

  -- Get all neighborhood IDs for this metro
  SELECT ARRAY_AGG(id) INTO v_hood_ids
  FROM public.neighborhoods
  WHERE metro_id = p_metro_id AND is_active = true;

  -- Collect item IDs:
  -- Universal items that match this season (or have no season tag)
  -- + Neighborhood items in this metro that match this season
  SELECT ARRAY_AGG(DISTINCT i.id) INTO v_item_ids
  FROM public.items i
  WHERE i.is_active = true
    AND i.is_approved = true
    AND (
      -- Universal items: no season restriction, or matching season
      (i.is_universal = true AND (i.season_tag IS NULL OR i.season_tag = v_season.name))
      OR
      -- Metro-specific items: in one of this metro's neighborhoods
      (i.is_universal = false
        AND i.neighborhood_id = ANY(v_hood_ids)
        AND (i.season_tag IS NULL OR i.season_tag = v_season.name)
      )
    );

  -- Insert list_items
  IF v_item_ids IS NOT NULL THEN
    INSERT INTO public.list_items (list_id, item_id, sort_order)
    SELECT v_list_id, unnest(v_item_ids), ROW_NUMBER() OVER () - 1;
  END IF;

  RAISE NOTICE 'Created seasonal list "%" with % items',
    v_title, COALESCE(ARRAY_LENGTH(v_item_ids, 1), 0);

  RETURN v_list_id;
END;
$function$;

-- 5. Promotion: only CheckOff-created candidates, and a named actor.
create or replace function public.promote_destination_candidate(p_candidate_id uuid, p_by text, p_neighborhood_id uuid, p_list_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  c destination_item_candidates%rowtype;
  d jsonb;
  v_item uuid;
  v_dup uuid;
  v_name text;
  v_lat double precision;
  v_lng double precision;
  v_diff int;
  v_type text;
begin
  -- Row lock: concurrent promotions of the same proposal queue here; the second sees status='promoted' and returns the first result.
  select * into c from destination_item_candidates where id = p_candidate_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if c.status = 'promoted' and c.promoted_item_id is not null then
    return jsonb_build_object('ok', true, 'already', true, 'item_id', c.promoted_item_id, 'type', case when c.candidate_type = 'rewrite' then 'rewrite' else 'new' end);
  end if;
  if c.status <> 'proposed' then return jsonb_build_object('ok', false, 'code', 'not_proposed'); end if;
  -- only CheckOff-created candidates are promotable; a raw Champion suggestion must be accepted into the inventory first
  if c.candidate_type not in ('new', 'rewrite') or c.origin = 'champion_request' then return jsonb_build_object('ok', false, 'code', 'not_accepted'); end if;
  if coalesce(p_by, '') = '' then return jsonb_build_object('ok', false, 'code', 'no_actor'); end if;
  if c.chamber_decision is distinct from 'include' then return jsonb_build_object('ok', false, 'code', 'not_included'); end if;
  if coalesce(c.body_provisional, false) then return jsonb_build_object('ok', false, 'code', 'provisional'); end if;
  if c.proposed_content_status = 'not_included' then return jsonb_build_object('ok', false, 'code', 'not_included_status'); end if;
  if coalesce(trim(c.proposed_body), '') = '' then return jsonb_build_object('ok', false, 'code', 'no_body'); end if;
  if not exists (select 1 from destination_lists dl where dl.destination_id = c.destination_id and dl.list_id = p_list_id and dl.is_active) then
    return jsonb_build_object('ok', false, 'code', 'bad_list');
  end if;
  if not exists (select 1 from neighborhoods n where n.id = p_neighborhood_id) then return jsonb_build_object('ok', false, 'code', 'bad_neighborhood'); end if;

  if c.candidate_type = 'rewrite' then
    if c.existing_item_id is null then return jsonb_build_object('ok', false, 'code', 'no_existing_item'); end if;
    perform 1 from items where id = c.existing_item_id for update;
    if not found then return jsonb_build_object('ok', false, 'code', 'no_existing_item'); end if;
    update destination_item_candidates set previous_body = (select body from items where id = c.existing_item_id) where id = c.id;
    update items set body = c.proposed_body where id = c.existing_item_id;   -- text only: visibility, location and everything else stay as they are
    update destination_item_candidates set status = 'promoted', promoted_item_id = c.existing_item_id, promoted_at = now(), promoted_by = p_by where id = c.id;
    return jsonb_build_object('ok', true, 'item_id', c.existing_item_id, 'type', 'rewrite');
  end if;

  d := c.promotion_details;
  if d is null or coalesce(d->>'confirmed_by', '') = '' then return jsonb_build_object('ok', false, 'code', 'details_not_confirmed'); end if;
  if c.category_id is null then return jsonb_build_object('ok', false, 'code', 'no_category'); end if;
  v_lat := nullif(d->>'maps_lat', '')::double precision;
  v_lng := nullif(d->>'maps_lng', '')::double precision;
  if v_lat is null or v_lng is null or v_lat not between -90 and 90 or v_lng not between -180 and 180 then return jsonb_build_object('ok', false, 'code', 'no_location'); end if;
  if coalesce(d->>'formatted_address', '') = '' and coalesce(d->>'maps_query', '') = '' then return jsonb_build_object('ok', false, 'code', 'no_address'); end if;
  v_diff := coalesce(nullif(d->>'difficulty', '')::int, 1);
  if v_diff not in (1, 5, 10, 25) then return jsonb_build_object('ok', false, 'code', 'bad_difficulty'); end if;
  v_type := coalesce(nullif(d->>'checkin_type', ''), 'tap');
  if v_type not in ('tap', 'photo', 'gps') then return jsonb_build_object('ok', false, 'code', 'bad_checkin_type'); end if;

  -- duplicate guard: same Google place, same address, or same quoted place name already in this neighborhood
  if coalesce((d->>'confirmedDistinct')::boolean, false) = false then
    v_name := lower(regexp_replace(coalesce(substring(c.proposed_body from '''([^'']+)'''), c.place_name), '[^a-zA-Z0-9]+', ' ', 'g'));
    select i.id into v_dup from items i
     where i.neighborhood_id = p_neighborhood_id
       and ( (nullif(d->>'google_place_id', '') is not null and i.google_place_id = d->>'google_place_id')
          or (nullif(d->>'formatted_address', '') is not null and i.formatted_address = d->>'formatted_address')
          or (trim(v_name) <> '' and trim(lower(regexp_replace(coalesce(substring(i.body from '''([^'']+)'''), ''), '[^a-zA-Z0-9]+', ' ', 'g'))) = trim(v_name)) )
     limit 1;
    if v_dup is not null then return jsonb_build_object('ok', false, 'code', 'duplicate', 'item_id', v_dup); end if;
  end if;

  insert into items (body, category_id, neighborhood_id, checkin_type, difficulty, geo_radius_m, maps_lat, maps_lng, maps_query, google_place_id,
                     formatted_address, website_url, has_alcohol, active_from, active_until, is_active, is_approved)
  values (c.proposed_body, c.category_id, p_neighborhood_id, v_type, v_diff, coalesce(nullif(d->>'geo_radius_m', '')::double precision, 100), v_lat, v_lng,
          nullif(d->>'maps_query', ''), nullif(d->>'google_place_id', ''), nullif(d->>'formatted_address', ''), nullif(d->>'website_url', ''),
          coalesce((d->>'has_alcohol')::boolean, false), nullif(d->>'active_from', '')::date, nullif(d->>'active_until', '')::date, false, true)
  returning id into v_item;
  if nullif(d->>'visit_profile_key', '') is not null then
    update items set visit_profile_key = d->>'visit_profile_key', visit_profile_source = 'admin' where id = v_item;
  end if;

  insert into list_items (list_id, item_id, sort_order)
  values (p_list_id, v_item, coalesce((select max(sort_order) + 1 from list_items where list_id = p_list_id), 0));

  -- the live item inherits the Chamber's decision, attribution and membership exactly as recorded on the proposal
  insert into destination_item_decisions (destination_id, item_id, decision, decision_source, decided_by, content_status, verification_owner_type, verification_owner_name,
                                          chamber_membership_status, membership_set_by, membership_set_at, recommended_decision, recommendation_note, list_recommendation,
                                          research_notes, chamber_question, updated_at)
  values (c.destination_id, v_item, c.chamber_decision, c.decision_source, c.decided_by, c.proposed_content_status, c.verification_owner_type, c.verification_owner_name,
          c.chamber_membership_status, c.membership_set_by, c.membership_set_at, c.recommended_decision, c.recommendation_note, c.list_recommendation,
          c.research_notes, c.chamber_question, coalesce(c.decided_at, now()))
  on conflict (destination_id, item_id) do nothing;

  update destination_item_candidates set status = 'promoted', promoted_item_id = v_item, promoted_at = now(), promoted_by = p_by where id = c.id;
  return jsonb_build_object('ok', true, 'item_id', v_item, 'type', 'new');
end
$fn$;
