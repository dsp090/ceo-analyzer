// v8-agents build — FIXED: tenure<=1.5yr clears all transition flags (was <1.5)
// PATCH 1: x-portkey-cache-force-refresh header added to callLLM
// PATCH 2: tenure boundary changed from < 1.5 to <= 1.5 in agentResearch + agentPrediction
import { useState, useRef, useEffect } from "react";

// SheetJS loaded via script tag for reliable global access
// ESM import of xlsx.mjs can fail to expose XLSX.read in some bundler configs
let XLSX = null;
async function loadXLSX() {
  if (XLSX) return XLSX;
  return new Promise((resolve, reject) => {
    if (window.XLSX) { XLSX = window.XLSX; return resolve(XLSX); }
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
    s.onload  = () => { XLSX = window.XLSX; resolve(XLSX); };
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

// ── Global styles ─────────────────────────────────────────────────────────────
const injectGlobalStyle = () => {
  const s = document.createElement("style");
  s.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap');
    html,body,#root{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#F1F2F4;}
    *{box-sizing:border-box;font-family:'Inter',system-ui,sans-serif;}
    ::-webkit-scrollbar{width:4px;}
    ::-webkit-scrollbar-track{background:transparent;}
    ::-webkit-scrollbar-thumb{background:#CBD5E1;border-radius:99px;}
    ::-webkit-scrollbar-thumb:hover{background:#94A3B8;}
    button:focus,textarea:focus,input:focus{outline:none;}
    button{font-family:'Inter',system-ui,sans-serif;}
    textarea,input{font-size:13px;}
  `;
  document.head.appendChild(s);
};

const C = {
  red:"#C00000", redD:"#900000", redDD:"#5C0000",
  redBg:"rgba(192,0,0,0.05)", redBorder:"rgba(192,0,0,0.2)",
  ink:"#111827", slate:"#1F2937", mid:"#6B7280", muted:"#9CA3AF",
  white:"#FFFFFF", surface:"#FFFFFF", surfaceAlt:"#F9FAFB",
  border:"#F0F0F0", borderMid:"#E5E7EB",
  ok:"#166534", okBg:"rgba(22,101,52,0.06)",
  warn:"#92400E", warnBg:"rgba(146,64,14,0.06)",
};

const PORTKEY_URL = "/api/chat/completions";
const PORTKEY_KEY = "2bayMIyF+J3J0aJtcc4i1HvrfLAS";
const MODEL       = "@ceo-coe/gpt-4o-search-preview";

// ── Helpers ───────────────────────────────────────────────────────────────────
const ni  = v => {
  if(!v) return true;
  const s = String(v).toLowerCase().trim();
  return s.includes("not clearly") ||
         s.includes("not publicly") ||
         s.includes("not available") ||
         s.includes("not disclosed") ||
         s.includes("not inferable") ||
         s.includes("unknown") ||
         s === "n/a" ||
         s === "na" ||
         s === "-" ||
         s === "";
};
const cl  = (t, n=25) => { if(!t) return ""; const w=String(t).replace(/[\n\r]/g," ").trim().split(/\s+/); return w.length<=n?w.join(" "):w.slice(0,n).join(" ").replace(/[,;:-]$/,"")+"..."; };
const lst = (a, n=4, w=20) => Array.isArray(a)?[...new Set(a.map(x=>cl(x,w)).filter(Boolean))].slice(0,n):[];
const joinCompact = (items, sep=" | ", n=25) => cl(items.filter(Boolean).map(String).map(s=>s.trim()).filter(Boolean).join(sep), n);
const calcTenure = s => {
  if(!s||["","not clearly inferable","not publicly disclosed"].includes(String(s).toLowerCase().trim())) return "";
  try {
    const d1=new Date(s); if(!isNaN(d1)){const y=(Date.now()-d1.getTime())/(365.25*24*3600*1e3);return y.toFixed(1);}
    const m=String(s).match(/\b(19|20)\d{2}\b/);
    if(m){const d2=new Date(`${m[0]}-07-01`);const y=(Date.now()-d2.getTime())/(365.25*24*3600*1e3);return`~${y.toFixed(1)}`;}
  } catch{}
  return "";
};

const PRED_COLOR = {new_ceo_appointed:"#C00000",transition_underway:"#C00000",high_likelihood:"#C00000",medium_likelihood:"#8A5A00",low_likelihood:"#1A6B3C"};
const PRED_LABEL = {new_ceo_appointed:"New CEO Appointed",transition_underway:"Transition Underway",high_likelihood:"High Likelihood",medium_likelihood:"Medium Likelihood",low_likelihood:"Low Likelihood"};
const OWN_LABEL  = {founder_ceo:"Founder CEO",family_ceo:"Family CEO",founder_family_control_non_ceo:"Family Control",family_majority_owned:"Family Majority",government_controlled:"Gov. Controlled",state_owned_enterprise:"State-Owned",private_equity_owned:"PE-Owned",professionally_managed:"Prof. Managed",unclear:"Unclear"};
const VIEW_LABEL = {high_influence:"High Influence",medium_influence:"Medium Influence",weak_influence:"Weak Influence",no_clear_influence:"No Clear Influence"};
const VIEW_COLOR = {high_influence:"#C00000",medium_influence:"#B84400",weak_influence:"#8A5A00",no_clear_influence:"#1A6B3C"};
const isHighPred = p => ["new_ceo_appointed","transition_underway","high_likelihood"].includes(p);
const rc = s => s>=8?"#C00000":s>=6?"#B84400":s>=4?"#8A5A00":"#1A6B3C";

function parseJSON(text, fallback={}) {
  try { const s=text.indexOf("{"),e=text.lastIndexOf("}")+1; return s!==-1?JSON.parse(text.slice(s,e)):fallback; } catch{ return fallback; }
}

const FX = { "€":1.08, "£":1.27, "¥":0.0067, "￥":0.0067, "A$":0.65, "C$":0.73, "CHF":1.12, "kr":0.093 };
function normaliseRevenue(s) {
  if(!s||ni(s)) return s;
  const raw = String(s).trim();
  let fx = 1;
  for(const [sym,rate] of Object.entries(FX)){
    if(raw.startsWith(sym)||raw.includes(" "+sym)){fx=rate;break;}
  }
  const numMatch = raw.match(/([\d,.]+)\s*(trillion|tn|billion|bn|million|m|b)/i);
  if(!numMatch) return raw;
  const num = parseFloat(numMatch[1].replace(/,/g,""));
  const unit = numMatch[2].toLowerCase();
  let usdBn;
  if(unit==="trillion"||unit==="tn") usdBn = num * 1000 * fx;
  else if(unit==="billion"||unit==="bn"||unit==="b") usdBn = num * fx;
  else if(unit==="million"||unit==="m") usdBn = num / 1000 * fx;
  else return raw;
  if(usdBn >= 1000) return `$${(usdBn/1000).toFixed(1)}tn`;
  if(usdBn >= 1)    return `$${usdBn.toFixed(1)}bn`;
  return `$${(usdBn*1000).toFixed(0)}m`;
}

// ── Portkey call ──────────────────────────────────────────────────────────────
// Cache-bust strategy (4 layers):
//   1. x-portkey-cache: no-cache         — tells Portkey never to serve cached response
//   2. x-portkey-cache-force-refresh     — bypasses any existing cached entry
//   3. nonce in sys prompt               — unique token fingerprint per call
//   4. CURRENT TIME in user prompt       — makes prompt string unique every call
async function callLLM(sys, usr, webSearch=false) {
  const now   = new Date();
  const ts    = now.toTimeString().slice(0,8);
  const nonce = `[REQ-${Date.now()}-${Math.random().toString(36).slice(2,7)}]`;

  // ── What we are sending ───────────────────────────────────────────────────
  console.group(`%c🔵 callLLM [${nonce}] webSearch=${webSearch}`, "color:#3B82F6;font-weight:bold");
  console.log("⏰ Time:",          ts);
  console.log("📤 System (first 120):", sys.slice(0,120).replace(/\n/g," "));
  console.log("📤 User (first 120):",   usr.slice(0,120).replace(/\n/g," "));

  const body = {
    model: MODEL,
    messages: [
      { role:"system", content:`${sys}\n\n${nonce}` },
      { role:"user",   content:`CURRENT TIME: ${ts}\n\n${usr}` },
    ],
    max_completion_tokens: 1024,
  };
  if(webSearch) {
    body.plugins = [{id:"webSearch"}];
  }

  const t0 = Date.now();
  const r = await fetch(PORTKEY_URL, {
    method:"POST",
    cache:"no-store",
    headers:{
      "Content-Type":                  "application/json",
      "x-portkey-api-key":             PORTKEY_KEY,
      "x-portkey-cache":               "no-cache",
      "x-portkey-cache-force-refresh": "true",
    },
    body:JSON.stringify(body)
  });

  const elapsed = Date.now() - t0;

  // ── Response diagnostics ──────────────────────────────────────────────────
  const cacheHdr  = r.headers.get("x-portkey-cache")        || "none";
  const cacheHit  = r.headers.get("x-portkey-cache-status") || "none";
  const reqId     = r.headers.get("x-request-id")           || "none";
  const status    = r.status;

  const cacheIcon = (cacheHdr==="HIT"||cacheHit==="HIT") ? "🔴 CACHE HIT" : "🟢 CACHE MISS";
  console.log(`${cacheIcon} | status=${status} | ${elapsed}ms | cache-header="${cacheHdr}" | cache-status="${cacheHit}" | req-id="${reqId}"`);

  if(!r.ok) {
    const errText = await r.text();
    console.error("❌ Portkey error:", errText);
    console.groupEnd();
    throw new Error(`Portkey ${status}: ${errText}`);
  }

  const d = await r.json();
  const content = d.choices?.[0]?.message?.content?.trim()||"";

  console.log("📥 Response (first 200):", content.slice(0,200).replace(/\n/g," "));
  console.groupEnd();

  return content;
}

// ── Financial Data Fetch ──────────────────────────────────────────────────────
async function fetchFinancialData(company, ticker) {
  const today = new Date().toDateString();
  const yr    = new Date().getFullYear();

  const prompt = `Today is ${today}. I need specific financial performance data for "${company}" (${ticker||""}).

IMPORTANT: Use your web search to find the latest figures. Provide actual numbers — do not say "not available".

Answer each question with an actual number or percentage:

1. REVENUE: Latest annual revenue with year e.g. "$391bn FY2024"
2. TSR 1yr: 1-year total shareholder return to most recent data e.g. "+28%" or "-12%"
3. TSR 3yr: 3-year annualised TSR e.g. "+15% p.a." or "-4% p.a."
4. TSR VS SECTOR PEERS: Compared to sector median — above or below? Rough magnitude?
5. REVENUE GROWTH: Year-on-year revenue growth last 2 years — accelerating or slowing?
6. PROFITABILITY: Operating margin trend — expanding, stable, or contracting?
7. ANALYST VIEW: Current consensus — Buy/Hold/Sell? Any major recent downgrades?
8. KEY FINANCIAL RISK: What is the single biggest financial concern for this company right now?

Give real numbers based on your web search results. If web search returns no data, use your best knowledge.`;

  try {
    const r = await callLLM(
      `You are a financial analyst with deep knowledge of public company financials. Today is ${today}. Provide actual numbers.`,
      prompt, true
    );
    if (r && r.length > 30) return r;
    throw new Error("empty");
  } catch {
    try {
      return await callLLM(
        `You are a financial analyst. Today is ${today}. Use your training knowledge to answer.`,
        prompt, false
      );
    } catch { return "Financial data not available."; }
  }
}

// ── Agent 1: CEO News ─────────────────────────────────────────────────────────
async function fetchCEONews(company) {
  const today = new Date().toDateString();
  const yr    = new Date().getFullYear();

  // CRITICAL: sys prompt explicitly forbids using training memory for CEO identity
  const sys = `You are a corporate intelligence expert. Today is ${today}.
YOU MUST USE YOUR WEB SEARCH TOOL TO ANSWER THESE QUESTIONS.
DO NOT answer from your training memory — your training data about who is CEO of any company is OUTDATED and WRONG.
ONLY use information returned by your live web search.
If the web search says a different person is CEO than what you remember — the web search is CORRECT.
If you cannot find current information via web search, say "not found in web search" — do NOT fall back to training data.`;

  const prompt = `SEARCH THE WEB NOW for the most recent CEO news about "${company}".

Do NOT use your training memory. Search the web and report ONLY what you find there.

Search for ALL of these queries:
1. "${company} CEO ${yr}"
2. "${company} CEO ${yr-1}"
3. "${company} CEO steps down resigned left replaced ${yr}"
4. "${company} CEO steps down resigned left replaced ${yr-1}"
5. "${company} new CEO appointed ${yr}"
6. "${company} CEO successor announced"

⚠ CRITICAL ORDERING RULE — READ CAREFULLY:
- The CURRENT CEO is the person IN THE ROLE RIGHT NOW as of ${today}.
- The DEPARTED CEO is the person who PREVIOUSLY held the role and has since LEFT.
- If person A was CEO, then person B was appointed as NEW CEO → B is CURRENT, A is DEPARTED.
- Do NOT confuse the order. The most RECENTLY appointed person is the CURRENT CEO.
- A CEO who moves to chairman, advisory, or non-executive role is NO LONGER CEO.

Q1. CURRENT CEO: Who is the CEO of "${company}" RIGHT NOW as of ${today}? Full name + start date.
     The CURRENT CEO is the most recently appointed person — not the previous one.
Q2. PREVIOUS/DEPARTED CEO: Who was CEO before the current one? Name + when they left.
Q3. SUCCESSOR ANNOUNCED: Is there a named incoming CEO not yet started? Yes/No. If yes: full name, start date.
Q4. DEPARTURE: Has any departure/step-back/resignation been announced? Yes/No + details.
Q5. TRANSITION STATUS: Is a transition underway, complete, or none?

REPORT ONLY WHAT THE WEB SEARCH RETURNS. Do not supplement with training knowledge.`;

  // Only ONE call — web search only, no training fallback
  try {
    const r1 = await callLLM(sys, prompt, true);
    if (r1 && r1.length > 30) {
      console.log(`\n🌐 [fetchCEONews] RAW WEB RESULT for "${company}":\n`, r1.slice(0, 500));

      // Second targeted search — specifically asks "who holds the CEO title right now"
      // This catches cases where the first search returns transition news but not the
      // definitive current title holder (e.g. multi-step transitions)
      let r2 = "";
      try {
        r2 = await callLLM(
          `You are a corporate intelligence expert. Today is ${today}.
USE YOUR WEB SEARCH TOOL. Search for who CURRENTLY holds the CEO title at this company right now.
Focus only on the most recent information. Return a short factual answer.`,
          `SEARCH: Who is the current CEO of "${company}" as of ${today}?
Search for: "${company} CEO title holder ${yr}"
Return: Full name of current CEO, their start date, and whether they hold the title "CEO" or "Executive Chairman" or other.`,
          true
        );
      } catch {}

      const combined = r1 + (r2 ? `\n\n--- VERIFICATION SEARCH ---\n${r2}` : "");
      return "LIVE WEB SEARCH RESULTS:\n" + combined;
    }
  } catch(e) {
    console.error(`❌ [fetchCEONews] Web search call FAILED for "${company}":`, e.message);
  }

  console.warn(`⚠️ [fetchCEONews] Web search returned nothing for "${company}" — no fallback`);
  return `Web search returned no results for ${company}. Do not use training data.`;
}

// ── Agent 2: Research ─────────────────────────────────────────────────────────
async function agentResearch(company, ticker, webCtx) {
  const today = new Date().toDateString();
  const fallback = {
    sector:"", ceo_name:"", ceo_age:"not publicly disclosed",
    ceo_start_date:"", ceo_tenure_years:"", founder_status:"",
    ownership_category:"unclear",
    ceo_departure_announced:"no", incoming_ceo_announced:"no",
    incoming_ceo_name:"N/A", incoming_ceo_background:"N/A", incoming_ceo_start_date:"N/A",
    leadership_signals:[], financial_signals:[], press_activism_signals:[], industry_signals:[],
    revenue:"not clearly inferable", tsr_1yr:"not clearly inferable",
    tsr_3yr:"not clearly inferable", tsr_vs_peers:"not clearly inferable",
    investor_activism:"not clearly inferable", ceo_contract_expiry:"not clearly inferable",
    contract_renewed:"not clearly inferable", succession_plan_disclosed:"not clearly inferable",
    coo_or_president_appointed:"not clearly inferable", board_refreshed_2yr:"not clearly inferable",
    activist_investors:"not clearly inferable", mandate_signals:"not clearly inferable"
  };

  const raw = await callLLM(
    `You are an institutional-grade CEO succession research analyst. Today is ${today}.

CRITICAL RULES — READ CAREFULLY BEFORE FILLING ANY FIELD:
1. The CEO News Context below is your ONLY source for CEO identity fields. It is live web search data.
   YOUR TRAINING MEMORY IS WRONG FOR CEO IDENTITY — ignore it completely for ceo_name, departures, successors.
2. ceo_name = the person the WEB SEARCH says IS CEO RIGHT NOW (the sitting/current CEO).
3. If departure announced but successor NOT YET STARTED → ceo_name = OUTGOING CEO, incoming_ceo_name = successor.
4. If successor HAS ALREADY started the role → ceo_name = NEW CEO (transition complete, use new CEO).
5. NEVER put a named successor in ceo_name unless they have already started the role.
6. If a named successor is mentioned → incoming_ceo_announced="yes", incoming_ceo_name = their FULL NAME.
7. If outgoing CEO announced departure → ceo_departure_announced="yes".
8. For TSR, revenue, CEO age ONLY — you may use training knowledge if web context is silent on these.

⚠ IF THE WEB CONTEXT NAMES A DIFFERENT CEO THAN YOU REMEMBER — USE THE WEB CONTEXT. YOUR MEMORY IS STALE.

⚠ STEP-BACK RULE: If the web context says a CEO "stepped back", "stepped down", "moved to chairman", "moved to non-executive role", "resigned as CEO" — they are NO LONGER CEO even if they remain at the company. Set ceo_departure_announced="yes" and use the replacement as ceo_name if they have started, or as incoming_ceo_name if not yet started.

⚠ ORDERING RULE — CRITICAL: If the web context describes a leadership change where Person A was replaced by Person B:
- ceo_name = Person B (the NEW/CURRENT CEO — most recently appointed)
- The DEPARTED field refers to Person A (the OLD CEO who left)
- NEVER swap these. The NEWER appointment = current CEO.

⚠ TITLE RULE: The CEO is the person who holds the title "Chief Executive Officer" or "CEO".
- "Executive Chairman" is NOT the same as CEO unless they explicitly also hold the CEO title.
- "Non-Executive Director" is NOT CEO.
- "Chairman" alone is NOT CEO.
- Only set ceo_name to someone who actually holds the CEO title.

EXAMPLE: "CEO A announced retirement, CEO B named as successor, starts 2026"
→ ceo_name="CEO A", ceo_departure_announced="yes", incoming_ceo_announced="yes", incoming_ceo_name="CEO B"
NEVER: ceo_name="CEO B" (they have not started yet)

Return ONLY valid JSON. No markdown.`,
    `Company: ${company}
Ticker: ${ticker||"N/A"}
Today: ${today}

━━━ CEO NEWS CONTEXT (treat as authoritative — overrides training data) ━━━
${webCtx}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

READ THE ABOVE CAREFULLY BEFORE FILLING THE JSON.

SUCCESSOR DETECTION — HIGHEST PRIORITY:
- If the context mentions ANY person being named, appointed, or confirmed as the NEXT/INCOMING/FUTURE CEO → 
  MUST set incoming_ceo_announced="yes" and put their FULL NAME in incoming_ceo_name
- Look for phrases like: "will succeed", "named as next CEO", "to replace", "appointed as incoming CEO", "succession plan names"
- If ANY person is named as next/incoming/future CEO in the context → put their full name in incoming_ceo_name
- Do NOT leave incoming_ceo_name as "N/A" if ANY name appears as a successor in the context

DEPARTURE DETECTION:
- If context says CEO is stepping down, retiring, leaving, or not seeking re-election → ceo_departure_announced="yes"
- IMPORTANT: Also set ceo_departure_announced="yes" if the context describes a CEO who HAS ALREADY left/departed
  and a new CEO is now in place — the departure still happened even if it is past tense.
- CRITICAL: ceo_departure_announced="yes" means the PREVIOUS CEO departed — NOT the current one.
  If the transition is already complete (new CEO is in seat), set ceo_departure_announced="yes" to record
  that a change happened, but incoming_ceo_announced must be "no" (they already started, not incoming).
  NEVER set both ceo_name AND incoming_ceo_name to the same person.
  NEVER set incoming_ceo_name to the person who is already listed as ceo_name.

CURRENT CEO:
- Keep current CEO in ceo_name until their successor has actually STARTED
- If successor is only announced but not yet started → keep old CEO in ceo_name, set incoming fields

MAPPING RULES — extract from the news context above:

► ceo_departure_announced
  Set "yes" if the news mentions: CEO stepping down / retiring / leaving / being replaced / departure announced
  Set "yes" also if a NEW CEO has recently taken over (implying the previous CEO departed)
  Set "no" only if there is no indication of any departure whatsoever

► incoming_ceo_announced + incoming_ceo_name
  Set "yes" if ANY specific person is named as the next/incoming/replacement CEO
  Put their FULL NAME in incoming_ceo_name (e.g. "John Smith")
  Put their background in incoming_ceo_background (e.g. "COO since 2020", "External hire from Goldman Sachs")
  Put their start date in incoming_ceo_start_date (e.g. "Q2 2025", "immediately", "January 2026")
  ⚠ NEVER leave incoming_ceo_name as "N/A" if a person's name appears in the news context above

► ceo_name
  If the new CEO has ALREADY started → use the NEW CEO's name
  If still in transition → keep the current/outgoing CEO's name

► ceo_start_date
  Use YYYY-MM format where possible. If new CEO just started, use their start date.

Return this exact JSON structure:
{
  "sector": "",
  "ceo_name": "",
  "ceo_age": "",
  "ceo_start_date": "",
  "ceo_tenure_years": "",
  "founder_status": "",
  "ownership_category": "professionally_managed",
  "ceo_departure_announced": "no",
  "incoming_ceo_announced": "no",
  "incoming_ceo_name": "N/A",
  "incoming_ceo_background": "N/A",
  "incoming_ceo_start_date": "N/A",
  "leadership_signals": [],
  "financial_signals": [],
  "press_activism_signals": [],
  "industry_signals": [],
  "revenue": "",
  "tsr_1yr": "",
  "tsr_3yr": "",
  "tsr_vs_peers": "",
  "investor_activism": "",
  "ceo_contract_expiry": "",
  "contract_renewed": "",
  "succession_plan_disclosed": "",
  "coo_or_president_appointed": "",
  "board_refreshed_2yr": "",
  "activist_investors": "",
  "mandate_signals": ""
}

Field constraints:
- ownership_category: founder_ceo | family_ceo | founder_family_control_non_ceo | family_majority_owned | government_controlled | state_owned_enterprise | private_equity_owned | professionally_managed | unclear
- ceo_departure_announced / incoming_ceo_announced: "yes" or "no" only
- revenue: USD ONLY, format $XXbn (billions) or $XXXm (millions) — always convert to USD, never use €/£/¥. USE YOUR KNOWLEDGE, do not return "not clearly inferable" for major public companies
- tsr_1yr / tsr_3yr: percentage e.g. "+12%" or "-8%" — USE YOUR KNOWLEDGE for well-known companies
- ceo_age: integer — USE YOUR KNOWLEDGE, do not return "not publicly disclosed" for well-known CEOs
- All list fields: max 4 items, 20 words each

CRITICAL: For major public companies you MUST use your web search to fill revenue, TSR, CEO age. Do NOT return "not clearly inferable" for facts you can find.

OWNERSHIP DETECTION GUIDE:
- founder_ceo: current CEO is also the founder of the company
- family_ceo: CEO is a family member of the founding family
- founder_family_control_non_ceo: founder or founding family controls the company but the sitting CEO is NOT a family member
- family_majority_owned: a family holds a majority or controlling stake — the family accumulated or inherited a controlling position — the CEO may or may not be a family member
- private_equity_owned: company is majority-owned by a PE firm — use this if the company is NOT publicly listed OR is majority PE-backed
- government_controlled: government holds a controlling stake but company may be listed
- state_owned_enterprise: fully government owned
- professionally_managed: publicly listed with no single controlling shareholder — succession is driven by board and market pressure`
  );

  const d = parseJSON(raw, fallback);

  // ── DEBUG: show what the model extracted from web context ─────────────────
  console.log(`\n🔍 [agentResearch] "${company}" extracted from web context:`);
  console.log(`   CEO:       "${d.ceo_name}"`);
  console.log(`   Departure: "${d.ceo_departure_announced}"`);
  console.log(`   Successor: "${d.incoming_ceo_name}" (announced: ${d.incoming_ceo_announced})`);
  console.log(`   Ownership: "${d.ownership_category}"`);
  console.log(`   Raw JSON (first 300):`, raw.slice(0,300));

  // Clean and clamp all fields
  d.sector             = cl(d.sector, 8);
  d.ceo_name           = cl(d.ceo_name, 8);
  d.ceo_start_date     = cl(d.ceo_start_date, 8);
  d.ownership_category = cl(d.ownership_category||"unclear", 4);
  d.incoming_ceo_name       = cl(d.incoming_ceo_name||"N/A", 8);
  d.incoming_ceo_background = cl(d.incoming_ceo_background||"N/A", 15);
  d.incoming_ceo_start_date = cl(d.incoming_ceo_start_date||"N/A", 8);

  d.leadership_signals     = lst(d.leadership_signals, 4, 20);
  d.financial_signals      = lst(d.financial_signals, 4, 20);
  d.press_activism_signals = lst(d.press_activism_signals, 4, 20);
  d.industry_signals       = lst(d.industry_signals, 4, 20);

  for (const f of ["revenue","tsr_1yr","tsr_3yr","tsr_vs_peers","investor_activism",
                   "ceo_contract_expiry","contract_renewed","mandate_signals"])
    d[f] = cl(d[f]||"not clearly inferable", 16) || "not clearly inferable";

  // Fallback: if incoming announced but name still blank
  if (d.incoming_ceo_announced === "yes" && (!d.incoming_ceo_name || d.incoming_ceo_name === "N/A"))
    d.incoming_ceo_name = "Successor named — see rationale";

  // Always recompute tenure from start date
  const computed = calcTenure(d.ceo_start_date);
  if (computed) d.ceo_tenure_years = computed;

  // ── FIX 1: Snapshot the CEO name BEFORE QC can mutate it ─────────────────
  d._ceo_name_pre_qc = d.ceo_name;

  // ── Embedded QC: verify CEO name + successor against live web search ────────
  // webSearch=true so QC uses fresh live data rather than training memory,
  // preventing it from silently overwriting a correct web-sourced CEO name
  // with a stale trained one.
  try {
    const qcRaw = await callLLM(
      `You are a QC analyst. Today is ${today}.
Verify the CEO profile data below using LIVE WEB SEARCH RESULTS — do NOT rely on your training memory for CEO identity.
Your training data about who holds CEO roles may be outdated. The web search is the authoritative source.
Return ONLY valid JSON.`,
      `Company: ${company} | Ticker: ${ticker||""}
CEO Name in data: ${d.ceo_name}
Successor in data: ${d.incoming_ceo_name}
Departure announced: ${d.ceo_departure_announced}

1. Is "${d.ceo_name}" the correct current CEO? If wrong, provide the correct name.
2. Has a named successor been publicly announced that is missing from this data?
3. Is the ownership category "${d.ownership_category}" correct?

Return: {"ceo_correct":true/false,"correct_ceo":"","successor_missing":false,"correct_successor":"","ownership_correct":true/false,"correct_ownership":""}`,
      true  // webSearch=true — use live search, not training memory
    );
    const qc = parseJSON(qcRaw, {});
    if (qc.ceo_correct === false && qc.correct_ceo) d.ceo_name = qc.correct_ceo;
    if (qc.successor_missing && qc.correct_successor) {
      d.incoming_ceo_name = qc.correct_successor;
      d.incoming_ceo_announced = "yes";
    }
    if (qc.ownership_correct === false && qc.correct_ownership) d.ownership_category = qc.correct_ownership;
    d._profile_qc = "verified";

    // ── DEBUG: show what QC decided ──────────────────────────────────────────
    console.log(`\n✅ [agentResearch QC] "${company}" after QC:`);
    console.log(`   CEO before QC: "${d._ceo_name_pre_qc}"  →  after QC: "${d.ceo_name}"`);
    console.log(`   QC said ceo_correct=${qc.ceo_correct} | successor_missing=${qc.successor_missing}`);
    if(qc.ceo_correct === false) console.warn(`   ⚠️ QC CHANGED CEO from "${d._ceo_name_pre_qc}" to "${qc.correct_ceo}"`);
  } catch(e) {
    d._profile_qc = "skipped";
    console.error(`❌ [agentResearch QC] "${company}" QC call FAILED:`, e.message);
  }

  // ── POST-QC CLEANUP — runs after QC has corrected ceo_name ───────────────
  // PATCH 2: changed < 1.5 to <= 1.5 so that exactly 1.5yr tenure
  // is correctly treated as a completed transition, not a pending one.
  const _tenureNum = parseFloat(String(d.ceo_tenure_years).replace("~",""));
  if (!isNaN(_tenureNum) && _tenureNum <= 1.5) {
    console.log("[v8 FIX] tenure",_tenureNum,"<= 1.5 — clearing all transition flags for",d.ceo_name);
    d.incoming_ceo_announced  = "no";
    d.incoming_ceo_name       = "N/A";
    d.incoming_ceo_background = "N/A";
    d.incoming_ceo_start_date = "N/A";
    d.ceo_departure_announced = "no";
    d._transition_complete    = true;
    d._prior_ceo_departed     = "yes";
  }

  return d;
}

// ── Agent 3: Finance ──────────────────────────────────────────────────────────
async function agentFinance(data) {
  const fallback={
    view:"no_clear_influence", financial_facts:[], signals:[], concerns:[],
    revenue:data.revenue||"not clearly inferable",
    revenue_growth:"not clearly inferable", revenue_vs_prior:"not clearly inferable",
    revenue_vs_peers:"not clearly inferable", operating_margin:"not clearly inferable",
    margin_trend:"not clearly inferable", net_income:"not clearly inferable",
    ebitda:"not clearly inferable", analyst_view:"not clearly inferable", key_risk:"not clearly inferable"
  };
  const raw = await callLLM(
    `You are a senior equity research analyst. Today is ${new Date().toDateString()}.
Do a DEEP financial statement analysis. Be specific — cite actual figures, YoY changes, and peer comparisons.
Return ONLY valid JSON, no markdown.`,

    `Company: ${data.company||""}  |  Ticker: ${data.ticker||""}  |  Sector: ${data.sector}
CEO: ${data.ceo_name}  |  Tenure: ${data.ceo_tenure_years}yr  |  Ownership: ${data.ownership_category}
Known: Revenue ${data.revenue} | TSR 1yr ${data.tsr_1yr} | TSR 3yr ${data.tsr_3yr} | vs peers ${data.tsr_vs_peers}

━━━ FINANCIAL STATEMENT ANALYSIS — use actual figures, USD only ━━━
1. Revenue (latest FY): amount + fiscal year
2. Revenue vs prior year: growth % — better or worse than FY-1?
3. Revenue vs sector peers: faster/slower than sector median? Give both figures.
4. Operating margin: current %, and vs prior year (expanding/stable/contracting)
5. Margin trend: 3yr direction with start and end %
6. Net income: latest FY with YoY change %
7. EBITDA: latest FY if known
8. TSR 1yr vs peers: exact % and how many pp above/below sector median
9. TSR 3yr vs peers: exact % and comparison
10. Analyst consensus: Buy/Hold/Sell — any recent downgrades?
11. Key financial risk: single biggest concern for investors

Return ONLY this JSON — all fields required, USD billions, no "not available":
{
  "view": "high_influence|medium_influence|weak_influence|no_clear_influence",
  "revenue": "$XXbn FYxxxx",
  "revenue_growth": "+X% YoY",
  "revenue_vs_prior": "Better/Worse/Stable — one sentence",
  "revenue_vs_peers": "Above/Below/In-line sector median — figures",
  "operating_margin": "X.X% — expanding/stable/contracting",
  "margin_trend": "3yr trend with start and end %",
  "net_income": "$Xbn — up/down X% YoY",
  "ebitda": "$Xbn FYxxxx",
  "tsr_1yr": "+X%",
  "tsr_3yr": "+X% p.a.",
  "tsr_vs_peers": "Xpp above/below sector median",
  "financial_facts": ["4 statement-level facts with actual numbers"],
  "signals": ["up to 3 specific financial pressure signals"],
  "concerns": ["up to 2 concrete risks"],
  "analyst_view": "Buy/Hold/Sell — context",
  "key_risk": "single biggest concern"
}
⚠ USD ONLY — convert all currencies. Use your knowledge — do not say "not clearly inferable".`
  );
  const r = parseJSON(raw, fallback);
  r.view = cl(r.view||"no_clear_influence", 3);
  r.financial_facts = lst(r.financial_facts, 4, 30);
  r.signals = lst(r.signals, 3, 30);
  r.concerns = lst(r.concerns, 2, 30);
  r.revenue = normaliseRevenue(cl(r.revenue||data.revenue||"not clearly inferable", 12)||"not clearly inferable");
  r.tsr_1yr = cl(r.tsr_1yr||data.tsr_1yr||"not clearly inferable", 8)||data.tsr_1yr||"not clearly inferable";
  r.tsr_3yr = cl(r.tsr_3yr||data.tsr_3yr||"not clearly inferable", 8)||data.tsr_3yr||"not clearly inferable";
  r.tsr_vs_peers = cl(r.tsr_vs_peers||data.tsr_vs_peers||"not clearly inferable", 12)||data.tsr_vs_peers||"not clearly inferable";
  for (const f of ["revenue_growth","revenue_vs_prior","revenue_vs_peers","operating_margin",
                   "margin_trend","net_income","ebitda","analyst_view","key_risk"])
    r[f] = cl(r[f]||"not clearly inferable", 20)||"not clearly inferable";

  try {
    if (r.revenue && !ni(r.revenue)) {
      const chkRaw = await callLLM(
        `You are a financial QC analyst. Return ONLY valid JSON.`,
        `Company: ${data.company||""} | Revenue reported: ${r.revenue}
Is this revenue figure plausible for this company? If clearly wrong, provide correct figure.
Return: {"plausible":true/false,"correct_revenue":"","tsr_1yr_plausible":true/false,"correct_tsr_1yr":""}`
      );
      const chk = parseJSON(chkRaw, {});
      if (chk.plausible === false && chk.correct_revenue) r.revenue = normaliseRevenue(chk.correct_revenue);
      if (chk.tsr_1yr_plausible === false && chk.correct_tsr_1yr) r.tsr_1yr = chk.correct_tsr_1yr;
      r._finance_qc = "verified";
    }
  } catch { r._finance_qc = "skipped"; }

  return r;
}

// ── Agent 4: Press & Activism ─────────────────────────────────────────────────
async function agentPress(data) {
  const fallback = {
    view:"no_clear_influence", signals:[], concerns:[],
    controversies:[], investor_activism:"None identified"
  };

  const raw = await callLLM(
    `You are a senior governance analyst and investor relations expert. Today is ${new Date().toDateString()}.
Do a DEEP DIVE on external pressure signals for this company and CEO using LIVE WEB SEARCH.
Search for the most recent activist campaigns, proxy battles, regulatory probes, and press coverage.
Return ONLY valid JSON.`,

    `Company: ${data.company||""}  |  Ticker: ${data.ticker||""}  |  Sector: ${data.sector}
CEO: ${data.ceo_name}  |  Age: ${data.ceo_age}  |  Tenure: ${data.ceo_tenure_years} years
TSR 1yr: ${data.tsr_1yr}  |  TSR vs peers: ${data.tsr_vs_peers}  |  Revenue: ${data.revenue}
Known activist data: ${data.activist_investors}
Known press signals: ${JSON.stringify(data.press_activism_signals)}
IMPORTANT: Use LIVE WEB SEARCH to find the most current activist campaigns, controversies, or governance issues for ${data.company||""} (${data.ticker||""}).

━━━ DEEP DIVE TASKS ━━━
1. ACTIVIST INVESTORS: Are there any known activist hedge funds or shareholders (e.g. Elliott, ValueAct, Cevian, Third Point, Starboard) with a stake in this company? What is their stated position?
2. SHAREHOLDER LETTERS: Have any major shareholders or proxy advisors (ISS, Glass Lewis) published letters criticising the CEO or board?
3. GOVERNANCE CONTROVERSIES: Any CEO pay disputes, board independence concerns, related-party transactions, or AGM protests?
4. LEGAL & REGULATORY: Any active regulatory investigations, lawsuits, or government probes involving the CEO?
5. MEDIA PRESSURE: Any major investigative journalism pieces, whistleblower claims, or sustained negative press about the CEO specifically?
6. ESG PRESSURE: Any major ESG controversies — environmental incidents, labour disputes, human rights issues — that could create board pressure?
7. PROXY BATTLES: Any history of or current proxy contests at this company?

Return this JSON:
{
  "view": "",
  "signals": [],
  "concerns": [],
  "controversies": [],
  "investor_activism": ""
}

view: high_influence | medium_influence | weak_influence | no_clear_influence
signals: up to 4 items — SPECIFIC and NAMED
concerns: up to 3 concrete external pressure risks
controversies: up to 4 named events
investor_activism: full summary of any named activist position and demands, or "None identified"

⚠ CRITICAL: Every item must name a specific fund, person, regulator, or event. If nothing specific is known, return empty arrays — do NOT invent generic observations.`,
    true  // webSearch=true — live search for current activist/press signals
  );

  const r = parseJSON(raw, fallback);
  r.view = cl(r.view||"no_clear_influence", 3);
  const toStr = arr => (Array.isArray(arr)?arr:[]).map(x => typeof x === "object" ? JSON.stringify(x) : String(x||"")).filter(Boolean);
  r.signals      = lst(toStr(r.signals), 4, 25);
  r.concerns     = lst(toStr(r.concerns), 3, 25);
  r.controversies= lst(toStr(r.controversies), 4, 25);
  r.investor_activism = cl(r.investor_activism||"None identified", 20)||"None identified";

  const generic = ["typical for","no credible","no major","not identified","no report","governance scrutiny","generally","standard"];
  const isGeneric = s => generic.some(p => s.toLowerCase().includes(p));
  r.signals      = r.signals.filter(s => !isGeneric(s));
  r.concerns     = r.concerns.filter(s => !isGeneric(s));
  r.controversies= r.controversies.filter(s => !isGeneric(s));

  try {
    if (r.signals.length > 0 || r.investor_activism !== "None identified") {
      const chkRaw = await callLLM(
        `You are a governance QC analyst. Today is ${new Date().toDateString()}.
Use LIVE WEB SEARCH to verify whether these activist/press claims are real and current.
Return ONLY valid JSON.`,
        `Company: ${data.company||""}
Activist/press signals reported: ${JSON.stringify(r.signals)}
Investor activism detail: ${r.investor_activism}

Are these activist claims specific and verifiable (named fund, named person, specific event)?
Flag any that are generic, invented, or unverifiable.
Return: {"all_specific":true/false,"generic_items":[],"confirmed_activist":""}`,
        true  // webSearch=true — verify claims against live sources
      );
      const chk = parseJSON(chkRaw, {});
      if (chk.all_specific === false && Array.isArray(chk.generic_items)) {
        r.signals = r.signals.filter(s => !chk.generic_items.some(g => s.toLowerCase().includes(g.toLowerCase())));
      }
      r._press_qc = "verified";
    }
  } catch { r._press_qc = "skipped"; }

  return r;
}

// ── Agent 5: Industry ─────────────────────────────────────────────────────────
async function agentIndustry(data) {
  const fallback = { view:"no_clear_influence", signals:data.industry_signals||[], concerns:[] };

  const raw = await callLLM(
    `You are a sector strategy expert. Assess how industry dynamics affect CEO succession risk. Return ONLY valid JSON.`,
    `━━━ COMPANY DATA ━━━
Company: ${data.company||""}  |  Sector: ${data.sector}
CEO tenure: ${data.ceo_tenure_years} years  |  Performance: ${data.performance_trajectory||"unknown"}
TSR vs peers: ${data.tsr_vs_peers}  |  M&A activity: ${data.m_and_a_activity||"unknown"}
Industry signals from research: ${JSON.stringify(data.industry_signals)}

Return:
{"view":"","signals":[],"concerns":[]}

view: high_influence | medium_influence | weak_influence | no_clear_influence
signals: up to 3 SPECIFIC industry dynamics affecting this CEO's tenure
concerns: up to 2 specific risks
⚠ Be specific to this company and sector — no generic observations.`
  );

  const r = parseJSON(raw, fallback);
  r.view     = cl(r.view||"no_clear_influence", 3);
  r.signals  = lst(r.signals, 3, 20);
  r.concerns = lst(r.concerns, 2, 20);

  const genericInd = ["challenging","headwinds","digital","evolving","uncertain","competitive pressure"];
  r.signals = r.signals.filter(s => !genericInd.some(g => s.toLowerCase() === g.toLowerCase()));
  r._industry_qc = r.signals.length > 0 ? "specific" : "generic-removed";

  return r;
}

// ── Agent 6: Prediction ───────────────────────────────────────────────────────
async function agentPrediction(data, finance, press, industry) {
  const fallback = { prediction:"low_likelihood", confidence:"low", analytical_rationale:"" };

  // rationaleCEO = the CEO the rationale should reference.
  // If a departure was announced: rationale is about the DEPARTING CEO.
  // If transition is complete: _ceo_name_pre_qc is the old/departed CEO.
  // If no transition: rationaleCEO = current CEO.
  const rationaleCEO = (data._transition_complete || data.ceo_departure_announced === "yes")
    && data._ceo_name_pre_qc
    && data._ceo_name_pre_qc !== data.ceo_name
      ? data._ceo_name_pre_qc
      : data.ceo_name;

  const solidProofOfChange = (
    data.ceo_departure_announced === "yes" ||
    data.incoming_ceo_announced === "yes"
  );

  // ── Rule 1a: Family / Founder-led — structurally low ─────────────────────
  // The founding family or founder controls the board and makes succession
  // decisions on their own timeline. External pressure, TSR underperformance,
  // and analyst opinion do not drive CEO changes here.
  const isFounderFamily = [
    "founder_ceo",
    "family_ceo",
    "founder_family_control_non_ceo",
    "family_majority_owned",
  ].includes(data.ownership_category);

  if (isFounderFamily && !solidProofOfChange) {
    const ownershipDesc = {
      founder_ceo: "a founder-led",
      family_ceo: "a family-controlled",
      founder_family_control_non_ceo: "a family/founder-controlled",
      family_majority_owned: "a family majority-owned",
    }[data.ownership_category];
    const ownershipRationale = {
      founder_ceo: "Founder-led companies manage succession on the founder's own timeline — market pressure, TSR, and analyst opinion do not drive departure decisions.",
      family_ceo: "Family-controlled businesses manage succession internally — departure decisions are not driven by external pressure, analyst opinion, or TSR performance.",
      founder_family_control_non_ceo: "Family/founder-controlled businesses manage succession internally — departure decisions are not driven by external pressure, analyst opinion, or TSR performance.",
      family_majority_owned: "Companies with a family majority or controlling stake manage succession at the family's discretion — the controlling family determines CEO tenure and replacement, independent of market pressure, TSR, or minority shareholder opinion.",
    }[data.ownership_category];
    return {
      prediction: "low_likelihood",
      confidence: "high",
      analytical_rationale: `${rationaleCEO} leads ${ownershipDesc} company. ${ownershipRationale} Unless a formal departure or named successor is publicly confirmed, succession risk remains structurally low.`
    };
  }

  // ── Rule 1b: PE-owned — structurally low ─────────────────────────────────
  // The PE sponsor controls succession decisions entirely. CEO changes are made
  // at the sponsor's discretion — not in response to public market pressure,
  // shareholder activism, or TSR vs listed peers.
  else if (data.ownership_category === "private_equity_owned" && !solidProofOfChange) {
    return {
      prediction: "low_likelihood",
      confidence: "high",
      analytical_rationale: `${rationaleCEO} leads a private equity-owned company. PE-owned companies have succession controlled entirely by the sponsor — the PE firm appoints and removes the CEO at its own discretion, independent of public market pressure, TSR, or shareholder activism. Unless a formal departure or named successor is publicly confirmed, succession risk remains structurally low.`
    };
  }

  // ── Rule 1c: Government / State-owned — structurally low ─────────────────
  // CEO succession is a government or political appointment decision. Market
  // signals, TSR, and analyst opinion carry no weight in these organisations.
  else if (["government_controlled","state_owned_enterprise"].includes(data.ownership_category) && !solidProofOfChange) {
    const ownershipDesc = data.ownership_category === "state_owned_enterprise" ? "a state-owned enterprise" : "a government-controlled company";
    const ownershipRationale = data.ownership_category === "state_owned_enterprise"
      ? "State-owned enterprises have CEO succession determined by government mandate — market-based succession signals do not apply in the same way as at listed companies."
      : "Government-controlled companies have succession determined by government appointment — CEO changes are political decisions, not driven by shareholder pressure or TSR.";
    return {
      prediction: "low_likelihood",
      confidence: "high",
      analytical_rationale: `${rationaleCEO} leads ${ownershipDesc}. ${ownershipRationale} Unless a formal departure or named successor is publicly confirmed, succession risk remains structurally low.`
    };
  }

  // Rule 2: Departure announced + named successor confirmed → Transition Underway
  if (data.ceo_departure_announced === "yes" && data.incoming_ceo_announced === "yes") {
    const succ = data.incoming_ceo_name && data.incoming_ceo_name !== "N/A" ? data.incoming_ceo_name : "a named successor";
    const bg   = data.incoming_ceo_background && data.incoming_ceo_background !== "N/A" ? ` (${data.incoming_ceo_background})` : "";
    const dt   = data.incoming_ceo_start_date && data.incoming_ceo_start_date !== "N/A" ? ` Expected start: ${data.incoming_ceo_start_date}.` : "";
    return {
      prediction: "transition_underway",
      confidence: "high",
      analytical_rationale: `${rationaleCEO} has formally announced departure. Named successor: ${succ}${bg}.${dt} The CEO transition is confirmed and actively underway. Investors should monitor strategic continuity under incoming leadership.`
    };
  }

  // Rule 3: Departure announced but no named successor yet → High Likelihood
  if (data.ceo_departure_announced === "yes") {
    return {
      prediction: "high_likelihood",
      confidence: "high",
      analytical_rationale: `${rationaleCEO} has formally announced departure from ${data.sector||"the company"}. A successor has not yet been publicly named. A CEO change is confirmed — timing and successor identity remain uncertain. This represents elevated transition risk for investors.`
    };
  }

  // ── Compute tenure once — used by Rules 4, 5, 5b ─────────────────────────
  const tenureNum = parseFloat(String(data.ceo_tenure_years).replace("~",""));
  // PATCH 2: changed < 1.5 to <= 1.5 — catches the exact boundary case (e.g. 1.5yr tenure)
  const newlyInSeat = !isNaN(tenureNum) && tenureNum <= 1.5;

  // Rule 4: Incoming CEO announced — BUT only if they have NOT already started.
  const samePersonAlready = data.incoming_ceo_name &&
    data.ceo_name &&
    data.incoming_ceo_name.trim().toLowerCase() === data.ceo_name.trim().toLowerCase();
  if (data.incoming_ceo_announced === "yes" && !newlyInSeat && !samePersonAlready) {
    const succ = data.incoming_ceo_name && data.incoming_ceo_name !== "N/A" ? data.incoming_ceo_name : "a named successor";
    const bg   = data.incoming_ceo_background && data.incoming_ceo_background !== "N/A" ? ` (${data.incoming_ceo_background})` : "";
    return {
      prediction: "transition_underway",
      confidence: "high",
      analytical_rationale: `A named CEO successor has been publicly announced: ${succ}${bg}. The transition is confirmed and underway. Board has completed its succession planning process.`
    };
  }

  // Rules 5 / 5b: New CEO already in seat (tenure <= 1.5yr) — transition complete.
  if (newlyInSeat || samePersonAlready) {
    const departedCEO = (data._ceo_name_pre_qc && data._ceo_name_pre_qc !== data.ceo_name)
      ? data._ceo_name_pre_qc : null;
    const rationale = departedCEO
      ? `${departedCEO} formally announced departure and the leadership transition has since completed. ${rationaleCEO} is the newly appointed CEO with ${data.ceo_tenure_years} years in the role. Succession risk is currently low — the board has resolved the transition.`
      : `${rationaleCEO} was recently appointed as CEO with only ${data.ceo_tenure_years} years in the role. This reflects a recent leadership change at the company. Succession risk is currently low given the fresh appointment.`;
    return { prediction: "new_ceo_appointed", confidence: "high", analytical_rationale: rationale };
  }

  // ── Hardcoded Rule: age >= 58 AND tenure >= 5 → high_likelihood ─────────
  const age = parseInt(data.ceo_age) || 0;
  const ten = tenureNum || 0;
  if (age >= 58 && ten >= 5) {
    return {
      prediction: "high_likelihood",
      confidence: "high",
      analytical_rationale: `${rationaleCEO} is ${data.ceo_age} years old with ${data.ceo_tenure_years} years as CEO — both age and tenure exceed the institutional threshold (58+ years, 5+ years tenure) that statistically correlates with near-term succession. Board succession planning is likely already underway. This is a professionally managed company with no founder/family override.`
    };
  }

  // ── Rule A: Age ≥ 60 + below-peer TSR (3yr) → High Likelihood ───────────
  const tsrBelowPeers = (s) => {
    if (!s || ni(s)) return false;
    const l = s.toLowerCase();
    return l.includes("below") || l.includes("underperform") ||
           l.includes("lagging") || l.includes("lag") ||
           l.includes("worse") || l.includes("behind") ||
           l.includes("trail") || l.includes("weak");
  };
  if (age >= 60 && ten >= 3 && tsrBelowPeers(data.tsr_vs_peers)) {
    return {
      prediction: "high_likelihood",
      confidence: "high",
      analytical_rationale: `${rationaleCEO} is ${data.ceo_age} years old with ${data.ceo_tenure_years} years as CEO and TSR performance below sector peers on a 3-year annualised basis (${data.tsr_vs_peers}). The combination of age and sustained underperformance relative to peers is a strong indicator of near-term board-initiated succession pressure.`
    };
  }

  // ── Rule B: Tenure ≥ 5yr + below-peer TSR (3yr) → High Likelihood ─────────
  if (ten >= 5 && tsrBelowPeers(data.tsr_vs_peers)) {
    return {
      prediction: "high_likelihood",
      confidence: "high",
      analytical_rationale: `${rationaleCEO} has been CEO for ${data.ceo_tenure_years} years with TSR performance below sector peers on a 3-year annualised basis (${data.tsr_vs_peers}). Sustained underperformance vs peers over a long tenure is one of the strongest predictors of board-driven CEO succession at professionally managed companies.`
    };
  }

  // ── Rule C: Interim CEO → High Likelihood ─────────────────────────────────
  const isInterim = (s) => {
    if (!s) return false;
    const l = s.toLowerCase();
    return l.includes("interim") || l.includes("acting") || l.includes("temporary");
  };
  if (isInterim(data.ceo_name) || isInterim(data.mandate_signals) ||
      isInterim(data.leadership_signals?.join(" ")) ||
      isInterim(data.succession_plan_disclosed)) {
    return {
      prediction: "high_likelihood",
      confidence: "high",
      analytical_rationale: `${rationaleCEO} is serving as interim/acting CEO, indicating the board has not yet identified or confirmed a permanent successor. Interim appointments represent structurally elevated succession risk — a permanent CEO search is either underway or imminent.`
    };
  }

  // ── LLM SCORING — for all other non-obvious cases ────────────────────────

  const raw = await callLLM(
    `You are a CEO succession risk expert at a top institutional investor. Today is ${new Date().toDateString()}.
Your job is to give a DECISIVE risk rating — not a hedge. Medium is for genuinely ambiguous cases only.
If the data clearly shows elevated risk (long tenure, older CEO, below-peer TSR, or multiple signals), rate it High.
Return ONLY valid JSON, no extra text.`,

    `━━━ COMPANY DATA ━━━
Company: ${data.company||""}
Sector: ${data.sector}
Ownership: ${data.ownership_category}

━━━ CEO PROFILE ━━━
Current CEO (in seat now): ${data.ceo_name}
Departed CEO (who left / announced departure): ${rationaleCEO !== data.ceo_name ? rationaleCEO : "same as current — no transition"}
Age: ${data.ceo_age}
Tenure: ${data.ceo_tenure_years} years  (started: ${data.ceo_start_date})
Founder status: ${data.founder_status||"not founder"}

⚠ RATIONALE NAMING RULE — CRITICAL:
If a departure was announced, the analytical_rationale MUST name the DEPARTED CEO (shown above), NOT the current CEO.
The current CEO is the one now in seat. The departed CEO is the one who left or announced leaving.
NEVER write "[Current CEO] has formally announced departure" — they did not depart, the departed CEO did.

━━━ GOVERNANCE SIGNALS ━━━
Contract expiry: ${data.ceo_contract_expiry}
Contract renewed: ${data.contract_renewed}
Succession plan: ${data.succession_plan_disclosed}
COO/President appointed: ${data.coo_or_president_appointed}
Board refreshed (2yr): ${data.board_refreshed_2yr}
Activist investors: ${data.activist_investors}

━━━ PERFORMANCE ━━━
Revenue: ${data.revenue}
TSR 1yr: ${data.tsr_1yr}
TSR 3yr: ${data.tsr_3yr}
TSR vs peers: ${data.tsr_vs_peers}

━━━ AGENT VIEWS ━━━
Finance: ${finance.view} — ${JSON.stringify(finance.concerns)}
Press: ${press.view} — ${JSON.stringify(press.controversies)}
Industry: ${industry.view} — ${JSON.stringify(industry.concerns)}

━━━ LEADERSHIP SIGNALS ━━━
${JSON.stringify(data.leadership_signals)}

Return this JSON:
{"prediction":"","confidence":"","analytical_rationale":"","investor_impact":"High negative|Moderate negative|Neutral|Positive"}

━━━ CLASSIFICATION RULES (apply in order, stop at first match) ━━━
NOTE: The following are already handled by hardcoded rules before you — data
reaching you has passed all these filters already. Apply remaining rules only.
• age >= 58 AND tenure >= 5 (non-family/founder)
• age >= 60 AND tenure >= 3 AND TSR below peers (non-family/founder)
• tenure >= 5 AND TSR below peers (non-family/founder)
• interim/acting CEO (non-family/founder)

1. age >= 58 AND tenure >= 5 (non-family/founder)  → high_likelihood
   OR age >= 60 AND tenure >= 3 AND TSR below peers → high_likelihood
   OR tenure >= 5 AND TSR below peers               → high_likelihood
   OR interim/acting CEO                            → high_likelihood
2. TWO OR MORE of these signals present:
   • activist investor present with named demands
   • TSR significantly below sector peers
   • tenure >= 5 years AND signals of board restlessness
   • contract expires within 12 months with no renewal indication
   • age >= 55 AND multiple other signals
   • major scandal or regulatory probe
   • COO/President appointed as clear named heir apparent
   • board recently refreshed suggesting change agenda
   • mandate signals indicating limited remaining term
                                                 → high_likelihood
3. ONE of these signals:
   • tenure 5+ years with some underperformance
   • mild TSR underperformance vs peers
   • contract expiry in 1–2 years
   • age 55–57 with no strong retention signals
   • COO appointed but not clearly heir
                                                 → medium_likelihood
4. low_likelihood if: tenure < 5yr AND no activist AND contract recently renewed AND performance solid
5. Default if data is sparse                     → medium_likelihood

confidence: "high" if prediction is clear-cut, "medium" if borderline, "low" if data is sparse
analytical_rationale: 4–6 sentences citing SPECIFIC data points (actual age, tenure, TSR values, signals). Never write generic boilerplate.`
  );

  const r = parseJSON(raw, fallback);
  r.prediction          = cl(r.prediction||"low_likelihood", 3);
  r.confidence          = cl(r.confidence||"low", 2);
  r.analytical_rationale = cl(r.analytical_rationale||"", 80);
  r.investor_impact      = cl(r.investor_impact||"", 8);

  // ── Name correction ───────────────────────────────────────────────────────
  if (rationaleCEO && data.ceo_name && rationaleCEO !== data.ceo_name &&
      r.analytical_rationale.includes(data.ceo_name)) {
    r.analytical_rationale = r.analytical_rationale.split(data.ceo_name).join(rationaleCEO);
  }

  // ── Embedded Challenge ────────────────────────────────────────────────────
  try {
    const chalRaw = await callLLM(
      `You are a devil's advocate. Challenge the prediction below — find the strongest reason it could be wrong. Return ONLY valid JSON.`,
      `Company: ${data.company||""} | Current CEO: ${data.ceo_name} | Departed CEO: ${rationaleCEO !== data.ceo_name ? rationaleCEO : "same"} | Age: ${data.ceo_age} | Tenure: ${data.ceo_tenure_years}yr
Ownership: ${data.ownership_category} | TSR vs peers: ${data.tsr_vs_peers}
Current prediction: ${r.prediction} (${r.confidence} confidence)
Finance view: ${finance.view} | Press view: ${press.view}
Rationale: ${r.analytical_rationale}

What is the single strongest argument AGAINST this prediction?
Should the prediction be revised? If yes, what should it be?
Return: {"should_revise":false,"revised_prediction":"","revised_confidence":"","challenge_note":""}`
    );
    const chal = parseJSON(chalRaw, {should_revise:false});
    if (chal.should_revise && chal.revised_prediction &&
        chal.revised_prediction !== r.prediction) {
      r.prediction = cl(chal.revised_prediction, 3);
      r.confidence = cl(chal.revised_confidence || r.confidence, 2);
      r.analytical_rationale = cl(r.analytical_rationale + (chal.challenge_note ? ` [Self-revised: ${chal.challenge_note}]` : ""), 80);
      r._challenge = "revised";
      if (rationaleCEO && data.ceo_name && rationaleCEO !== data.ceo_name &&
          r.analytical_rationale.includes(data.ceo_name)) {
        r.analytical_rationale = r.analytical_rationale.split(data.ceo_name).join(rationaleCEO);
      }
    } else {
      r._challenge = "held";
    }
  } catch { r._challenge = "skipped"; }

  return r;
}

// ── Agent 7: Validation & QC ──────────────────────────────────────────────────
async function agentValidation(company, ticker, data, finance, press, pred) {
  const today = new Date().toDateString();
  const fallback = {
    ceo_name_verified: "unverified",
    tenure_verified: "unverified",
    tsr_verified: "unverified",
    revenue_verified: "unverified",
    activist_verified: "unverified",
    prediction_rationale_check: "unverified",
    data_completeness_score: 0,
    flags: [],
    qc_summary: "Validation could not be completed."
  };

  const raw = await callLLM(
    `You are a quality control analyst reviewing AI-generated CEO succession research. Today is ${new Date().toDateString()}.
Your job is to VERIFY each key data point and flag anything that looks wrong, implausible, or missing.
Be critical. Do not just accept what the research says — cross-check with your own knowledge.
Return ONLY valid JSON.`,

    `Company: ${company}  |  Ticker: ${ticker||""}

━━━ DATA TO VERIFY ━━━
CEO Name: ${data.ceo_name}
CEO Age: ${data.ceo_age}
CEO Start Date: ${data.ceo_start_date}
CEO Tenure: ${data.ceo_tenure_years} years
Ownership: ${data.ownership_category}
Revenue: ${data.revenue}
TSR 1yr: ${data.tsr_1yr}  |  TSR 3yr: ${data.tsr_3yr}  |  TSR vs peers: ${data.tsr_vs_peers}
Activist investors: ${data.activist_investors}
Departure announced: ${data.ceo_departure_announced}
Incoming CEO: ${data.incoming_ceo_name}
Finance view: ${finance.view}
Press view: ${press.view}
Prediction: ${pred.prediction}  |  Confidence: ${pred.confidence}

━━━ VERIFICATION TASKS ━━━
1. CEO NAME: Is "${data.ceo_name}" actually the current CEO of ${company} as of ${today}?
2. SUCCESSOR CHECK: Has ${company} publicly announced a named successor/incoming CEO?
3. TENURE: Does the tenure of ${data.ceo_tenure_years} years match the start date ${data.ceo_start_date}?
4. TSR: Are the TSR figures plausible?
5. REVENUE: Is ${data.revenue} plausible?
6. ACTIVIST: Is the activist investor data accurate?
7. PREDICTION: Does the prediction of ${pred.prediction} seem reasonable?
8. MISSING DATA: Which important fields are blank or "not clearly inferable"?
9. COMPANY IDENTITY: Is this actually ${company}?

Return this JSON:
{
  "ceo_name_verified": "correct|incorrect|uncertain",
  "ceo_name_note": "",
  "successor_found": false,
  "successor_name": "",
  "successor_note": "",
  "tenure_verified": "correct|incorrect|uncertain",
  "tenure_note": "",
  "tsr_verified": "correct|plausible|incorrect|uncertain",
  "tsr_note": "",
  "revenue_verified": "correct|plausible|incorrect|uncertain",
  "revenue_note": "",
  "activist_verified": "correct|incorrect|uncertain",
  "activist_note": "",
  "prediction_check": "reasonable|too_high|too_low|uncertain",
  "prediction_note": "",
  "company_identity_check": "correct|confused|uncertain",
  "identity_note": "",
  "missing_critical_fields": [],
  "flags": [],
  "data_completeness_score": 0,
  "qc_summary": ""
}`
  );

  const r = parseJSON(raw, fallback);
  r.flags = lst(r.flags, 5, 30);
  r.missing_critical_fields = lst(r.missing_critical_fields, 8, 15);
  r.qc_summary = cl(r.qc_summary||"", 60);
  r.data_completeness_score = parseInt(r.data_completeness_score)||0;
  return r;
}

// ── Agent 8: Challenge ────────────────────────────────────────────────────────
async function agentChallenge(company, data, pred, finance, press) {
  const today = new Date().toDateString();
  const fallback = {
    challenge_points: [],
    overriding_factors: [],
    revised_confidence: pred.confidence,
    should_revise: false,
    revised_prediction: pred.prediction,
    challenge_summary: ""
  };

  const raw = await callLLM(
    `You are a devil's advocate analyst. Today is ${today}.
Your job is to CHALLENGE the prediction below and find reasons it could be WRONG.
Be critical and specific. Think about what evidence contradicts the prediction.
Return ONLY valid JSON.`,

    `Company: ${company}
CEO: ${data.ceo_name} | Tenure: ${data.ceo_tenure_years}yr | Age: ${data.ceo_age}
Ownership: ${data.ownership_category}
Current prediction: ${pred.prediction} (confidence: ${pred.confidence})
TSR: ${data.tsr_1yr} / ${data.tsr_3yr} vs peers: ${data.tsr_vs_peers}
Activist investors: ${data.activist_investors}
Finance view: ${finance.view}
Press view: ${press.view}
Rationale given: ${pred.analytical_rationale}

Return this JSON:
{
  "challenge_points": [],
  "overriding_factors": [],
  "revised_confidence": "",
  "should_revise": false,
  "revised_prediction": "",
  "challenge_summary": ""
}`
  );

  const r = parseJSON(raw, fallback);
  r.challenge_points    = lst(r.challenge_points, 4, 30);
  r.overriding_factors  = lst(r.overriding_factors, 3, 25);
  r.challenge_summary   = cl(r.challenge_summary||"", 60);
  r.revised_prediction  = cl(r.revised_prediction||pred.prediction, 3);
  r.revised_confidence  = cl(r.revised_confidence||pred.confidence, 2);
  r.should_revise       = Boolean(r.should_revise);
  return r;
}

// ── Full pipeline ─────────────────────────────────────────────────────────────
async function runPipeline(company, ticker, log) {

  log(p=>[...p,`[${company}] 1/6 CEO Scan — searching live news + model knowledge...`]);
  const webCtx = await fetchCEONews(company);
  const finCtx = await fetchFinancialData(company, ticker);

  // ── DEBUG: show what the web search actually returned ─────────────────────
  console.log(`\n${"─".repeat(60)}`);
  console.log(`🏢 PIPELINE START: "${company}"`);
  console.log(`📡 Web context (first 400 chars):\n`, webCtx.slice(0,400));

  log(p=>[...p,`[${company}] 2/6 Profile Structuring — building CEO profile...`]);
  const data = await agentResearch(company, ticker, webCtx + "\n\nFINANCIAL DATA:\n" + finCtx);

  // ── DEBUG: final CEO profile after all QC ─────────────────────────────────
  console.log(`\n📋 FINAL PROFILE for "${company}":`);
  console.log(`   CEO:        "${data.ceo_name}"  (pre-QC: "${data._ceo_name_pre_qc}")`);
  console.log(`   Tenure:     ${data.ceo_tenure_years}yr  Start: ${data.ceo_start_date}`);
  console.log(`   Departure:  ${data.ceo_departure_announced}  Successor: "${data.incoming_ceo_name}" (announced: ${data.incoming_ceo_announced})`);
  console.log(`   Ownership:  ${data.ownership_category}`);

  if(data._profile_qc === "verified")
    log(p=>[...p,`[${company}]     ✓ Profile QC passed — CEO: ${data.ceo_name}${data.incoming_ceo_announced==="yes"?" · Successor: "+data.incoming_ceo_name:""}${data._ceo_name_pre_qc && data._ceo_name_pre_qc !== data.ceo_name ? " · Departed: "+data._ceo_name_pre_qc : ""}`]);
  if(data.ceo_departure_announced==="yes")
    log(p=>[...p,`[${company}]     ⚠ Departure announced — departing CEO: ${data._ceo_name_pre_qc || data.ceo_name}`]);

  // ── Attach company + ticker to data so downstream agents have them ─────────
  data.company = company;
  data.ticker  = ticker || "";

  log(p=>[...p,`[${company}] 3/6 Finance — analysing revenue, TSR, margins...`]);
  const finance = await agentFinance(data);
  if(finance._finance_qc === "verified")
    log(p=>[...p,`[${company}]     ✓ Finance QC passed — Revenue: ${finance.revenue} · TSR 1yr: ${finance.tsr_1yr}`]);

  log(p=>[...p,`[${company}] 4/6 Press — scanning activism, controversies, probes...`]);
  const press = await agentPress(data);
  if(press._press_qc === "verified")
    log(p=>[...p,`[${company}]     ✓ Press QC passed — ${press.signals.length} verified signals`]);

  log(p=>[...p,`[${company}] 5/6 Industry — assessing sector dynamics...`]);
  const industry = await agentIndustry(data);
  log(p=>[...p,`[${company}]     ✓ Industry QC — ${industry.signals.length} specific signals (generic removed)`]);

  log(p=>[...p,`[${company}] 6/6 Prediction — scoring with all verified agent outputs...`]);
  const pred = await agentPrediction(data, finance, press, industry);
  if(pred._challenge === "revised")
    log(p=>[...p,`[${company}]     ⚡ Self-challenge revised prediction → ${pred.prediction}`]);
  else
    log(p=>[...p,`[${company}]     ✓ Self-challenge held — ${pred.prediction} (${pred.confidence} confidence)`]);

  log(p=>[...p,`[${company}] ✅ Complete`]);

  // ── DEBUG: final summary ──────────────────────────────────────────────────
  console.log(`\n🏁 FINAL RESULT for "${company}":`);
  console.log(`   CEO: "${data.ceo_name}" | Prediction: ${pred.prediction} | Confidence: ${pred.confidence}`);
  console.log(`   Rationale: "${pred.analytical_rationale.slice(0,150)}..."`);
  console.log(`${"─".repeat(60)}\n`);

  const finalPred = pred;
  const validation = {
    ceo_name_verified: data._profile_qc === "verified" ? "correct" : "unverified",
    ceo_name_note: data._profile_qc === "verified" ? "Verified by embedded profile QC" : "",
    successor_found: false, successor_name: "",
    tsr_verified: finance._finance_qc === "verified" ? "plausible" : "unverified",
    tsr_note: "",
    revenue_verified: finance._finance_qc === "verified" ? "plausible" : "unverified",
    prediction_check: pred._challenge === "revised" ? "revised by self-challenge" : "reasonable",
    prediction_note: pred._challenge === "held" ? "Held after internal challenge" : pred._challenge === "revised" ? "Revised after internal challenge" : "",
    company_identity_check: "correct",
    flags: [],
    missing_critical_fields: [],
    data_completeness_score: data._profile_qc === "verified" ? 90 : 75,
    qc_summary: `Profile QC: ${data._profile_qc||"skipped"}. Finance QC: ${finance._finance_qc||"skipped"}. Press QC: ${press._press_qc||"skipped"}. Prediction: ${pred._challenge||"skipped"}. Pre-QC CEO: ${data._ceo_name_pre_qc||"same"}.`,
  };
  const challenge = {
    challenge_points: [],
    overriding_factors: [],
    challenge_summary: pred._challenge === "revised" ? "Prediction self-revised after internal challenge" : "Prediction held after internal challenge",
    should_revise: pred._challenge === "revised",
    prediction_revised: pred._challenge === "revised",
  };
  return {
    company:cl(company,8), ticker:cl(ticker||"",6),
    sector:data.sector, ceo_name:data.ceo_name, ceo_age:data.ceo_age,
    ceo_start_date:data.ceo_start_date, ceo_tenure_years:data.ceo_tenure_years,
    founder_status:data.founder_status, ownership_category:data.ownership_category,
    ceo_departure_announced:data.ceo_departure_announced, incoming_ceo_announced:data.incoming_ceo_announced,
    incoming_ceo_name:data.incoming_ceo_name, incoming_ceo_background:data.incoming_ceo_background,
    incoming_ceo_start_date:data.incoming_ceo_start_date,
    // departed_ceo_name = the person who LEFT the CEO role.
    // Original v8 logic: show whenever _ceo_name_pre_qc differs from ceo_name.
    // This means QC corrected the CEO name to someone new — the pre-QC name was the departed one.
    departed_ceo_name: (data._ceo_name_pre_qc && data._ceo_name_pre_qc !== data.ceo_name)
      ? data._ceo_name_pre_qc
      : "",
    transition_complete: data._transition_complete || false,
    prediction:pred.prediction, confidence:pred.confidence, analytical_rationale:pred.analytical_rationale,
    revenue:normaliseRevenue(finance.revenue||data.revenue),
    revenue_growth:finance.revenue_growth||"",
    revenue_vs_prior:finance.revenue_vs_prior||"",
    revenue_vs_peers:finance.revenue_vs_peers||"",
    operating_margin:finance.operating_margin||"",
    margin_trend:finance.margin_trend||"",
    net_income:finance.net_income||"",
    ebitda:finance.ebitda||"",
    analyst_view:finance.analyst_view||"",
    key_risk:finance.key_risk||"",
    financial_summary:Array.isArray(finance.financial_facts)?finance.financial_facts.filter(Boolean).join(" | "):String(finance.financial_facts||""),
    tsr_1yr:   (finance.tsr_1yr   &&!finance.tsr_1yr.includes("inferable"))   ? finance.tsr_1yr   : data.tsr_1yr,
    tsr_3yr:   (finance.tsr_3yr   &&!finance.tsr_3yr.includes("inferable"))   ? finance.tsr_3yr   : data.tsr_3yr,
    tsr_vs_peers:(finance.tsr_vs_peers&&!finance.tsr_vs_peers.includes("inferable"))? finance.tsr_vs_peers: data.tsr_vs_peers,
    ceo_contract_expiry:data.ceo_contract_expiry, contract_renewed:data.contract_renewed,
    succession_plan_disclosed:data.succession_plan_disclosed, coo_or_president_appointed:data.coo_or_president_appointed,
    board_refreshed_2yr:data.board_refreshed_2yr, activist_investors:data.activist_investors,
    press_controversies:joinCompact(press.controversies," | ",30),
    investor_activism:press.investor_activism, mandate_signals:data.mandate_signals,
    key_risks: lst(data.press_activism_signals, 4, 25),
    mitigating_factors: lst(finance.signals.length>0 ? finance.signals : [], 3, 25),
    succession_signals: lst(data.leadership_signals, 4, 20),
    leadership_signals: data.leadership_signals,
    financial_signals: data.financial_signals,
    press_signals:press.signals, industry_signals:industry.signals,
    finance_view:finance.view, press_view:press.view, industry_view:industry.view,
    finance_concerns:finance.concerns, press_concerns:press.concerns, industry_concerns:industry.concerns,
    performance_trajectory:data.performance_trajectory||"",
    m_and_a_activity:data.m_and_a_activity||"",
    regulatory_scrutiny:data.regulatory_scrutiny||"",
    investor_impact:pred.investor_impact||"",
    successor_found_by_validation: validation.successor_found||false,
    challenge_points:     challenge.challenge_points||[],
    overriding_factors:   challenge.overriding_factors||[],
    challenge_summary:    challenge.challenge_summary||"",
    prediction_revised:   challenge.should_revise||false,
    validation_ceo:       validation.ceo_name_verified||"unverified",
    validation_ceo_note:  validation.ceo_name_note||"",
    validation_tsr:       validation.tsr_verified||"unverified",
    validation_tsr_note:  validation.tsr_note||"",
    validation_revenue:   validation.revenue_verified||"unverified",
    validation_prediction:validation.prediction_check||"uncertain",
    validation_prediction_note: validation.prediction_note||"",
    validation_company:   validation.company_identity_check||"uncertain",
    validation_flags:     (validation.flags||[]).map(f=>String(f)),
    validation_missing:   (validation.missing_critical_fields||[]).map(f=>String(f)),
    qc_score:             validation.data_completeness_score||0,
    qc_summary:           validation.qc_summary||"",
  };
}

// ── Export to XLSX (SheetJS compatible) ──────────────────────────────────────
async function exportToExcel(results) {
  const XL = await loadXLSX();
  const PRED_LABEL_MAP = {
    new_ceo_appointed:"New CEO Appointed", transition_underway:"Transition Underway",
    high_likelihood:"High Likelihood", medium_likelihood:"Medium Likelihood",
    low_likelihood:"Low Likelihood"
  };

  const flatten = v => {
    if (Array.isArray(v)) return v.map(i => typeof i==="object"?JSON.stringify(i):String(i)).join(" | ");
    if (typeof v==="object"&&v!==null) return JSON.stringify(v);
    return String(v??"");
  };

  // ── Column groups ─────────────────────────────────────────────────────────
  const SECTIONS = [
    { title:"COMPANY & CEO PROFILE", cols:[
      { key:"company",                      label:"Company",               w:24 },
      { key:"ticker",                       label:"Ticker",                w:10 },
      { key:"sector",                       label:"Sector",                w:18 },
      { key:"ownership_category",           label:"Ownership Type",        w:22 },
      { key:"ceo_name",                     label:"CEO Name",              w:22 },
      { key:"departed_ceo_name",            label:"Departed CEO",          w:22 },
      { key:"ceo_age",                      label:"Age",                   w:8  },
      { key:"ceo_start_date",               label:"Start Date",            w:14 },
      { key:"ceo_tenure_years",             label:"Tenure (yrs)",          w:13 },
      { key:"founder_status",               label:"Founder Status",        w:18 },
    ]},
    { title:"SUCCESSION STATUS", cols:[
      { key:"prediction",                   label:"Prediction",            w:24, fmt:v=>PRED_LABEL_MAP[v]||v },
      { key:"confidence",                   label:"Confidence",            w:12 },
      { key:"investor_impact",              label:"Investor Impact",       w:20 },
      { key:"ceo_departure_announced",      label:"Departure Announced",   w:18 },
      { key:"incoming_ceo_announced",       label:"Successor Announced",   w:18 },
      { key:"incoming_ceo_name",            label:"Incoming CEO",          w:22 },
      { key:"incoming_ceo_background",      label:"Incoming Background",   w:32 },
      { key:"incoming_ceo_start_date",      label:"Incoming Start Date",   w:20 },
      { key:"analytical_rationale",         label:"Board-Ready Rationale", w:65 },
    ]},
    { title:"FINANCIALS", cols:[
      { key:"revenue",                      label:"Revenue",               w:14 },
      { key:"tsr_1yr",                      label:"TSR 1yr",               w:12 },
      { key:"tsr_3yr",                      label:"TSR 3yr",               w:12 },
      { key:"tsr_vs_peers",                 label:"TSR vs Peers",          w:28 },
      { key:"financial_summary",            label:"Financial Summary",     w:55 },
      { key:"operating_margin",             label:"Operating Margin",      w:20 },
      { key:"analyst_view",                 label:"Analyst View",          w:22 },
      { key:"finance_view",                 label:"Finance Agent View",    w:20 },
    ]},
    { title:"GOVERNANCE", cols:[
      { key:"ceo_contract_expiry",          label:"Contract Expiry",       w:18 },
      { key:"contract_renewed",             label:"Contract Renewed",      w:18 },
      { key:"succession_plan_disclosed",    label:"Succession Plan",       w:28 },
      { key:"coo_or_president_appointed",   label:"COO / President",       w:28 },
      { key:"board_refreshed_2yr",          label:"Board Refreshed (2yr)", w:22 },
      { key:"mandate_signals",              label:"Mandate Signals",       w:35 },
    ]},
    { title:"ACTIVISM & PRESS", cols:[
      { key:"activist_investors",           label:"Activist Investors",    w:28 },
      { key:"investor_activism",            label:"Activism Detail",       w:45 },
      { key:"press_controversies",          label:"Press Controversies",   w:45 },
      { key:"press_view",                   label:"Press Agent View",      w:20 },
      { key:"press_signals",                label:"Press Signals",         w:45, fmt:v=>Array.isArray(v)?v.join(" | "):v },
      { key:"press_concerns",               label:"Press Concerns",        w:45, fmt:v=>Array.isArray(v)?v.join(" | "):v },
    ]},
    { title:"SIGNALS", cols:[
      { key:"leadership_signals",           label:"Leadership Signals",    w:45, fmt:v=>Array.isArray(v)?v.join(" | "):v },
      { key:"financial_signals",            label:"Financial Signals",     w:45, fmt:v=>Array.isArray(v)?v.join(" | "):v },
      { key:"industry_signals",             label:"Industry Signals",      w:45, fmt:v=>Array.isArray(v)?v.join(" | "):v },
      { key:"industry_view",                label:"Industry Agent View",   w:20 },
      { key:"finance_concerns",             label:"Finance Concerns",      w:45, fmt:v=>Array.isArray(v)?v.join(" | "):v },
      { key:"industry_concerns",            label:"Industry Concerns",     w:45, fmt:v=>Array.isArray(v)?v.join(" | "):v },
    ]},
    { title:"QC & VALIDATION", cols:[
      { key:"qc_score",                     label:"QC Score",              w:12 },
      { key:"qc_summary",                   label:"QC Summary",            w:45 },
      { key:"validation_ceo",               label:"CEO Verified",          w:16 },
      { key:"validation_ceo_note",          label:"CEO Verify Note",       w:35 },
      { key:"validation_tsr",               label:"TSR Verified",          w:14 },
      { key:"validation_revenue",           label:"Revenue Verified",      w:16 },
      { key:"validation_prediction",        label:"Prediction QC",         w:22 },
      { key:"validation_prediction_note",   label:"Prediction QC Note",    w:35 },
      { key:"validation_company",           label:"Company Identity",      w:22 },
      { key:"validation_flags",             label:"QC Flags",              w:35, fmt:v=>Array.isArray(v)?v.join(" | "):v },
      { key:"validation_missing",           label:"Missing Fields",        w:35, fmt:v=>Array.isArray(v)?v.join(", "):v  },
      { key:"challenge_summary",            label:"Challenge Summary",     w:45 },
      { key:"prediction_revised",           label:"Prediction Revised?",   w:16, fmt:v=>v?"Yes":"No" },
    ]},
  ];

  const allCols = SECTIONS.flatMap(s => s.cols);
  const getVal  = (r, c) => flatten(c.fmt ? c.fmt(r[c.key]??"") : (r[c.key]??""));

  // ── Sheet 1: Full data ────────────────────────────────────────────────────
  const wb = XL.utils.book_new();

  // Row 0: title
  // Row 1: section headers
  // Row 2: column headers
  // Row 3+: data
  const titleRow   = [`CEO Succession Risk Analysis  ·  ${results.length} Companies  ·  ${new Date().toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"})}`];
  const sectRow    = [];
  const headerRow  = [];
  let colOffset    = 0;
  for(const sec of SECTIONS){
    sectRow.push(sec.title);
    for(let i=1;i<sec.cols.length;i++) sectRow.push("");
    sec.cols.forEach(c => headerRow.push(c.label));
    colOffset += sec.cols.length;
  }
  const dataRows = results.map(r => allCols.map(c => getVal(r,c)));

  const wsData = [titleRow, sectRow, headerRow, ...dataRows];
  const ws     = XL.utils.aoa_to_sheet(wsData);

  // Column widths
  ws["!cols"] = allCols.map(c => ({ wch: c.w || 20 }));

  // Row heights
  ws["!rows"] = [
    { hpt:30 },  // title
    { hpt:18 },  // section headers
    { hpt:36 },  // column headers
    ...results.map(()=>({ hpt:72 }))
  ];

  // Freeze: first 3 rows + first 2 columns
  ws["!freeze"] = { xSplit:2, ySplit:3, topLeftCell:"C4", activePane:"bottomRight" };

  // Autofilter on column header row
  ws["!autofilter"] = { ref: XL.utils.encode_range({ s:{r:2,c:0}, e:{r:2,c:allCols.length-1} }) };

  // Merge title row across all columns
  const merges = [{ s:{r:0,c:0}, e:{r:0,c:allCols.length-1} }];
  // Merge section header cells
  let off = 0;
  for(const sec of SECTIONS){
    if(sec.cols.length > 1) merges.push({ s:{r:1,c:off}, e:{r:1,c:off+sec.cols.length-1} });
    off += sec.cols.length;
  }
  ws["!merges"] = merges;

  XL.utils.book_append_sheet(wb, ws, "CEO Succession Analysis");

  // ── Sheet 2: Summary ─────────────────────────────────────────────────────
  const predOrder  = ["New CEO Appointed","Transition Underway","High Likelihood","Medium Likelihood","Low Likelihood"];
  const predCounts = results.reduce((acc,r)=>{
    const label = PRED_LABEL_MAP[r.prediction]||r.prediction||"Unknown";
    acc[label]=(acc[label]||0)+1; return acc;
  },{});
  const highCount  = (predCounts["New CEO Appointed"]||0)+(predCounts["Transition Underway"]||0)+(predCounts["High Likelihood"]||0);

  const s2Data = [
    [`CEO Succession Risk Analysis — Summary`],
    [`Generated: ${new Date().toLocaleDateString("en-GB",{weekday:"long",day:"2-digit",month:"long",year:"numeric"})}`],
    [],
    ["Total Companies Analysed", results.length],
    ["High Risk+ (New / Transition / High)", highCount],
    ["High Risk %", results.length ? `${Math.round((highCount/results.length)*100)}%` : "0%"],
    [],
    ["Prediction Breakdown"],
    ["Prediction","Count","% of Total"],
    ...predOrder.map(label=>[label, predCounts[label]||0, results.length?`${Math.round(((predCounts[label]||0)/results.length)*100)}%`:"0%"]),
    [],
    ["Quick Reference"],
    ["Company","CEO","Tenure","Prediction","Confidence","Revenue","TSR 1yr","Ownership","Sector"],
    ...results.map(r=>[
      r.company||"",
      r.ceo_name||"",
      r.ceo_tenure_years&&!ni(r.ceo_tenure_years)?`${r.ceo_tenure_years}yr`:"",
      PRED_LABEL_MAP[r.prediction]||r.prediction||"",
      r.confidence||"",
      r.revenue||"",
      r.tsr_1yr||"",
      OWN_LABEL[r.ownership_category]||r.ownership_category||"",
      r.sector||"",
    ]),
  ];

  const ws2 = XL.utils.aoa_to_sheet(s2Data);
  ws2["!cols"] = [{wch:32},{wch:22},{wch:14},{wch:24},{wch:14},{wch:14},{wch:12},{wch:22},{wch:18}];
  XL.utils.book_append_sheet(wb, ws2, "Summary");

  // ── Download ──────────────────────────────────────────────────────────────
  XL.writeFile(wb, `CEO_Succession_Analysis_${new Date().toISOString().slice(0,10)}.xlsx`);
}

// ── UI Components ─────────────────────────────────────────────────────────────

function PredBadge({pred,sm=false}){
  const col = PRED_COLOR[pred]||"#9B9591";
  const isRed = ["new_ceo_appointed","transition_underway","high_likelihood"].includes(pred);
  return(
    <span style={{
      background: isRed ? C.red : col,
      color:"#fff",
      borderRadius:3,
      padding:sm?"2px 8px":"4px 13px",
      fontSize:sm?10:12,
      fontWeight:700,
      letterSpacing:"0.04em",
      whiteSpace:"nowrap",
      textTransform:"uppercase"
    }}>{PRED_LABEL[pred]||pred}</span>
  );
}

function Pill({text,v="n"}){
  const m={
    n:{bg:"#F0EEE9",c:C.slate},
    r:{bg:"rgba(204,0,0,0.08)",c:C.redD},
    g:{bg:C.okBg,c:C.ok},
    a:{bg:C.warnBg,c:C.warn},
    b:{bg:"rgba(0,51,153,0.07)",c:"#003399"}
  }[v]||{bg:"#F0EEE9",c:C.slate};
  return(
    <span style={{
      background:m.bg,color:m.c,
      borderRadius:3,padding:"2px 8px",
      fontSize:11,fontWeight:600,
      display:"inline-block",marginRight:4,marginBottom:4
    }}>{text}</span>
  );
}

function SH({children}){
  return(
    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10,paddingBottom:7,borderBottom:`1px solid ${C.border}`}}>
      <div style={{width:2,height:12,background:C.red,borderRadius:1,flexShrink:0}}/>
      <span style={{fontSize:10,fontWeight:700,color:C.ink,textTransform:"uppercase",letterSpacing:"0.12em"}}>{children}</span>
    </div>
  );
}

function KV({label,val,hi=false}){
  if(!val||val==="N/A"||ni(val)) return null;
  return(
    <div style={{
      background: hi?"rgba(192,0,0,0.04)":C.white,
      border:`1px solid ${hi?"#FECACA":C.border}`,
      borderRadius:6,
      padding:"10px 13px",
      boxShadow:"0 1px 2px rgba(0,0,0,0.04)"
    }}>
      <div style={{fontSize:11,color:hi?C.red:C.mid,textTransform:"uppercase",letterSpacing:"0.07em",fontWeight:700,marginBottom:5}}>{label}</div>
      <div style={{fontSize:15,fontWeight:700,color:hi?C.redD:C.ink,lineHeight:1.3}}>{val}</div>
    </div>
  );
}

function AgentView({label,view,signals=[],concerns=[]}){
  const col=VIEW_COLOR[view]||C.mid;
  const isHigh = view==="high_influence";
  const safeStr = v => (v && typeof v === "object") ? JSON.stringify(v) : String(v||"");
  return(
    <div style={{
      background:C.white,
      border:`1px solid ${isHigh?"#FCA5A5":C.border}`,
      borderRadius:8,
      padding:"12px 14px",
      boxShadow:"0 1px 3px rgba(0,0,0,0.04)"
    }}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
        <span style={{fontSize:11,fontWeight:700,color:C.ink,textTransform:"uppercase",letterSpacing:"0.08em"}}>{label}</span>
        <span style={{
          background:isHigh?"#FEF2F2":col==="no_clear_influence"?"#F0FDF4":"#FFFBEB",
          color:col,
          border:`1px solid ${isHigh?"#FECACA":"transparent"}`,
          borderRadius:3,padding:"2px 8px",fontSize:10,fontWeight:600
        }}>{VIEW_LABEL[view]||view}</span>
      </div>
      {signals.filter(s=>s&&safeStr(s).length>2).map((s,i)=>(
        <div key={i} style={{fontSize:14,color:C.slate,marginBottom:6,display:"flex",gap:7,lineHeight:1.5}}>
          <span style={{color:C.red,flexShrink:0,marginTop:1}}>—</span>{safeStr(s)}
        </div>
      ))}
      {concerns.filter(s=>s&&safeStr(s).length>2).map((s,i)=>(
        <div key={i} style={{fontSize:14,color:C.redD,marginBottom:6,display:"flex",gap:7,lineHeight:1.5}}>
          <span style={{color:C.red,flexShrink:0,marginTop:1}}>!</span>{safeStr(s)}
        </div>
      ))}
    </div>
  );
}

function Blist({items,col=C.red}){
  const safeStr = v => (v && typeof v === "object") ? JSON.stringify(v) : String(v||"");
  return items.filter(item=>item&&safeStr(item).length>2).map((item,i)=>(
    <div key={i} style={{display:"flex",gap:9,marginBottom:8,fontSize:14,color:C.slate,alignItems:"flex-start",lineHeight:1.5}}>
      <span style={{color:col,fontWeight:700,flexShrink:0,fontSize:10,marginTop:3}}>—</span>
      {safeStr(item)}
    </div>
  ));
}

// ── Detail Panel ──────────────────────────────────────────────────────────────
function Detail({r}){
  const [tab,setTab]=useState("overview");
  const isHigh=isHighPred(r.prediction);
  const TABS=[
    {id:"overview",l:"Overview"},
    {id:"agents",l:"Agent Views"},
    {id:"ceo",l:"CEO Profile"},
    {id:"governance",l:"Governance"},
    {id:"financials",l:"Financials"},
    {id:"rationale",l:"Rationale"},
    {id:"qc",l:"QC"}
  ];

  return(
    <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",overflow:"hidden"}}>

      <div style={{
        background:C.white,
        borderBottom:`1px solid ${C.border}`,
        padding:"14px 20px 0",
        flexShrink:0,
        borderLeft:isHigh?`4px solid ${C.red}`:"4px solid transparent"
      }}>
        <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:14,marginBottom:10}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:22,fontWeight:700,color:C.ink,letterSpacing:"-0.02em",lineHeight:1.15}}>{r.company}</div>
            <div style={{display:"flex",gap:6,marginTop:4,flexWrap:"wrap",alignItems:"center"}}>
              {r.ticker&&<span style={{fontSize:11,color:C.mid,fontFamily:"monospace",background:C.surfaceAlt,padding:"1px 6px",borderRadius:3,border:`1px solid ${C.border}`}}>{r.ticker}</span>}
              {r.sector&&<span style={{fontSize:11,color:C.mid}}>{r.sector}</span>}
              {r.ownership_category&&r.ownership_category!=="unclear"&&(
                <span style={{fontSize:10,color:C.muted,background:C.surfaceAlt,padding:"1px 6px",borderRadius:2,border:`1px solid ${C.border}`}}>{OWN_LABEL[r.ownership_category]||r.ownership_category}</span>
              )}
            </div>
          </div>
          <div style={{textAlign:"right",flexShrink:0,paddingTop:2}}>
            <PredBadge pred={r.prediction}/>
            <div style={{fontSize:10,color:C.muted,marginTop:4}}>
              Confidence: <strong style={{color:C.mid}}>{r.confidence||"—"}</strong>
            </div>
          </div>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:6,marginBottom:10}}>
          {[
            ["CEO",r.ceo_name],
            ["Age",!ni(r.ceo_age)?r.ceo_age:"—"],
            ["Tenure",r.ceo_tenure_years&&!ni(r.ceo_tenure_years)?`${r.ceo_tenure_years}yr`:"—"],
            ["Successor",r.incoming_ceo_announced==="yes"&&r.incoming_ceo_name&&r.incoming_ceo_name!=="N/A"?r.incoming_ceo_name:"—"],
            ["TSR 1yr",!ni(r.tsr_1yr)?r.tsr_1yr:"—"]
          ].map(([l,v])=>(
            <div key={l} style={{background:C.surfaceAlt,borderRadius:5,padding:"7px 10px",border:`1px solid ${C.border}`}}>
              <div style={{fontSize:9,color:C.muted,textTransform:"uppercase",letterSpacing:"0.09em",fontWeight:600,marginBottom:3}}>{l}</div>
              <div style={{fontSize:13,fontWeight:600,color:C.ink,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{v||"—"}</div>
            </div>
          ))}
        </div>

        {/* Show departed CEO name when QC corrected to new CEO */}
        {r.departed_ceo_name&&(
          <div style={{marginBottom:6,background:"#FFF7ED",border:"1px solid #FED7AA",borderRadius:5,padding:"6px 12px",fontSize:11,color:"#92400E"}}>
            Departed CEO: <strong>{r.departed_ceo_name}</strong> · Succeeded by: <strong>{r.ceo_name}</strong>
          </div>
        )}

        {r.incoming_ceo_announced==="yes"&&r.incoming_ceo_name&&r.incoming_ceo_name!=="N/A"&&(
          <div style={{marginBottom:10,background:"#F0FDF4",border:"1px solid #BBF7D0",borderRadius:5,padding:"7px 12px",fontSize:12,display:"flex",alignItems:"center",gap:8}}>
            <span style={{color:"#15803D",fontWeight:700,fontSize:11}}>SUCCESSOR</span>
            <span style={{color:C.ink,fontWeight:600}}>{r.incoming_ceo_name}</span>
            {r.incoming_ceo_background&&r.incoming_ceo_background!=="N/A"&&<span style={{color:C.mid}}> — {r.incoming_ceo_background}</span>}
            {r.incoming_ceo_start_date&&r.incoming_ceo_start_date!=="N/A"&&<span style={{color:C.muted}}> · Starts: {r.incoming_ceo_start_date}</span>}
          </div>
        )}
        {r.ceo_departure_announced==="yes"&&r.incoming_ceo_announced!=="yes"&&!r.departed_ceo_name&&!r.transition_complete&&(
          <div style={{marginBottom:10,background:C.redBg,border:"1px solid #FECACA",borderRadius:5,padding:"6px 12px",fontSize:11,color:C.redD}}>
            ⚠ CEO departure announced — successor not yet named
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={{display:"flex",background:C.white,borderBottom:`1px solid ${C.border}`,flexShrink:0,overflowX:"auto"}}>
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{
            flex:1,padding:"10px 6px",border:"none",cursor:"pointer",
            fontSize:12,fontWeight:600,background:"transparent",
            color:tab===t.id?C.red:C.mid,
            borderBottom:tab===t.id?`2px solid ${C.red}`:"2px solid transparent",
            whiteSpace:"nowrap",minWidth:72,transition:"color 0.15s"
          }}>{t.l}</button>
        ))}
      </div>

      {/* Content — unchanged from original */}
      <div style={{flex:1,overflowY:"auto",background:C.surfaceAlt,padding:"16px 18px"}}>

        {tab==="overview"&&(
          <div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:8}}>
              <KV label="Prediction" val={PRED_LABEL[r.prediction]||r.prediction} hi={isHigh}/>
              <KV label="Confidence" val={r.confidence} hi={isHigh}/>
              <KV label="Revenue" val={!ni(r.revenue)?r.revenue:""}/>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:8}}>
              <KV label="TSR 1yr" val={!ni(r.tsr_1yr)?r.tsr_1yr:""}/>
              <KV label="TSR 3yr" val={!ni(r.tsr_3yr)?r.tsr_3yr:""}/>
              <KV label="TSR vs Peers" val={!ni(r.tsr_vs_peers)?r.tsr_vs_peers:""}/>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:8}}>
              <KV label="CEO Tenure" val={r.ceo_tenure_years&&!ni(r.ceo_tenure_years)?`${r.ceo_tenure_years} years`:""}/>              <KV label="CEO Age" val={!ni(r.ceo_age)?r.ceo_age:""}/>
              <KV label="Contract Expiry" val={!ni(r.ceo_contract_expiry)?r.ceo_contract_expiry:""} hi={r.ceo_contract_expiry&&!ni(r.ceo_contract_expiry)}/>
              <KV label="Activist Investors" val={r.activist_investors&&!ni(r.activist_investors)&&!["none","no"].includes(String(r.activist_investors).toLowerCase())?r.activist_investors:""} hi={r.activist_investors&&!ni(r.activist_investors)&&!["none","no"].includes(String(r.activist_investors).toLowerCase())}/>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:12}}>
              <KV label="Performance" val={!ni(r.performance_trajectory)?r.performance_trajectory:""}/>
              <KV label="M&A Activity" val={!ni(r.m_and_a_activity)?r.m_and_a_activity:""}/>
              <KV label="Regulatory" val={r.regulatory_scrutiny&&!["none","low"].includes(String(r.regulatory_scrutiny).toLowerCase())?r.regulatory_scrutiny:""}/>
              <KV label="COO / Heir Apparent" val={!ni(r.coo_or_president_appointed)?r.coo_or_president_appointed:""}/>
            </div>

            {/* Show transition alert only for PENDING transitions — not completed ones */}
            {(r.ceo_departure_announced==="yes"||r.incoming_ceo_announced==="yes")&&!r.transition_complete&&(
              <div style={{background:C.redBg,border:`1px solid #FECACA`,borderRadius:7,padding:"12px 15px",marginBottom:10}}>
                <SH>CEO Transition Alert</SH>
                {r.ceo_departure_announced==="yes"&&(
                  <div style={{fontSize:13,color:C.redD,marginBottom:4}}>
                    ⚠ Departure announced: <strong>{r.departed_ceo_name||r.ceo_name}</strong> is leaving.
                  </div>
                )}
                {r.incoming_ceo_announced==="yes"&&r.incoming_ceo_name&&r.incoming_ceo_name!=="N/A"
                  ?<div style={{fontSize:13,color:C.redD}}>✓ Successor named: <strong>{r.incoming_ceo_name}</strong>{r.incoming_ceo_background&&r.incoming_ceo_background!=="N/A"?` — ${r.incoming_ceo_background}`:""}{r.incoming_ceo_start_date&&r.incoming_ceo_start_date!=="N/A"?` · Starts: ${r.incoming_ceo_start_date}`:""}</div>
                  :r.incoming_ceo_announced==="yes"&&<div style={{fontSize:13,color:C.redD}}>Successor not yet publicly named.</div>
                }
              </div>
            )}
            {/* Completed transition banner — shows who departed and who arrived */}
            {r.transition_complete&&r.departed_ceo_name&&(
              <div style={{background:"#F0FDF4",border:"1px solid #BBF7D0",borderRadius:7,padding:"12px 15px",marginBottom:10}}>
                <SH>CEO Transition Complete</SH>
                <div style={{fontSize:13,color:C.ok}}>✓ <strong>{r.departed_ceo_name}</strong> departed · <strong>{r.ceo_name}</strong> appointed as new CEO</div>
              </div>
            )}

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
              <div style={{background:C.white,border:`1px solid #FECACA`,borderRadius:8,padding:"13px 15px",boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
                <SH>Leadership &amp; Succession Signals</SH>
                {r.leadership_signals?.filter(s=>s&&String(s).length>3).length>0
                  ?<Blist items={r.leadership_signals.filter(s=>s&&String(s).length>3)} col={C.red}/>
                  :<div style={{fontSize:13,color:C.muted,fontStyle:"italic"}}>No specific leadership signals identified.</div>}
              </div>
              <div style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:8,padding:"13px 15px",boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
                <SH>Governance &amp; Succession Plan</SH>
                {[
                  !ni(r.succession_plan_disclosed)?`Succession plan: ${r.succession_plan_disclosed}`:"",
                  !ni(r.coo_or_president_appointed)?`COO / President: ${r.coo_or_president_appointed}`:"",
                  !ni(r.board_refreshed_2yr)?`Board refresh: ${r.board_refreshed_2yr}`:"",
                  !ni(r.contract_renewed)?`Contract: ${r.contract_renewed}`:"",
                  !ni(r.mandate_signals)?r.mandate_signals:"",
                ].filter(Boolean).length>0
                  ?<Blist items={[!ni(r.succession_plan_disclosed)?`Succession plan: ${r.succession_plan_disclosed}`:"",!ni(r.coo_or_president_appointed)?`COO / President: ${r.coo_or_president_appointed}`:"",!ni(r.board_refreshed_2yr)?`Board refresh: ${r.board_refreshed_2yr}`:"",!ni(r.contract_renewed)?`Contract: ${r.contract_renewed}`:"",!ni(r.mandate_signals)?r.mandate_signals:""].filter(Boolean)} col={"#003399"}/>
                  :<div style={{fontSize:13,color:C.muted,fontStyle:"italic"}}>No specific governance signals available.</div>}
              </div>
            </div>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
              <div style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:8,padding:"13px 15px",boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
                <SH>Press &amp; Activism</SH>
                {r.press_signals?.filter(s=>s&&String(s).length>3).length>0
                  ?<Blist items={r.press_signals.filter(s=>s&&String(s).length>3)} col={C.red}/>
                  :r.press_controversies&&!ni(r.press_controversies)
                    ?<div style={{fontSize:14,color:C.slate,lineHeight:1.6}}>{r.press_controversies}</div>
                    :<div style={{fontSize:13,color:C.muted,fontStyle:"italic"}}>No significant activist or press pressure identified.</div>}
                {r.investor_activism&&!ni(r.investor_activism)&&!["none identified","not clearly"].some(x=>r.investor_activism.toLowerCase().includes(x))&&(
                  <div style={{marginTop:8,padding:"7px 10px",background:"#FEF2F2",borderRadius:5,fontSize:13,color:C.redD}}>
                    <strong>Activist detail:</strong> {r.investor_activism}
                  </div>
                )}
              </div>
              <div style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:8,padding:"13px 15px",boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
                <SH>Financial &amp; Industry Signals</SH>
                {[...(r.financial_signals||[]),...(r.industry_signals||[])].filter(s=>s&&String(s).length>3).length>0
                  ?<Blist items={[...(r.financial_signals||[]),...(r.industry_signals||[])].filter(s=>s&&String(s).length>3).slice(0,5)} col={C.warn}/>
                  :<div style={{fontSize:13,color:C.muted,fontStyle:"italic"}}>No specific financial or industry signals identified.</div>}
              </div>
            </div>

            {r.analytical_rationale&&(
              <div style={{background:"#1A1A2E",borderRadius:8,padding:"16px 20px",position:"relative",overflow:"hidden"}}>
                <div style={{position:"absolute",right:-15,top:-15,width:80,height:80,borderRadius:"50%",background:"rgba(255,255,255,0.04)"}}/>
                <div style={{fontSize:10,fontWeight:700,color:"rgba(255,255,255,0.55)",textTransform:"uppercase",letterSpacing:"0.12em",marginBottom:8}}>Board-Ready Rationale</div>
                <div style={{fontSize:15,color:"#fff",lineHeight:1.75,fontWeight:400}}>{r.analytical_rationale}</div>
              </div>
            )}
          </div>
        )}

        {tab==="agents"&&(
          <div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
              <AgentView label="Finance Agent" view={r.finance_view} signals={r.financial_signals||[]} concerns={r.finance_concerns||[]}/>
              <AgentView label="Press Agent" view={r.press_view} signals={r.press_signals||[]} concerns={r.press_concerns||[]}/>
            </div>
            <AgentView label="Industry Agent" view={r.industry_view} signals={r.industry_signals||[]} concerns={r.industry_concerns||[]}/>
            {r.financial_summary&&(
              <div style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:8,padding:"12px 14px",marginTop:10,boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
                <SH>Financial Summary</SH>
                <div style={{fontSize:14,color:C.slate,lineHeight:1.6}}>{r.financial_summary}</div>
              </div>
            )}
          </div>
        )}

        {tab==="ceo"&&(
          <div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:12}}>
              <KV label="CEO Name" val={r.ceo_name}/>
              {r.departed_ceo_name&&<KV label="Departed CEO" val={r.departed_ceo_name}/>}
              <KV label="Age" val={!ni(r.ceo_age)?r.ceo_age:""}/>
              <KV label="Tenure" val={r.ceo_tenure_years&&!ni(r.ceo_tenure_years)?`${r.ceo_tenure_years} years`:""}/>              <KV label="Start Date" val={!ni(r.ceo_start_date)?r.ceo_start_date:""}/>
              <KV label="Founder Status" val={!ni(r.founder_status)?r.founder_status:""}/>
              <KV label="Ownership" val={OWN_LABEL[r.ownership_category]||r.ownership_category}/>
            </div>
            {r.incoming_ceo_announced==="yes"&&(
              <div style={{background:"#FFFBEB",border:"1px solid #FDE68A",borderRadius:8,padding:"12px 14px",marginBottom:10}}>
                <SH>Incoming CEO</SH>
                <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
                  <KV label="Name" val={r.incoming_ceo_name}/>
                  <KV label="Background" val={r.incoming_ceo_background}/>
                  <KV label="Start Date" val={r.incoming_ceo_start_date}/>
                </div>
              </div>
            )}
            {!ni(r.mandate_signals)&&(
              <div style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:8,padding:"12px 14px",boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
                <SH>Mandate Signals</SH>
                <div style={{fontSize:14,color:C.slate,lineHeight:1.6}}>{r.mandate_signals}</div>
              </div>
            )}
          </div>
        )}

        {tab==="governance"&&(
          <div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:12}}>
              <KV label="Contract Expiry" val={!ni(r.ceo_contract_expiry)?r.ceo_contract_expiry:""}/>
              <KV label="Contract Renewed" val={!ni(r.contract_renewed)?r.contract_renewed:""}/>
              <KV label="Succession Plan" val={!ni(r.succession_plan_disclosed)?r.succession_plan_disclosed:""}/>
              <KV label="COO / President" val={!ni(r.coo_or_president_appointed)?r.coo_or_president_appointed:""}/>
              <KV label="Board Refresh" val={!ni(r.board_refreshed_2yr)?r.board_refreshed_2yr:""}/>
              <KV label="Activist Investors" val={!ni(r.activist_investors)?r.activist_investors:""} hi={r.activist_investors&&!["none","no","not clearly inferable"].includes(String(r.activist_investors).toLowerCase())}/>
            </div>
            {!ni(r.investor_activism)&&(
              <div style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:8,padding:"12px 14px",boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
                <SH>Investor Activism Detail</SH>
                <div style={{fontSize:14,color:C.slate,lineHeight:1.6}}>{r.investor_activism}</div>
              </div>
            )}
          </div>
        )}

        {tab==="financials"&&(
          <div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:8}}>
              <KV label="Revenue" val={!ni(r.revenue)?r.revenue:""}/>
              <KV label="TSR 1yr" val={!ni(r.tsr_1yr)?r.tsr_1yr:""}/>
              <KV label="TSR 3yr" val={!ni(r.tsr_3yr)?r.tsr_3yr:""}/>
              <KV label="TSR vs Peers" val={!ni(r.tsr_vs_peers)?r.tsr_vs_peers:""}/>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:12}}>
              <KV label="Operating Margin" val={!ni(r.operating_margin)?r.operating_margin:""}/>
              <KV label="Analyst View" val={!ni(r.analyst_view)?r.analyst_view:""}/>
              <KV label="Finance View" val={VIEW_LABEL[r.finance_view]||r.finance_view}/>
            </div>
            {(!ni(r.revenue_vs_prior)||!ni(r.revenue_vs_peers))&&(
              <div style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:8,padding:"13px 16px",marginBottom:10,boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
                <SH>Revenue Comparison</SH>
                <div style={{display:"flex",gap:24,flexWrap:"wrap"}}>
                  {!ni(r.revenue_vs_prior)&&<div><div style={{fontSize:10,color:C.mid,textTransform:"uppercase",letterSpacing:"0.08em",fontWeight:600,marginBottom:3}}>vs Prior Year</div><div style={{fontSize:14,fontWeight:600,color:C.ink}}>{r.revenue_vs_prior}</div></div>}
                  {!ni(r.revenue_vs_peers)&&<div><div style={{fontSize:10,color:C.mid,textTransform:"uppercase",letterSpacing:"0.08em",fontWeight:600,marginBottom:3}}>vs Sector Peers</div><div style={{fontSize:14,fontWeight:600,color:C.ink}}>{r.revenue_vs_peers}</div></div>}
                </div>
              </div>
            )}
            {r.financial_signals?.length>0&&(
              <div style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:8,padding:"12px 14px",marginBottom:10,boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
                <SH>Financial Signals</SH>
                <Blist items={r.financial_signals} col={C.warn}/>
              </div>
            )}
            {r.financial_summary&&(
              <div style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:8,padding:"12px 14px",boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
                <SH>Financial Summary</SH>
                <div style={{fontSize:13,color:C.slate,lineHeight:1.6}}>{r.financial_summary}</div>
              </div>
            )}
          </div>
        )}

        {tab==="rationale"&&(
          <div>
            {r.analytical_rationale&&(
              <div style={{background:"#1A1A2E",borderRadius:8,padding:"18px 22px",marginBottom:14}}>
                <div style={{fontSize:10,fontWeight:700,color:"rgba(255,255,255,0.55)",textTransform:"uppercase",letterSpacing:"0.12em",marginBottom:9}}>Board-Ready Analytical Rationale</div>
                <div style={{fontSize:15,color:"#fff",lineHeight:1.8,fontWeight:400}}>{r.analytical_rationale}</div>
              </div>
            )}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
              <AgentView label="Finance" view={r.finance_view} signals={r.financial_signals||[]} concerns={r.finance_concerns||[]}/>
              <AgentView label="Press" view={r.press_view} signals={r.press_signals||[]} concerns={r.press_concerns||[]}/>
              <AgentView label="Industry" view={r.industry_view} signals={r.industry_signals||[]} concerns={r.industry_concerns||[]}/>
            </div>
          </div>
        )}

        {tab==="qc"&&(
          <div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:12}}>
              <div style={{background:r.qc_score>=80?"#F0FDF4":r.qc_score>=50?"#FFFBEB":"#FEF2F2",border:`1px solid ${r.qc_score>=80?"#BBF7D0":r.qc_score>=50?"#FDE68A":"#FECACA"}`,borderRadius:7,padding:"13px",textAlign:"center"}}>
                <div style={{fontSize:9,color:C.mid,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:5}}>Data Completeness</div>
                <div style={{fontSize:32,fontWeight:800,color:r.qc_score>=80?C.ok:r.qc_score>=50?C.warn:C.red}}>{r.qc_score||0}%</div>
              </div>
              <div style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:7,padding:"13px",boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
                <div style={{fontSize:9,color:C.mid,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:5}}>QC Summary</div>
                <div style={{fontSize:13,color:C.ink,lineHeight:1.6}}>{r.qc_summary||"No QC summary available."}</div>
              </div>
              <div style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:7,padding:"13px",boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
                <div style={{fontSize:9,color:C.mid,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:5}}>Company Identity</div>
                <div style={{fontSize:13,fontWeight:700,color:r.validation_company==="correct"?C.ok:r.validation_company==="confused"?C.red:C.warn}}>{r.validation_company||"—"}</div>
                {r.validation_flags?.map((f,i)=><div key={i} style={{fontSize:10,color:C.red,marginTop:4}}>⚠ {f}</div>)}
              </div>
            </div>

            <div style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:8,padding:"13px 15px",marginBottom:10,boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
              <SH>Field Verification</SH>
              {[
                ["CEO Name",r.ceo_name,r.validation_ceo,r.validation_ceo_note],
                ["TSR Figures",`${r.tsr_1yr} / ${r.tsr_3yr}`,r.validation_tsr,r.validation_tsr_note],
                ["Revenue",r.revenue,r.validation_revenue,""],
                ["Prediction",r.prediction,r.validation_prediction,r.validation_prediction_note],
              ].map(([label,value,status,note],i)=>{
                const isGood=["correct","plausible","reasonable"].includes(status);
                const isBad=["incorrect","too_high","too_low","confused"].includes(status);
                return(
                  <div key={i} style={{display:"grid",gridTemplateColumns:"130px 1fr 110px",gap:8,padding:"9px 0",borderBottom:`1px solid ${C.border}`,alignItems:"start"}}>
                    <div style={{fontSize:13,fontWeight:600,color:C.ink}}>{label}</div>
                    <div>
                      <div style={{fontSize:13,color:C.ink}}>{value||"—"}</div>
                      {note&&<div style={{fontSize:10,color:C.mid,marginTop:2}}>{note}</div>}
                    </div>
                    <div style={{background:isGood?"#F0FDF4":isBad?"#FEF2F2":"#FFFBEB",borderRadius:3,padding:"3px 8px",fontSize:10,fontWeight:700,color:isGood?C.ok:isBad?C.red:C.warn,textAlign:"center"}}>{status||"—"}</div>
                  </div>
                );
              })}
            </div>

            {r.validation_missing?.length>0&&(
              <div style={{background:"#FFFBEB",border:"1px solid #FDE68A",borderRadius:8,padding:"12px 14px",marginBottom:10}}>
                <SH>Missing Critical Fields</SH>
                <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                  {r.validation_missing.map((f,i)=><span key={i} style={{background:"#FEF3C7",border:"1px solid #F59E0B",borderRadius:3,padding:"3px 8px",fontSize:10,color:"#92400E",fontWeight:600}}>{f}</span>)}
                </div>
              </div>
            )}

            {r.challenge_points?.length>0&&(
              <div style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:8,padding:"13px 15px",marginBottom:10,boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
                <SH>Prediction Challenge</SH>
                {r.prediction_revised&&(
                  <div style={{background:"#FEF2F2",border:"1px solid #FECACA",borderRadius:5,padding:"7px 11px",marginBottom:10,fontSize:11,color:C.red,fontWeight:600}}>
                    ⚠ Prediction was revised after challenge
                  </div>
                )}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                  <div>
                    <div style={{fontSize:10,fontWeight:700,color:C.red,textTransform:"uppercase",letterSpacing:"0.09em",marginBottom:7}}>Arguments Against</div>
                    {r.challenge_points.map((p,i)=><div key={i} style={{display:"flex",gap:7,marginBottom:7,fontSize:14,color:C.slate,alignItems:"flex-start",lineHeight:1.55}}><span style={{color:C.red,flexShrink:0,fontWeight:700}}>✗</span>{typeof p==="object"?JSON.stringify(p):String(p||"")}</div>)}
                  </div>
                  <div>
                    <div style={{fontSize:10,fontWeight:700,color:C.ok,textTransform:"uppercase",letterSpacing:"0.09em",marginBottom:7}}>Reasons It Still Holds</div>
                    {(r.overriding_factors||[]).map((p,i)=><div key={i} style={{display:"flex",gap:7,marginBottom:7,fontSize:14,color:C.slate,alignItems:"flex-start",lineHeight:1.55}}><span style={{color:C.ok,flexShrink:0,fontWeight:700}}>✓</span>{typeof p==="object"?JSON.stringify(p):String(p||"")}</div>)}
                  </div>
                </div>
                {r.challenge_summary&&(
                  <div style={{marginTop:10,padding:"9px 12px",background:"#F9F8F5",borderRadius:5,fontSize:13,color:C.ink,lineHeight:1.6,border:`1px solid ${C.border}`}}>
                    <strong>Challenge verdict:</strong> {r.challenge_summary}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}

// ── Company Row ───────────────────────────────────────────────────────────────
function CRow({r,idx,sel,onClick}){
  const isH=isHighPred(r.prediction);
  const [hov,setHov]=useState(false);
  return(
    <div onClick={onClick}
      onMouseEnter={()=>setHov(true)}
      onMouseLeave={()=>setHov(false)}
      style={{
        padding:"10px 14px",cursor:"pointer",
        borderBottom:`1px solid ${C.border}`,
        background:sel?"#FFF5F5":hov?"#FAFAFA":C.white,
        borderLeft:`3px solid ${sel?C.red:isH?"rgba(192,0,0,0.3)":"transparent"}`,
        transition:"all 0.12s"
      }}>
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        <div style={{width:24,height:24,borderRadius:5,background:isH?"rgba(192,0,0,0.08)":"#F3F4F6",color:isH?C.red:C.mid,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,flexShrink:0}}>{idx+1}</div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontWeight:600,fontSize:13,color:sel?C.red:C.ink,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{r.company}</div>
          <div style={{fontSize:11,color:C.mid,marginTop:2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{r.ceo_name||"—"}{r.ceo_tenure_years&&!ni(r.ceo_tenure_years)?` · ${r.ceo_tenure_years}yr`:""}{r.departed_ceo_name?` · prev: ${r.departed_ceo_name}`:""}</div>
        </div>
        <PredBadge pred={r.prediction} sm/>
      </div>
    </div>
  );
}

function PBar({v,t}){
  return(
    <div style={{background:"#E5E7EB",borderRadius:99,height:3,overflow:"hidden"}}>
      <div style={{height:"100%",width:`${(v/t)*100}%`,background:C.red,borderRadius:99,transition:"width 0.4s ease"}}/>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App(){
  const [iTab,setITab]=useState("manual");
  const [txt,setTxt]=useState("");
  const [fileCos,setFileCos]=useState([]);
  const [results,setResults]=useState([]);
  const [running,setRunning]=useState(false);
  const [prog,setProg]=useState({d:0,t:0});
  const [logs,setLogs]=useState([]);
  const [err,setErr]=useState("");
  const [sel,setSel]=useState(null);
  const [showIn,setShowIn]=useState(true);
  const fRef=useRef();

  useEffect(()=>{ injectGlobalStyle(); },[]);

  const handleFile=async e=>{
    const f=e.target.files[0]; if(!f) return;
    const isExcel = /\.(xlsx|xls|xlsm)$/i.test(f.name);
    try {
      if(isExcel){
        const XL   = await loadXLSX();
        const buf  = await f.arrayBuffer();
        const wb   = XL.read(new Uint8Array(buf));
        const ws   = wb.Sheets[wb.SheetNames[0]];
        const rows = XL.utils.sheet_to_json(ws, {header:1, defval:""});
        const header = rows[0]?.map(h=>String(h).toLowerCase().trim()) || [];
        const compIdx = header.findIndex(h=>h.includes("company")||h.includes("name"));
        const tickIdx = header.findIndex(h=>h.includes("ticker")||h.includes("symbol")||h.includes("tick"));
        const cI = compIdx>=0 ? compIdx : 0;
        const tI = tickIdx>=0 ? tickIdx : 1;
        const dataRows = compIdx>=0 ? rows.slice(1) : rows;
        setFileCos(dataRows.filter(r=>r[cI]&&String(r[cI]).toLowerCase()!=="company").map(r=>({company:String(r[cI]||"").trim(),ticker:String(r[tI]||"").trim()})).filter(r=>r.company).slice(0,100));
      } else {
        const t=await f.text();
        const rows=t.split("\n").map(r=>r.split(",").map(c=>c.trim().replace(/^"|"$/g,"")));
        setFileCos(rows.filter(r=>r[0]&&r[0].toLowerCase()!=="company").map(r=>({company:r[0],ticker:r[1]||""})).slice(0,100));
      }
    } catch(e){setErr("File parse error: "+e.message);}
  };

  const parseTxt=()=>txt.split("\n").map(l=>l.trim()).filter(Boolean).map(l=>{const p=l.split(",");return{company:p[0]?.trim(),ticker:p[1]?.trim()||""};}).filter(c=>c.company).slice(0,20);

  const run=async()=>{
    // ── Hard reset — wipe all state before starting a new run ────────────────
    // This clears React state, JS heap variables, and browser request cache
    // so every run starts completely from scratch with no residual data.
    setErr("");
    setResults([]);
    setLogs([]);
    setSel(null);
    setProg({d:0,t:0});

    // Force browser to discard any cached fetch responses for this session
    if (window.caches) {
      try {
        const keys = await window.caches.keys();
        await Promise.all(keys.map(k => window.caches.delete(k)));
      } catch {}
    }

    const cos=iTab==="manual"?parseTxt():fileCos;
    if(!cos.length){setErr("Enter at least one company.");return;}
    setRunning(true);setShowIn(false);setProg({d:0,t:cos.length});
    const out=[];
    for(let i=0;i<cos.length;i++){
      const{company,ticker}=cos[i];
      try{
        const res=await runPipeline(company,ticker,setLogs);
        out.push(res);setResults([...out]);
        if(i===0) setSel(0);
      }catch(e){
        setLogs(p=>[...p,`[${company}] ERROR: ${e.message}`]);
        out.push({company:cl(company,8),ticker:cl(ticker||"",6),prediction:"error",confidence:"low",analytical_rationale:"Error: "+e.message,ceo_name:"",departed_ceo_name:"",ceo_tenure_years:"",leadership_signals:[],financial_signals:[],press_signals:[],industry_signals:[],finance_concerns:[],press_concerns:[],industry_concerns:[]});
        setResults([...out]);
      }
      setProg({d:i+1,t:cos.length});
    }
    setRunning(false);
  };

  const ORDER={new_ceo_appointed:0,transition_underway:1,high_likelihood:2,medium_likelihood:3,low_likelihood:4,error:5};
  const sorted=[...results].sort((a,b)=>(ORDER[a.prediction]??5)-(ORDER[b.prediction]??5));
  const pc=results.reduce((a,r)=>{if(r.prediction)a[r.prediction]=(a[r.prediction]||0)+1;return a;},{});
  const selR=sel!=null?sorted[sel]:null;

  return(
    <div style={{position:"fixed",inset:0,display:"flex",flexDirection:"column",background:"#F5F4F0",fontFamily:"'Inter',system-ui,sans-serif",overflow:"hidden"}}>

      {/* NAV */}
      <div style={{background:C.red,flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 24px",height:54,gap:16}}>
          <div style={{display:"flex",alignItems:"center",gap:10,flexShrink:0}}>
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
              <rect width="28" height="28" rx="5" fill="rgba(255,255,255,0.15)"/>
              <rect x="6" y="17" width="3" height="6" rx="1" fill="white"/>
              <rect x="12" y="12" width="3" height="11" rx="1" fill="white"/>
              <rect x="18" y="7" width="3" height="16" rx="1" fill="white"/>
            </svg>
            <div>
              <div style={{fontSize:15,fontWeight:700,color:"#fff",letterSpacing:"-0.02em",lineHeight:1.2}}>CEO Succession Risk Analyzer</div>
              <div style={{fontSize:10.5,color:"rgba(255,255,255,0.65)",fontWeight:400}}>Bain &amp; Company · 6-agent self-correcting pipeline</div>
            </div>
          </div>

          <div style={{display:"flex",gap:3,flexWrap:"nowrap",flex:1,justifyContent:"center"}}>
            {[
              ["CEO Scan",          "Searches live web + model knowledge for CEO appointments, departures and named successors"],
              ["Profile Structuring","Builds full CEO profile with embedded QC — snapshots CEO name before QC mutation"],
              ["Finance",           "Analyses revenue vs peers, TSR, margins — embedded QC sanity-checks all figures"],
              ["Press",             "Identifies activist investors, proxy advisor criticism and regulatory probes"],
              ["Industry",          "Assesses sector disruption, M&A dynamics and competitive pressures"],
              ["Prediction",        "Hard rules first (incl. Rule 5b for completed transitions), then LLM scoring + self-challenge"],
            ].map(([l,tip],i)=>(
              <div key={l} title={tip} style={{fontSize:10,fontWeight:500,color:"rgba(255,255,255,0.75)",padding:"3px 8px",borderRadius:3,background:"rgba(0,0,0,0.15)",whiteSpace:"nowrap",cursor:"default"}}>{i+1}. {l}</div>
            ))}
          </div>

          <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
            {results.length>0&&!running&&(
              <div style={{display:"flex",gap:14,alignItems:"center",padding:"4px 14px",background:"rgba(0,0,0,0.15)",borderRadius:6}}>
                {[{l:"Total",v:results.length,c:"rgba(255,255,255,0.9)"},{l:"High+",v:(pc.new_ceo_appointed||0)+(pc.transition_underway||0)+(pc.high_likelihood||0),c:"#FFB3B3"},{l:"Medium",v:pc.medium_likelihood||0,c:"#FFD580"},{l:"Low",v:pc.low_likelihood||0,c:"#86EFAC"}].map(({l,v,c})=>(
                  <div key={l} style={{textAlign:"center"}}>
                    <div style={{fontSize:17,fontWeight:700,color:c,lineHeight:1}}>{v}</div>
                    <div style={{fontSize:9,color:"rgba(255,255,255,0.5)",fontWeight:500,textTransform:"uppercase",letterSpacing:"0.06em",marginTop:2}}>{l}</div>
                  </div>
                ))}
              </div>
            )}
            <button onClick={()=>setShowIn(x=>!x)} style={{background:"rgba(255,255,255,0.15)",border:"1px solid rgba(255,255,255,0.2)",color:"#fff",borderRadius:5,padding:"5px 12px",fontSize:11,fontWeight:500,cursor:"pointer",whiteSpace:"nowrap"}}>{showIn?"Hide Input":"New Analysis"}</button>
            {results.length>0&&!running&&(
              <button onClick={()=>exportToExcel(results)} style={{background:"#fff",border:"none",color:C.red,borderRadius:5,padding:"5px 12px",fontSize:11,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>↓ Export Excel</button>
            )}
          </div>
        </div>
      </div>

      {/* INPUT DRAWER */}
      {showIn&&(
        <div style={{background:C.white,borderBottom:`1px solid ${C.border}`,flexShrink:0,boxShadow:"0 1px 4px rgba(0,0,0,0.06)"}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr auto",alignItems:"stretch"}}>
            <div style={{borderRight:`1px solid ${C.border}`}}>
              <div style={{display:"flex",borderBottom:`1px solid ${C.border}`}}>
                {[["manual","Manual Entry"],["file","File Upload"]].map(([id,l])=>(
                  <button key={id} onClick={()=>setITab(id)} style={{padding:"8px 18px",border:"none",cursor:"pointer",fontSize:12,fontWeight:600,background:"transparent",color:iTab===id?C.red:C.mid,borderBottom:iTab===id?`2px solid ${C.red}`:"2px solid transparent"}}>{l}</button>
                ))}
              </div>
              <div style={{padding:"10px 16px",display:"flex",gap:12,alignItems:"center"}}>
                {iTab==="manual"?(
                  <>
                    <textarea value={txt} onChange={e=>setTxt(e.target.value)} rows={3}
                      placeholder={"Company Name, TICKER\nAnother Company, TICK\nThird Company, TIC"}
                      style={{flex:1,borderRadius:5,border:`1px solid ${C.border}`,padding:"8px 12px",fontSize:13,color:C.ink,background:C.white,fontFamily:"'Inter',monospace",resize:"none",lineHeight:1.6}}
                    />
                    <div style={{fontSize:12,color:C.mid,lineHeight:2,whiteSpace:"nowrap",flexShrink:0}}>One per line<br/>Name, TICKER<br/>Max 20</div>
                  </>
                ):(
                  <>
                    <div onClick={()=>fRef.current.click()}
                      style={{flex:1,border:`1.5px dashed #FECACA`,borderRadius:6,padding:"16px",textAlign:"center",cursor:"pointer",background:"#FEF2F2"}}
                      onMouseEnter={e=>e.currentTarget.style.borderColor=C.red}
                      onMouseLeave={e=>e.currentTarget.style.borderColor="#FECACA"}>
                      <div style={{fontSize:13,fontWeight:600,color:C.red,marginBottom:3}}>Upload CSV or Excel</div>
                      <div style={{fontSize:12,color:C.mid}}>.csv · .xlsx · .xls · .xlsm</div>
                      <input ref={fRef} type="file" accept=".csv,.xlsx,.xls,.xlsm" style={{display:"none"}} onChange={handleFile}/>
                    </div>
                    {fileCos.length>0&&<div style={{fontSize:13,color:C.ok,fontWeight:600,flexShrink:0}}>{fileCos.length} companies loaded</div>}
                  </>
                )}
                {err&&<div style={{fontSize:12,color:C.red,flexShrink:0}}>{err}</div>}
              </div>
            </div>
            <div style={{padding:"12px 16px",display:"flex",flexDirection:"column",justifyContent:"center",gap:8,minWidth:180,background:"#FAFAF8"}}>
              <button onClick={run} disabled={running} style={{padding:"11px 0",width:"100%",background:running?"#E8E5DF":C.red,color:running?C.mid:"#fff",border:"none",borderRadius:5,fontSize:14,fontWeight:700,cursor:running?"not-allowed":"pointer",boxShadow:running?"none":"0 2px 8px rgba(192,0,0,0.20)"}}>
                {running?`Running ${prog.d}/${prog.t}…`:"Run Pipeline"}
              </button>
              {running&&(
                <div>
                  <PBar v={prog.d} t={prog.t}/>
                  <div style={{fontSize:11,color:C.mid,marginTop:4,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{logs[logs.length-1]||""}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MAIN 2-COL */}
      <div style={{flex:1,display:"grid",gridTemplateColumns:sorted.length?"260px 1fr":"1fr",overflow:"hidden",minHeight:0}}>
        {sorted.length>0&&(
          <div style={{background:C.white,borderRight:`1px solid ${C.border}`,display:"flex",flexDirection:"column",overflow:"hidden"}}>
            <div style={{padding:"10px 14px",borderBottom:`1px solid ${C.border}`,background:C.white,flexShrink:0,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{fontSize:12,fontWeight:700,color:C.red,textTransform:"uppercase",letterSpacing:"0.08em"}}>{sorted.length} Companies</span>
              <span style={{fontSize:11,color:C.mid}}>by risk</span>
            </div>
            <div style={{flex:1,overflowY:"auto"}}>
              {sorted.map((r,i)=><CRow key={i} r={r} idx={i} sel={sel===i} onClick={()=>setSel(i)}/>)}
            </div>
          </div>
        )}

        <div style={{position:"relative",overflow:"hidden",display:"flex",flexDirection:"column",background:"#F8F9FA"}}>
          {selR?<Detail r={selR}/>:(
            <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:12}}>
              {sorted.length>0?(
                <>
                  <div style={{fontSize:22,color:"#D4D0CB"}}>&#8592;</div>
                  <div style={{fontSize:12,color:C.mid}}>Select a company to view analysis</div>
                </>
              ):(
                <div style={{textAlign:"center",maxWidth:500,padding:32}}>
                  <svg width="56" height="56" viewBox="0 0 56 56" fill="none" style={{margin:"0 auto 18px",display:"block"}}>
                    <rect width="56" height="56" rx="12" fill="#FEF2F2"/>
                    <circle cx="14" cy="28" r="5" fill="#FECACA"/>
                    <circle cx="28" cy="18" r="5" fill="#FCA5A5"/>
                    <circle cx="28" cy="38" r="5" fill="#FCA5A5"/>
                    <circle cx="42" cy="28" r="5" fill="#C00000"/>
                    <line x1="19" y1="26" x2="23" y2="20" stroke="#FECACA" strokeWidth="1.5"/>
                    <line x1="19" y1="30" x2="23" y2="36" stroke="#FECACA" strokeWidth="1.5"/>
                    <line x1="33" y1="20" x2="37" y2="26" stroke="#FCA5A5" strokeWidth="1.5"/>
                    <line x1="33" y1="36" x2="37" y2="30" stroke="#FCA5A5" strokeWidth="1.5"/>
                  </svg>
                  <div style={{fontSize:22,fontWeight:700,color:C.ink,marginBottom:8,letterSpacing:"-0.02em"}}>
                    CEO Succession Risk Analyzer
                  </div>
                  <div style={{fontSize:13,color:C.mid,lineHeight:1.8,marginBottom:22}}>
                    6-agent self-correcting pipeline — CEO Scan · Profile Structuring · Finance · Press · Industry · Prediction
                  </div>
                  {!showIn&&(
                    <button onClick={()=>setShowIn(true)} style={{padding:"11px 28px",background:C.red,color:"#fff",border:"none",borderRadius:5,fontSize:13,fontWeight:700,cursor:"pointer",boxShadow:"0 2px 12px rgba(163,0,0,0.28)"}}>Start Analysis</button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}