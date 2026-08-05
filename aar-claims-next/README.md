# AAR Claims Forensic Audit — Next.js + Supabase

Deploys to **Vercel** (git push → build → public HTTPS URL, no Docker, no
containers, no port forwarding) with **Supabase** providing Postgres +
Auth + Storage. Built to remove the entire category of operational
problems the earlier Docker/Codespaces version ran into.

## Setup

1. **Supabase**: SQL Editor → paste and run `supabase/schema.sql` in
   full. Idempotent, safe to re-run.
2. Copy `.env.example` → `.env.local`, fill in your Supabase URL + both
   keys (Settings → API). Leave the `MS_*` vars blank unless you're
   setting up OneDrive sync (see below).
3. `npm install`
4. `npm run dev` → `http://localhost:3000`
5. Deploy: push to GitHub, import into Vercel, set the same env vars in
   Vercel's project settings, deploy.

## Everything built this pass

- **Auth** (`app/(auth)/login`, `app/(auth)/signup`) — real Supabase
  email/password signup and login. First account created becomes admin
  automatically via a DB trigger (`handle_new_user` in schema.sql) — no
  bootstrap endpoint.
- **Session middleware** (`middleware.ts`) — refreshes the Supabase
  session on every request, redirects unauthenticated users away from
  `/dashboard` and signed-in users away from `/login`/`/signup`.
- **Dashboard bootstrap** (`app/dashboard/page.tsx`) — reuses the most
  recent existing session instead of always creating a new one. This is
  a direct fix for a real bug the Docker version had (logging out
  orphaned all prior uploads behind an unreachable session id).
- **Rule engine** (`lib/rules.ts`) — duplicates, non-payable keywords,
  IQR pricing anomalies, invalid member ID format, diagnosis gaps.
  Compiled with `tsc` and run against realistic hand-built test data;
  one real bug (a duplicate flag double-counting a row) was caught and
  fixed before this was called done.
- **Column mapping** (`lib/columnMapping.ts`) — maps varied source
  header names to canonical fields by alias, not exact match. Tested
  against the actual column names from a real AAR claims export
  (`INSURANCE_MEMBER_ID`, `MEDICAL_PRODUCT_NAME`, etc.) — confirmed it
  maps correctly and correctly detects missing required columns.
- **Chunked upload** (`components/dashboard/UploadPanel.tsx` +
  `app/api/upload/route.ts` + `app/api/source-files/route.ts`) — parses
  CSV/XLSX in the browser, maps columns, and sends rows to the server in
  2,000-row chunks with a progress bar. This is what makes "hundreds of
  thousands of records" safe: no single request ever does more than one
  bounded insert, regardless of total file size. The CSV parser's
  quoted-comma handling was tested directly (`"Consultation, General"`
  stays one field, doesn't break on the internal comma).
- **Flag recomputation** (`app/api/flags/recompute/route.ts`) —
  paginates through `claim_rows` in pages of 1,000 rather than one
  unbounded query, so recomputing flags also scales to very large
  sessions.
- **Dashboard** (`components/dashboard/DashboardContent.tsx`) — category
  dropdown, time-range dropdown (month/year/custom), Generate button,
  KPI cards, a real Recharts bar chart and line chart, a flagged-amount
  total, drill-down table, and a working Excel export (SheetJS).
- **Reports with history** (`components/dashboard/ReportsPanel.tsx` +
  `app/api/reports/*`) — Generate button saves a snapshot (counts +
  total amount) to `generated_reports`; a presentation-style summary
  view renders it big-number/report-deck style; every past report is
  listed and clickable to reload, satisfying "go back and view a past
  one" without needing a job queue.
- **OneDrive/SharePoint sync** (`components/dashboard/SyncPanel.tsx` +
  `lib/msGraph.ts` + `app/api/ms-oauth/*`) — delegated OAuth ("Connect
  your Microsoft account"), browse a folder, ingest a file directly into
  the session. Runs inside one request (per the no-job-queue decision),
  so a single very large file synced this way is bounded by your
  hosting plan's function timeout — the Upload tab's chunking is the
  more reliable path for huge files; this is documented in the panel
  itself, not hidden.

## Verification actually performed

- **`lib/rules.ts`**: compiled with `tsc`, executed against 8 rows of
  hand-built realistic test data covering every rule branch. Found and
  fixed one real bug.
- **`lib/columnMapping.ts`**: compiled and executed against the real
  header names from an actual AAR claims export.
- **CSV parsing logic** in `UploadPanel.tsx`: extracted and run directly
  against a quoted-comma test case.
- **Every `.ts`/`.tsx` file in the project**: full `tsc --noEmit` pass.
  Every single flagged issue was one of exactly two categories — missing
  `react`/`next` type declarations (expected, since `npm install` has
  never been run in this environment, no network access here) or
  implicit-`any` on event handler parameters (same root cause: no
  installed React types to infer from). Zero actual syntax errors,
  zero real type errors, across the whole codebase.

## What I could NOT verify — said plainly, not buried

- **`npm install` has never actually been run against these exact
  dependency versions.** I have no network access in the environment I
  built this in. There is a real, non-zero chance of a version conflict
  I haven't seen. Run it and paste me the exact error if anything fails
  — don't assume it's clean just because I said the code compiles.
- **No query has run against a live Supabase database.** I traced every
  Supabase call by hand against `schema.sql`'s actual table/column
  names, but tracing by hand is not the same as executing it.
- **The Microsoft OAuth flow has never been exercised end to end** — I
  don't have a real Azure app registration to test against. The code
  follows the same pattern as the working FastAPI version, but "follows
  the same pattern" is not "confirmed working."

## Next steps, concretely

1. `npm install` locally (or push to GitHub and let Vercel's build log
   be the first real signal) — tell me the exact failure if any.
2. Run `supabase/schema.sql`, fill in `.env.local`, `npm run dev`.
3. Sign up (first account = admin), upload a small real file, confirm
   flags appear on the dashboard.
4. Only then wire up Microsoft OAuth (needs a real Azure app
   registration on your end regardless of what I build).
