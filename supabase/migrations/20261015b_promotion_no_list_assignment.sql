-- Promotion no longer adds the new item to any list. Which lists an experience belongs to is CheckOff's own curation (admin tool).
-- The parameter p_list_id is kept so existing callers keep working, and is ignored. Nothing else about promotion changes:
-- the item is still created inactive, decisions are copied with the Chamber's attribution, and the proposal is linked.
CREATE OR REPLACE FUNCTION public.promote_destination_candidate(p_candidate_id uuid, p_by text, p_neighborhood_id uuid, p_list_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;
