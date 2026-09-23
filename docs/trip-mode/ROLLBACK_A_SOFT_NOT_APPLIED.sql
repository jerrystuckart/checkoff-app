-- =============================================================================
-- ROLLBACK A — SOFT ROLLBACK. Safe to run at any time, including AFTER
-- real Trip Mode use. Does not touch columns, the constraint, the trigger,
-- or any existing check_ins row (live or retroactive) in any way.
--
-- WHAT THIS DOES: disables Trip Mode for the Munich list only. Because
-- the client (screens/ItemDetailScreen.jsx's tripModeListMeta effect,
-- screens/ListScreen.jsx's loadListMeta) fetches `lists.trip_mode_enabled`
-- fresh from the database on every screen load/focus — it is never
-- cached beyond the current screen mount — flipping this single column is
-- itself the kill switch. NO APP UPDATE, REDEPLOY, OR OTA IS NEEDED: the
-- "Check off from this trip" entry point and the ListScreen banner both
-- stop appearing the next time any user's client re-fetches this list's
-- metadata (already-open screens catch up on their next focus/refresh).
--
-- Preserves: experienced_at, verification_method, and awarded points on
-- every row already created via Trip Mode — nothing about a completed
-- retroactive check-in changes. A user who already used Trip Mode keeps
-- their points/memory/completion exactly as before; only NEW submissions
-- become unavailable.
-- =============================================================================

UPDATE public.lists
SET trip_mode_enabled = false
WHERE id = '692cb6bc-cbeb-4740-af6f-5f1833673a0f'::uuid;

-- Verification (read-only, safe to run any time):
-- SELECT id, title, trip_mode_enabled FROM public.lists WHERE id = '692cb6bc-cbeb-4740-af6f-5f1833673a0f'::uuid;
-- expect trip_mode_enabled = false, everything else unchanged.
