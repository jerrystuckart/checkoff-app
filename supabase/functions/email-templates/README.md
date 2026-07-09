# CheckOff Resend Email HTML System

Built for the three July 2026 email RPCs:

1. `get_monthly_recap_users()`
2. `get_inactive_users()`
3. `get_never_checkin_users()`

## Brand system

- Header: dark navy `#0F1117`
- Accent: amber `#F5A623`
- Body: warm off-white `#F4F1EA` outside, white card inside
- Max width: 600px
- Buttons: amber pill, dark text
- Footer: “Built for discovery. Ready for visitors.”

## Files

- `monthly-recap.html` — for active users with 1+ check-ins in the past 30 days
- `inactive-reengagement.html` — for users with historical check-ins but none in the past 30 days
- `never-checkedin-onboarding.html` — for accounts older than 14 days with zero check-ins ever
- `render-helpers.ts` — simple token replacement helper for Supabase Edge Functions

## Expected template tokens

Shared:

- `{{display_name}}`
- `{{metro_name}}`
- `{{neighborhood_name}}`
- `{{unsubscribe_url}}`
- `{{item_1_name}}`, `{{item_1_note}}`, `{{item_1_url}}`
- `{{item_2_name}}`, `{{item_2_note}}`, `{{item_2_url}}`
- `{{item_3_name}}`, `{{item_3_note}}`, `{{item_3_url}}`

Monthly recap:

- `{{checkins_this_month}}`
- `{{lifetime_points}}`
- `{{current_streak}}`
- `{{season_total_items}}`
- `{{season_days_remaining}}`

## Notes before wiring

- Keep the unsubscribe link as an actual link around the word “unsubscribe.” Do not expose the full URL in the visible footer.
- For API-triggered emails, generate a real unsubscribe/preferences URL per user or pass through your list-management unsubscribe URL if Resend supplies one.
- The recommended items section expects 3 items. The helper falls back to generic CheckOff actions if the JSON array is missing or short.
- The onboarding template uses the existing hosted image: `https://getcheckoff.com/email/home-107.jpg`.
