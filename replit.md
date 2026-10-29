# Auvrenthia Markets

Investment-market UI with account, member dashboard, and admin experiences.

## Run

- `pnpm --filter @workspace/wealthhub-site run dev` starts the app.
- `pnpm --filter @workspace/wealthhub-site run build` builds the web app.
- Run `pnpm run typecheck` for workspace typechecking.

## Data and authentication

- Supabase is the app's only persistent database and auth provider.
- Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in Replit Secrets.
- Apply `Supabase/schema.sql` in the Supabase SQL Editor before using accounts.
- Do not put a Supabase service-role key in this browser app.
- The Postgres/Drizzle workspace package is unused starter scaffolding; do not provision or push a separate database.

## Source map

- `artifacts/wealthhub-site` — Vite/React app, pages, Supabase client.
- `Supabase/schema.sql` — Supabase tables, policies, and RPC setup.
- `artifacts/api-server` — optional market-feed API; not needed to start the web UI.
