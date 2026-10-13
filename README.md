<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/1f30a020-7889-4a04-aa40-30d3f715c580

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`
4. Check the code and focused regression tests:
   `npm run lint` and `npm test`

## Supabase and account plans

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in the local environment and in the Vercel project settings. Apply the SQL migrations in `supabase/migrations` to the Supabase project before enabling user registration. The `account_entitlements` migration assigns new and existing accounts to Demo (up to two printed pages); Pro accounts have no page limit.

Pro activation is manual for now. In the Supabase SQL Editor, update the account by its registered email:

```sql
update public.account_entitlements
set plan_code = 'pro', max_print_pages = null
where user_id = (select id from auth.users where email = 'user@example.com');
```

The entitlement table grants users read access only to their own plan. Do not grant client-side writes or put a Supabase secret/service-role key in Vercel client variables.

## Error monitoring

The React Error Boundary shows a recovery action, and client/API errors are reduced to sanitized metadata before storage. Events are sent only for authenticated sessions to `client_error_events`; this table has no client read policy. The Supabase migration schedules deletion after 30 days. Start the local Supabase stack before running database tests with `npx supabase test db`.

AI endpoints require a valid Supabase user session. Image analysis accepts JPEG, PNG, and WebP files up to 2 MB. Configure `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `GEMINI_API_KEY` for the Vercel server runtime; the `VITE_*` values configure the browser client. Never use the secret/service-role key in a `VITE_*` variable.
