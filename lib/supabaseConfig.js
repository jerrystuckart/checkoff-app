// Shared Supabase project config — split out from lib/supabase.js so a
// module that only needs the project URL (e.g. lib/fallbackArtSource.js's
// pure Storage-URL construction) doesn't have to import the full client,
// which pulls in React Native's AsyncStorage/AppState and isn't safe to
// load under plain Node (unit tests, the admin tool's build, etc). Single
// source of truth: lib/supabase.js imports SUPABASE_URL from here too,
// rather than redeclaring it — no duplicated project URL/env config.
export const SUPABASE_URL = 'https://uggusbbswybyplypkbxz.supabase.co'
