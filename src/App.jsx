// v7-agents build
import { useState, useRef, useEffect } from "react";
import * as XLSX from "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/xlsx.mjs";

// ── Global styles ─────────────────────────────────────────────────────────────
const injectGlobalStyle = () => {
  const s = document.createElement("style");
  s.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=DM+Serif+Display&display=swap');
    html,body,#root{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#F5F4F0;}
    *{box-sizing:border-box;font-family:'DM Sans',sans-serif;}
    ::-webkit-scrollbar{width:4px;}
    ::-webkit-scrollbar-track{background:#F0EEE9;}
    ::-webkit-scrollbar-thumb{background:#CC0000;border-radius:99px;}
    button:focus,textarea:focus,input:focus{outline:none;}
    button{font-family:'DM Sans',sans-serif;}
  `;
  document.head.appendChild(s);
};

const C = {
  // Bain red family
  red:"#CC0000", redD:"#A30000", redDD:"#6B0000",
  r04:"rgba(204,0,0,0.04)", r08:"rgba(204,0,0,0.08)",
  r15:"rgba(204,0,0,0.15)", r25:"rgba(204,0,0,0.25)",
  // Neutrals — warm off-white palette
  ink:"#1A1714",        // near-black text
  ink2:"#FFFFFF",       // sidebar / drawer bg
  ink3:"#F9F8F5",       // subtle off-white
  slate:"#3D3935",      // secondary text
  mid:"#6B6560",        // tertiary text / labels
  muted:"#B8B4AF",      // placeholder text
  pale:"#D4D0CB",       // borders
  // Surface
  surface:"#FFFFFF",
  surfaceAlt:"#F9F8F5",
  border:"#E8E5DF",
  borderStrong:"#D4D0CB",
  white:"#FFFFFF",
  // Semantic — keep green/amber only for data status, not UI chrome
  ok:"#1A6B3C", okBg:"rgba(26,107,60,0.07)",
  warn:"#8A5A00", warnBg:"rgba(138,90,0,0.07)",
  orange:"#B84400",
};

// ── FIXED: direct Portkey URL (no proxy needed) ───────────────────────────────
const PORTKEY_URL = "/api/chat/completions"; // proxied via vite → portkey.bain.dev
const PORTKEY_KEY = "2bayMIyF+J3J0aJtcc4i1HvrfLAS";
const MODEL       = "@ceo-coe/gpt-4o-search-preview";

// ── Helpers ───────────────────────────────────────────────────────────────────
const ni  = v => !v || String(v).toLowerCase().includes("not clearly");
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

const PRED_COLOR = {new_ceo_appointed:"#CC0000",transition_underway:"#CC0000",high_likelihood:"#CC0000",medium_likelihood:"#8A5A00",low_likelihood:"#1A6B3C"};
const PRED_LABEL = {new_ceo_appointed:"New CEO Appointed",transition_underway:"Transition Underway",high_likelihood:"High Likelihood",medium_likelihood:"Medium Likelihood",low_likelihood:"Low Likelihood"};
const OWN_LABEL  = {founder_ceo:"Founder CEO",family_ceo:"Family CEO",founder_family_control_non_ceo:"Family Control",government_controlled:"Gov. Controlled",state_owned_enterprise:"State-Owned",professionally_managed:"Prof. Managed",unclear:"Unclear"};
const VIEW_LABEL = {high_influence:"High Influence",medium_influence:"Medium Influence",weak_influence:"Weak Influence",no_clear_influence:"No Clear Influence"};
const VIEW_COLOR = {high_influence:"#CC0000",medium_influence:"#B84400",weak_influence:"#8A5A00",no_clear_influence:"#1A6B3C"};
const isHighPred = p => ["new_ceo_appointed","transition_underway","high_likelihood"].includes(p);
const rc = s => s>=8?"#CC0000":s>=6?"#B84400":s>=4?"#8A5A00":"#1A6B3C";

function parseJSON(text, fallback={}) {
  try { const s=text.indexOf("{"),e=text.lastIndexOf("}")+1; return s!==-1?JSON.parse(text.slice(s,e)):fallback; } catch{ return fallback; }
}

// Normalise any revenue string to "$XXbn" USD format
// Handles: €38.8bn, £5.2bn, ¥4.2tn, $391bn, $47.9bn, "47.9 billion", "391 billion USD"
const FX = { "€":1.08, "£":1.27, "¥":0.0067, "￥":0.0067, "A$":0.65, "C$":0.73, "CHF":1.12, "kr":0.093 };
function normaliseRevenue(s) {
  if(!s||ni(s)) return s;
  const raw = String(s).trim();
  // Extract currency symbol
  let fx = 1;
  for(const [sym,rate] of Object.entries(FX)){
    if(raw.startsWith(sym)||raw.includes(" "+sym)){fx=rate;break;}
  }
  // Extract numeric value
  const numMatch = raw.match(/([\d,.]+)\s*(trillion|tn|billion|bn|million|m|b)/i);
  if(!numMatch) return raw; // can't parse, return as-is
  const num = parseFloat(numMatch[1].replace(/,/g,""));
  const unit = numMatch[2].toLowerCase();
  let usdBn;
  if(unit==="trillion"||unit==="tn") usdBn = num * 1000 * fx;
  else if(unit==="billion"||unit==="bn"||unit==="b") usdBn = num * fx;
  else if(unit==="million"||unit==="m") usdBn = num / 1000 * fx;
  else return raw;
  // Format
  if(usdBn >= 1000) return `$${(usdBn/1000).toFixed(1)}tn`;
  if(usdBn >= 1)    return `$${usdBn.toFixed(1)}bn`;
  return `$${(usdBn*1000).toFixed(0)}m`;
}

// ── Portkey call ──────────────────────────────────────────────────────────────
async function callLLM(sys, usr, webSearch=false) {
  const body = {
    model: MODEL,
    messages: [{role:"system",content:sys},{role:"user",content:usr}],
    max_completion_tokens: 1024,
  };
  if(webSearch) {
    body.plugins = [{id:"webSearch"}];
  }
  const r = await fetch(PORTKEY_URL, {
    method:"POST",
    headers:{"Content-Type":"application/json","x-portkey-api-key":PORTKEY_KEY},
    body:JSON.stringify(body)
  });
  if(!r.ok) throw new Error(`Portkey ${r.status}: ${await r.text()}`);
  const d = await r.json();
  return d.choices?.[0]?.message?.content?.trim()||"";
}

// ── Financial Data Fetch — dedicated lookup for TSR, revenue, performance ────
async function fetchFinancialData(company, ticker) {
  const today = new Date().toDateString();
  const yr    = new Date().getFullYear();

  const prompt = `Today is ${today}. I need specific financial performance data for "${company}" (${ticker||""}).

IMPORTANT: Use your training knowledge. For well-known public companies you KNOW these numbers. Do not say "not available".

Answer each question with an actual number or percentage:

1. REVENUE: Latest annual revenue with year e.g. "$391bn FY2024"
2. TSR 1yr: 1-year total shareholder return to most recent data e.g. "+28%" or "-12%"
3. TSR 3yr: 3-year annualised TSR e.g. "+15% p.a." or "-4% p.a."
4. TSR VS SECTOR PEERS: Compared to sector median — above or below? Rough magnitude?
5. REVENUE GROWTH: Year-on-year revenue growth last 2 years — accelerating or slowing?
6. PROFITABILITY: Operating margin trend — expanding, stable, or contracting?
7. ANALYST VIEW: Current consensus — Buy/Hold/Sell? Any major recent downgrades?
8. KEY FINANCIAL RISK: What is the single biggest financial concern for this company right now?

For Apple (AAPL): You know revenue is ~$391bn, TSR has lagged vs mega-cap AI peers, etc.
For Microsoft (MSFT): You know revenue, strong cloud growth, TSR has been strong.
Give real numbers for any company you have knowledge of.`;

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

// ── Agent 1: CEO News — dual-call strategy (web search + model knowledge) ────
async function fetchCEONews(company) {
  const today = new Date().toDateString();
  const yr    = new Date().getFullYear();

  const sys = `You are a corporate intelligence expert. Today is ${today}.
Answer based on your most recent training knowledge.
If a CEO changed in ${yr} or ${yr-1}, that is the correct answer — not the previous CEO.`;

  const prompt = `Company: "${company}"

Answer ALL questions using your most up-to-date training knowledge:

Q1. CURRENT CEO: Who is the CEO of "${company}" right now? Full first and last name + start date.

Q2. SUCCESSOR ANNOUNCED: Has "${company}" publicly named a SPECIFIC PERSON as the NEXT/INCOMING CEO?
    This could be phrased as: "will succeed", "appointed as next CEO", "named as successor", "to take over as CEO"
    Yes/No. If yes: their FULL NAME, their current role, their confirmed start date.

Q3. CEO CHANGE IN ${yr} or ${yr-1}: Has there been an actual CEO change? Old name + new name + date.

Q4. DEPARTURE ANNOUNCED: Has the current CEO formally said they are leaving/retiring/stepping down?
    Yes/No. If yes: name, announcement date, effective date.

Q5. TRANSITION STATUS: Is a CEO transition currently underway or formally planned?

Examples of what to look for:
- Any announcement: "X will succeed Y as CEO", "X named as next CEO", "X appointed incoming CEO"
- Any press release, board announcement, or regulatory filing confirming a named successor
- Any transition plan where a specific person is confirmed to take over

ALWAYS check for successor announcements — this is the most important question like there is ceo annoucement for babcock ceo that is Harry Holt will be replacing David Lockwood and For apple Tim cook will step down and John Ternus will be the new ceo and PostNL has new ceo as well dont hallucinate deep dive dont miss edge cases like these these are some examples find similarly for other companies as well.`;

  // Always make both calls — plugin may or may not fire, model knowledge always works
  const results = [];
  try {
    const r1 = await callLLM(sys, prompt, true);
    if (r1 && r1.length > 30) results.push("SEARCH:\n" + r1);
  } catch {}
  try {
    const r2 = await callLLM(sys, prompt, false);
    if (r2 && r2.length > 30) results.push("KNOWLEDGE:\n" + r2);
  } catch {}
  return results.length ? results.join("\n\n---\n\n") : `No data found for ${company}.`;
}
// ── Agent 2: Research — build full CEO profile from news + training data ──────
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

CRITICAL RULES — READ BEFORE FILLING JSON:
1. The CEO News Context below is your PRIMARY source. It overrides your training data.
2. If the context says a CEO change happened in ${new Date().getFullYear()} or ${new Date().getFullYear()-1} — use the NEW CEO's name in ceo_name.
3. If a named successor is mentioned in the context — set incoming_ceo_announced="yes" and fill incoming_ceo_name with their FULL NAME.
4. If the old CEO stepped down — set ceo_departure_announced="yes".
5. Do NOT default to a long-tenured CEO if the context confirms they have been replaced.
6. If the news context confirms the CEO has changed, update ceo_name to the NEW CEO.
7. Use training knowledge for TSR, revenue, CEO age — do not return "not clearly inferable" for major public companies.

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

CURRENT CEO:
- Keep current CEO in ceo_name until their successor has actually STARTED
- If successor is only announced but not yet started → keep old CEO in ceo_name, set incoming fields

MAPPING RULES — extract from the news context above:

► ceo_departure_announced
  Set "yes" if the news mentions: CEO stepping down / retiring / leaving / being replaced / departure announced
  Set "no" otherwise

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
- ownership_category: founder_ceo | family_ceo | founder_family_control_non_ceo | government_controlled | state_owned_enterprise | professionally_managed | unclear
- ceo_departure_announced / incoming_ceo_announced: "yes" or "no" only
- revenue: USD ONLY, format $XXbn (billions) or $XXXm (millions) — always convert to USD, never use €/£/¥. USE YOUR KNOWLEDGE, do not return "not clearly inferable" for major public companies
- tsr_1yr / tsr_3yr: percentage e.g. "+12%" or "-8%" — USE YOUR KNOWLEDGE for well-known companies
- ceo_age: integer — USE YOUR KNOWLEDGE, do not return "not publicly disclosed" for well-known CEOs
- All list fields: max 4 items, 20 words each

CRITICAL: For major public companies (Apple, Microsoft, Airbus etc), you MUST use your training knowledge to fill revenue, TSR, CEO age. Do NOT return "not clearly inferable" for facts you know.`
  );

  const d = parseJSON(raw, fallback);

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

  return d;
}
// ── Agent 3: Finance (deep dive) ─────────────────────────────────────────────
async function agentFinance(data) {
  const fallback={view:"no_clear_influence",financial_facts:[],revenue:data.revenue||"not clearly inferable",signals:[],concerns:[]};
  const raw = await callLLM(
    `You are a senior equity research analyst specialising in CEO succession risk. Today is ${new Date().toDateString()}.
Your job is to do a DEEP financial analysis of this company and CEO, drawing on ALL your knowledge.
Be specific — cite actual figures, dates, and named events. Return ONLY valid JSON.`,

    `Company: ${data.company||""}  |  Ticker: ${data.ticker||""}  |  Sector: ${data.sector}
CEO: ${data.ceo_name}  |  Tenure: ${data.ceo_tenure_years} years  |  Ownership: ${data.ownership_category}

Known data from research agent:
Revenue: ${data.revenue}
TSR 1yr: ${data.tsr_1yr}  |  TSR 3yr: ${data.tsr_3yr}  |  TSR vs peers: ${data.tsr_vs_peers}
Financial signals from research: ${JSON.stringify(data.financial_signals)}

━━━ DEEP DIVE TASKS ━━━
1. REVENUE & GROWTH: What is this company's actual revenue? Revenue growth trend over 2-3 years?
2. PROFITABILITY: Are margins expanding or contracting? Any profit warnings or earnings misses?
3. TSR PERFORMANCE: What is the actual TSR 1yr and 3yr? How does it compare to sector peers?
4. BALANCE SHEET: Any leverage concerns, debt rating changes, or liquidity issues?
5. ANALYST SENTIMENT: Any recent analyst downgrades, price target cuts, or sell ratings?
6. SHAREHOLDER RETURNS: Dividend cuts, buyback suspensions, or capital allocation concerns?
7. CEO ACCOUNTABILITY: Is the CEO directly blamed by investors or analysts for underperformance?

Return this JSON:
{
  "view": "",
  "revenue": "",
  "tsr_1yr": "",
  "tsr_3yr": "",
  "tsr_vs_peers": "",
  "financial_facts": [],
  "signals": [],
  "concerns": []
}

view: high_influence | medium_influence | weak_influence | no_clear_influence
  • high_influence: sustained TSR underperformance, major earnings misses, CEO blamed for financial failures
  • medium_influence: moderate underperformance, mixed results, some analyst concern
  • weak_influence: one-off miss, generally solid performance
  • no_clear_influence: strong financial performance, no pressure

financial_facts: up to 4 items — SPECIFIC figures e.g. "Revenue $28bn FY2024, up 4% YoY", "TSR -12% vs sector median +8% over 3 years"
signals: up to 3 SPECIFIC financial pressure signals with actual numbers
concerns: up to 2 concrete financial risks that could accelerate CEO change
revenue: USD only, format as $XXbn (billions) — always convert non-USD currencies to USD. Use actual figure if known.
tsr_1yr / tsr_3yr: use actual % if known
tsr_vs_peers: "above median", "below median", or specific figure
⚠ Every item must be factual and specific. No generic observations.
⚠ For major public companies, USE YOUR TRAINING KNOWLEDGE to fill in actual TSR and revenue figures.
   Do NOT return "not clearly inferable" for Apple, Microsoft, Airbus, ArcelorMittal etc — you know these numbers.`
  );
  const r = parseJSON(raw, fallback);
  r.view = cl(r.view||"no_clear_influence", 3);
  r.financial_facts = lst(r.financial_facts, 4, 25);
  r.signals = lst(r.signals, 3, 25);
  r.concerns = lst(r.concerns, 2, 25);
  r.revenue = normaliseRevenue(cl(r.revenue||data.revenue||"not clearly inferable", 10)||"not clearly inferable");
  r.tsr_1yr = cl(r.tsr_1yr||data.tsr_1yr||"not clearly inferable", 8)||data.tsr_1yr||"not clearly inferable";
  r.tsr_3yr = cl(r.tsr_3yr||data.tsr_3yr||"not clearly inferable", 8)||data.tsr_3yr||"not clearly inferable";
  r.tsr_vs_peers = cl(r.tsr_vs_peers||data.tsr_vs_peers||"not clearly inferable", 10)||data.tsr_vs_peers||"not clearly inferable";
  return r;
}

// ── Agent 4: Press & Activism (deep dive) ───────────────────────────────────
async function agentPress(data) {
  const fallback = {
    view:"no_clear_influence", signals:[], concerns:[],
    controversies:[], investor_activism:"None identified"
  };

  const raw = await callLLM(
    `You are a senior governance analyst and investor relations expert. Today is ${new Date().toDateString()}.
Do a DEEP DIVE on external pressure signals for this company and CEO.
Draw on your full knowledge of activist campaigns, proxy battles, shareholder letters, and press coverage.
Return ONLY valid JSON.`,

    `Company: ${data.company||""}  |  Ticker: ${data.ticker||""}  |  Sector: ${data.sector}
CEO: ${data.ceo_name}  |  Age: ${data.ceo_age}  |  Tenure: ${data.ceo_tenure_years} years
TSR 1yr: ${data.tsr_1yr}  |  TSR vs peers: ${data.tsr_vs_peers}  |  Revenue: ${data.revenue}
Known activist data: ${data.activist_investors}
Known press signals: ${JSON.stringify(data.press_activism_signals)}
IMPORTANT: Use your full training knowledge about this specific company. Search for any known activist campaigns, controversies, or governance issues for ${data.company||""} (${data.ticker||""}).

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
  • high_influence: active named activist with CEO change demand, regulatory probe, proxy battle, major scandal
  • medium_influence: proxy advisor criticism, compensation controversy, governance concerns from named investor
  • weak_influence: one-off press criticism, minor governance question
  • no_clear_influence: no notable external pressure found

signals: up to 4 items — SPECIFIC and NAMED e.g. "Elliott Management disclosed 8.5% stake Nov 2023 demanding strategic review", "ISS recommended against CEO pay package at 2024 AGM"
concerns: up to 3 concrete external pressure risks
controversies: up to 4 named events — lawsuits, regulatory probes, activist letters, public disputes
investor_activism: full summary of any named activist position and demands, or "None identified"

⚠ CRITICAL: Every item must name a specific fund, person, regulator, or event. If nothing specific is known, return empty arrays — do NOT invent generic observations.`
  );

  const r = parseJSON(raw, fallback);
  r.view = cl(r.view||"no_clear_influence", 3);
  // Normalise — flatten any objects to strings before processing
  const toStr = arr => (Array.isArray(arr)?arr:[]).map(x => typeof x === "object" ? JSON.stringify(x) : String(x||"")).filter(Boolean);
  r.signals      = lst(toStr(r.signals), 4, 25);
  r.concerns     = lst(toStr(r.concerns), 3, 25);
  r.controversies= lst(toStr(r.controversies), 4, 25);
  r.investor_activism = cl(r.investor_activism||"None identified", 20)||"None identified";

  // Strip boilerplate
  const generic = ["typical for","no credible","no major","not identified","no report","governance scrutiny","generally","standard"];
  const isGeneric = s => generic.some(p => s.toLowerCase().includes(p));
  r.signals      = r.signals.filter(s => !isGeneric(s));
  r.concerns     = r.concerns.filter(s => !isGeneric(s));
  r.controversies= r.controversies.filter(s => !isGeneric(s));

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
signals: up to 3 SPECIFIC industry dynamics affecting this CEO's tenure (e.g. "AI disruption forcing strategic pivot", "Regulatory pressure on advertising model")
concerns: up to 2 specific risks
⚠ Be specific to this company and sector — no generic observations.`
  );

  const r = parseJSON(raw, fallback);
  r.view     = cl(r.view||"no_clear_influence", 3);
  r.signals  = lst(r.signals, 3, 20);
  r.concerns = lst(r.concerns, 2, 20);
  return r;
}

// ── Agent 6: Prediction — final board-ready risk verdict ─────────────────────
async function agentPrediction(data, finance, press, industry) {
  const fallback = { prediction:"low_likelihood", confidence:"low", analytical_rationale:"" };

  // ── HARD CODE OVERRIDES — no LLM needed, answer is deterministic ─────────
  const isFamily = ["founder_ceo","family_ceo","founder_family_control_non_ceo"].includes(data.ownership_category);

  // Rule 1: Family/founder CEO → ALWAYS Low unless there is solid hard proof of change
  // Solid proof means: formal departure announcement OR confirmed incoming CEO
  // Activist investors, press signals, TSR underperformance — none of these override the family rule
  // Only a publicly confirmed departure or named successor can change this
  const solidProofOfChange = (
    data.ceo_departure_announced === "yes" ||
    data.incoming_ceo_announced === "yes"
  );

  if (isFamily && !solidProofOfChange) {
    return {
      prediction: "low_likelihood",
      confidence: "high",
      analytical_rationale: `${data.ceo_name} leads a ${OWN_LABEL[data.ownership_category]||"family/founder-controlled"} company. Family and founder-controlled businesses manage succession internally — departure decisions are not driven by external pressure, analyst opinion, or TSR performance. Unless a formal departure or named successor is publicly confirmed, succession risk remains structurally low.`
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
      analytical_rationale: `${data.ceo_name} has formally announced departure. Named successor: ${succ}${bg}.${dt} The CEO transition is confirmed and actively underway. Investors should monitor strategic continuity under incoming leadership.`
    };
  }

  // Rule 3: Departure announced but no named successor yet → High Likelihood
  if (data.ceo_departure_announced === "yes") {
    return {
      prediction: "high_likelihood",
      confidence: "high",
      analytical_rationale: `${data.ceo_name} has formally announced departure from ${data.sector||"the company"}. A successor has not yet been publicly named. A CEO change is confirmed — timing and successor identity remain uncertain. This represents elevated transition risk for investors.`
    };
  }

  // Rule 4: Incoming CEO already announced (even without formal departure) → Transition Underway
  if (data.incoming_ceo_announced === "yes") {
    const succ = data.incoming_ceo_name && data.incoming_ceo_name !== "N/A" ? data.incoming_ceo_name : "a named successor";
    const bg   = data.incoming_ceo_background && data.incoming_ceo_background !== "N/A" ? ` (${data.incoming_ceo_background})` : "";
    return {
      prediction: "transition_underway",
      confidence: "high",
      analytical_rationale: `A named CEO successor has been publicly announced: ${succ}${bg}. The transition is confirmed and underway. Board has completed its succession planning process.`
    };
  }

  // Rule 5: Very short tenure → New CEO recently appointed
  const tenureNum = parseFloat(String(data.ceo_tenure_years).replace("~",""));
  if (!isNaN(tenureNum) && tenureNum < 1.0) {
    return {
      prediction: "new_ceo_appointed",
      confidence: "high",
      analytical_rationale: `${data.ceo_name} was recently appointed as CEO with only ${data.ceo_tenure_years} years in the role. This reflects a recent leadership change at the company. Succession risk is currently low given the fresh appointment.`
    };
  }

  // ── LLM SCORING — for all other non-obvious cases ────────────────────────
  const age = parseInt(data.ceo_age) || 0;
  const ten = tenureNum || 0;

  const raw = await callLLM(
    `You are a CEO succession risk expert. Today is ${new Date().toDateString()}.
Assess the succession risk level based on the data provided.
Be accurate and calibrated. Do NOT use age >= 65 as a standalone trigger — it was removed.
Do NOT mention age >= 65 as a classification rule in the rationale.
Return ONLY valid JSON, no extra text.`,

    `━━━ COMPANY DATA ━━━
Company: ${data.company||""}
Sector: ${data.sector}
Ownership: ${data.ownership_category}

━━━ CEO PROFILE ━━━
Name: ${data.ceo_name}
Age: ${data.ceo_age}
Tenure: ${data.ceo_tenure_years} years  (started: ${data.ceo_start_date})
Founder status: ${data.founder_status||"not founder"}

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
1. age >= 63 AND tenure >= 8                     → high_likelihood
2. TWO OR MORE of these signals present:
   • activist investor present with named demands
   • TSR significantly below sector peers
   • tenure >= 8 years AND signals of board restlessness
   • contract expires within 12 months with no renewal indication
   • age >= 60 AND multiple other signals
   • major scandal or regulatory probe
   • COO/President appointed as clear named heir apparent
   • board recently refreshed suggesting change agenda
   • mandate signals indicating limited remaining term
                                                 → high_likelihood
3. ONE of these signals:
   • tenure 5–8 years with some underperformance
   • mild TSR underperformance vs peers
   • contract expiry in 1–2 years
   • age 58–62 with no strong retention signals
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
  return r;
}
// ── Agent 7: Validation & QC ─────────────────────────────────────────────────
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
   - Cross-check against your most recent knowledge of CEO changes.
   - If a new CEO has already started, flag the old name as "incorrect".

2. SUCCESSOR CHECK (CRITICAL): Has ${company} publicly announced a named successor/incoming CEO?
   - Search your full knowledge for any named successor announcement for this specific company.
   - Look for: board announcements, press releases, regulatory filings, news articles naming a specific person.
   - If a named successor exists and incoming_ceo_name is "N/A", flag it and provide the correct name.
3. TENURE: Does the tenure of ${data.ceo_tenure_years} years match the start date ${data.ceo_start_date}? Is this plausible?
4. TSR: Are the TSR figures (${data.tsr_1yr}, ${data.tsr_3yr}) plausible for ${company} in the current period?
5. REVENUE: Is ${data.revenue} a plausible revenue figure for ${company}?
6. ACTIVIST: Is the activist investor data (${data.activist_investors}) accurate to your knowledge?
7. PREDICTION: Given everything you know about ${company}, does the prediction of ${pred.prediction} seem reasonable?
   - If a successor has been named but incoming_ceo_announced is "no", the prediction should be "transition_underway".
8. MISSING DATA: Which important fields are blank or "not clearly inferable" that should have data?
9. COMPANY IDENTITY: Is this actually ${company} or could the model have confused it with another company?

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
}

missing_critical_fields: list fields that returned "not clearly inferable" but should be available
flags: list any specific concerns e.g. "CEO name appears to be from a different company", "TSR figures seem inconsistent"
data_completeness_score: 0-100, how complete is the data overall
qc_summary: 2-3 sentence plain English summary of data quality and any concerns`
  );

  const r = parseJSON(raw, fallback);
  r.flags = lst(r.flags, 5, 30);
  r.missing_critical_fields = lst(r.missing_critical_fields, 8, 15);
  r.qc_summary = cl(r.qc_summary||"", 60);
  r.data_completeness_score = parseInt(r.data_completeness_score)||0;
  return r;
}

// ── Agent 8: Challenge — argues AGAINST the prediction to find weaknesses ────
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

━━━ YOUR TASKS ━━━

STEP 1 — ARGUE AGAINST THE PREDICTION:
What specific evidence or facts CONTRADICT the prediction of "${pred.prediction}"?
- If predicted High: what retention signals, contract renewals, or strong performance data suggest LOW risk?
- If predicted Low: what age, tenure, performance, or activist signals suggest HIGHER risk?
- If predicted Transition: is there any evidence the transition might not happen?

STEP 2 — WHAT WAS MISSED?
What important context about ${company} and ${data.ceo_name} might the research have missed?
Think about: board dynamics, peer comparisons, sector norms, recent news, contract details.

STEP 3 — SHOULD THE PREDICTION BE REVISED?
Given the challenges above, is the original prediction still the best call?
Or should it be revised up or down?

Return this JSON:
{
  "challenge_points": [],
  "overriding_factors": [],
  "revised_confidence": "",
  "should_revise": false,
  "revised_prediction": "",
  "challenge_summary": ""
}

challenge_points: up to 4 specific reasons the prediction COULD BE WRONG — cite actual facts
overriding_factors: up to 3 reasons the original prediction is STILL correct despite challenges
revised_confidence: "high" | "medium" | "low" — how confident after challenge
should_revise: true if the prediction should change, false if it holds
revised_prediction: the prediction after challenge — can be same or different
challenge_summary: 2-3 sentences summarising the challenge and final verdict`
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
  log(p=>[...p,`[${company}] 🔍 Fetching live CEO news...`]);
  const webCtx = await fetchCEONews(company);
  log(p=>[...p,`[${company}] 💹 Fetching financial data...`]);
  const finCtx = await fetchFinancialData(company, ticker);
  log(p=>[...p,`[${company}] 📊 Research agent...`]);
  const data = await agentResearch(company, ticker, webCtx + "\n\nFINANCIAL DATA:\n" + finCtx);
  if(data.incoming_ceo_announced==="yes") log(p=>[...p,`[${company}] ⚡ Incoming CEO: ${data.incoming_ceo_name}`]);
  if(data.ceo_departure_announced==="yes") log(p=>[...p,`[${company}] ⚠ CEO departure announced`]);
  log(p=>[...p,`[${company}] 💰 Finance agent...`]);
  const finance = await agentFinance(data);
  log(p=>[...p,`[${company}] 📰 Press agent...`]);
  const press = await agentPress(data);
  log(p=>[...p,`[${company}] 🏭 Industry agent...`]);
  const industry = await agentIndustry(data);
  log(p=>[...p,`[${company}] 🎯 Prediction agent...`]);
  const pred = await agentPrediction(data, finance, press, industry);
  log(p=>[...p,`[${company}] 🔴 Challenging prediction...`]);
  const challenge = await agentChallenge(company, data, pred, finance, press);
  // If challenge recommends revision, update the prediction
  const finalPred = challenge.should_revise ? {
    ...pred,
    prediction: challenge.revised_prediction,
    confidence: challenge.revised_confidence,
    analytical_rationale: pred.analytical_rationale + " [Post-challenge revision: " + challenge.challenge_summary + "]"
  } : pred;
  log(p=>[...p,`[${company}] ✅ Validating & QC checking...`]);
  const validation = await agentValidation(company, ticker, data, finance, press, finalPred);
  if (validation.ceo_name_verified === "incorrect") {
    data.ceo_name = data.ceo_name + " ⚠";
  }
  // If validation found a successor that research missed — apply it
  if (validation.successor_found && validation.successor_name &&
      (data.incoming_ceo_name === "N/A" || !data.incoming_ceo_name)) {
    data.incoming_ceo_name = validation.successor_name;
    data.incoming_ceo_announced = "yes";
    finalPred.prediction = "transition_underway";
    finalPred.confidence = "high";
    log(p=>[...p,`[${company}] ⚡ Successor found by validation: ${validation.successor_name}`]);
  }
  log(p=>[...p,`[${company}] ✓ Complete (QC: ${validation.data_completeness_score}% | ${challenge.should_revise?"Prediction revised":"Prediction held"})`]);
  return {
    company:cl(company,8), ticker:cl(ticker||"",6),
    sector:data.sector, ceo_name:data.ceo_name, ceo_age:data.ceo_age,
    ceo_start_date:data.ceo_start_date, ceo_tenure_years:data.ceo_tenure_years,
    founder_status:data.founder_status, ownership_category:data.ownership_category,
    ceo_departure_announced:data.ceo_departure_announced, incoming_ceo_announced:data.incoming_ceo_announced,
    incoming_ceo_name:data.incoming_ceo_name, incoming_ceo_background:data.incoming_ceo_background,
    incoming_ceo_start_date:data.incoming_ceo_start_date,
    prediction:pred.prediction, confidence:pred.confidence, analytical_rationale:pred.analytical_rationale,
    revenue:normaliseRevenue(finance.revenue||data.revenue),
    financial_summary:Array.isArray(finance.financial_facts)?finance.financial_facts.filter(Boolean).join(" | "):String(finance.financial_facts||""),
    // TSR: prefer finance agent enrichment over research agent (finance does deeper lookup)
    tsr_1yr:   (finance.tsr_1yr   &&!finance.tsr_1yr.includes("inferable"))   ? finance.tsr_1yr   : data.tsr_1yr,
    tsr_3yr:   (finance.tsr_3yr   &&!finance.tsr_3yr.includes("inferable"))   ? finance.tsr_3yr   : data.tsr_3yr,
    tsr_vs_peers:(finance.tsr_vs_peers&&!finance.tsr_vs_peers.includes("inferable"))? finance.tsr_vs_peers: data.tsr_vs_peers,
    ceo_contract_expiry:data.ceo_contract_expiry, contract_renewed:data.contract_renewed,
    succession_plan_disclosed:data.succession_plan_disclosed, coo_or_president_appointed:data.coo_or_president_appointed,
    board_refreshed_2yr:data.board_refreshed_2yr, activist_investors:data.activist_investors,
    press_controversies:joinCompact(press.controversies," | ",30),
    investor_activism:press.investor_activism, mandate_signals:data.mandate_signals,
    // Signals — from distinct agent sources
    key_risks: lst(data.press_activism_signals, 4, 25),
    mitigating_factors: lst(finance.signals.length>0 ? finance.signals : [], 3, 25),
    succession_signals: lst(data.leadership_signals, 4, 20),
    // Raw agent signals
    leadership_signals: data.leadership_signals,  // research agent — richest contextual signals
    financial_signals: data.financial_signals,
    press_signals:press.signals, industry_signals:industry.signals,
    finance_view:finance.view, press_view:press.view, industry_view:industry.view,
    finance_concerns:finance.concerns, press_concerns:press.concerns, industry_concerns:industry.concerns,
    // Extra insight fields
    performance_trajectory:data.performance_trajectory||"",
    m_and_a_activity:data.m_and_a_activity||"",
    regulatory_scrutiny:data.regulatory_scrutiny||"",
    investor_impact:pred.investor_impact||"",
    successor_found_by_validation: validation.successor_found||false,
    // Challenge agent
    challenge_points:     challenge.challenge_points||[],
    overriding_factors:   challenge.overriding_factors||[],
    challenge_summary:    challenge.challenge_summary||"",
    prediction_revised:   challenge.should_revise||false,
    // Validation & QC
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

// ── Export to Excel ──────────────────────────────────────────────────────────
function exportToExcel(results) {
  const PRED_LABEL_MAP = {
    new_ceo_appointed:"New CEO Appointed", transition_underway:"Transition Underway",
    high_likelihood:"High Likelihood", medium_likelihood:"Medium Likelihood",
    low_likelihood:"Low Likelihood"
  };

  const cols = [
    { key:"company",              label:"Company"                        },
    { key:"ticker",               label:"Ticker"                         },
    { key:"sector",               label:"Sector"                         },
    { key:"ownership_category",   label:"Ownership Type"                 },
    { key:"ceo_name",             label:"CEO Name"                       },
    { key:"ceo_age",              label:"CEO Age"                        },
    { key:"ceo_start_date",       label:"CEO Start Date"                 },
    { key:"ceo_tenure_years",     label:"CEO Tenure (Years)"             },
    { key:"founder_status",       label:"Founder Status"                 },
    { key:"ceo_departure_announced", label:"Departure Announced"         },
    { key:"incoming_ceo_announced",  label:"Successor Announced"         },
    { key:"incoming_ceo_name",       label:"Incoming CEO Name"           },
    { key:"incoming_ceo_background", label:"Incoming CEO Background"     },
    { key:"incoming_ceo_start_date", label:"Incoming CEO Start Date"     },
    { key:"prediction",           label:"Prediction",        fmt: v => PRED_LABEL_MAP[v]||v },
    { key:"confidence",           label:"Confidence"                     },
    { key:"investor_impact",      label:"Investor Impact"                },
    { key:"analytical_rationale", label:"Board-Ready Rationale"          },
    { key:"revenue",              label:"Revenue"                        },
    { key:"tsr_1yr",              label:"TSR 1yr"                        },
    { key:"tsr_3yr",              label:"TSR 3yr"                        },
    { key:"tsr_vs_peers",         label:"TSR vs Peers"                   },
    { key:"financial_summary",    label:"Financial Summary"              },
    { key:"ceo_contract_expiry",  label:"Contract Expiry"                },
    { key:"contract_renewed",     label:"Contract Renewed"               },
    { key:"succession_plan_disclosed", label:"Succession Plan"           },
    { key:"coo_or_president_appointed", label:"COO / President Appointed"},
    { key:"board_refreshed_2yr",  label:"Board Refreshed (2yr)"          },
    { key:"activist_investors",   label:"Activist Investors"             },
    { key:"investor_activism",    label:"Activism Detail"                },
    { key:"mandate_signals",      label:"Mandate Signals"                },
    { key:"finance_view",         label:"Finance Agent View"             },
    { key:"press_view",           label:"Press Agent View"               },
    { key:"industry_view",        label:"Industry Agent View"            },
    { key:"press_controversies",  label:"Press Controversies"            },
    { key:"leadership_signals",   label:"Leadership Signals",  fmt: v => Array.isArray(v)?v.join(" | "):v },
    { key:"financial_signals",    label:"Financial Signals",   fmt: v => Array.isArray(v)?v.join(" | "):v },
    { key:"press_signals",        label:"Press Signals",       fmt: v => Array.isArray(v)?v.join(" | "):v },
    { key:"industry_signals",     label:"Industry Signals",    fmt: v => Array.isArray(v)?v.join(" | "):v },
    { key:"finance_concerns",     label:"Finance Concerns",    fmt: v => Array.isArray(v)?v.join(" | "):v },
    { key:"press_concerns",       label:"Press Concerns",      fmt: v => Array.isArray(v)?v.join(" | "):v },
    { key:"industry_concerns",    label:"Industry Concerns",   fmt: v => Array.isArray(v)?v.join(" | "):v },
    { key:"qc_score",              label:"QC Completeness Score"                },
    { key:"qc_summary",            label:"QC Summary"                           },
    { key:"validation_ceo",        label:"CEO Name Verified"                    },
    { key:"validation_ceo_note",   label:"CEO Verification Note"                },
    { key:"validation_tsr",        label:"TSR Verified"                         },
    { key:"validation_tsr_note",   label:"TSR Note"                             },
    { key:"validation_revenue",    label:"Revenue Verified"                     },
    { key:"validation_prediction", label:"Prediction QC"                        },
    { key:"validation_prediction_note", label:"Prediction QC Note"              },
    { key:"validation_company",    label:"Company Identity Check"               },
    { key:"validation_flags",      label:"QC Flags",  fmt: v => Array.isArray(v)?v.join(" | "):v },
    { key:"validation_missing",    label:"Missing Fields", fmt: v => Array.isArray(v)?v.join(", "):v },
    { key:"challenge_points",      label:"Challenge Points",    fmt: v => Array.isArray(v)?v.join(" | "):v },
    { key:"overriding_factors",    label:"Overriding Factors",  fmt: v => Array.isArray(v)?v.join(" | "):v },
    { key:"challenge_summary",     label:"Challenge Summary"                        },
    { key:"prediction_revised",    label:"Prediction Revised?", fmt: v => v?"Yes":"No" },
  ];

  const flatten = v => {
    if (Array.isArray(v)) return v.map(i => typeof i === "object" ? JSON.stringify(i) : String(i)).join(" | ");
    if (typeof v === "object" && v !== null) return JSON.stringify(v);
    return String(v ?? "");
  };
  const escape = v => {
    const s = flatten(v).replace(/"/g, '""');
    return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s}"` : s;
  };

  const header = cols.map(c => escape(c.label)).join(",");
  const rows = results.map(r =>
    cols.map(c => {
      const raw = r[c.key] ?? "";
      const val = c.fmt ? c.fmt(raw) : raw;
      return escape(val);
    }).join(",")
  );

  const csv = [header, ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `CEO_Succession_Analysis_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
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
      <div style={{width:3,height:12,background:C.red,borderRadius:1,flexShrink:0}}/>
      <span style={{fontSize:10,fontWeight:700,color:C.ink,textTransform:"uppercase",letterSpacing:"0.12em"}}>{children}</span>
    </div>
  );
}

function KV({label,val,hi=false}){
  if(!val||val==="N/A"||ni(val)) return null;
  return(
    <div style={{
      background: hi?"#FEF2F2":C.white,
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
  // Safe string render — prevent [object Object]
  const safeStr = v => (v && typeof v === "object") ? JSON.stringify(v) : String(v||"");
  return(
    <div style={{
      background:C.white,
      border:`1px solid ${isHigh?"#FECACA":C.border}`,
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
  // Header: red gradient for high risk, deep charcoal for others
  const hdrBg = isHigh
    ? `linear-gradient(135deg,${C.redD},${C.red})`
    : `linear-gradient(135deg,#1A1714,#2C2825)`;
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

      {/* ── Header ── */}
      <div style={{background:hdrBg,padding:"16px 22px 14px",flexShrink:0,position:"relative",overflow:"hidden"}}>
        {/* Subtle decorative circle */}
        <div style={{position:"absolute",right:-30,top:-30,width:160,height:160,borderRadius:"50%",background:"rgba(255,255,255,0.03)",pointerEvents:"none"}}/>

        <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:14,marginBottom:10}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:24,fontWeight:700,color:"#fff",letterSpacing:"-0.02em",lineHeight:1.1,fontFamily:"'DM Serif Display',serif"}}>{r.company}</div>
            <div style={{display:"flex",gap:8,marginTop:5,flexWrap:"wrap",alignItems:"center"}}>
              {r.ticker&&<span style={{fontSize:11,color:"rgba(255,255,255,0.5)",fontFamily:"monospace",background:"rgba(255,255,255,0.1)",padding:"2px 7px",borderRadius:3}}>{r.ticker}</span>}
              {r.sector&&<span style={{fontSize:11,color:"rgba(255,255,255,0.55)"}}>{r.sector}</span>}
              {r.ownership_category&&r.ownership_category!=="unclear"&&(
                <span style={{fontSize:10,color:"rgba(255,255,255,0.38)",background:"rgba(255,255,255,0.07)",padding:"1px 6px",borderRadius:2}}>{OWN_LABEL[r.ownership_category]||r.ownership_category}</span>
              )}
            </div>
          </div>
          <div style={{textAlign:"right",flexShrink:0}}>
            <PredBadge pred={r.prediction}/>
            <div style={{fontSize:10,color:"rgba(255,255,255,0.45)",marginTop:5}}>
              Confidence: <strong style={{color:"rgba(255,255,255,0.8)"}}>{r.confidence||"—"}</strong>
            </div>
          </div>
        </div>

        {/* CEO data strip */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",background:"rgba(0,0,0,0.22)",borderRadius:5,overflow:"hidden",border:"1px solid rgba(255,255,255,0.06)"}}>
          {[
            ["CEO",r.ceo_name],
            ["Age",!ni(r.ceo_age)?r.ceo_age:"—"],
            ["Tenure",r.ceo_tenure_years?`${r.ceo_tenure_years}yr`:"—"],
            ["Successor",r.incoming_ceo_announced==="yes"&&r.incoming_ceo_name&&r.incoming_ceo_name!=="N/A"?r.incoming_ceo_name:"—"],
            ["TSR 1yr",!ni(r.tsr_1yr)?r.tsr_1yr:"—"]
          ].map(([l,v],i,a)=>(
            <div key={l} style={{padding:"8px 10px",borderRight:i<a.length-1?"1px solid rgba(255,255,255,0.07)":"none"}}>
              <div style={{fontSize:9,color:"rgba(255,255,255,0.4)",textTransform:"uppercase",letterSpacing:"0.1em",fontWeight:600,marginBottom:3}}>{l}</div>
              <div style={{fontSize:13,fontWeight:700,color:"#fff",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{v||"—"}</div>
            </div>
          ))}
        </div>

        {/* Successor alert */}
        {r.incoming_ceo_announced==="yes"&&r.incoming_ceo_name&&r.incoming_ceo_name!=="N/A"&&(
          <div style={{marginTop:8,background:"rgba(255,210,0,0.12)",border:"1px solid rgba(255,200,0,0.3)",borderRadius:5,padding:"8px 12px",fontSize:12}}>
            <span style={{color:"#FFD700",fontWeight:800}}>⚡ SUCCESSOR NAMED: </span>
            <span style={{color:"#fff",fontWeight:700}}>{r.incoming_ceo_name}</span>
            {r.incoming_ceo_background&&r.incoming_ceo_background!=="N/A"&&(
              <span style={{color:"rgba(255,255,255,0.6)"}}> — {r.incoming_ceo_background}</span>
            )}
            {r.incoming_ceo_start_date&&r.incoming_ceo_start_date!=="N/A"&&(
              <span style={{color:"rgba(255,255,255,0.45)"}}> · Starts: {r.incoming_ceo_start_date}</span>
            )}
          </div>
        )}
        {r.ceo_departure_announced==="yes"&&r.incoming_ceo_announced!=="yes"&&(
          <div style={{marginTop:8,background:"rgba(204,0,0,0.2)",border:"1px solid rgba(204,0,0,0.4)",borderRadius:5,padding:"6px 11px",fontSize:11,color:"#FFBBBB"}}>
            ⚠ CEO departure announced — successor not yet named
          </div>
        )}
      </div>

      {/* ── Tabs ── */}
      <div style={{display:"flex",background:C.white,borderBottom:`1px solid ${C.border}`,flexShrink:0,overflowX:"auto"}}>
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{
            flex:1,padding:"10px 6px",border:"none",cursor:"pointer",
            fontSize:12,fontWeight:600,
            background:"transparent",
            color:tab===t.id?C.red:C.mid,
            borderBottom:tab===t.id?`2px solid ${C.red}`:"2px solid transparent",
            whiteSpace:"nowrap",minWidth:72,
            transition:"color 0.15s"
          }}>{t.l}</button>
        ))}
      </div>

      {/* ── Content ── */}
      <div style={{flex:1,overflowY:"auto",background:"#F9F8F5",padding:"16px 18px"}}>

        {tab==="overview"&&(
          <div>
            {/* Row 1: Prediction + Confidence + Revenue */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:8}}>
              <KV label="Prediction" val={PRED_LABEL[r.prediction]||r.prediction} hi={isHigh}/>
              <KV label="Confidence" val={r.confidence} hi={isHigh}/>
              <KV label="Revenue" val={!ni(r.revenue)?r.revenue:""}/>
            </div>

            {/* Row 2: TSR */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:8}}>
              <KV label="TSR 1yr" val={!ni(r.tsr_1yr)?r.tsr_1yr:""}/>
              <KV label="TSR 3yr" val={!ni(r.tsr_3yr)?r.tsr_3yr:""}/>
              <KV label="TSR vs Peers" val={!ni(r.tsr_vs_peers)?r.tsr_vs_peers:""}/>
            </div>

            {/* Row 3: CEO facts */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:8}}>
              <KV label="CEO Tenure" val={r.ceo_tenure_years?`${r.ceo_tenure_years} years`:""}/>
              <KV label="CEO Age" val={!ni(r.ceo_age)?r.ceo_age:""}/>
              <KV label="Contract Expiry" val={!ni(r.ceo_contract_expiry)?r.ceo_contract_expiry:""} hi={r.ceo_contract_expiry&&!ni(r.ceo_contract_expiry)}/>
              <KV label="Activist Investors" val={r.activist_investors&&!ni(r.activist_investors)&&!["none","no"].includes(String(r.activist_investors).toLowerCase())?r.activist_investors:""} hi={r.activist_investors&&!ni(r.activist_investors)&&!["none","no"].includes(String(r.activist_investors).toLowerCase())}/>
            </div>

            {/* Row 4: Context */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:12}}>
              <KV label="Performance" val={!ni(r.performance_trajectory)?r.performance_trajectory:""}/>
              <KV label="M&A Activity" val={!ni(r.m_and_a_activity)?r.m_and_a_activity:""}/>
              <KV label="Regulatory" val={r.regulatory_scrutiny&&!["none","low"].includes(String(r.regulatory_scrutiny).toLowerCase())?r.regulatory_scrutiny:""}/>
              <KV label="COO / Heir Apparent" val={!ni(r.coo_or_president_appointed)?r.coo_or_president_appointed:""}/>
            </div>

            {/* CEO Transition Alert */}
            {(r.ceo_departure_announced==="yes"||r.incoming_ceo_announced==="yes")&&(
              <div style={{background:"#FEF2F2",border:"1px solid #FECACA",borderRadius:7,padding:"12px 15px",marginBottom:10}}>
                <SH>CEO Transition Alert</SH>
                {r.ceo_departure_announced==="yes"&&(
                  <div style={{fontSize:13,color:C.redD,marginBottom:4}}>
                    ⚠ Departure announced: <strong>{r.ceo_name}</strong> is leaving.
                  </div>
                )}
                {r.incoming_ceo_announced==="yes"&&r.incoming_ceo_name&&r.incoming_ceo_name!=="N/A"
                  ?<div style={{fontSize:13,color:C.redD}}>
                    ✓ Successor named: <strong>{r.incoming_ceo_name}</strong>
                    {r.incoming_ceo_background&&r.incoming_ceo_background!=="N/A"?` — ${r.incoming_ceo_background}`:""}
                    {r.incoming_ceo_start_date&&r.incoming_ceo_start_date!=="N/A"?` · Starts: ${r.incoming_ceo_start_date}`:""}
                  </div>
                  :r.incoming_ceo_announced==="yes"&&<div style={{fontSize:13,color:C.redD}}>Successor not yet publicly named.</div>
                }
              </div>
            )}

            {/* Two-column: Leadership + Governance */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
              <div style={{background:C.white,border:`1px solid #FECACA`,borderRadius:8,padding:"13px 15px",boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
                <SH>Leadership &amp; Succession Signals</SH>
                {r.leadership_signals?.filter(s=>s&&String(s).length>3).length>0
                  ?<Blist items={r.leadership_signals.filter(s=>s&&String(s).length>3)} col={C.red}/>
                  :<div style={{fontSize:13,color:C.muted,fontStyle:"italic"}}>No specific leadership signals identified.</div>
                }
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
                  ?<Blist items={[
                    !ni(r.succession_plan_disclosed)?`Succession plan: ${r.succession_plan_disclosed}`:"",
                    !ni(r.coo_or_president_appointed)?`COO / President: ${r.coo_or_president_appointed}`:"",
                    !ni(r.board_refreshed_2yr)?`Board refresh: ${r.board_refreshed_2yr}`:"",
                    !ni(r.contract_renewed)?`Contract: ${r.contract_renewed}`:"",
                    !ni(r.mandate_signals)?r.mandate_signals:"",
                  ].filter(Boolean)} col={"#003399"}/>
                  :<div style={{fontSize:13,color:C.muted,fontStyle:"italic"}}>No specific governance signals available.</div>
                }
              </div>
            </div>

            {/* Two-column: Press + Financial */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
              <div style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:8,padding:"13px 15px",boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
                <SH>Press &amp; Activism</SH>
                {r.press_signals?.filter(s=>s&&String(s).length>3).length>0
                  ?<Blist items={r.press_signals.filter(s=>s&&String(s).length>3)} col={C.red}/>
                  :r.press_controversies&&!ni(r.press_controversies)
                    ?<div style={{fontSize:14,color:C.slate,lineHeight:1.6}}>{r.press_controversies}</div>
                    :<div style={{fontSize:13,color:C.muted,fontStyle:"italic"}}>No significant activist or press pressure identified.</div>
                }
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
                  :<div style={{fontSize:13,color:C.muted,fontStyle:"italic"}}>No specific financial or industry signals identified.</div>
                }
              </div>
            </div>

            {/* Board-Ready Rationale */}
            {r.analytical_rationale&&(
              <div style={{background:`linear-gradient(135deg,${C.redDD},${C.redD})`,borderRadius:8,padding:"16px 20px",position:"relative",overflow:"hidden"}}>
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
              <KV label="Age" val={!ni(r.ceo_age)?r.ceo_age:""}/>
              <KV label="Tenure" val={r.ceo_tenure_years?`${r.ceo_tenure_years} years`:""}/>
              <KV label="Start Date" val={!ni(r.ceo_start_date)?r.ceo_start_date:""}/>
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
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:12}}>
              <KV label="Revenue" val={!ni(r.revenue)?r.revenue:""}/>
              <KV label="TSR 1yr" val={!ni(r.tsr_1yr)?r.tsr_1yr:""}/>
              <KV label="TSR 3yr" val={!ni(r.tsr_3yr)?r.tsr_3yr:""}/>
              <KV label="TSR vs Peers" val={!ni(r.tsr_vs_peers)?r.tsr_vs_peers:""}/>
              <KV label="Finance View" val={VIEW_LABEL[r.finance_view]||r.finance_view}/>
            </div>
            {r.financial_signals?.length>0&&(
              <div style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:8,padding:"12px 14px",marginBottom:10,boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
                <SH>Financial Signals</SH>
                <Blist items={r.financial_signals} col={C.warn}/>
              </div>
            )}
            {r.financial_summary&&(
              <div style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:8,padding:"12px 14px",boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
                <SH>Financial Summary</SH>
                <div style={{fontSize:14,color:C.slate,lineHeight:1.6}}>{r.financial_summary}</div>
              </div>
            )}
          </div>
        )}

        {tab==="rationale"&&(
          <div>
            {r.analytical_rationale&&(
              <div style={{background:`linear-gradient(135deg,${C.redDD},${C.redD})`,borderRadius:8,padding:"18px 22px",marginBottom:14}}>
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
            {/* Score row */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:12}}>
              <div style={{
                background:r.qc_score>=80?"#F0FDF4":r.qc_score>=50?"#FFFBEB":"#FEF2F2",
                border:`1px solid ${r.qc_score>=80?"#BBF7D0":r.qc_score>=50?"#FDE68A":"#FECACA"}`,
                borderRadius:7,padding:"13px",textAlign:"center"
              }}>
                <div style={{fontSize:9,color:C.mid,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:5}}>Data Completeness</div>
                <div style={{fontSize:32,fontWeight:800,color:r.qc_score>=80?C.ok:r.qc_score>=50?C.warn:C.red}}>{r.qc_score||0}%</div>
              </div>
              <div style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:7,padding:"13px",boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
                <div style={{fontSize:9,color:C.mid,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:5}}>QC Summary</div>
                <div style={{fontSize:13,color:C.ink,lineHeight:1.6}}>{r.qc_summary||"No QC summary available."}</div>
              </div>
              <div style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:7,padding:"13px",boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
                <div style={{fontSize:9,color:C.mid,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:5}}>Company Identity</div>
                <div style={{fontSize:13,fontWeight:700,color:r.validation_company==="correct"?C.ok:r.validation_company==="confused"?C.red:C.warn}}>
                  {r.validation_company||"—"}
                </div>
                {r.validation_flags?.map((f,i)=>(
                  <div key={i} style={{fontSize:10,color:C.red,marginTop:4}}>⚠ {f}</div>
                ))}
              </div>
            </div>

            {/* Field verification */}
            <div style={{background:C.white,border:`1px solid ${C.border}`,borderRadius:8,padding:"13px 15px",marginBottom:10,boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
              <SH>Field Verification</SH>
              {[
                ["CEO Name",r.ceo_name,r.validation_ceo,r.validation_ceo_note],
                ["TSR Figures",`${r.tsr_1yr} / ${r.tsr_3yr}`,r.validation_tsr,r.validation_tsr_note],
                ["Revenue",r.revenue,r.validation_revenue,""],
                ["Prediction",r.prediction,r.validation_prediction,r.validation_prediction_note],
              ].map(([label,value,status,note],i)=>{
                const isGood = ["correct","plausible","reasonable"].includes(status);
                const isBad  = ["incorrect","too_high","too_low","confused"].includes(status);
                const sc  = isGood?C.ok:isBad?C.red:C.warn;
                const sbg = isGood?"#F0FDF4":isBad?"#FEF2F2":"#FFFBEB";
                return(
                  <div key={i} style={{display:"grid",gridTemplateColumns:"130px 1fr 110px",gap:8,padding:"9px 0",borderBottom:`1px solid ${C.border}`,alignItems:"start"}}>
                    <div style={{fontSize:13,fontWeight:600,color:C.ink}}>{label}</div>
                    <div>
                      <div style={{fontSize:13,color:C.ink}}>{value||"—"}</div>
                      {note&&<div style={{fontSize:10,color:C.mid,marginTop:2}}>{note}</div>}
                    </div>
                    <div style={{background:sbg,borderRadius:3,padding:"3px 8px",fontSize:10,fontWeight:700,color:sc,textAlign:"center"}}>{status||"—"}</div>
                  </div>
                );
              })}
            </div>

            {/* Missing fields */}
            {r.validation_missing?.length>0&&(
              <div style={{background:"#FFFBEB",border:"1px solid #FDE68A",borderRadius:8,padding:"12px 14px",marginBottom:10}}>
                <SH>Missing Critical Fields</SH>
                <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                  {r.validation_missing.map((f,i)=>(
                    <span key={i} style={{background:"#FEF3C7",border:"1px solid #F59E0B",borderRadius:3,padding:"3px 8px",fontSize:10,color:"#92400E",fontWeight:600}}>{f}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Challenge results */}
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
                    {r.challenge_points.map((p,i)=>(
                      <div key={i} style={{display:"flex",gap:7,marginBottom:7,fontSize:14,color:C.slate,alignItems:"flex-start",lineHeight:1.55}}>
                        <span style={{color:C.red,flexShrink:0,fontWeight:700}}>✗</span>
                        {typeof p === "object" ? JSON.stringify(p) : String(p||"")}
                      </div>
                    ))}
                  </div>
                  <div>
                    <div style={{fontSize:10,fontWeight:700,color:C.ok,textTransform:"uppercase",letterSpacing:"0.09em",marginBottom:7}}>Reasons It Still Holds</div>
                    {(r.overriding_factors||[]).map((p,i)=>(
                      <div key={i} style={{display:"flex",gap:7,marginBottom:7,fontSize:14,color:C.slate,alignItems:"flex-start",lineHeight:1.55}}>
                        <span style={{color:C.ok,flexShrink:0,fontWeight:700}}>✓</span>
                        {typeof p === "object" ? JSON.stringify(p) : String(p||"")}
                      </div>
                    ))}
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
  const col=PRED_COLOR[r.prediction]||C.mid;
  const [hov,setHov]=useState(false);
  return(
    <div onClick={onClick}
      onMouseEnter={()=>setHov(true)}
      onMouseLeave={()=>setHov(false)}
      style={{
        padding:"10px 14px",cursor:"pointer",
        borderBottom:`1px solid ${C.border}`,
        background:sel?"#FEF2F2":hov?"#FFF5F5":C.white,
        borderLeft:`3px solid ${sel?C.red:isH?"#FECACA":"transparent"}`,
        transition:"all 0.12s"
      }}>
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        <div style={{
          width:24,height:24,borderRadius:5,
          background:isH?"#FEF2F2":"#F5F4F0",
          color:isH?C.red:C.mid,
          display:"flex",alignItems:"center",justifyContent:"center",
          fontSize:11,fontWeight:700,flexShrink:0
        }}>{idx+1}</div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontWeight:600,fontSize:13,color:sel?C.red:C.ink,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{r.company}</div>
          <div style={{fontSize:11,color:C.mid,marginTop:2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
            {r.ceo_name||"—"}{r.ceo_tenure_years?` · ${r.ceo_tenure_years}yr`:""}
          </div>
        </div>
        <PredBadge pred={r.prediction} sm/>
      </div>
    </div>
  );
}

function PBar({v,t}){
  return(
    <div style={{background:"#E8E5DF",borderRadius:99,height:3,overflow:"hidden"}}>
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
  const [showIn,setShowIn]=useState(true); // collapses after first run
  const fRef=useRef();

  useEffect(()=>{ injectGlobalStyle(); },[]);

  const handleFile=async e=>{
    const f=e.target.files[0]; if(!f) return;
    const isExcel = /\.(xlsx|xls|xlsm)$/i.test(f.name);
    try {
      if(isExcel){
        const buf = await f.arrayBuffer();
        const wb = XLSX.read(buf, {type:"array"});
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, {header:1, defval:""});
        // Find company/ticker columns (header row detection)
        const header = rows[0]?.map(h=>String(h).toLowerCase().trim()) || [];
        const compIdx = header.findIndex(h=>h.includes("company")||h.includes("name"));
        const tickIdx = header.findIndex(h=>h.includes("ticker")||h.includes("symbol")||h.includes("tick"));
        const cI = compIdx>=0 ? compIdx : 0;
        const tI = tickIdx>=0 ? tickIdx : 1;
        const dataRows = compIdx>=0 ? rows.slice(1) : rows;
        setFileCos(dataRows
          .filter(r=>r[cI]&&String(r[cI]).toLowerCase()!=="company")
          .map(r=>({company:String(r[cI]||"").trim(), ticker:String(r[tI]||"").trim()}))
          .filter(r=>r.company)
          .slice(0,20));
      } else {
        const t=await f.text();
        const rows=t.split("\n").map(r=>r.split(",").map(c=>c.trim().replace(/^"|"$/g,"")));
        setFileCos(rows.filter(r=>r[0]&&r[0].toLowerCase()!=="company").map(r=>({company:r[0],ticker:r[1]||""})).slice(0,20));
      }
    } catch(e){setErr("File parse error: "+e.message);}
  };
  const parseTxt=()=>txt.split("\n").map(l=>l.trim()).filter(Boolean).map(l=>{const p=l.split(",");return{company:p[0]?.trim(),ticker:p[1]?.trim()||""};}).filter(c=>c.company).slice(0,20);

  const run=async()=>{
    setErr("");setResults([]);setLogs([]);setSel(null);
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
        out.push({company:cl(company,8),ticker:cl(ticker||"",6),prediction:"error",confidence:"low",analytical_rationale:"Error: "+e.message,ceo_name:"",ceo_tenure_years:"",leadership_signals:[],financial_signals:[],press_signals:[],industry_signals:[],finance_concerns:[],press_concerns:[],industry_concerns:[]});
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
    <div style={{position:"fixed",inset:0,display:"flex",flexDirection:"column",background:"#F5F4F0",fontFamily:"'DM Sans',sans-serif",overflow:"hidden"}}>

      {/* ── NAV ── */}
      <div style={{background:C.red,flexShrink:0,boxShadow:"0 2px 8px rgba(163,0,0,0.25)"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 20px",gap:14}}>
          <div style={{display:"flex",alignItems:"center",gap:13}}>
            {/* Nav icon — subtle bar chart */}
            <svg width="34" height="34" viewBox="0 0 34 34" fill="none" style={{flexShrink:0}}>
              <rect width="34" height="34" rx="6" fill="rgba(255,255,255,0.12)"/>
              <rect x="8" y="20" width="4" height="8" rx="1" fill="rgba(255,255,255,0.9)"/>
              <rect x="15" y="14" width="4" height="14" rx="1" fill="rgba(255,255,255,0.9)"/>
              <rect x="22" y="8" width="4" height="20" rx="1" fill="rgba(255,255,255,0.9)"/>
            </svg>
            <div>
              <div style={{fontSize:16,fontWeight:700,color:"#fff",letterSpacing:"-0.01em",lineHeight:1.2}}>CEO Succession Risk Analyzer</div>
              <div style={{fontSize:11,color:"rgba(255,255,255,0.6)",fontWeight:400,marginTop:1}}>8-agent intelligence pipeline · Bain &amp; Company</div>
            </div>
          </div>

          <div style={{display:"flex",gap:6,flexWrap:"nowrap"}}>
            {["Web Search","Research","Finance","Press","Industry","Prediction","Challenge","Validation"].map((l,i)=>(
              <div key={l} style={{
                fontSize:10,fontWeight:600,
                color:"rgba(255,255,255,0.75)",
                background:"rgba(255,255,255,0.1)",
                borderRadius:3,padding:"3px 8px",
                whiteSpace:"nowrap"
              }}>{i+1}. {l}</div>
            ))}
          </div>

          <div style={{display:"flex",alignItems:"center",gap:10,flexShrink:0}}>
            {results.length>0&&!running&&(
              <div style={{display:"flex",gap:16,alignItems:"center",background:"rgba(0,0,0,0.15)",borderRadius:6,padding:"5px 14px"}}>
                {[
                  {l:"Total",v:results.length,c:"rgba(255,255,255,0.9)"},
                  {l:"New/Transition",v:(pc.new_ceo_appointed||0)+(pc.transition_underway||0),c:"#FFB3B3"},
                  {l:"High",v:pc.high_likelihood||0,c:"#FFB3B3"},
                  {l:"Medium",v:pc.medium_likelihood||0,c:"#FFD580"},
                  {l:"Low",v:pc.low_likelihood||0,c:"#86EFAC"}
                ].map(({l,v,c})=>(
                  <div key={l} style={{textAlign:"center"}}>
                    <div style={{fontSize:17,fontWeight:800,color:c,lineHeight:1}}>{v}</div>
                    <div style={{fontSize:9,color:"rgba(255,255,255,0.55)",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.07em",marginTop:2}}>{l}</div>
                  </div>
                ))}
              </div>
            )}
            <button onClick={()=>setShowIn(x=>!x)} style={{
              background:"rgba(255,255,255,0.15)",
              border:"1px solid rgba(255,255,255,0.25)",
              color:"#fff",borderRadius:5,
              padding:"6px 14px",fontSize:11,fontWeight:600,
              cursor:"pointer",flexShrink:0,whiteSpace:"nowrap"
            }}>
              {showIn?"Hide Input":"New Analysis"}
            </button>
            {results.length>0&&!running&&(
              <button onClick={()=>exportToExcel(results)} style={{
                background:"rgba(255,255,255,0.15)",border:"1px solid rgba(255,255,255,0.25)",
                color:"#fff",borderRadius:5,padding:"6px 12px",
                fontSize:11,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap"
              }}>↓ Export</button>
            )}
          </div>
        </div>
      </div>

      {/* ── INPUT DRAWER ── */}
      {showIn&&(
        <div style={{background:C.white,borderBottom:`1px solid ${C.border}`,flexShrink:0,boxShadow:"0 1px 4px rgba(0,0,0,0.06)"}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr auto",alignItems:"stretch"}}>

            {/* Left: tabs + textarea/upload */}
            <div style={{borderRight:`1px solid ${C.border}`}}>
              {/* Tab row */}
              <div style={{display:"flex",borderBottom:`1px solid ${C.border}`}}>
                {[["manual","Manual Entry"],["file","File Upload"]].map(([id,l])=>(
                  <button key={id} onClick={()=>setITab(id)} style={{
                    padding:"8px 18px",border:"none",cursor:"pointer",
                    fontSize:12,fontWeight:600,background:"transparent",
                    color:iTab===id?C.red:C.mid,
                    borderBottom:iTab===id?`2px solid ${C.red}`:"2px solid transparent"
                  }}>{l}</button>
                ))}
              </div>
              {/* Input body */}
              <div style={{padding:"10px 16px",display:"flex",gap:12,alignItems:"center"}}>
                {iTab==="manual"?(
                  <>
                    <textarea
                      value={txt}
                      onChange={e=>setTxt(e.target.value)}
                      rows={3}
                      placeholder={"Apple Inc, AAPL
Microsoft, MSFT
Babcock International, BAB"}
                      style={{
                        flex:1,borderRadius:5,border:`1px solid ${C.border}`,
                        padding:"8px 12px",fontSize:13,
                        color:C.ink,background:C.white,
                        fontFamily:"'DM Sans',monospace",
                        resize:"none",lineHeight:1.6
                      }}
                    />
                    <div style={{fontSize:12,color:C.mid,lineHeight:2,whiteSpace:"nowrap",flexShrink:0}}>
                      One per line<br/>Name, TICKER<br/>Max 20
                    </div>
                  </>
                ):(
                  <>
                    <div
                      onClick={()=>fRef.current.click()}
                      style={{
                        flex:1,border:`1.5px dashed #FECACA`,borderRadius:6,
                        padding:"16px",textAlign:"center",cursor:"pointer",background:"#FEF2F2"
                      }}
                      onMouseEnter={e=>e.currentTarget.style.borderColor=C.red}
                      onMouseLeave={e=>e.currentTarget.style.borderColor="#FECACA"}>
                      <div style={{fontSize:13,fontWeight:600,color:C.red,marginBottom:3}}>Upload CSV or Excel</div>
                      <div style={{fontSize:12,color:C.mid}}>.csv · .xlsx · .xls · .xlsm</div>
                      <input ref={fRef} type="file" accept=".csv,.xlsx,.xls,.xlsm" style={{display:"none"}} onChange={handleFile}/>
                    </div>
                    {fileCos.length>0&&(
                      <div style={{fontSize:13,color:C.ok,fontWeight:600,flexShrink:0}}>{fileCos.length} companies loaded</div>
                    )}
                  </>
                )}
                {err&&<div style={{fontSize:12,color:C.red,flexShrink:0}}>{err}</div>}
              </div>
            </div>

            {/* Right: run button + progress */}
            <div style={{padding:"12px 16px",display:"flex",flexDirection:"column",justifyContent:"center",gap:8,minWidth:180,background:"#FAFAF8"}}>
              <button
                onClick={run}
                disabled={running}
                style={{
                  padding:"11px 0",width:"100%",
                  background:running?"#E8E5DF":C.red,
                  color:running?C.mid:"#fff",
                  border:"none",borderRadius:5,
                  fontSize:14,fontWeight:700,
                  cursor:running?"not-allowed":"pointer",
                  boxShadow:running?"none":"0 2px 12px rgba(163,0,0,0.28)"
                }}>
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

      {/* ── MAIN 2-COL ── */}
      <div style={{flex:1,display:"grid",gridTemplateColumns:sorted.length?"260px 1fr":"1fr",overflow:"hidden",minHeight:0}}>

        {/* Sidebar */}
        {sorted.length>0&&(
          <div style={{background:C.white,borderRight:`1px solid ${C.border}`,display:"flex",flexDirection:"column",overflow:"hidden"}}>
            <div style={{
              padding:"10px 14px",
              borderBottom:`1px solid ${C.border}`,
              background:"#F9F8F5",
              flexShrink:0,
              display:"flex",justifyContent:"space-between",alignItems:"center"
            }}>
              <span style={{fontSize:12,fontWeight:700,color:C.red,textTransform:"uppercase",letterSpacing:"0.08em"}}>{sorted.length} Companies</span>
              <span style={{fontSize:11,color:C.mid}}>by risk</span>
            </div>
            <div style={{flex:1,overflowY:"auto"}}>
              {sorted.map((r,i)=><CRow key={i} r={r} idx={i} sel={sel===i} onClick={()=>setSel(i)}/>)}
            </div>
          </div>
        )}

        {/* Detail / empty state */}
        <div style={{position:"relative",overflow:"hidden",display:"flex",flexDirection:"column",background:"#F9F8F5"}}>
          {selR?<Detail r={selR}/>:(
            <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:12}}>
              {sorted.length>0
                ?(
                  <>
                    <div style={{fontSize:22,color:C.pale}}>←</div>
                    <div style={{fontSize:12,color:C.mid}}>Select a company to view analysis</div>
                  </>
                ):(
                  <div style={{textAlign:"center",maxWidth:500,padding:32}}>
                    {/* Empty state icon — subtle pipeline nodes */}
                    <svg width="56" height="56" viewBox="0 0 56 56" fill="none" style={{margin:"0 auto 18px",display:"block"}}>
                      <rect width="56" height="56" rx="12" fill="#FEF2F2"/>
                      <circle cx="14" cy="28" r="5" fill="#FECACA"/>
                      <circle cx="28" cy="18" r="5" fill="#FCA5A5"/>
                      <circle cx="28" cy="38" r="5" fill="#FCA5A5"/>
                      <circle cx="42" cy="28" r="5" fill="#CC0000"/>
                      <line x1="19" y1="26" x2="23" y2="20" stroke="#FECACA" strokeWidth="1.5"/>
                      <line x1="19" y1="30" x2="23" y2="36" stroke="#FECACA" strokeWidth="1.5"/>
                      <line x1="33" y1="20" x2="37" y2="26" stroke="#FCA5A5" strokeWidth="1.5"/>
                      <line x1="33" y1="36" x2="37" y2="30" stroke="#FCA5A5" strokeWidth="1.5"/>
                    </svg>
                    <div style={{fontSize:22,fontWeight:700,color:C.ink,marginBottom:8,letterSpacing:"-0.02em",fontFamily:"'DM Serif Display',serif"}}>
                      CEO Succession Risk Analyzer
                    </div>
                    <div style={{fontSize:13,color:C.mid,lineHeight:1.8,marginBottom:22}}>
                      8-agent intelligence pipeline — Web Search · Research · Finance · Press · Industry · Prediction · Challenge · Validation
                    </div>
                    {!showIn&&(
                      <button onClick={()=>setShowIn(true)} style={{
                        padding:"11px 28px",background:C.red,color:"#fff",
                        border:"none",borderRadius:5,fontSize:13,fontWeight:700,
                        cursor:"pointer",boxShadow:"0 2px 12px rgba(163,0,0,0.28)"
                      }}>Start Analysis</button>
                    )}
                  </div>
                )
              }
            </div>
          )}
        </div>
      </div>
    </div>
  );
}