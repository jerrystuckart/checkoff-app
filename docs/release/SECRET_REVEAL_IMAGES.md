# Secret screen images (locked teaser + optional reveal background)

Status: implemented on `feature/secret-reveal-background`; **migration 20261009a NOT applied, OTAs NOT published** (held for visual review).
Admin tool changes live in the local `checkoff_admin.html` (not in git); the exact diff is `admin_secret_image_controls.diff` (apply with `patch checkoff_admin.html < ...`).

## Roles (all in bucket `submission-photos`)
| Role | Column / table | Folder | Shown |
|---|---|---|---|
| Locked / teaser image | `items.secret_business_photo_storage_path` | `secret-business-photos/<item_id>/` | hero of the LOCKED screen only |
| Reveal background (optional, new) | `items.secret_reveal_image_storage_path` | `secret-reveal-images/<item_id>/` | stationary full-screen background behind the UNLOCKED card |
| Approved cover / pool | `item_cover_candidates` (`display_eligible` / `selected`) via `active_cover_candidate_id` | `admin-artwork/…`, `cover-candidates/<uid>/…` | cards everywhere; **fallback** for the reveal background |

Resolution when unlocked: reveal image → approved pool/cover → locked/teaser image → branded fallback. Locked: teaser image → branded fallback (never the reveal image, cover or pool). The app requests the reveal image only after unlock. Neither image is ever blurred (the secret is the wording, not the photo).

## Why a dedicated column
The approved cover also feeds Home/Nearby/List cards (landscape-ish crops). A portrait full-screen background has different framing needs, and reusing the cover would force one image to serve both. The column is additive, nullable, and everything works unchanged when it is NULL.

## Security
- Ordinary users cannot write `items` (see security matrix "cannot edit items") and can only upload under `cover-candidates/<uid>/` (20261007d). The new path is written only by the admin tool.
- Pending/rejected submissions are never referenced: the reveal column holds only an admin-chosen path; the app's other sources (`display_eligible`/`selected`) are unchanged.
- Read access is an exact-path storage policy (mirrors `secret business photos`). `supabase/tests/secret_reveal_image_20261009.sql` (NOT RUN, rolls back) checks default NULL, no client UPDATE/INSERT on the column, exactly one SELECT policy.
- Removing an image clears the pointer only; the stored file is kept (it may also be the cover).

## Recommended reveal image (portrait background)
- **1170 × 2532 px** (9:19.5). Acceptable: 1080 × 2340 … 1290 × 2796. Absolute minimum 1080 × 1920. JPEG or PNG, < 10 MB (a 300–900 KB JPEG is plenty).
- The app uses cover-crop: wider/shorter images are cropped left/right. Keep the subject centred horizontally.
- Subject in the **upper-middle ~55%**. The bottom ~45% sits behind the dark gradient, the discovery card and the primary button; the top ~8% sits under the back button/status pill.
- No text, logos or UI baked into the image.
- Locked/teaser image: shown as a ~16:11 hero (≈1170 × 800), subject centred; landscape or portrait both work. It must not reveal the secret wording.

## Rollout (after approval)
1. Review the previews, then apply `supabase/migrations/20261009a_secret_reveal_image.sql` (additive; rollback in the file).
2. Publish the OTAs (iOS + Android) from the canonical tips.
3. Use Business Photo Intake → select the secret item → "Reveal background image" to upload; preview/replace/remove are in the same panel.
Until the migration is applied the app simply gets no reveal image (the query error is treated as "none") and the admin panel says the option needs the migration.
