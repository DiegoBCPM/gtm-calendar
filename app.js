/* =====================================================================
   Trainline ES-IT GTM Calendar — APP LOGIC
   ---------------------------------------------------------------------
   All behaviour lives here. Plain vanilla JavaScript, no framework and
   no build step: index.html loads this file directly with <script>.

   HOW IT FITS TOGETHER
     • index.html  — the page skeleton (top bar, empty grid container)
     • styles.css  — all visual styling
     • app.js      — this file: loads data, draws the calendar, handles
                     clicks/drags, and saves back to Supabase

   TABLE OF CONTENTS
     1. Edit lock      — the soft password gate (view vs. edit)
     2. Supabase       — load/save the shared state (dbLoad / dbSave)
     3. Brand palette  — campaign colour options
     4. Taxonomy       — the fixed channels + assets, and legacy renames
     5. State          — per-market app state (_states / state)
     6. Storage        — loadState / scheduleSave / saveState / market switch
     7. Date utils      — turning dates into day-columns and back
     8. Render          — drawing the whole grid from state
     9. Paint & drag    — creating/moving/resizing bars by dragging
    10. Bar menu        — the little "Delete this bar" pop-up
    11. Edit lock UI    — the 🔒 / 🔓 button
    12. Toolbar actions  — clicks on top-bar buttons, date range
    13. Campaign form    — the add/edit/info pop-up
    14. Boot             — runs once on page load
   ===================================================================== */

/* =====================================================
   1. EDIT LOCK  (soft, UI-only — see CLAUDE.md for caveats)
   View is always open; editing requires the shared password.
   APP_EDIT_HASH = SHA-256 of the password (currently "FY27").
   To change it: hash a new word and replace this string.
   ===================================================== */
const APP_EDIT_HASH = "4364651c17063ebf2da06c6ca86ce70a049d298a6ae811b119b7760da333a3de";
let canEdit = false;   // flipped true once the correct password is entered
async function sha256(str){
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,"0")).join("");
}

/* =====================================================
   2. SUPABASE CONFIG  —  anon key only, safe for browser
   ===================================================== */
const SUPABASE_URL = "https://wmdobrdopivhvlamoplm.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndtZG9icmRvcGl2aHZsYW1vcGxtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2NTk3NjgsImV4cCI6MjA5NjIzNTc2OH0.Ab-5iK2Y_qtR2ct08yIsI9Cxiqk9oPR3rHBY0gzOPx8";
const DB_TABLE     = "gtm-state";

// Tracks whether each market's row already exists in Supabase.
const _savedOnce = { ES:false, IT:false };
let _lastDbError = "";   // human-readable last failure, shown in the UI

async function dbLoad(market){
  try{
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/${DB_TABLE}?id=eq.gtm-${market}&select=data`,
      { headers:{ apikey:SUPABASE_KEY, Authorization:`Bearer ${SUPABASE_KEY}` } }
    );
    if(!r.ok){ _lastDbError=`Read failed — HTTP ${r.status}: ${(await r.text().catch(()=>"")).slice(0,160)}`; throw new Error(_lastDbError); }
    const rows = await r.json();
    if(rows && rows.length && rows[0].data){ _savedOnce[market]=true; return rows[0].data; }
  }catch(e){ console.error("dbLoad:",e); if(!_lastDbError) _lastDbError=String(e.message||e); }
  return null;
}

async function dbSave(market, s){
  const key = `gtm-${market}`;
  const hdrs = { apikey:SUPABASE_KEY, Authorization:`Bearer ${SUPABASE_KEY}`, "Content-Type":"application/json" };
  try{
    let res;
    if(_savedOnce[market]){
      res = await fetch(`${SUPABASE_URL}/rest/v1/${DB_TABLE}?id=eq.${key}`, {
        method:"PATCH", headers:{...hdrs, Prefer:"return=minimal"}, body:JSON.stringify({data:s})
      });
    } else {
      res = await fetch(`${SUPABASE_URL}/rest/v1/${DB_TABLE}`, {
        method:"POST", headers:{...hdrs, Prefer:"return=minimal"}, body:JSON.stringify({id:key, data:s})
      });
    }
    if(res.ok){ _savedOnce[market]=true; _lastDbError=""; return true; }
    if(_savedOnce[market]){ _savedOnce[market]=false; return dbSave(market,s); } // PATCH failed → retry as INSERT
    _lastDbError = `Write failed — HTTP ${res.status}: ${(await res.text().catch(()=>"")).slice(0,160)}`;
    console.error("dbSave:",_lastDbError);
    return false;
  }catch(e){ _lastDbError=String(e.message||e); console.error("dbSave:",e); return false; }
}

/* =====================================================
   3. BRAND PALETTE
   ===================================================== */
const BRAND_PALETTE = [
  {name:"Trainline",   color:"#02a88f"},
  {name:"Renfe",       color:"#81015e"},
  {name:"Ouigo",       color:"#e3006a"},
  {name:"iryo",        color:"#d30e17"},
  {name:"Trenitalia",  color:"#006c67"},
  {name:"Italo",       color:"#a7160c"},
  {name:"Monetization",color:"#383838"},
  {name:"Product",     color:"#1f03ff"},
];

/* =====================================================
   4. TAXONOMY
   ===================================================== */
const TAXONOMY = [
  {cat:"Briefing",   assets:[]},   // no sub-assets: paint the channel row itself to mark the briefing-due date
  {cat:"SEO",        assets:["Top Banner - Home Page","Top Banner - Landing Pages","Top Banner - Other Pages","GTM Banner Home Page","Piggy Banner","Content Creation"]},
  {cat:"MerchSlots", assets:["App Banner","Homepage Banner","Search banners","GTM APP Carrusel"]},
  {cat:"CRM",        assets:["Dedicated Newsletter","Content Block","Push notification","IAM"]},
  {cat:"Growth",     assets:["PPC","Mobile Marketing"]},
  {cat:"Others",     assets:["Sponsored Search"]},
];
// Legacy asset names → current names. Applied in migrate() so existing painted
// bars aren't orphaned when the taxonomy is renamed.
const ASSET_RENAME = {
  "TP - Home Page":     "Top Banner - Home Page",
  "TP - Landing Pages": "Top Banner - Landing Pages",
  "TP - Other Pages":   "Top Banner - Other Pages",
  "DAPS":               "Mobile Marketing",
  "APP":                "Mobile Marketing",
};
const STATUSES = ["Planning","Briefed","Live","Done"];
const MONTHS   = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
const DOW      = ["S","M","T","W","T","F","S"];
const MIN_DW=9, MAX_DW=48;
const ASSET_CAMPAIGN = "__campaign__";
const ASSET_CATEGORY = "__category__";

/* Airtable logo — used as the briefing-link icon (briefings live in Airtable). */
const ICON_AIRTABLE = `<svg class="ic-at" viewBox="0 0 200 170" width="15" height="13" aria-hidden="true">
  <path fill="#FCB400" d="M90.04 12.37 24.08 39.66c-3.67 1.52-3.63 6.73.06 8.19l66.24 26.27c5.82 2.31 12.3 2.31 18.12 0l66.24-26.27c3.69-1.46 3.73-6.67.06-8.19L108.83 12.37c-6.02-2.49-12.78-2.49-18.79 0"/>
  <path fill="#18BFFF" d="M105.31 88.46v65.62c0 3.12 3.15 5.25 6.05 4.1l73.81-28.65a4.43 4.43 0 0 0 2.79-4.11V59.81c0-3.12-3.15-5.25-6.05-4.1l-73.81 28.65a4.43 4.43 0 0 0-2.79 4.1"/>
  <path fill="#F82B60" d="M88.08 91.85 66.17 102.42l-2.22 1.08-46.24 22.15c-2.93 1.42-6.67-.72-6.67-3.97V60.09c0-1.18.6-2.19 1.41-2.96.34-.34.72-.61 1.12-.85 1.1-.66 2.68-.83 4.02-.3l70.12 27.78c3.57 1.42 3.85 6.41.37 8.09"/>
  <path fill="#000" fill-opacity=".25" d="M88.08 91.85 66.17 102.42 12.45 57.13c.34-.34.72-.61 1.12-.85 1.1-.66 2.68-.83 4.02-.3l70.12 27.78c3.57 1.42 3.85 6.41.37 8.09"/>
</svg>`;

/* =====================================================
   5. MULTI-MARKET STATE
   ===================================================== */
const _states = { ES:null, IT:null };
let activeMarket = "ES";
let state = null;        // always === _states[activeMarket]
let saveTimer = null;

const uid = () => Math.random().toString(36).slice(2,9);

function seedState(market){
  const base = {
    range:{from:"2026-02-01",to:"2027-01-31"},
    dayWidth:24, collapsedCategories:{}, hiddenCategories:{}, campaigns:[]
  };
  if(market === "ES"){
    const mkSEO = a => ({id:uid(),category:"SEO",asset:a,start:"2026-02-27",end:"2026-03-04",status:"Live"});
    base.campaigns = [
      { id:uid(), name:"RENFE FALLAS 2026", mkFunds:true, start:"2026-02-26", end:"2026-03-19",
        status:"Live", notes:"Feb 26 – Mar 19", owner:"", briefingUrl:"", assetsUrl:"",
        international:false, hasPromo:false, promoDetail:"", promoUrl:"",
        collapsed:false, brandColor:"#81015e",
        activations:[
          {id:uid(),category:"campaign",asset:ASSET_CAMPAIGN,start:"2026-02-26",end:"2026-03-19",status:"Live"},
          ...TAXONOMY.find(t=>t.cat==="SEO").assets.map(mkSEO)
        ]},
      { id:uid(), name:"OUIGO ODV", mkFunds:true, start:"2026-03-05", end:"2026-03-08",
        status:"Planning", notes:"Mar 5 – Mar 8", owner:"", briefingUrl:"", assetsUrl:"",
        international:false, hasPromo:false, promoDetail:"", promoUrl:"",
        collapsed:false, brandColor:"#e3006a",
        activations:[
          {id:uid(),category:"campaign",asset:ASSET_CAMPAIGN,start:"2026-03-05",end:"2026-03-08",status:"Planning"}
        ]}
    ];
  }
  return base;
}

function migrate(s){
  s.range = s.range||{from:"2026-02-01",to:"2027-01-31"};
  s.dayWidth = s.dayWidth||24;
  s.collapsedCategories = s.collapsedCategories||{};
  s.hiddenCategories = s.hiddenCategories||{};
  s.campaigns = (s.campaigns||[]).map(c=>({
    ...c,
    activations:(c.activations||[]).map(a=>({...a, asset:ASSET_RENAME[a.asset]||a.asset})),
    collapsed:c.collapsed??false, brandColor:c.brandColor||"",
    notes:(c.notes ?? c.flightDetail ?? ""),   // legacy flightDetail carries over into notes
    international:c.international??false,
    hasPromo:c.hasPromo??false,
    promoDetail:c.promoDetail||"",
    promoUrl:c.promoUrl||"",
    briefingUrl:c.briefingUrl||"",
    assetsUrl:c.assetsUrl||""
  }));
  return s;
}

/* =====================================================
   6. STORAGE
   ===================================================== */
async function loadState(){
  setSave("syncing");
  const loaded = await dbLoad(activeMarket);
  if(loaded){ state = migrate(loaded); }
  else { state = seedState(activeMarket); await dbSave(activeMarket, state); }
  _states[activeMarket] = state;
  setSave("synced");
}

function scheduleSave(){
  if(!canEdit) return;   // view-only: never persist (incl. local view toggles)
  setSave("syncing");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveState, 700);
}

async function saveState(){
  setSave("syncing");
  const ok = await dbSave(activeMarket, state);
  setSave(ok ? "synced" : "error");
}

function setSave(k){
  const el=document.getElementById("saveInd");
  el.className="save-ind "+k;
  el.querySelector(".stxt").textContent =
    k==="error" ? ("⚠ "+(_lastDbError||"Sync failed")).slice(0,90)
    : {synced:"Synced",syncing:"Syncing…"}[k];
  el.title = k==="error"
    ? "Supabase rejected the save:\n"+(_lastDbError||"unknown error")+"\n\nClick to retry."
    : k==="synced" ? "Changes saved to Supabase and shared with your team." : "";
}

async function switchMarket(market){
  if(market===activeMarket) return;
  clearTimeout(saveTimer);
  if(canEdit) await dbSave(activeMarket, state);      // persist current before switching (edit mode only)
  activeMarket = market;
  if(_states[market]){
    state = _states[market];
  } else {
    showLoading(true);
    await loadState();
    showLoading(false);
  }
  updateMarketUI();
  render();
}

function showLoading(show){
  document.getElementById("loadingOverlay").classList.toggle("show",show);
}

function updateMarketUI(){
  document.getElementById("brandTitle").textContent = "Trainline ES & IT GTM Calendar";
  document.querySelectorAll(".mtab").forEach(b=>
    b.classList.toggle("active", b.dataset.tab===activeMarket));
}

/* =====================================================
   7. DATE UTILS
   ===================================================== */
const parse     = s  => { const [y,m,d]=s.split("-").map(Number); return new Date(Date.UTC(y,m-1,d)); };
const ymd       = d  => d.toISOString().slice(0,10);
const addDays   = (s,n) => { const d=parse(s); d.setUTCDate(d.getUTCDate()+n); return ymd(d); };
const diff      = (a,b) => Math.round((parse(b)-parse(a))/86400000);
const dayIndex  = s  => diff(state.range.from, s);
const indexToDate=i  => addDays(state.range.from, i);
const numDays   = () => diff(state.range.from, state.range.to)+1;
const maxIdx    = () => numDays()-1;
const clampIdx  = i  => Math.max(0, Math.min(maxIdx(), i));
const inRange   = s  => diff(state.range.from,s)>=0 && diff(s,state.range.to)>=0;
const esc       = s  => String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
function todayStr(){ const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }

const findCampaign = id  => state.campaigns.find(c=>c.id===id);
const findAct      = (cid,aid) => { const c=findCampaign(cid); return c&&c.activations.find(a=>a.id===aid); };

function geo(s,e){
  const max=maxIdx(); if(e<0||s>max) return null;
  return { left:Math.max(0,s)*state.dayWidth, width:Math.max(4,(Math.min(max,e)-Math.max(0,s)+1)*state.dayWidth-2) };
}

function mergeRanges(acts){
  const arr=acts.map(a=>[dayIndex(a.start),dayIndex(a.end)]).sort((x,y)=>x[0]-y[0]);
  const out=[];
  for(const [s,e] of arr){
    const last=out[out.length-1];
    if(last&&s<=last[1]+1) last[1]=Math.max(last[1],e); else out.push([s,e]);
  }
  return out;
}

/* =====================================================
   8. RENDER
   ===================================================== */
const grid  = document.getElementById("grid");
const scroll= document.getElementById("scroll");

function render(){
  // Auto-organise: earliest start date at the top
  state.campaigns.sort((a,b)=>(a.start||"").localeCompare(b.start||"")||(a.name||"").localeCompare(b.name||""));
  // Auto-advance status by date (Live on start, Done after end); persist if it changed.
  let statusDirty=false;
  for(const c of state.campaigns){ const e=effStatus(c); if(e!==c.status){ c.status=e; statusDirty=true; } }
  if(statusDirty) scheduleSave();
  document.getElementById("fromDate").value = state.range.from;
  document.getElementById("toDate").value   = state.range.to;

  const dw=state.dayWidth, nd=numDays(), tlw=nd*dw;
  const w0=parse(state.range.from).getUTCDay();
  const firstSat=(6-w0+7)%7;
  const tStr=todayStr(), tShown=inRange(tStr), tIdx=tShown?dayIndex(tStr):-1;

  grid.classList.toggle("locked", !canEdit);
  grid.style.setProperty("--dw",   dw+"px");
  grid.style.setProperty("--tlw",  tlw+"px");
  grid.style.setProperty("--wkoff",(firstSat*dw)+"px");
  grid.style.setProperty("--tdyx", (tShown?tIdx*dw+dw/2-1:-50)+"px");
  grid.style.setProperty("--tdyc", tShown?"var(--today-c)":"transparent");

  const flag = activeMarket==="ES"?"🇪🇸":"🇮🇹";
  grid.innerHTML = headerHTML(nd,dw,tIdx,flag) + state.campaigns.map(campaignHTML).join("");
  renderLegend();
}

function headerHTML(nd,dw,tIdx,flag){
  const months=[]; const days=[];
  let curKey=null,start=0,label="";
  for(let i=0;i<nd;i++){
    const d=parse(indexToDate(i));
    const key=d.getUTCFullYear()+"-"+d.getUTCMonth();
    if(key!==curKey){
      if(curKey!==null) months.push({label,count:i-start});
      curKey=key; start=i;
      label=MONTHS[d.getUTCMonth()]+(d.getUTCMonth()===0||i===0?" '"+String(d.getUTCFullYear()).slice(2):"");
    }
    const wd=d.getUTCDay(), isToday=(i===tIdx);
    days.push(`<div class="day ${wd===0||wd===6?"we":""} ${isToday?"today-col":""}" style="width:${dw}px">
      <span class="dow">${DOW[wd]}</span><span class="dnum">${d.getUTCDate()}</span></div>`);
  }
  months.push({label,count:nd-start});
  return `<div class="row hrow">
    <div class="label"><span class="corner-txt">${flag} Campaign / Channel</span></div>
    <div class="headlane">
      <div class="months">${months.map(m=>`<div class="mb" style="width:${m.count*dw}px">${m.label}</div>`).join("")}</div>
      <div class="daysrow">${days.join("")}</div>
    </div>
  </div>`;
}

function campaignHTML(c){
  const cid=c.id, cc=c.brandColor||"#9ca3af";
  let html=`<div class="row crow" style="--cc:${cc}">
    <div class="label clabel">
      <button class="caret" data-action="toggle-campaign" data-campaign="${cid}">${c.collapsed?"▸":"▾"}</button>
      <div class="cmeta">
        <div class="cname">${esc(c.name)}</div>
        <div class="ctags">
          <span class="pill mk ${c.mkFunds?"yes":"no"}">MK ${c.mkFunds?"Yes":"No"}</span>
          <span class="pill ${stCls(c.status)}">${c.status}</span>
          ${c.international?`<span class="pill intl" title="International campaign">🌍 Intl</span>`:""}
          ${c.hasPromo?`<span class="pill promo${c.promoUrl?" link":""}" ${c.promoUrl?`data-action="promo-campaign" data-campaign="${cid}"`:""} title="${esc(c.promoDetail||"Promotion")}">🎁 Promo</span>`:""}
        </div>
      </div>
      <div class="cacts">
        ${canEdit?`<button title="Duplicate" data-action="dup-campaign" data-campaign="${cid}">⎘</button>`:""}
        ${canEdit?`<button title="Edit" data-action="edit-campaign" data-campaign="${cid}">✎</button>`:""}
        <button title="Campaign info" data-action="info-campaign" data-campaign="${cid}">ℹ️</button>
        <button title="${c.briefingUrl?"Open briefing":"No briefing URL"}" data-action="brief-campaign" data-campaign="${cid}" ${c.briefingUrl?"":"disabled"}>${ICON_AIRTABLE}</button>
        <button title="${c.assetsUrl?"Open assets":"No assets URL"}" data-action="assets-campaign" data-campaign="${cid}" ${c.assetsUrl?"":"disabled"}>📎</button>
      </div>
    </div>
    <div class="lane clane paintable" data-paint="1" data-campaign="${cid}" data-cat="campaign" data-asset="${ASSET_CAMPAIGN}">
      ${campaignLaneContent(c)}
    </div>
  </div>`;
  if(!c.collapsed){
    for(const t of TAXONOMY){
      if(state.hiddenCategories[t.cat]) continue;
      html += categoryHTML(c,t);
    }
  }
  return html;
}

function campaignLaneContent(c){
  const cc=c.brandColor||"#9ca3af";
  const g=geo(dayIndex(c.start),dayIndex(c.end));
  const win=g?`<div class="cwin" style="left:${g.left}px;width:${g.width}px;border-color:${cc}55"></div>`:"";
  const bars=c.activations.filter(a=>a.category==="campaign").map(a=>barHTML(c.id,a,cc)).join("");
  const mini=c.collapsed?c.activations.filter(a=>a.category!=="campaign").map(a=>{
    const ag=geo(dayIndex(a.start),dayIndex(a.end));
    return ag?`<div class="mini c-${a.category}" style="left:${ag.left}px;width:${ag.width}px;background:var(--cc)"></div>`:"";
  }).join(""):"";
  return win+bars+mini;
}

function categoryHTML(c,t){
  const col=!!state.collapsedCategories[t.cat];
  const catBars=!col?c.activations.filter(a=>a.category===t.cat&&a.asset===ASSET_CATEGORY).map(a=>barHTML(c.id,a)).join(""):"";
  const sumBars=col?summaryHTML(c,t):"";
  let html=`<div class="row catrow c-${t.cat}">
    <div class="label catlabel">
      <button class="caret" data-action="toggle-category" data-cat="${t.cat}">${col?"▸":"▾"}</button>
      <span class="cdot"></span><span class="catname">${t.cat}</span>
    </div>
    <div class="lane catlane paintable" data-paint="1" data-campaign="${c.id}" data-cat="${t.cat}" data-asset="${ASSET_CATEGORY}">
      ${catBars}${sumBars}
    </div>
  </div>`;
  if(!col){
    html+=t.assets.map(asset=>{
      const bars=c.activations.filter(a=>a.category===t.cat&&a.asset===asset).map(a=>barHTML(c.id,a)).join("");
      return `<div class="row arow c-${t.cat}">
        <div class="label"><div class="alabel-wrap"><span class="adot"></span><span class="alabel-txt" title="${esc(asset)}">${esc(asset)}</span></div></div>
        <div class="lane alane paintable" data-paint="1" data-campaign="${c.id}" data-cat="${t.cat}" data-asset="${asset}">${bars}</div>
      </div>`;
    }).join("");
  }
  return html;
}

function summaryHTML(c,t){
  const acts=c.activations.filter(a=>a.category===t.cat&&a.asset!==ASSET_CATEGORY);
  if(!acts.length) return "";
  return mergeRanges(acts).map(([s,e])=>{
    const g=geo(s,e); if(!g) return "";
    return `<div class="bar c-${t.cat} summary" style="left:${g.left}px;width:${g.width}px"></div>`;
  }).join("");
}

function barHTML(cid,a,campaignColor){
  const g=geo(dayIndex(a.start),dayIndex(a.end)); if(!g) return "";
  const isCamp=a.category==="campaign";
  const isCat =a.asset===ASSET_CATEGORY;
  const ic = isCamp?(campaignColor||findCampaign(cid)?.brandColor||"#9ca3af"):null;
  const cls = isCamp?`bar s-${a.status}`:`bar c-${a.category} s-${a.status}`;
  const bg  = ic?`background:${ic};--bar-bg:${ic};`:"";
  const lbl = isCamp?(findCampaign(cid)?.name||""):isCat?a.category:a.asset;
  return `<div class="${cls}" data-id="${a.id}" data-campaign="${cid}" data-editable="1"
    style="${bg}left:${g.left}px;width:${g.width}px"
    title="${esc(lbl+' · '+a.start+' → '+a.end+' · '+a.status)}">
    <span class="h h-l"></span>
    ${g.width>30?`<span class="blabel">${esc(lbl)}</span>`:""}
    <span class="h h-r"></span>
  </div>`;
}

function stCls(s){ return {Planning:"st-Planning",Briefed:"st-Briefed",Live:"st-Live",Done:"st-Done"}[s]||"st-Planning"; }

/* Status auto-advances by date: Live once the start date is reached, Done once
   the end date has passed. Before the start date the manual status (Planning /
   Briefed) is kept. The Slack notifier applies the same rule so both agree. */
function effStatus(c){
  const t=todayStr();
  if(c.end   && t>c.end)    return "Done";
  if(c.start && t>=c.start) return "Live";
  return c.status||"Planning";
}

function renderLegend(){
  const chips=TAXONOMY.map(t=>`<span class="chip ${state.hiddenCategories[t.cat]?"off":""}" data-action="toggle-legend" data-cat="${t.cat}">
    <span class="cdot" style="background:var(--${t.cat})"></span>${t.cat}</span>`).join("");
  const brands=BRAND_PALETTE.map(b=>`<span class="brand-chip"><span class="bdot" style="background:${b.color}"></span>${b.name}</span>`).join("");
  document.getElementById("legend").innerHTML=
    `<span class="leg-label">Channels</span><div style="display:flex;gap:5px">${chips}</div>
     <div class="spacer" style="flex:1"></div>
     <span class="leg-label">Campaigns</span><div style="display:flex;gap:5px">${brands}</div>`;
}

/* =====================================================
   9. PAINT & DRAG
   ===================================================== */
let drag=null;

grid.addEventListener("pointerdown", e=>{
  if(!canEdit) return;   // view-only: no painting, moving, resizing, or bar menu
  const bar=e.target.closest('.bar[data-editable="1"]');
  if(bar){
    e.preventDefault();
    const act=findAct(bar.dataset.campaign,bar.dataset.id); if(!act) return;
    const handle=e.target.closest(".h");
    const type=handle?(handle.classList.contains("h-l")?"resize-l":"resize-r"):"move";
    drag={type,act,bar,rect:bar.parentElement.getBoundingClientRect(),startX:e.clientX,
          os:dayIndex(act.start),oe:dayIndex(act.end),moved:false};
    drag.ns=drag.os; drag.ne=drag.oe;
    document.body.style.userSelect="none";
    window.addEventListener("pointermove",onMove);
    window.addEventListener("pointerup",onUp,{once:true});
    return;
  }
  const lane=e.target.closest('.lane[data-paint="1"]');
  if(lane){
    e.preventDefault();
    const rect=lane.getBoundingClientRect();
    const idx=clampIdx(Math.floor((e.clientX-rect.left)/state.dayWidth));
    const cat=lane.dataset.cat, cid=lane.dataset.campaign;
    const previewBg=cat==="campaign"?(findCampaign(cid)?.brandColor||"#9ca3af"):"var(--cc)";
    const pb=document.createElement("div");
    pb.className="bar preview"+(cat!=="campaign"?" c-"+cat:"");
    pb.style.cssText=`left:${idx*state.dayWidth}px;width:${Math.max(4,state.dayWidth-2)}px;background:${previewBg}`;
    lane.appendChild(pb);
    drag={type:"paint",lane,rect,startIdx:idx,curIdx:idx,preview:pb,
          campaign:cid,cat,asset:lane.dataset.asset};
    document.body.style.userSelect="none";
    window.addEventListener("pointermove",onMove);
    window.addEventListener("pointerup",onUp,{once:true});
  }
});

function posBar(el,a,b){ const dw=state.dayWidth; el.style.left=a*dw+"px"; el.style.width=Math.max(4,(b-a+1)*dw-2)+"px"; }

function onMove(e){
  if(!drag) return;
  const dw=state.dayWidth;
  if(Math.abs(e.clientX-drag.startX)>3) drag.moved=true;
  if(drag.type==="paint"){
    const idx=clampIdx(Math.floor((e.clientX-drag.rect.left)/dw));
    drag.curIdx=idx; posBar(drag.preview,Math.min(drag.startIdx,idx),Math.max(drag.startIdx,idx));
  } else if(drag.type==="move"){
    const d=Math.round((e.clientX-drag.startX)/dw), span=drag.oe-drag.os;
    const ns=Math.max(0,Math.min(maxIdx()-span,drag.os+d));
    drag.ns=ns; drag.ne=ns+span; posBar(drag.bar,drag.ns,drag.ne);
  } else if(drag.type==="resize-l"){
    const ns=Math.max(0,Math.min(drag.oe,drag.os+Math.round((e.clientX-drag.startX)/dw)));
    drag.ns=ns; drag.ne=drag.oe; posBar(drag.bar,drag.ns,drag.ne);
  } else if(drag.type==="resize-r"){
    const ne=Math.min(maxIdx(),Math.max(drag.os,drag.oe+Math.round((e.clientX-drag.startX)/dw)));
    drag.ns=drag.os; drag.ne=ne; posBar(drag.bar,drag.ns,drag.ne);
  }
}

function onUp(e){
  window.removeEventListener("pointermove",onMove);
  document.body.style.userSelect="";
  if(!drag) return;
  const d=drag; drag=null;
  if(d.type==="paint"){
    if(d.preview) d.preview.remove();
    const a=Math.min(d.startIdx,d.curIdx), b=Math.max(d.startIdx,d.curIdx);
    const c=findCampaign(d.campaign);
    if(c){ c.activations.push({id:uid(),category:d.cat,asset:d.asset,start:indexToDate(a),end:indexToDate(b),status:"Live"}); render(); scheduleSave(); }
    return;
  }
  if(d.moved){ d.act.start=indexToDate(d.ns); d.act.end=indexToDate(d.ne); render(); scheduleSave(); }
  else openActMenu(d.act,d.bar,e);
}

/* =====================================================
   10. BAR MENU
   ===================================================== */
function closeMenus(){ document.querySelectorAll(".menu").forEach(m=>m.remove()); }

function openActMenu(act,barEl,e){
  closeMenus();
  const c=findCampaign(barEl.dataset.campaign);
  const isCamp=act.category==="campaign";
  const isCat =act.asset===ASSET_CATEGORY;
  const title=isCamp?(c?.name||"Campaign span"):isCat?(act.category+" (category)"):act.asset;
  const m=document.createElement("div"); m.className="menu";
  m.innerHTML=`<div class="mhead"><div class="mt">${esc(title)}</div><div class="ms">${act.start} → ${act.end}</div></div>
    <div class="opt del" data-del="1">🗑 Delete this bar</div>`;
  document.getElementById("overlays").appendChild(m);
  const mh=m.scrollHeight||230;
  m.style.left=Math.max(8,Math.min(e.clientX||100,window.innerWidth-210))+"px";
  m.style.top =Math.max(8,Math.min(e.clientY||100,window.innerHeight-mh-8))+"px";
  m.addEventListener("click",ev=>{
    const opt=ev.target.closest(".opt"); if(!opt) return;
    if(opt.dataset.del){ const ca=findCampaign(barEl.dataset.campaign); if(ca) ca.activations=ca.activations.filter(a=>a.id!==act.id); }
    else if(opt.dataset.status) act.status=opt.dataset.status;
    closeMenus(); render(); scheduleSave();
  });
  setTimeout(()=>document.addEventListener("pointerdown",function out(ev){ if(!ev.target.closest(".menu")){ closeMenus(); document.removeEventListener("pointerdown",out); } }),0);
}

/* =====================================================
   11. EDIT LOCK UI
   ===================================================== */
async function toggleLock(){
  if(canEdit){ canEdit=false; updateLockUI(); render(); return; }
  const pw = prompt("Enter the edit password to make changes:");
  if(pw===null) return;                       // cancelled
  if(await sha256(pw) === APP_EDIT_HASH){ canEdit=true; updateLockUI(); render(); }
  else alert("Incorrect password — staying in view-only mode.");
}
function updateLockUI(){
  const b=document.getElementById("lockBtn");
  if(b){
    b.textContent = canEdit ? "🔓 Editing — click to lock" : "🔒 View only — click to edit";
    b.classList.toggle("primary", canEdit);
  }
  const add=document.getElementById("addBtn");
  if(add) add.style.display = canEdit ? "" : "none";
}

/* =====================================================
   12. TOOLBAR ACTIONS
   ===================================================== */
document.getElementById("saveInd").addEventListener("click",()=>{
  if(document.getElementById("saveInd").classList.contains("error")) saveState();
});

document.getElementById("app").addEventListener("click", async e=>{
  const t=e.target.closest("[data-action]"); if(!t) return;
  const action=t.dataset.action, cid=t.dataset.campaign;
  // Edit actions are inert while locked (buttons are also hidden, this is a backstop)
  if(!canEdit && ["add-campaign","edit-campaign","dup-campaign","del-campaign"].includes(action)) return;
  switch(action){
    case "toggle-lock":   await toggleLock(); break;
    case "switch-tab":    await switchMarket(t.dataset.tab); break;
    case "add-campaign":  openCampaignForm(null); break;
    case "edit-campaign": openCampaignForm(cid); break;
    case "info-campaign": openCampaignForm(cid); break;   // read-only when locked
    case "dup-campaign":  dupCampaign(cid); break;
    case "del-campaign":  delCampaign(cid); break;
    case "brief-campaign":{ const c=findCampaign(cid); if(c?.briefingUrl) window.open(c.briefingUrl,"_blank","noopener"); break; }
    case "assets-campaign":{ const c=findCampaign(cid); if(c?.assetsUrl) window.open(c.assetsUrl,"_blank","noopener"); break; }
    case "promo-campaign":{ const c=findCampaign(cid); if(c?.promoUrl) window.open(c.promoUrl,"_blank","noopener"); break; }
    case "toggle-campaign":{ const c=findCampaign(cid); c.collapsed=!c.collapsed; render(); scheduleSave(); break; }
    case "toggle-category":{ const k=t.dataset.cat; state.collapsedCategories[k]=!state.collapsedCategories[k]; render(); scheduleSave(); break; }
    case "toggle-legend":{ const k=t.dataset.cat; state.hiddenCategories[k]=!state.hiddenCategories[k]; render(); scheduleSave(); break; }
    case "zoom-in":  state.dayWidth=Math.min(MAX_DW,state.dayWidth+4); render(); scheduleSave(); break;
    case "zoom-out": state.dayWidth=Math.max(MIN_DW,state.dayWidth-4); render(); scheduleSave(); break;
    case "reload":   await loadState(); render(); break;
  }
});

document.getElementById("fromDate").addEventListener("change",e=>{
  if(!canEdit){ e.target.value=state.range.from; return; }
  const v=e.target.value; if(!v) return;
  if(diff(v,state.range.to)<0){alert("From must be before To."); e.target.value=state.range.from; return;}
  state.range.from=v; render(); scheduleSave();
});
document.getElementById("toDate").addEventListener("change",e=>{
  if(!canEdit){ e.target.value=state.range.to; return; }
  const v=e.target.value; if(!v) return;
  if(diff(state.range.from,v)<0){alert("To must be after From."); e.target.value=state.range.to; return;}
  state.range.to=v; render(); scheduleSave();
});

function dupCampaign(cid){
  const c=findCampaign(cid); if(!c) return;
  const copy=JSON.parse(JSON.stringify(c));
  copy.id=uid(); copy.name=c.name+" (copy)"; copy.activations.forEach(a=>a.id=uid());
  state.campaigns.splice(state.campaigns.findIndex(x=>x.id===cid)+1,0,copy);
  render(); scheduleSave();
}
function delCampaign(cid){
  const c=findCampaign(cid); if(!c) return;
  if(!confirm(`Delete "${c.name}" and all its bars?`)) return;
  state.campaigns=state.campaigns.filter(x=>x.id!==cid);
  render(); scheduleSave();
}

/* =====================================================
   13. CAMPAIGN FORM
   ===================================================== */
function openCampaignForm(cid){
  const editing=!!cid;
  const readOnly=!canEdit;                 // info view while locked; full editing once unlocked
  const dis=readOnly?" disabled":"";
  const c=editing?findCampaign(cid):{name:"",start:state.range.from,end:state.range.from,mkFunds:true,status:"Planning",notes:"",owner:"",briefingUrl:"",assetsUrl:"",brandColor:"",international:false,hasPromo:false,promoDetail:"",promoUrl:""};
  let sel=c.brandColor||"";
  const scrim=document.createElement("div"); scrim.className="scrim";
  const sw=[
    `<span class="swatch ${sel===""?"sel":""}" data-col="" style="background:#d1d5db" title="None"></span>`,
    ...BRAND_PALETTE.map(b=>`<span class="swatch ${sel===b.color?"sel":""}" data-col="${b.color}" style="background:${b.color}" title="${b.name}"></span>`)
  ].join("");
  const title=readOnly?"Campaign info":(editing?"Edit campaign":"New campaign");
  scrim.innerHTML=`<div class="modal"><h2>${title}</h2>
    ${readOnly?`<p class="ro-hint">View only — click the 🔒 button in the top bar and enter the password to edit.</p>`:""}
    <div class="field"><label>Campaign name</label><input id="f_name" value="${esc(c.name)}" placeholder="e.g. RENFE SUMMER 2026"${dis}></div>
    <div class="frow">
      <div class="field"><label>Start date</label><input id="f_start" type="date" value="${c.start}"${dis}></div>
      <div class="field"><label>End date</label><input id="f_end" type="date" value="${c.end}"${dis}></div>
    </div>
    <div class="frow">
      <div class="field"><label>MK Funds</label><select id="f_mk"${dis}><option value="yes" ${c.mkFunds?"selected":""}>Yes</option><option value="no" ${!c.mkFunds?"selected":""}>No</option></select></div>
      <div class="field"><label>Status</label><select id="f_status"${dis}>${STATUSES.map(s=>`<option ${s===c.status?"selected":""}>${s}</option>`).join("")}</select></div>
    </div>
    <div class="field"><label>Brand colour</label><div class="swatches${readOnly?" ro":""}">${sw}</div></div>
    <div class="field"><label>Notes</label><textarea id="f_notes" rows="3" placeholder="Any notes about this campaign…"${dis}>${esc(c.notes||"")}</textarea></div>
    <div class="checks">
      <div class="checkrow"><input type="checkbox" id="f_intl" ${c.international?"checked":""}${dis}><label for="f_intl">International (not domestic-only)</label></div>
      <div class="checkrow"><input type="checkbox" id="f_promo" ${c.hasPromo?"checked":""}${dis}><label for="f_promo">Has promotion</label></div>
    </div>
    <div id="promoFields" style="${c.hasPromo?"":"display:none"}">
      <div class="field"><label>Promo details</label><input id="f_promodetail" value="${esc(c.promoDetail||"")}" placeholder="e.g. 20% off all routes"${dis}></div>
      <div class="field"><label>Promo URL</label><input id="f_promourl" value="${esc(c.promoUrl||"")}" placeholder="https://…"${dis}></div>
    </div>
    <div class="field"><label>Owner</label><input id="f_owner" value="${esc(c.owner||"")}" placeholder="Name"${dis}></div>
    <div class="frow">
      <div class="field"><label>${ICON_AIRTABLE} Briefing URL</label><input id="f_url" value="${esc(c.briefingUrl||"")}" placeholder="Link to the campaign brief"${dis}></div>
      <div class="field"><label>📎 Assets URL</label><input id="f_assets" value="${esc(c.assetsUrl||"")}" placeholder="Link to the creative assets"${dis}></div>
    </div>
    <div class="ferr" id="f_err"></div>
    <div class="actions">
      ${editing&&!readOnly?`<button class="btn danger" id="f_delete">🗑 Delete campaign</button>`:""}
      <div class="spacer" style="flex:1"></div>
      <button class="btn" id="f_cancel">${readOnly?"Close":"Cancel"}</button>${readOnly?"":`<button class="btn primary" id="f_save">${editing?"Save changes":"Create campaign"}</button>`}
    </div>
  </div>`;
  document.getElementById("overlays").appendChild(scrim);
  const close=()=>scrim.remove();
  scrim.addEventListener("click",e=>{ if(e.target===scrim) close(); });
  scrim.querySelector("#f_cancel").addEventListener("click",close);
  if(readOnly){ return; }                  // info view: nothing is editable, no save handler
  const delBtn=scrim.querySelector("#f_delete");
  if(delBtn) delBtn.addEventListener("click",()=>{ close(); delCampaign(cid); });   // delCampaign confirms first

  scrim.querySelectorAll(".swatch").forEach(sw=>sw.addEventListener("click",()=>{
    sel=sw.dataset.col; scrim.querySelectorAll(".swatch").forEach(s=>s.classList.toggle("sel",s.dataset.col===sel));
  }));
  const promoChk=scrim.querySelector("#f_promo"), promoFields=scrim.querySelector("#promoFields");
  promoChk.addEventListener("change",()=>{ promoFields.style.display=promoChk.checked?"":"none"; });
  scrim.querySelector("#f_name").focus();
  scrim.querySelector("#f_save").addEventListener("click",()=>{
    const name=scrim.querySelector("#f_name").value.trim();
    const start=scrim.querySelector("#f_start").value;
    const end=scrim.querySelector("#f_end").value;
    const err=scrim.querySelector("#f_err");
    if(!name){err.textContent="Please enter a campaign name.";return;}
    if(!start||!end){err.textContent="Please set start and end dates.";return;}
    if(diff(start,end)<0){err.textContent="End date must be on or after start date.";return;}
    const data={name,start,end,
      mkFunds:scrim.querySelector("#f_mk").value==="yes",
      status:scrim.querySelector("#f_status").value,
      notes:scrim.querySelector("#f_notes").value.trim(),
      international:scrim.querySelector("#f_intl").checked,
      hasPromo:scrim.querySelector("#f_promo").checked,
      promoDetail:scrim.querySelector("#f_promodetail").value.trim(),
      promoUrl:scrim.querySelector("#f_promourl").value.trim(),
      owner:scrim.querySelector("#f_owner").value.trim(),
      briefingUrl:scrim.querySelector("#f_url").value.trim(),
      assetsUrl:scrim.querySelector("#f_assets").value.trim(),
      brandColor:sel};
    if(editing) Object.assign(c,data);
    else state.campaigns.push({id:uid(),collapsed:false,activations:[],...data});
    close(); render(); scheduleSave();
  });
}

/* =====================================================
   14. BOOT  — runs once when the page loads
   ===================================================== */
(async function init(){
  await loadState();
  updateMarketUI();
  updateLockUI();
  render();
  const t=todayStr();
  if(inRange(t)) scroll.scrollLeft=Math.max(0,dayIndex(t)*state.dayWidth-260);
})();
