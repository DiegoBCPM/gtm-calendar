/* =====================================================================
   Trainline ES-IT GTM Calendar — SLACK NOTIFIER
   ---------------------------------------------------------------------
   Runs once a day from GitHub Actions (.github/workflows/slack-notify.yml).
   Reads the same Supabase `gtm-state` rows the calendar uses and posts a
   Slack message when a campaign:
     • briefing is due            (a "Briefing deadline" bar is dated today)
     • starts in LEAD_DAYS days   (start === today + LEAD_DAYS)
     • starts today               (start === today)
     • finished today             (end   === today)

   It @-mentions the OWNERS OF THE CHANNELS that are actually activated on
   that campaign (i.e. painted on the calendar) — not a single owner.

   WHY THIS DESIGN
     The calendar is a browser-only page, so it can't notify anyone when
     it's closed. This job is server-side and scheduled, so it fires every
     day regardless. It runs once a day and only matches EXACT dates, so
     each event posts exactly once — no "already notified" flag needed.

   =====================================================================
   ███  YOU EDIT ONLY THE 3 CONFIG BLOCKS BELOW. Nothing else.  ███
     CONFIG 1  — the wording of the 4 messages
     CONFIG 2  — the Slack ID of each channel owner
     CONFIG 3  — how the list of owners is formatted (optional)
   ===================================================================== */

const LEAD_DAYS = Number(process.env.LEAD_DAYS || 3);


/* ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
   CONFIG 1 — MESSAGE WORDING
   ───────────────────────────────────────────────────────────────────
   There are four messages (soon / start / finish / briefing). Just edit the text inside the quotes.
   Each "\n" starts a new line. Slack *bold* uses *single asterisks*.

   You can drop these {tokens} anywhere in the text and they get replaced:
     {name}      → the campaign name
     {market}    → ES or IT
     {leadDays}  → the number of days before start (currently 3)
     {start}     → start date, e.g. 2026-07-13
     {end}       → end date
     {status}    → Planning / Briefed / Live / Done (auto: Live on start, Done after end)
     {owners}    → the activated channels' owners, auto-built. e.g.
                   "@Ana from SEO, @Luis from Growth · PPC, @Sara from CRM"
                   (ONLY the channels painted on that campaign appear)
     {briefDate} → the briefing due date (only used in the briefing message)
     {links}     → "🔗 Briefing · 📎 Assets · 🎁 Promo" (only the ones set)

   A token that has no value (e.g. {links} when there are no links) just
   disappears, and any blank line it leaves behind is removed for you.

   ── WORKED EXAMPLE ──────────────────────────────────────────────────
   If you write:
     "Hi team! *{name}* starts in {leadDays} days. Heads up {owners}."
   and the campaign "SAN JUAN" has SEO + PPC painted, with the owners set
   in CONFIG 2, Slack shows:
     "Hi team! *SAN JUAN* starts in 3 days. Heads up @Ana from SEO,
      @Luis from Growth · PPC."
   ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ */
const MESSAGES = {

  // ── 1) Sent LEAD_DAYS (3) days BEFORE a campaign starts ──
  soon:
    "Hello team! 👋 This is an automated message from *GTM Agent*.\n" +
    "The campaign *{name}* ({market}) starts in {leadDays} days.\n" +
    "Heads up {owners} — your channels are activated for this campaign.\n" +
    "📅 {start} → {end}   ·   📍 {status}\n" +
    "{links}",

  // ── 2) Sent ON the day a campaign STARTS ──
  start:
    "🚀 *{name}* ({market}) is live as of today!\n" +
    "Please activate channels: {owners}\n" +
    "📅 {start} → {end}   ·   📍 {status}\n" +
    "{links}",

  // ── 3) Sent ON the day a campaign FINISHES ──
  finish:
    "🏁 *{name}* ({market}) wrapped up today — great work! Please make sure all channels are deactivated: {owners} 👏\n" +
    "📅 ran {start} → {end}   ·   final status: {status}\n" +
    "{links}",

  // ── 4) Sent ON the date painted on the "Briefing deadline" row (before the campaign starts) ──
  briefing:
    "📋 *Briefing deadline* for *{name}* ({market}) — due *{briefDate}*.\n" +
    "{owners} — please make sure your channel's briefing is populated by then.\n" +
    "🗓 Campaign runs {start} → {end}\n" +
    "{links}",
};

// Title line shown once above the day's updates per market. "" to hide it.
const HEADER = "📣 {market} GTM — {today}";


/* ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
   CONFIG 2 — CHANNEL OWNERS  →  paste each owner's Slack ID here
   ───────────────────────────────────────────────────────────────────
   Owners are SEPARATE PER MARKET: fill the ES block for Spain campaigns
   and the IT block for Italy campaigns. The job automatically uses the
   right market's owners, so the wrong country never gets pinged.

   There is ONE owner per bucket. Put their Slack member ID in `slackId`.
   To find an ID in Slack: click the person's name/avatar → "View full
   profile" → the "⋯" (More) button → "Copy member ID" (looks like
   U07ABC123). Paste it between the quotes. Leave "" to skip mentioning.

   `label` is just the text shown next to the mention — edit if you like.

   The buckets map to the calendar's channels like this:
     SEO        → every SEO asset (Top Banners, Piggy Banner, Content…)
     MerchSlots → App Banner, Homepage Banner, Search banners, Carrusel
     CRM        → Newsletter, Content Block, Push, IAM
     GrowthPPC  → the Growth channel's "PPC" asset
     GrowthMM   → the Growth channel's "Mobile Marketing" asset
     Others     → Sponsored Search   (set "" if you don't want to mention)
   ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ */
const CHANNEL_OWNERS = {

  // ─────────── SPAIN (ES) owners ───────────
  ES: {
    SEO:        { label: "SEO",          slackId: "U08G2MN0JBY" },   // TEMP: Diego, for testing   // e.g. "U07ABC123"
    MerchSlots: { label: "MerchSlots",   slackId: "" },
    CRM:        { label: "CRM",          slackId: "" },
    GrowthPPC:  { label: "Growth · PPC", slackId: "" },
    GrowthMM:   { label: "Growth · MM",  slackId: "" },
    Others:     { label: "Others",       slackId: "" },
  },

  // ─────────── ITALY (IT) owners ───────────
  IT: {
    SEO:        { label: "SEO",          slackId: "U08G2MN0JBY" },   // TEMP: Diego, for testing
    MerchSlots: { label: "MerchSlots",   slackId: "" },
    CRM:        { label: "CRM",          slackId: "" },
    GrowthPPC:  { label: "Growth · PPC", slackId: "" },
    GrowthMM:   { label: "Growth · MM",  slackId: "" },
    Others:     { label: "Others",       slackId: "" },
  },
};


/* ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
   CONFIG 3 — how each owner appears inside {owners}  (optional)
   ───────────────────────────────────────────────────────────────────
   {mention} = the @person (or "(SEO owner)" if no ID set yet)
   {label}   = the bucket label from CONFIG 2
   Entries are joined with OWNER_JOIN. Example output:
     "@Ana from SEO, @Luis from Growth · PPC"
   ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ */
const OWNER_FORMAT = "{mention} from {label}";
const OWNER_JOIN   = ", ";
const NO_OWNERS    = "the team";   // shown when a campaign has no channels painted


/* =====================================================================
   ── Below here is plumbing; you normally don't need to touch it. ──
   ===================================================================== */

const SUPABASE_URL = "https://wmdobrdopivhvlamoplm.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndtZG9icmRvcGl2aHZsYW1vcGxtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2NTk3NjgsImV4cCI6MjA5NjIzNTc2OH0.Ab-5iK2Y_qtR2ct08yIsI9Cxiqk9oPR3rHBY0gzOPx8";
const DB_TABLE     = "gtm-state";
const WEBHOOKS = { ES: process.env.SLACK_WEBHOOK_ES, IT: process.env.SLACK_WEBHOOK_IT };

// Fixed order channels are listed in when several are activated.
const BUCKET_ORDER = ["SEO","MerchSlots","CRM","GrowthPPC","GrowthMM","Others"];
// Growth "Mobile Marketing" had legacy names; treat them as MM too (see app.js migrate()).
const MM_ASSETS = new Set(["Mobile Marketing","DAPS","APP"]);

/* ---- date helpers (calendar dates, Europe/Madrid = Europe/Rome = CET) ---- */
function todayStr(){
  return new Intl.DateTimeFormat("en-CA", {                 // en-CA → YYYY-MM-DD
    timeZone:"Europe/Madrid", year:"numeric", month:"2-digit", day:"2-digit",
  }).format(new Date());
}
function addDays(ymd, n){
  const [y,m,d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m-1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0,10);
}

/* ---- which channel buckets are activated (painted) on a campaign? ---- */
function activatedBuckets(c){
  const set = new Set();
  for(const a of (c.activations || [])){
    if(!a || !a.category) continue;
    if(a.category === "campaign") continue;               // campaign-level bar, not a channel
    switch(a.category){
      case "SEO":        set.add("SEO"); break;
      case "MerchSlots": set.add("MerchSlots"); break;
      case "CRM":        set.add("CRM"); break;
      case "Others":     set.add("Others"); break;
      case "Growth":
        if(a.asset === "PPC")            set.add("GrowthPPC");
        else if(MM_ASSETS.has(a.asset))  set.add("GrowthMM");
        else { set.add("GrowthPPC"); set.add("GrowthMM"); } // whole-Growth row painted
        break;
    }
  }
  return BUCKET_ORDER.filter(b => set.has(b));             // keep a stable order
}

/* ---- build the {owners} string from the activated buckets ---- */
function ownersToken(c, market){
  const owners = CHANNEL_OWNERS[market] || {};   // ES owners for ES, IT owners for IT
  const buckets = activatedBuckets(c);
  if(!buckets.length) return NO_OWNERS;
  return buckets.map(b => {
    const o = owners[b];
    if(!o || (!o.slackId && !o.label)) return null;
    const mention = o.slackId ? `<@${o.slackId}>` : `(${o.label} owner)`;
    return OWNER_FORMAT.replaceAll("{mention}", mention).replaceAll("{label}", o.label);
  }).filter(Boolean).join(OWNER_JOIN);
}

/* ---- the {links} string ---- */
function linksToken(c){
  const out = [];
  if(c.briefingUrl) out.push(`🔗 <${c.briefingUrl}|Briefing>`);
  if(c.assetsUrl)   out.push(`📎 <${c.assetsUrl}|Assets>`);
  if(c.hasPromo && c.promoUrl) out.push(`🎁 <${c.promoUrl}|Promo>`);
  return out.join("   ·   ");
}

/* ---- campaign status auto-advances by date (mirrors effStatus in app.js) ---- */
function effStatus(c){
  const t = todayStr();
  if(c.end   && t > c.end)    return "Done";
  if(c.start && t >= c.start) return "Live";
  return c.status || "Planning";
}

/* ---- render one message: fill tokens, drop blank lines ---- */
function buildText(kind, market, c, extra={}){
  const tokens = {
    name: c.name || "Untitled campaign",
    market, start: c.start, end: c.end, status: effStatus(c),
    leadDays: String(LEAD_DAYS),
    owners: ownersToken(c, market),
    links: linksToken(c),
    briefDate: "",
    ...extra,
  };
  let s = MESSAGES[kind];
  for(const [k,v] of Object.entries(tokens)) s = s.replaceAll(`{${k}}`, v ?? "");
  return s.split("\n").map(l => l.trimEnd()).filter(l => l.trim().length).join("\n");
}

/* ---- is a "Briefing deadline" bar dated today on this campaign? ---- */
function briefingDueToday(c, today){
  for(const a of (c.activations || [])){
    if(a && a.category === "Briefing" && a.start === today) return a;   // fire on the marked date
  }
  return null;
}

/* ---- Supabase read (mirrors dbLoad in app.js) ---- */
async function loadMarket(market){
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/${DB_TABLE}?id=eq.gtm-${market}&select=data`,
    { headers:{ apikey:SUPABASE_KEY, Authorization:`Bearer ${SUPABASE_KEY}` } }
  );
  if(!r.ok) throw new Error(`Supabase read ${market} — HTTP ${r.status}: ${(await r.text().catch(()=>"")).slice(0,160)}`);
  const rows = await r.json();
  return (rows && rows.length && rows[0].data) ? rows[0].data : null;
}

/* ---- Slack post ---- */
async function postSlack(url, blocks, fallback){
  const r = await fetch(url, {
    method:"POST", headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ text: fallback, blocks }),
  });
  if(!r.ok) throw new Error(`Slack post — HTTP ${r.status}: ${(await r.text().catch(()=>"")).slice(0,160)}`);
}
function section(text){ return { type:"section", text:{ type:"mrkdwn", text } }; }

/* ---- main ---- */
async function run(){
  const today   = todayStr();
  const soonDay = addDays(today, LEAD_DAYS);
  console.log(`Run for ${today} (3-day lead = ${soonDay}).`);
  let totalSent = 0;

  for(const market of ["ES","IT"]){
    const webhook = WEBHOOKS[market];
    if(!webhook){ console.log(`[${market}] no webhook configured — skipping`); continue; }

    let data;
    try { data = await loadMarket(market); }
    catch(err){ console.error(`[${market}] ${err.message}`); process.exitCode = 1; continue; }

    const campaigns = (data && Array.isArray(data.campaigns)) ? data.campaigns : [];
    const blocks = [];
    for(const c of campaigns){
      if(!c || !c.start) continue;
      const brief = briefingDueToday(c, today);
      if(brief)               blocks.push(section(buildText("briefing", market, c, { briefDate: brief.end })));
      if(c.start === soonDay) blocks.push(section(buildText("soon",   market, c)));
      if(c.start === today)   blocks.push(section(buildText("start",  market, c)));
      if(c.end   === today)   blocks.push(section(buildText("finish", market, c)));
    }

    if(!blocks.length){ console.log(`[${market}] nothing for ${today}`); continue; }

    const head = HEADER ? [{ type:"header", text:{ type:"plain_text",
      text: HEADER.replaceAll("{market}",market).replaceAll("{today}",today), emoji:true } }] : [];
    try {
      await postSlack(webhook, [...head, ...blocks], `${market} GTM updates for ${today}`);
      totalSent += blocks.length;
      console.log(`[${market}] posted ${blocks.length} update(s)`);
    } catch(err){ console.error(`[${market}] ${err.message}`); process.exitCode = 1; }
  }
  console.log(`Done — ${totalSent} update(s) sent.`);
}

run().catch(err => { console.error(err); process.exit(1); });
