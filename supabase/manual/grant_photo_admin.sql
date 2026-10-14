-- MANUAL, OPERATOR-ONLY. Run through the Supabase SQL editor or `supabase db query --linked -f`
-- (service role / postgres). It cannot be reached from the app: photo_admins has RLS on, no policies,
-- and all privileges revoked from anon/authenticated.
--
-- Grant (replace the email), then confirm exactly one row came back:
INSERT INTO public.photo_admins (user_id, granted_by, note)
SELECT id, id, 'initial photo admin'
FROM public.users
WHERE lower(email) = lower('REPLACE_WITH_ACCOUNT_EMAIL')
ON CONFLICT (user_id) DO NOTHING
RETURNING user_id;

-- Revoke later:
-- DELETE FROM public.photo_admins WHERE user_id = '<user uuid>';
