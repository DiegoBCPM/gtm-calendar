# Trainline ES-IT — GTM Calendar

## What this is
A single-page web app for planning Trainline's GTM marketing campaigns across **Spain (ES)** and **Italy (IT)**. It's a painted Gantt/calendar: campaigns listed on the left, a day-by-day timeline on the right. Users click-drag across days on any row to "paint" coloured bars (activations), grouped by marketing channel. Two market tabs (ES / IT), each with fully independent data.

## Tech stack
- **Frontend:** one self-contained `index.html` — inline CSS + vanilla JS. No framework, no build step, no dependencies.
- **Database:** Supabase (Postgres) — stores shared state so the whole team sees the same calendar.
- **Hosting:** Netlify (static site) — live at https://singular-mochi-83fc9c.netlify.app

There is no `package.json`, no bundler. To run locally, just open `index.html` in a browser (or `python3 -m http.server`).

## How storage works (important — several bugs lived here)
- Supabase table: **`gtm-state`** — note the **hyphen**, not an underscore. (A `gtm_state` mismatch caused a 404 early on.)
  - Columns: `id` (text, primary key), `data` (jsonb).
  - One row per market: `id = "gtm-ES"` and `id = "gtm-IT"`. The entire app state for that market lives in `data`.
- Access via Supabase REST from the browser:
  - Read: `GET /rest/v1/gtm-state?id=eq.gtm-ES&select=data`
  - First save → `POST` (insert). Every save after → `PATCH` on the row id. **Do not** revert to plain upsert (`resolution=merge-duplicates`) — it was unreliable.
- The **anon / publishable** key is embedded in `index.html`. That is safe for a browser. **Never** put the `service_role` key in this file.
- Row Level Security on `gtm-state` must be **disabled**, or the `anon` role granted CRUD. SQL (hyphenated names need quotes):
  ```sql
  alter table public."gtm-state" disable row level security;
  grant select, insert, update, delete on public."gtm-state" to anon;
  ```

## Why it's hosted on Netlify (not a Claude artifact)
Claude's artifact sandbox blocks `fetch()` to external domains (you get "NetworkError"), so Supabase calls fail there. Hosting the same file on Netlify removes that restriction. Native `confirm()` / `alert()` are also blocked in the sandbox but work fine on Netlify.

## Data model (per market)
```
state = {
  range: { from, to },         // financial-year window, e.g. 2026-02-01 → 2027-01-31
  dayWidth,                    // zoom level (px per day)
  collapsedCategories: {},     // category collapse (global across campaigns)
  hiddenCategories: {},        // legend show/hide filters
  campaigns: [ Campaign ]
}
Campaign   = { id, name, mkFunds, start, end, status, flightDetail, owner, briefingUrl, collapsed, brandColor, activations: [Activation] }
Activation = { id, category, asset, start, end, status }
```
Special activations:
- `category: "campaign"` → painted on the campaign header row; rendered in the campaign's **brand colour**.
- `asset: "__category__"` → painted on a category header row.
Statuses: Planning (hatched/light), Briefed (outlined), Live (solid), Done (faded).

## Fixed channel taxonomy (identical for every campaign, both markets)
- **SEO** (green): TP - Home Page, TP - Landing Pages, TP - Other Pages, GTM Banner Home Page, Piggy Banner, Content Creation
- **MerchSlots** (orange): App Banner, Homepage Banner, Search banners, GTM APP Carrusel
- **CRM** (purple): Dedicated Newsletter, Content Block, Push notification, IAM
- **Growth** (red): PPC, DAPS, APP
- **Others** (slate): Sponsored Search

## Brand colours (campaign colour options)
Trainline `#02a88f` · Renfe `#81015e` · Ouigo `#e3006a` · iryo `#d30e17` · Trenitalia `#006c67` · Italo `#a7160c` · Monetization `#383838` · Product `#1f03ff`

## Conventions
- Keep everything in the single `index.html`. No build tooling.
- No `localStorage` / `sessionStorage`.
- The "Synced" indicator (top-right) reflects the real save status; on failure it shows the HTTP status + message.

## Deploy flow
Target: a git repo connected to Netlify so `git push` auto-deploys (currently the live site is `singular-mochi-83fc9c`). Until then, deploys are manual drag-and-drop of `index.html` into Netlify.

## Backlog / to-do
- **Re-add the password gate.** It was temporarily removed for debugging. The `APP_PASSWORD` constant ("FY27") is still in the file; the lock-screen UI and boot logic were stripped and need restoring.
- **Slack automation:** notify a channel when a campaign hits its end date; optionally a weekly digest and status-change alerts. Best as a scheduled job (Supabase Edge Function / cron / Make.com) reading the same `gtm-state` table — not browser-side, so it fires even when no one has the calendar open.
- Optional polish: replace native `confirm()`/`alert()` with in-page dialogs.
- Possibly seed Italy with starter campaigns (currently empty).
- (Separate, later) competitor price monitoring — check internal Trainline data access before any external scraping.