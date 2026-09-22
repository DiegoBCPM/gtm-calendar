# Trainline ES-IT — GTM Calendar

## What this is
A single-page web app for planning Trainline's GTM marketing campaigns across **Spain (ES)** and **Italy (IT)**. It's a painted Gantt/calendar: campaigns listed on the left, a day-by-day timeline on the right. Users click-drag across days on any row to "paint" coloured bars (activations), grouped by marketing channel. Two market tabs (ES / IT), each with fully independent data.

## Tech stack
- **Frontend:** three plain files — `index.html` (page shell) + `styles.css` + `app.js` (all behaviour). Vanilla JS, no framework, no build step, no dependencies.
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
  range: { from, to },         // visible window; `to` is a FLOOR, not a wall (see below)
  dayWidth,                    // zoom level (px per day)
  collapsedCategories: {},     // category collapse (global across campaigns)
  hiddenCategories: {},        // legend show/hide filters
  campaigns: [ Campaign ]
}
Campaign   = { id, name, mkFunds, start, end, status, notes, owner, briefingUrl, assetsUrl, collapsed, brandColor,
               international, hasPromo, promoDetail, promoUrl, activations: [Activation] }
Activation = { id, category, asset, start, end, status }
```
Notes on campaign fields:
- `notes` — free-text notes (renamed from the old `flightDetail`; legacy values auto-migrate via `migrate()`).
- `international` — true if the campaign is international, false = domestic only. Shown as a 🌍 Intl pill.
- `hasPromo` / `promoDetail` / `promoUrl` — promotion flag + details + link. When `hasPromo`, a 🎁 Promo pill shows (clickable → `promoUrl`).
- `briefingUrl` / `assetsUrl` — two separate links. Row buttons: 🔗 opens the briefing, 📎 opens the creative assets (each disabled when its URL is empty).
- Campaigns are auto-sorted by `start` ascending on every render (earliest at top); manual ordering isn't persisted.

### The window auto-grows (`range`)
`range.from` anchors the grid and is **never** moved automatically: every bar is positioned at `dayIndex × dayWidth` measured from `from`, so shifting it would slide the whole grid and jump the reader's scroll.

`range.to` is a **floor**. `autoGrowRange()` (called once per market load, from `migrate()`) widens it to the last day of the month *after* the latest date found in any campaign or activation. So the calendar can never open too small to show its own data — paint something in June 2027 and the timeline just grows to fit on next load.

- It grows on **load only**, not on every render, so typing a narrower end date in the top bar still gives you a focused view for the session; reload restores the full window.
- `MAX_SPAN_DAYS` (3 years from `from`) caps it. Without that, one campaign mistyped as ending in 2099 would ask the browser to lay out ~26,000 day columns and hang the tab. Past the cap, bars clip as before.
- Current floor for both markets is `2027-02-28`. IT auto-grows past it to `2027-04-30`, because "CGN BAU" runs to 2027-03-31 — before this existed, that bar was being silently clipped at January.
- **A true infinite/unbounded timeline would need virtualisation** (render only the visible days). Every day is a real DOM node in `headerHTML()`, and each lane is `numDays × dayWidth` wide, so unbounded growth eventually stalls the browser. The auto-grow floor gives the same practical result without that rework.

Special activations:
- `category: "campaign"` → painted on the campaign header row; rendered in the campaign's **brand colour**.
- `asset: "__category__"` → painted on a category header row.
Statuses: Planning (hatched/light), Briefed (outlined), Live (solid), Done (faded).
Campaign status **auto-advances by date** via `effStatus()`: it shows **Live** once the start date is reached and **Done** once the end date has passed; before the start date the manually-set status (Planning/Briefed) is kept. The value is derived at render time (and persisted when unlocked); the Slack notifier applies the same rule so both agree.

## Fixed channel taxonomy (identical for every campaign, both markets)
- **Briefing** (black): two assets — **Briefing Deadline** and **Briefing Delivery**. Paint **Briefing Deadline** to mark the date the briefing must be populated (normally *before* the campaign start); this fires a dedicated Slack reminder **on the marked date** to the activated channels' owners. **Briefing Delivery** is currently visual-only (no Slack trigger). The notifier matches `category==="Briefing" && asset==="Briefing Deadline"`.
- **SEO** (green): Top Banner - Home Page, Top Banner - Landing Pages, Top Banner - Other Pages, GTM Banner Home Page, Piggy Banner, Content Creation
- **MerchSlots** (orange): App Banner, Homepage Banner, Search banners, GTM APP Carrusel
- **CRM** (purple): Dedicated Newsletter, Content Block, Push notification, IAM
- **Growth** (red): PPC, Mobile Marketing
- **Others** (slate): Sponsored Search

Legacy asset names auto-migrate via `ASSET_RENAME` in `migrate()` (old `TP - …` → `Top Banner - …`; `DAPS`/`APP` → `Mobile Marketing`), so previously painted bars aren't orphaned by the rename.

## Brand colours (campaign colour options)
Trainline `#02a88f` · Renfe `#81015e` · Ouigo `#e3006a` · iryo `#d30e17` · Trenitalia `#006c67` · Italo `#a7160c` · Monetization `#383838` · Product `#1f03ff`

## Conventions
- Keep to the three files (`index.html` / `styles.css` / `app.js`). No build tooling, no dependencies.
- No `localStorage` / `sessionStorage`.
- The "Synced" indicator (top-right) reflects the real save status; on failure it shows the HTTP status + message.

## Deploy flow
Target: a git repo connected to Netlify so `git push` auto-deploys (currently the live site is `singular-mochi-83fc9c`). Until then, deploys are manual drag-and-drop of `index.html` into Netlify.

## Backlog / to-do
- **Edit lock (done, soft).** The app loads read-only; a top-bar "🔒 View only" button prompts for a shared password to enable editing (paint/drag, add/edit/dup/delete, range). Password is stored as a SHA-256 hash in `APP_EDIT_HASH` (currently "FY27"); change it by hashing a new word (`printf '%s' 'NEW' | shasum -a 256`). While locked, `scheduleSave` no-ops so view tweaks (zoom/collapse) never persist. **This is UI-only — not real security:** the public source reveals the hash, and the anon key + disabled RLS still allow direct DB writes. For real protection, gate writes server-side (RLS read-only anon + an Edge Function that checks the password).
- **Slack automation (done, live).** `scripts/notify-slack.mjs`, run daily by `.github/workflows/slack-notify.yml`. Reads the same `gtm-state` rows and posts per-market (webhook secrets `SLACK_WEBHOOK_ES` / `SLACK_WEBHOOK_IT` → channels `es-gtm` / `it-gtm`) on four triggers: briefing deadline, starts-in-3-days, starts-today, finished-today. It @-mentions only the owners of the channels actually painted on that campaign, plus a per-market `CC` list on every post. Only the three CONFIG blocks at the top of the script are meant to be edited.
  - **Watch out — the schedule can die silently.** GitHub sets scheduled workflows on *public* repos to `disabled_inactivity` after 60 days with no repo activity. This already happened once (last commit 2026-07-06 → cron stopped 2026-09-05, unnoticed for 17 days, ~11 missed alerts). A keepalive step in the workflow now pushes an empty `[skip netlify]` commit if the newest commit is older than 45 days. To check by hand: `gh api repos/DiegoBCPM/gtm-calendar/actions/workflows --jq '.workflows[].state'`; to revive: `gh api --method PUT repos/DiegoBCPM/gtm-calendar/actions/workflows/305347595/enable` (needs the `DiegoBCPM` account — `gh auth switch --user DiegoBCPM`).
  - **Known limitation:** GitHub queues public-repo schedules at low priority, so the 07:05 UTC cron has drifted as late as 19:23 UTC. If exact 09:05 CET delivery matters, move the trigger off GitHub cron (external cron → `workflow_dispatch`, or a Supabase scheduled function).
  - **Known gap:** `briefingDueToday()` matches only `asset === "Briefing Deadline"`. Briefing bars painted on the category header row are saved as `asset: "__category__"` and never fire (live examples: ES "OUIGO Sep ODV TBC", IT "SNCF Christmas Seat Release"). `Briefing Delivery` is visual-only by design.
- **Optional next for Slack:** weekly digest, status-change alerts, and a failure alert if the job errors or hasn't run in 48h.
- Optional polish: replace native `confirm()`/`alert()` with in-page dialogs.
- Possibly seed Italy with starter campaigns (currently empty).
- (Separate, later) competitor price monitoring — check internal Trainline data access before any external scraping.