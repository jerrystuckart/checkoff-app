# Willcox destination landing (getcheckoff.com/willcox)

- Page: getcheckoff-site `public/willcox/index.html`, served at `/willcox` by a rewrite in `vercel.json` (the old redirect to the pitch page was removed). `/willcox/willcox-pitch.html` is untouched.
- App route: `checkoff://destination/<destinations.id>` -> `Hub` screen (`lib/linkingConfig.js`, test `lib/destinationLink.test.js`). Willcox id `bb4f0caf-c6ce-4eae-a7fd-c622bf115639`. Needs an app build/OTA that includes this line; older builds open at Home.
- Attribution: `utm_source|medium|campaign|content` are read from the URL, appended to the app link, added to the Play `referrer`, and written to `landing_events` (see `getcheckoff-site/supabase/landing_events.sql`, must be applied once).
- Events: landing_view, app_open_attempt, app_open_success (heuristic: page hidden/blurred within 4s), appstore_click, playstore_click. "Hub opened" is not observable from the web; app_open_success is the proxy.
- Not done (follow-ups): deferred deep linking (none exists: a fresh install opens at Home); iOS Universal Link and Android App Link for `/willcox` (AASA/intent filter currently exclude it on purpose, so old builds never swallow the landing page); in-app capture of UTM params for install attribution.
