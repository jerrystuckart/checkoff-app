-- Only a CheckOff administrator (or the service role) may create a list as official, or mark an existing list official.
-- Until now any signed-in user could create their own list and set is_official = true / is_public = true in a metro, which is exactly what Home shows
-- as an official list. The app only ever writes is_official = false from clients, and all existing official lists were created by an admin, so
-- ordinary use is unaffected. Personal lists, public personal lists and everything an admin does are unchanged.
create or replace function public.guard_list_official() returns trigger language plpgsql as $f$
begin
  if new.is_official is true and (tg_op = 'INSERT' or old.is_official is distinct from true) and not public.caller_is_admin_or_service() then
    raise exception 'Only a CheckOff administrator can create or mark an official list' using errcode = '42501';
  end if;
  return new;
end $f$;
drop trigger if exists trg_guard_list_official on public.lists;
create trigger trg_guard_list_official before insert or update of is_official on public.lists
  for each row execute function public.guard_list_official();
