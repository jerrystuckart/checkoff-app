-- neighborhood_sweep: inactive/unapproved items no longer make the badge impossible to complete. Both the total and the checked count
-- use only public items. Check-in history is untouched. Only this function body changes.
CREATE OR REPLACE FUNCTION public.check_and_award_badges()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_list_id         uuid;
  v_is_secret       boolean;
  v_neighborhood_id uuid;
  v_cover_emoji     text;
  v_total           bigint;
  v_today           bigint;
  v_week            bigint;
  v_photos          bigint;
  v_checkin_hour    int;
  v_list_total      bigint;
  v_list_checked    bigint;
  v_secrets_total   bigint;
  v_secrets_checked bigint;
  v_nbhd_total      bigint;
  v_nbhd_checked    bigint;
BEGIN
  -- Resolve list context from list_item_id
  SELECT li.list_id, i.is_secret, i.neighborhood_id, l.cover_emoji
  INTO v_list_id, v_is_secret, v_neighborhood_id, v_cover_emoji
  FROM list_items li
  JOIN items i  ON i.id  = li.item_id
  JOIN lists  l ON l.id  = li.list_id
  WHERE li.id = NEW.list_item_id;

  -- Total check-ins for this user
  SELECT COUNT(*) INTO v_total
  FROM check_ins WHERE user_id = NEW.user_id;

  -- Check-ins today
  SELECT COUNT(*) INTO v_today
  FROM check_ins
  WHERE user_id = NEW.user_id AND checked_at >= CURRENT_DATE;

  -- Check-ins in last 7 days
  SELECT COUNT(*) INTO v_week
  FROM check_ins
  WHERE user_id = NEW.user_id AND checked_at >= NOW() - INTERVAL '7 days';

  -- Photo check-ins
  SELECT COUNT(*) INTO v_photos
  FROM check_ins
  WHERE user_id = NEW.user_id AND checkin_method = 'photo';

  -- Local hour (Phoenix — no DST)
  v_checkin_hour := EXTRACT(HOUR FROM NOW() AT TIME ZONE 'America/Phoenix')::int;

  -- ── Milestone badges (>= so bulk inserts don't skip a threshold) ──────────
  IF v_total >= 1   THEN PERFORM award_badge_if_new(NEW.user_id, 'first_checkin'); END IF;
  IF v_total >= 10  THEN PERFORM award_badge_if_new(NEW.user_id, 'checkins_10');   END IF;
  IF v_total >= 25  THEN PERFORM award_badge_if_new(NEW.user_id, 'checkins_25');   END IF;
  IF v_total >= 50  THEN PERFORM award_badge_if_new(NEW.user_id, 'checkins_50');   END IF;
  IF v_total >= 100 THEN PERFORM award_badge_if_new(NEW.user_id, 'checkins_100');  END IF;

  -- ── Activity badges ───────────────────────────────────────────────────────
  IF v_week  >= 5 THEN PERFORM award_badge_if_new(NEW.user_id, 'on_fire');     END IF;
  IF v_today >= 3 THEN PERFORM award_badge_if_new(NEW.user_id, 'speed_run');   END IF;
  IF v_checkin_hour >= 22
                  THEN PERFORM award_badge_if_new(NEW.user_id, 'night_owl');   END IF;
  IF v_photos >= 5 THEN PERFORM award_badge_if_new(NEW.user_id, 'photo_five'); END IF;
  IF v_is_secret  THEN PERFORM award_badge_if_new(NEW.user_id, 'secret_hunter'); END IF;

  -- ── List-completion badges ────────────────────────────────────────────────
  IF v_list_id IS NOT NULL THEN

    SELECT COUNT(*) INTO v_list_total  FROM list_items WHERE list_id = v_list_id;
    SELECT COUNT(*) INTO v_list_checked
    FROM check_ins ci
    JOIN list_items li ON li.id = ci.list_item_id
    WHERE li.list_id = v_list_id AND ci.user_id = NEW.user_id;

    -- seasonal_sweep: finished any list
    IF v_list_total > 0 AND v_list_checked = v_list_total THEN
      PERFORM award_badge_if_new(NEW.user_id, 'seasonal_sweep');
    END IF;

    -- Next 10 specific
    IF v_cover_emoji = '🔟' THEN
      IF v_list_checked >= 3 THEN
        PERFORM award_badge_if_new(NEW.user_id, 'next10_three');
      END IF;
      IF v_list_total > 0 AND v_list_checked = v_list_total THEN
        PERFORM award_badge_if_new(NEW.user_id, 'next10_finisher');
      END IF;

      -- secret_sweep: all secrets in this Next 10 list
      SELECT COUNT(*) INTO v_secrets_total
      FROM list_items li JOIN items i ON i.id = li.item_id
      WHERE li.list_id = v_list_id AND i.is_secret = true;

      SELECT COUNT(*) INTO v_secrets_checked
      FROM check_ins ci
      JOIN list_items li ON li.id = ci.list_item_id
      JOIN items i       ON i.id  = li.item_id
      WHERE li.list_id = v_list_id AND ci.user_id = NEW.user_id AND i.is_secret = true;

      IF v_secrets_total > 0 AND v_secrets_checked = v_secrets_total THEN
        PERFORM award_badge_if_new(NEW.user_id, 'secret_sweep');
      END IF;
    END IF;

    -- neighborhood_sweep: all items in this neighborhood (min 2 items)
    IF v_neighborhood_id IS NOT NULL THEN
      SELECT COUNT(*) INTO v_nbhd_total
      FROM list_items li JOIN items i ON i.id = li.item_id
      WHERE li.list_id = v_list_id AND i.neighborhood_id = v_neighborhood_id
        AND i.is_active = true AND i.is_approved = true;

      SELECT COUNT(*) INTO v_nbhd_checked
      FROM check_ins ci
      JOIN list_items li ON li.id = ci.list_item_id
      JOIN items i       ON i.id  = li.item_id
      WHERE li.list_id = v_list_id AND ci.user_id = NEW.user_id
        AND i.neighborhood_id = v_neighborhood_id
        AND i.is_active = true AND i.is_approved = true;

      IF v_nbhd_total >= 2 AND v_nbhd_checked = v_nbhd_total THEN
        PERFORM award_badge_if_new(NEW.user_id, 'neighborhood_sweep');
      END IF;
    END IF;

  END IF;

  RETURN NEW;
END;
$function$;
