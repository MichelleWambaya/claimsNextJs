# Rebuild manifest — where each file goes

Filenames here use dots instead of slashes only because several of your
uploads shared the same name. Map them to real paths as follows:

| Delivered file | Real path |
|---|---|
| `config.domain.ts` | `config/domain.ts` **← edit this to repurpose the app** |
| `lib.toJson.ts` | `lib/toJson.ts` |
| `lib.columnMapping.ts` | `lib/columnMapping.ts` |
| `lib.rules.ts` | `lib/rules.ts` |
| `lib.notify.ts` | `lib/notify.ts` |
| `lib.session-context.tsx` | `lib/session-context.tsx` |
| `route.notifications.ts` | `app/api/notifications/route.ts` |
| `route.rule-config.ts` | `app/api/rule-config/route.ts` |
| `route.export-dataset.ts` | `app/api/reports/export-dataset/route.ts` |
| `route.export-pptx.ts` | `app/api/reports/export-pptx/route.ts` |
| `route.flags-recompute.ts` | `app/api/flags/recompute/route.ts` (replaces existing) |
| `RulesConstraintsPanel.tsx` | `components/dashboard/RulesConstraintsPanel.tsx` |
| `NotificationBell.tsx` | `components/notifications/NotificationBell.tsx` |
| `Sidebar.tsx` | `components/layout/Sidebar.tsx` |
| `PowerBiPanel.tsx` | `components/dashboard/PowerBiPanel.tsx` |
| `PresentationsPanel.tsx` | `components/dashboard/PresentationsPanel.tsx` |
| `UploadPanel.tsx` | `components/dashboard/UploadPanel.tsx` (replaces existing) |
| `app.dashboard.layout.tsx` | `app/dashboard/layout.tsx` |
| `app.dashboard.page.tsx` | `app/dashboard/page.tsx` (replaces existing) |
| `app.dashboard.upload.page.tsx` | `app/dashboard/upload/page.tsx` |
| `app.dashboard.rules.page.tsx` | `app/dashboard/rules/page.tsx` |
| `app.dashboard.reports.page.tsx` | `app/dashboard/reports/page.tsx` |
| `app.dashboard.presentations.page.tsx` | `app/dashboard/presentations/page.tsx` |
| `app.dashboard.powerbi.page.tsx` | `app/dashboard/powerbi/page.tsx` |
| `app.dashboard.settings.page.tsx` | `app/dashboard/settings/page.tsx` |
| `schema-additions.sql` | run in Supabase SQL editor |

## Also required

**`package.json`** — add:
```
npm install pptxgenjs lucide-react
```

**`tailwind.config.js`** — add a `brand` color so `bg-brand`/`text-brand` classes work:
```js
theme: {
  extend: {
    colors: {
      brand: "#f97316", // keep in sync with BRANDING.primaryColor in config/domain.ts
    },
  },
},
```

**Delete** (Microsoft OAuth / Sync removed):
- `lib/msGraph.ts`
- `app/api/ms-oauth/connect/route.ts`
- `app/api/ms-oauth/callback/route.ts`
- `app/api/ms-oauth/sync/route.ts`
- `components/dashboard/SyncPanel.tsx`
- `lib/xlsxUtils.ts` (superseded by `lib/toJson.ts`)

**Update the login/signup pages** to remove `export const dynamic = "force-dynamic"` (invalid alongside `"use client"` — this was the Vercel build failure from earlier in this conversation). I already delivered fixed versions of those; carry them into this rebuild unchanged.

**Not yet touched in this pass** — still exactly as before, no changes needed:
- `app/login/page.tsx`, `app/signup/page.tsx` (just apply the earlier `dynamic` fix)
- `app/page.tsx` (root redirect)
- `components/dashboard/DashboardContent.tsx` (already has the timezone + pagination fixes from earlier)
- `components/dashboard/ReportsPanel.tsx` — works as-is; a nice follow-up would be adding a "Download .pptx" button here too, though Presentations already covers it
- `app/api/sessions/route.ts`, `app/api/source-files/route.ts`, `app/api/upload/route.ts`, `app/api/reports/route.ts`, `app/api/reports/generate/route.ts` (already has the pagination fix)
- Auth (`lib/supabase/client.ts`, `lib/supabase/server.ts`)

## Env vars

Same as before, minus everything `MS_*` (Microsoft OAuth is gone), plus:
```
NOTIFY_WEBHOOK_URL=   # optional — Slack/Teams/Discord/custom webhook for external push
```
