import { useState, useRef, useEffect } from "react";

// ── Global styles ─────────────────────────────────────────────────────────────
const injectGlobalStyle = () => {
  const s = document.createElement("style");
  s.textContent = `
    html,body,#root{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#0D0D18;}
    *{box-sizing:border-box;}
    ::-webkit-scrollbar{width:5px;}
    ::-webkit-scrollbar-track{background:rgba(255,255,255,0.03);}
    ::-webkit-scrollbar-thumb{background:rgba(204,0,0,0.4);border-radius:99px;}
    button:focus,textarea:focus,input:focus{outline:none;}
  `;
  document.head.appendChild(s);
};

const C = {
  red:"#CC0000", redD:"#990000", redDD:"#5A0000",
  r10:"rgba(204,0,0,0.07)", r20:"rgba(204,0,0,0.14)", r30:"rgba(204,0,0,0.28)",
  ink:"#0D0D18", ink2:"#161624", ink3:"#1E1E30",
  slate:"#6B6B90", mid:"#8888AA", muted:"#A0A0BC", pale:"#C0C0D0",
  surface:"#F2F2F7", white:"#FFFFFF",
  ok:"#0D9A5E", okBg:"rgba(13,154,94,0.12)",
  warn:"#B56E00", warnBg:"rgba(181,110,0,0.12)",
  orange:"#CC4400",
};

// ── FIXED: direct Portkey URL (no proxy needed) ───────────────────────────────
const PORTKEY_URL = "/api/chat/completions"; // proxied via vite → portkey.bain.dev
const PORTKEY_KEY = "2bayMIyF+J3J0aJtcc4i1HvrfLAS";
const MODEL       = "@ceo-coe/gpt-5.4";

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

const PRED_COLOR = {new_ceo_appointed:"#CC0000",transition_underway:"#CC4400",high_likelihood:"#CC4400",medium_likelihood:"#B56E00",low_likelihood:"#0D9A5E"};
const PRED_LABEL = {new_ceo_appointed:"New CEO Appointed",transition_underway:"Transition Underway",high_likelihood:"High Likelihood",medium_likelihood:"Medium Likelihood",low_likelihood:"Low Likelihood"};
const OWN_LABEL  = {founder_ceo:"Founder CEO",family_ceo:"Family CEO",founder_family_control_non_ceo:"Family Control",government_controlled:"Gov. Controlled",state_owned_enterprise:"State-Owned",professionally_managed:"Prof. Managed",unclear:"Unclear"};
const VIEW_LABEL = {high_influence:"High Influence",medium_influence:"Medium Influence",weak_influence:"Weak Influence",no_clear_influence:"No Clear Influence"};
const VIEW_COLOR = {high_influence:"#CC0000",medium_influence:"#CC4400",weak_influence:"#B56E00",no_clear_influence:"#0D9A5E"};
const isHighPred = p => ["new_ceo_appointed","transition_underway","high_likelihood"].includes(p);
const rc = s => s>=8?"#CC0000":s>=6?"#CC4400":s>=4?"#B56E00":"#0D9A5E";

function parseJSON(text, fallback={}) {
  try { const s=text.indexOf("{"),e=text.lastIndexOf("}")+1; return s!==-1?JSON.parse(text.slice(s,e)):fallback; } catch{ return fallback; }
}

// ── Portkey call ──────────────────────────────────────────────────────────────
async function callLLM(sys, usr, webSearch=false) {
  const body = {
    model: MODEL,
    messages: [{role:"system",content:sys},{role:"user",content:usr}],
    max_completion_tokens: 1024,
  };
  // Mirror Python script: extra_body with plugins for web search
  if(webSearch) {
    body.plugins = [{id:"webSearch"}];           // Portkey plugin format
    body.extra_body = {plugins:[{id:"webSearch"}]}; // fallback extra_body format
  }
  const r = await fetch(PORTKEY_URL, {
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      "x-portkey-api-key":PORTKEY_KEY,
    },
    body:JSON.stringify(body)
  });
  if(!r.ok) throw new Error(`Portkey ${r.status}: ${await r.text()}`);
  const d = await r.json();
  return d.choices?.[0]?.message?.content?.trim()||"";
}

// ── Agent 1: CEO News — dual-call strategy (web search + model knowledge) ────
async function fetchCEONews(company) {
  const today = new Date().toDateString();
  const yr    = new Date().getFullYear();

  const sys = `You are a corporate intelligence analyst. Today is ${today}.
Your sole task: find the most current CEO succession facts for the company given.
Use ALL available knowledge — web search results, press releases, news articles, company announcements.
Today is ${today} — any news up to and including today is relevant.`;

  const prompt = `Company: "${company}"
Today: ${today}

Search thoroughly and answer each question with FULL NAMES and SPECIFIC DATES:

Q1. CURRENT CEO
Who is the CEO of "${company}" RIGHT NOW as of ${today}?
→ Full name + date they became CEO

Q2. CEO CHANGE IN ${yr-1}–${yr}
Has the CEO changed in the last 18 months?
→ Yes/No. If yes: departing CEO full name, incoming CEO full name, date of change

Q3. DEPARTURE ANNOUNCED
Has the current CEO formally announced they are leaving, retiring, or stepping down?
→ Yes/No. If yes: name + announcement date + effective departure date

Q4. NAMED SUCCESSOR
Has a specific person been publicly named as the next CEO?
→ Yes/No. If yes: their FULL NAME + current role/background + expected start date
→ Check: company press releases, board announcements, regulatory filings, news articles

Q5. TRANSITION STATUS
Is this company currently mid-transition? (i.e. old CEO leaving, new one starting soon)
→ Yes/No. Brief description if yes.

IMPORTANT:
- Give FULL first and last names — never just a surname
- If you found this in a news article or press release, say so
- Do NOT say "not found" or "no information" if you have any relevant knowledge
- Recent announcements (even from this week or today) are valid`;

  // Call 1: with web search plugin
  let webResult = "";
  try {
    webResult = await callLLM(sys, prompt, true);
  } catch { webResult = ""; }

  // Call 2: model knowledge directly (no web search)
  let modelResult = "";
  try {
    modelResult = await callLLM(sys, prompt, false);
  } catch { modelResult = ""; }

  // Merge: prefer web result if it has content, otherwise use model result
  // If both have content, combine them so research agent sees both
  if (webResult && webResult.length > 50 && modelResult && modelResult.length > 50) {
    return `WEB SEARCH RESULT:
${webResult}

MODEL KNOWLEDGE:
${modelResult}`;
  }
  if (webResult && webResult.length > 50) return webResult;
  if (modelResult && modelResult.length > 50) return modelResult;
  return `No CEO news found for ${company}.`;
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
    `You are an institutional CEO succession research analyst. Today is ${today}.
PRIORITY: The CEO News Context below contains the most recent data — always prefer it over your training knowledge for current CEO name, departure, and succession facts.
Return ONLY valid JSON. No markdown, no extra text.`,

    `Company: ${company}
Ticker: ${ticker||"N/A"}
Today: ${today}

━━━ CEO NEWS CONTEXT (treat as authoritative — overrides training data) ━━━
${webCtx}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

READ THE ABOVE CAREFULLY BEFORE FILLING THE JSON.
If the context contains Q4 answer with a name → that name MUST go in incoming_ceo_name.
If the context says "transition underway" or "mid-transition" → set both flags to "yes".

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
- revenue: USD only, format $XXbn or $XXXm
- tsr_1yr / tsr_3yr: percentage e.g. "+12%" or "-8%"
- All list fields: max 4 items, 20 words each`
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
// ── Agent 3: Finance ──────────────────────────────────────────────────────────
async function agentFinance(data) {
  const fallback={view:"no_clear_influence",financial_facts:data.financial_signals||[],revenue:data.revenue||"not clearly inferable",signals:[],concerns:[]};
  const raw=await callLLM("You are an equity research expert. Assess financial influence on CEO succession. Return JSON only.",`Data:\n${JSON.stringify(data)}\n\nReturn:\n{"view":"no_clear_influence","financial_facts":[],"revenue":"","signals":[],"concerns":[]}\n\nview=high_influence|medium_influence|weak_influence|no_clear_influence. lists max 3 items 20 words.`);
  const r=parseJSON(raw,fallback);
  r.view=cl(r.view||"no_clear_influence",3); r.financial_facts=lst(r.financial_facts,3,20);
  r.signals=lst(r.signals,3,18); r.concerns=lst(r.concerns,2,18);
  r.revenue=cl(r.revenue||data.revenue||"not clearly inferable",8)||"not clearly inferable";
  return r;
}

// ── Agent 4: Press & Activism ────────────────────────────────────────────────
async function agentPress(data) {
  const fallback = {
    view:"no_clear_influence", signals:[], concerns:[],
    controversies:(data.press_activism_signals||[]).slice(0,3),
    investor_activism:data.investor_activism||"not clearly inferable"
  };

  const raw = await callLLM(
    `You are a governance and investor relations expert specialising in CEO succession risk.
Analyse the specific data provided and identify REAL, NAMED signals — not generic observations.
Return ONLY valid JSON.`,

    `━━━ COMPANY DATA ━━━
Company: ${data.company||""}  |  Sector: ${data.sector}  |  CEO: ${data.ceo_name}
CEO tenure: ${data.ceo_tenure_years} years  |  Ownership: ${data.ownership_category}
TSR 1yr: ${data.tsr_1yr}  |  TSR vs peers: ${data.tsr_vs_peers}
Activist investors: ${data.activist_investors}
Press/activism signals from research: ${JSON.stringify(data.press_activism_signals)}
Investor activism detail: ${data.investor_activism}
Mandate signals: ${data.mandate_signals}
Contract expiry: ${data.ceo_contract_expiry}  |  Renewed: ${data.contract_renewed}

━━━ TASK ━━━
Based on the data above, assess external pressure on CEO succession.

Return this JSON:
{
  "view": "",
  "signals": [],
  "concerns": [],
  "controversies": [],
  "investor_activism": ""
}

━━━ RULES ━━━
view: high_influence | medium_influence | weak_influence | no_clear_influence
  • high_influence: named activist campaign, public shareholder letter demanding CEO change, major scandal/investigation, formal vote of no-confidence
  • medium_influence: TSR underperformance vs peers, compensation controversy, governance criticism from proxy advisors
  • weak_influence: minor governance concerns, one-off press criticism
  • no_clear_influence: no notable external pressure

signals: up to 3 items — SPECIFIC facts only (e.g. "Elliott Management disclosed 5% stake in 2024", "ISS recommended against CEO pay package")
  DO NOT write generic phrases like "governance scrutiny typical for mega-cap" or "no credible report"
  If no real signals exist, return an empty array []

concerns: up to 2 items — actual identified risks with specifics
controversies: up to 3 items — named events, lawsuits, activist letters, regulatory probes
investor_activism: summarise any named activist investors and their stated position, or "None identified"

⚠ Quality rule: Every item must reference a SPECIFIC event, person, or named entity. Generic observations are not allowed.`
  );

  const r = parseJSON(raw, fallback);
  r.view             = cl(r.view||"no_clear_influence", 3);
  r.signals          = lst(r.signals, 3, 20);
  r.concerns         = lst(r.concerns, 2, 20);
  r.controversies    = lst(r.controversies, 3, 20);
  r.investor_activism = cl(r.investor_activism||"not clearly inferable", 15)||"not clearly inferable";

  // Filter out generic boilerplate phrases
  const genericPhrases = ["typical for","no credible","no major","not identified","no report","governance scrutiny"];
  const isGeneric = s => genericPhrases.some(p => s.toLowerCase().includes(p));
  r.signals       = r.signals.filter(s => !isGeneric(s));
  r.concerns      = r.concerns.filter(s => !isGeneric(s));
  r.controversies = r.controversies.filter(s => !isGeneric(s));

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

  // Rule 1: Family/founder CEO with no announced departure → always Low
  if (isFamily && data.ceo_departure_announced !== "yes" && data.incoming_ceo_announced !== "yes") {
    return {
      prediction: "low_likelihood",
      confidence: "high",
      analytical_rationale: `${data.ceo_name} leads a ${OWN_LABEL[data.ownership_category]||"family/founder-controlled"} company. Family and founder-led businesses have internally managed, planned succession processes with minimal external departure pressure. No departure has been announced. Succession risk is structurally low regardless of tenure or age.`
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
Be accurate and calibrated — do NOT default to low_likelihood for famous long-tenured CEOs.
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
1. age >= 65                                     → high_likelihood
2. age >= 63 AND tenure >= 8                     → high_likelihood
3. tenure >= 12                                  → high_likelihood
4. TWO OR MORE of these signals present:
   • activist investor present
   • TSR underperformance vs peers
   • tenure >= 8 years
   • contract expires within 12 months
   • age >= 60
   • major scandal or regulatory probe
   • COO/President appointed as clear heir
   • board recently refreshed
                                                 → high_likelihood
5. ONE of these signals:
   • tenure 5–8 years
   • mild underperformance
   • contract expiry in 1–2 years
   • age 58–62
   • COO appointed (not clear heir)
                                                 → medium_likelihood
6. All of these true: tenure < 5yr AND age < 58 AND strong performance AND contract recently renewed AND no activist
                                                 → low_likelihood
7. Default if unclear                            → medium_likelihood

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
// ── Full pipeline ─────────────────────────────────────────────────────────────
async function runPipeline(company, ticker, log) {
  log(p=>[...p,`[${company}] 🔍 Fetching live CEO news...`]);
  const webCtx = await fetchCEONews(company);
  log(p=>[...p,`[${company}] 📊 Research agent...`]);
  const data = await agentResearch(company, ticker, webCtx);
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
  log(p=>[...p,`[${company}] ✓ Complete`]);
  return {
    company:cl(company,8), ticker:cl(ticker||"",6),
    sector:data.sector, ceo_name:data.ceo_name, ceo_age:data.ceo_age,
    ceo_start_date:data.ceo_start_date, ceo_tenure_years:data.ceo_tenure_years,
    founder_status:data.founder_status, ownership_category:data.ownership_category,
    ceo_departure_announced:data.ceo_departure_announced, incoming_ceo_announced:data.incoming_ceo_announced,
    incoming_ceo_name:data.incoming_ceo_name, incoming_ceo_background:data.incoming_ceo_background,
    incoming_ceo_start_date:data.incoming_ceo_start_date,
    prediction:pred.prediction, confidence:pred.confidence, analytical_rationale:pred.analytical_rationale,
    revenue:finance.revenue, financial_summary:joinCompact(finance.financial_facts," | ",30),
    tsr_1yr:data.tsr_1yr, tsr_3yr:data.tsr_3yr, tsr_vs_peers:data.tsr_vs_peers,
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
    tsr_3yr:data.tsr_3yr,
    performance_trajectory:data.performance_trajectory||"",
    m_and_a_activity:data.m_and_a_activity||"",
    regulatory_scrutiny:data.regulatory_scrutiny||"",
    succession_plan_disclosed:data.succession_plan_disclosed||"",
    coo_or_president_appointed:data.coo_or_president_appointed||"",
    board_refreshed_2yr:data.board_refreshed_2yr||"",
    investor_impact:pred.investor_impact||"",
  };
}

// ── UI Components ─────────────────────────────────────────────────────────────

function PredBadge({pred,sm=false}){
  const bg=PRED_COLOR[pred]||"#8888AA";
  return <span style={{background:bg,color:"#fff",borderRadius:5,padding:sm?"3px 9px":"5px 14px",fontSize:sm?11:13,fontWeight:800,letterSpacing:"0.03em",whiteSpace:"nowrap"}}>{PRED_LABEL[pred]||pred}</span>;
}

function Pill({text,v="n"}){
  const m={n:{bg:"rgba(0,0,0,0.07)",c:C.slate},r:{bg:C.r20,c:C.redD},g:{bg:C.okBg,c:C.ok},a:{bg:C.warnBg,c:C.warn},b:{bg:"rgba(0,51,153,0.1)",c:"#003399"}}[v]||{bg:"rgba(0,0,0,0.07)",c:C.slate};
  return <span style={{background:m.bg,color:m.c,borderRadius:99,padding:"3px 10px",fontSize:11,fontWeight:600,display:"inline-block",marginRight:4,marginBottom:4}}>{text}</span>;
}

function SH({children}){
  return(
    <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:9,paddingBottom:6,borderBottom:"1px solid rgba(204,0,0,0.12)"}}>
      <div style={{width:3,height:11,background:C.red,borderRadius:2,flexShrink:0}}/>
      <span style={{fontSize:12,fontWeight:900,color:C.red,textTransform:"uppercase",letterSpacing:"0.1em"}}>{children}</span>
    </div>
  );
}

function KV({label,val,hi=false}){
  if(!val||val==="N/A"||ni(val)) return null;
  return(
    <div style={{background:hi?C.r10:"rgba(0,0,0,0.03)",border:`1px solid ${hi?"rgba(204,0,0,0.18)":"rgba(0,0,0,0.07)"}`,borderRadius:8,padding:"9px 12px"}}>
      <div style={{fontSize:11,color:hi?C.red:C.mid,textTransform:"uppercase",letterSpacing:"0.07em",fontWeight:700,marginBottom:4}}>{label}</div>
      <div style={{fontSize:15,fontWeight:700,color:hi?C.redD:C.ink,lineHeight:1.3}}>{val}</div>
    </div>
  );
}

function AgentView({label,view,signals=[],concerns=[]}){
  const col=VIEW_COLOR[view]||"#8888AA";
  return(
    <div style={{background:"rgba(0,0,0,0.03)",border:"1px solid rgba(0,0,0,0.07)",borderRadius:10,padding:"11px 13px"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
        <span style={{fontSize:12,fontWeight:800,color:C.mid,textTransform:"uppercase",letterSpacing:"0.07em"}}>{label}</span>
        <span style={{background:col,color:"#fff",borderRadius:4,padding:"2px 8px",fontSize:10,fontWeight:700}}>{VIEW_LABEL[view]||view}</span>
      </div>
      {signals.map((s,i)=><div key={i} style={{fontSize:13,color:C.slate,marginBottom:5,display:"flex",gap:6}}><span style={{color:col}}>▸</span>{s}</div>)}
      {concerns.map((s,i)=><div key={i} style={{fontSize:13,color:C.redD,marginBottom:5,display:"flex",gap:6}}><span style={{color:C.red}}>!</span>{s}</div>)}
    </div>
  );
}

function Blist({items,col=C.red}){
  return items.map((item,i)=>(
    <div key={i} style={{display:"flex",gap:8,marginBottom:8,fontSize:14,color:C.slate,alignItems:"flex-start",lineHeight:1.5}}>
      <span style={{color:col,fontWeight:800,flexShrink:0,fontSize:10,marginTop:2}}>▸</span>{item}
    </div>
  ));
}

// ── Detail Panel ──────────────────────────────────────────────────────────────
function Detail({r}){
  const [tab,setTab]=useState("overview");
  const isHigh=isHighPred(r.prediction);
  const hdrBg=isHigh?`linear-gradient(135deg,${C.redD},${C.red})`:`linear-gradient(135deg,${C.ink2},${C.ink3})`;
  const TABS=[{id:"overview",l:"Overview"},{id:"agents",l:"Agent Views"},{id:"ceo",l:"CEO Profile"},{id:"governance",l:"Governance"},{id:"financials",l:"Financials"},{id:"rationale",l:"Rationale"}];

  return(
    <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",overflow:"hidden"}}>

      {/* Header */}
      <div style={{background:hdrBg,padding:"15px 20px 12px",flexShrink:0,position:"relative",overflow:"hidden"}}>
        <div style={{position:"absolute",right:-20,top:-20,width:130,height:130,borderRadius:"50%",background:"rgba(255,255,255,0.04)",pointerEvents:"none"}}/>
        <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:12,marginBottom:8}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:26,fontWeight:900,color:C.white,letterSpacing:"-0.02em",lineHeight:1.1}}>{r.company}</div>
            <div style={{display:"flex",gap:8,marginTop:4,flexWrap:"wrap",alignItems:"center"}}>
              {r.ticker&&<span style={{fontSize:11,color:"rgba(255,255,255,0.45)",fontFamily:"monospace",background:"rgba(255,255,255,0.08)",padding:"1px 7px",borderRadius:4}}>{r.ticker}</span>}
              {r.sector&&<span style={{fontSize:11,color:"rgba(255,255,255,0.5)"}}>{r.sector}</span>}
              {r.ownership_category&&r.ownership_category!=="unclear"&&<span style={{fontSize:10,color:"rgba(255,255,255,0.35)"}}>{OWN_LABEL[r.ownership_category]||r.ownership_category}</span>}
            </div>
          </div>
          <div style={{textAlign:"center",flexShrink:0}}>
            <PredBadge pred={r.prediction}/>
            <div style={{fontSize:10,color:"rgba(255,255,255,0.45)",marginTop:5}}>Confidence: <strong style={{color:"rgba(255,255,255,0.8)"}}>{r.confidence||"—"}</strong></div>
          </div>
        </div>
        {/* CEO strip */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",background:"rgba(0,0,0,0.2)",borderRadius:7,overflow:"hidden"}}>
          {[["CEO",r.ceo_name],["Age",!ni(r.ceo_age)?r.ceo_age:"—"],["Tenure",r.ceo_tenure_years?`${r.ceo_tenure_years}yr`:"—"],["Successor",r.incoming_ceo_announced==="yes"&&r.incoming_ceo_name&&r.incoming_ceo_name!=="N/A"?r.incoming_ceo_name:"—"],["TSR 1yr",!ni(r.tsr_1yr)?r.tsr_1yr:"—"]].map(([l,v],i,a)=>(
            <div key={l} style={{padding:"7px 8px",borderRight:i<a.length-1?"1px solid rgba(255,255,255,0.06)":"none"}}>
              <div style={{fontSize:10,color:"rgba(255,255,255,0.5)",textTransform:"uppercase",letterSpacing:"0.08em",fontWeight:700,marginBottom:2}}>{l}</div>
              <div style={{fontSize:14,fontWeight:700,color:C.white,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{v||"—"}</div>
            </div>
          ))}
        </div>
        {r.incoming_ceo_announced==="yes"&&r.incoming_ceo_name&&r.incoming_ceo_name!=="N/A"&&(
          <div style={{marginTop:8,background:"rgba(255,200,0,0.15)",border:"1px solid rgba(255,200,0,0.4)",borderRadius:7,padding:"8px 12px",fontSize:12}}>
            <span style={{color:"#FFD700",fontWeight:900}}>⚡ SUCCESSOR NAMED: </span>
            <span style={{color:"#FFF",fontWeight:700}}>{r.incoming_ceo_name}</span>
            {r.incoming_ceo_background&&r.incoming_ceo_background!=="N/A"&&<span style={{color:"rgba(255,255,255,0.6)"}}> — {r.incoming_ceo_background}</span>}
            {r.incoming_ceo_start_date&&r.incoming_ceo_start_date!=="N/A"&&<span style={{color:"rgba(255,255,255,0.5)"}}> · Starts: {r.incoming_ceo_start_date}</span>}
          </div>
        )}
        {r.ceo_departure_announced==="yes"&&r.incoming_ceo_announced!=="yes"&&(
          <div style={{marginTop:8,background:"rgba(204,0,0,0.18)",border:"1px solid rgba(204,0,0,0.35)",borderRadius:6,padding:"6px 10px",fontSize:11,color:"#FFAAAA"}}>
            ⚠ CEO departure announced — successor not yet named
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={{display:"flex",background:C.ink2,borderBottom:"1px solid rgba(255,255,255,0.05)",flexShrink:0,overflowX:"auto"}}>
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{flex:1,padding:"9px 4px",border:"none",cursor:"pointer",fontSize:11,fontWeight:700,background:"transparent",color:tab===t.id?C.white:C.slate,borderBottom:tab===t.id?`2px solid ${C.red}`:"2px solid transparent",fontSize:13,whiteSpace:"nowrap",minWidth:70}}>
            {t.l}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{flex:1,overflowY:"auto",background:C.surface,padding:"14px 16px"}}>

        {tab==="overview"&&(
          <div>

            {/* ── Row 1: Prediction + Confidence + Revenue ── */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:8}}>
              <KV label="Prediction" val={PRED_LABEL[r.prediction]||r.prediction} hi={isHigh}/>
              <KV label="Confidence" val={r.confidence} hi={isHigh}/>
              <KV label="Revenue" val={!ni(r.revenue)?r.revenue:""}/>
            </div>

            {/* ── Row 2: TSR fields ── */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:8}}>
              <KV label="TSR 1yr" val={!ni(r.tsr_1yr)?r.tsr_1yr:""}/>
              <KV label="TSR 3yr" val={!ni(r.tsr_3yr)?r.tsr_3yr:""}/>
              <KV label="TSR vs Peers" val={!ni(r.tsr_vs_peers)?r.tsr_vs_peers:""}/>
            </div>

            {/* ── Row 3: CEO facts ── */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:8}}>
              <KV label="CEO Tenure" val={r.ceo_tenure_years?`${r.ceo_tenure_years} years`:""}/>
              <KV label="CEO Age" val={!ni(r.ceo_age)?r.ceo_age:""}/>
              <KV label="Contract Expiry" val={!ni(r.ceo_contract_expiry)?r.ceo_contract_expiry:""} hi={r.ceo_contract_expiry&&!ni(r.ceo_contract_expiry)}/>
              <KV label="Activist Investors" val={r.activist_investors&&!ni(r.activist_investors)&&!["none","no"].includes(String(r.activist_investors).toLowerCase())?r.activist_investors:""} hi={r.activist_investors&&!ni(r.activist_investors)&&!["none","no"].includes(String(r.activist_investors).toLowerCase())}/>
            </div>

            {/* ── Row 4: Context facts ── */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:12}}>
              <KV label="Performance" val={!ni(r.performance_trajectory)?r.performance_trajectory:""}/>
              <KV label="M&A Activity" val={!ni(r.m_and_a_activity)?r.m_and_a_activity:""}/>
              <KV label="Regulatory" val={r.regulatory_scrutiny&&!["none","low"].includes(String(r.regulatory_scrutiny).toLowerCase())?r.regulatory_scrutiny:""}/>
              <KV label="COO / Heir Apparent" val={!ni(r.coo_or_president_appointed)?r.coo_or_president_appointed:""}/>
            </div>

            {/* ── CEO Transition Alert ── */}
            {(r.ceo_departure_announced==="yes"||r.incoming_ceo_announced==="yes")&&(
              <div style={{background:C.r20,border:`1px solid rgba(204,0,0,0.35)`,borderRadius:9,padding:"12px 14px",marginBottom:10}}>
                <SH>CEO Transition Alert</SH>
                {r.ceo_departure_announced==="yes"&&(
                  <div style={{fontSize:13,color:C.redD,marginBottom:4}}>⚠ Departure announced: <strong>{r.ceo_name}</strong> is leaving.</div>
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

            {/* ── Main content: two columns ── */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>

              {/* LEFT: Leadership & Succession Signals */}
              <div style={{background:C.r10,border:`1px solid rgba(204,0,0,0.15)`,borderRadius:9,padding:"12px 14px"}}>
                <SH>Leadership &amp; Succession Signals</SH>
                {r.leadership_signals?.filter(s=>s&&s.length>3).length>0
                  ?<Blist items={r.leadership_signals.filter(s=>s&&s.length>3)} col={C.red}/>
                  :<div style={{fontSize:13,color:C.muted,fontStyle:"italic"}}>No specific leadership signals identified.</div>
                }
              </div>

              {/* RIGHT: Governance */}
              <div style={{background:C.white,border:"1px solid rgba(0,0,0,0.07)",borderRadius:9,padding:"12px 14px"}}>
                <SH>Governance &amp; Succession Plan</SH>
                {[
                  !ni(r.succession_plan_disclosed)?`Succession plan: ${r.succession_plan_disclosed}`:"",
                  !ni(r.coo_or_president_appointed)?`COO/President: ${r.coo_or_president_appointed}`:"",
                  !ni(r.board_refreshed_2yr)?`Board refresh: ${r.board_refreshed_2yr}`:"",
                  !ni(r.contract_renewed)?`Contract: ${r.contract_renewed}`:"",
                  !ni(r.mandate_signals)?r.mandate_signals:"",
                ].filter(Boolean).length>0
                  ?<Blist items={[
                    !ni(r.succession_plan_disclosed)?`Succession plan: ${r.succession_plan_disclosed}`:"",
                    !ni(r.coo_or_president_appointed)?`COO/President: ${r.coo_or_president_appointed}`:"",
                    !ni(r.board_refreshed_2yr)?`Board refresh: ${r.board_refreshed_2yr}`:"",
                    !ni(r.contract_renewed)?`Contract: ${r.contract_renewed}`:"",
                    !ni(r.mandate_signals)?r.mandate_signals:"",
                  ].filter(Boolean)} col={"#003399"}/>
                  :<div style={{fontSize:13,color:C.muted,fontStyle:"italic"}}>No specific governance signals available.</div>
                }
              </div>
            </div>

            {/* ── Second row: Press + Financial ── */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>

              {/* Press & Activism */}
              <div style={{background:C.white,border:"1px solid rgba(0,0,0,0.07)",borderRadius:9,padding:"12px 14px"}}>
                <SH>Press &amp; Activism</SH>
                {r.press_signals?.filter(s=>s&&s.length>3).length>0
                  ?<Blist items={r.press_signals.filter(s=>s&&s.length>3)} col={C.red}/>
                  :r.press_controversies&&!ni(r.press_controversies)
                    ?<div style={{fontSize:13,color:C.slate,lineHeight:1.5}}>{r.press_controversies}</div>
                    :<div style={{fontSize:13,color:C.muted,fontStyle:"italic"}}>No significant activist or press pressure identified.</div>
                }
                {r.investor_activism&&!ni(r.investor_activism)&&!["none identified","not clearly"].some(x=>r.investor_activism.toLowerCase().includes(x))&&(
                  <div style={{marginTop:8,padding:"7px 10px",background:C.r10,borderRadius:6,fontSize:12,color:C.redD}}>
                    <strong>Activist detail:</strong> {r.investor_activism}
                  </div>
                )}
              </div>

              {/* Financial & Industry */}
              <div style={{background:C.white,border:"1px solid rgba(0,0,0,0.07)",borderRadius:9,padding:"12px 14px"}}>
                <SH>Financial &amp; Industry Signals</SH>
                {[...(r.financial_signals||[]),...(r.industry_signals||[])].filter(s=>s&&s.length>3).length>0
                  ?<Blist items={[...(r.financial_signals||[]),...(r.industry_signals||[])].filter(s=>s&&s.length>3).slice(0,5)} col={C.warn}/>
                  :<div style={{fontSize:13,color:C.muted,fontStyle:"italic"}}>No specific financial or industry signals identified.</div>
                }
              </div>
            </div>

            {/* ── Board-Ready Rationale ── */}
            {r.analytical_rationale&&(
              <div style={{background:`linear-gradient(135deg,${C.redDD},${C.redD})`,borderRadius:10,padding:"14px 18px",position:"relative",overflow:"hidden"}}>
                <div style={{position:"absolute",right:-10,top:-10,width:60,height:60,borderRadius:"50%",background:"rgba(255,255,255,0.05)"}}/>
                <div style={{fontSize:11,fontWeight:800,color:"rgba(255,255,255,0.6)",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:7}}>Board-Ready Rationale</div>
                <div style={{fontSize:15,color:C.white,lineHeight:1.7,fontWeight:500}}>{r.analytical_rationale}</div>
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
              <div style={{background:C.white,border:"1px solid rgba(0,0,0,0.07)",borderRadius:9,padding:"11px 13px",marginTop:10}}>
                <SH>Financial Summary</SH>
                <div style={{fontSize:13,color:C.slate,lineHeight:1.5}}>{r.financial_summary}</div>
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
              <div style={{background:"rgba(255,220,0,0.08)",border:"1px solid rgba(255,200,0,0.25)",borderRadius:9,padding:"11px 13px",marginBottom:10}}>
                <SH>Incoming CEO</SH>
                <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
                  <KV label="Name" val={r.incoming_ceo_name}/>
                  <KV label="Background" val={r.incoming_ceo_background}/>
                  <KV label="Start Date" val={r.incoming_ceo_start_date}/>
                </div>
              </div>
            )}
            {!ni(r.mandate_signals)&&(
              <div style={{background:C.white,border:"1px solid rgba(0,0,0,0.07)",borderRadius:9,padding:"11px 13px"}}>
                <SH>Mandate Signals</SH>
                <div style={{fontSize:13,color:C.slate,lineHeight:1.5}}>{r.mandate_signals}</div>
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
              <div style={{background:C.white,border:"1px solid rgba(0,0,0,0.07)",borderRadius:9,padding:"11px 13px"}}>
                <SH>Investor Activism Detail</SH>
                <div style={{fontSize:13,color:C.slate,lineHeight:1.5}}>{r.investor_activism}</div>
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
              <div style={{background:C.white,border:"1px solid rgba(0,0,0,0.07)",borderRadius:9,padding:"11px 13px",marginBottom:10}}>
                <SH>Financial Signals</SH>
                <Blist items={r.financial_signals} col={C.warn}/>
              </div>
            )}
            {r.financial_summary&&(
              <div style={{background:C.white,border:"1px solid rgba(0,0,0,0.07)",borderRadius:9,padding:"11px 13px"}}>
                <SH>Financial Summary</SH>
                <div style={{fontSize:13,color:C.slate,lineHeight:1.6}}>{r.financial_summary}</div>
              </div>
            )}
          </div>
        )}

        {tab==="rationale"&&(
          <div>
            {r.analytical_rationale&&(
              <div style={{background:`linear-gradient(135deg,${C.redDD},${C.redD})`,borderRadius:12,padding:"16px 18px",marginBottom:14}}>
                <div style={{fontSize:11,fontWeight:800,color:"rgba(255,255,255,0.6)",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:8}}>Board-Ready Analytical Rationale</div>
                <div style={{fontSize:16,color:C.white,lineHeight:1.7,fontWeight:500}}>{r.analytical_rationale}</div>
              </div>
            )}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
              <AgentView label="Finance" view={r.finance_view} signals={r.financial_signals||[]} concerns={r.finance_concerns||[]}/>
              <AgentView label="Press" view={r.press_view} signals={r.press_signals||[]} concerns={r.press_concerns||[]}/>
              <AgentView label="Industry" view={r.industry_view} signals={r.industry_signals||[]} concerns={r.industry_concerns||[]}/>
            </div>
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
    <div onClick={onClick} onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}
      style={{padding:"9px 12px",cursor:"pointer",borderBottom:"1px solid rgba(255,255,255,0.03)",
        background:sel?"rgba(204,0,0,0.18)":hov?"rgba(255,255,255,0.04)":"transparent",
        borderLeft:`3px solid ${sel?C.red:isH?"rgba(204,0,0,0.35)":"transparent"}`,transition:"background 0.1s"}}>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        <div style={{width:22,height:22,borderRadius:"50%",background:isH?"rgba(204,0,0,0.25)":"rgba(255,255,255,0.07)",color:isH?"rgba(255,120,120,0.9)":"rgba(255,255,255,0.3)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800,flexShrink:0}}>{idx+1}</div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontWeight:700,fontSize:12,color:sel?C.white:"rgba(255,255,255,0.85)",fontSize:14,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{r.company}</div>
          <div style={{fontSize:12,color:C.muted,marginTop:2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{r.ceo_name||"—"}{r.ceo_tenure_years?` · ${r.ceo_tenure_years}yr`:""}</div>
        </div>
        <div style={{flexShrink:0,display:"flex",flexDirection:"column",alignItems:"flex-end",gap:3}}>
          <div style={{width:8,height:8,borderRadius:"50%",background:col}}/>
          <PredBadge pred={r.prediction} sm/>
        </div>
      </div>
    </div>
  );
}

function PBar({v,t}){
  return(
    <div style={{background:"rgba(255,255,255,0.08)",borderRadius:99,height:3,overflow:"hidden"}}>
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
    try{const t=await f.text();const rows=t.split("\n").map(r=>r.split(",").map(c=>c.trim().replace(/^"|"$/g,"")));setFileCos(rows.filter(r=>r[0]&&r[0].toLowerCase()!=="company").map(r=>({company:r[0],ticker:r[1]||""})).slice(0,20));}
    catch{setErr("CSV parse error");}
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
    <div style={{position:"fixed",inset:0,display:"flex",flexDirection:"column",background:C.ink,fontFamily:"'Segoe UI',system-ui,sans-serif",overflow:"hidden"}}>

      {/* NAV */}
      <div style={{background:`linear-gradient(90deg,${C.redD},${C.red})`,flexShrink:0,borderBottom:"2px solid rgba(0,0,0,0.35)"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"9px 16px",gap:12,flexWrap:"wrap"}}>
          <div style={{display:"flex",alignItems:"center",gap:11}}>
            <div style={{width:34,height:34,borderRadius:7,background:"rgba(255,255,255,0.14)",border:"1px solid rgba(255,255,255,0.18)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:17}}>📊</div>
            <div>
              <div style={{fontSize:18,fontWeight:900,color:C.white,letterSpacing:"-0.01em",lineHeight:1.15}}>CEO Succession Risk Analyzer</div>
              <div style={{fontSize:12,color:"rgba(255,255,255,0.65)"}}>6-agent pipeline · Web search · Portkey · {MODEL}</div>
            </div>
          </div>
          <div style={{display:"flex",gap:14,flexWrap:"wrap"}}>
            {[["🔍 Web Search","Live CEO news"],["📊 Research","Full profile"],["💰 Finance","TSR & revenue"],["📰 Press","Activism"],["🏭 Industry","Sector"],["🎯 Prediction","Board verdict"]].map(([l,s])=>(
              <div key={l} style={{fontSize:11,color:"rgba(255,255,255,0.55)",lineHeight:1.5}}>
                <div style={{fontWeight:800,color:"rgba(255,255,255,0.9)",fontSize:12}}>{l}</div>{s}
              </div>
            ))}
          </div>
          {results.length>0&&(
            <button onClick={()=>setShowIn(x=>!x)} style={{background:"rgba(0,0,0,0.25)",border:"1px solid rgba(255,255,255,0.18)",color:C.white,borderRadius:6,padding:"5px 12px",fontSize:10,fontWeight:700,cursor:"pointer",flexShrink:0}}>
              {showIn?"▲ Hide Input":"▼ New Analysis"}
            </button>
          )}
        </div>
      </div>

      {/* INPUT DRAWER */}
      {showIn&&(
        <div style={{background:C.ink2,borderBottom:"1px solid rgba(255,255,255,0.06)",flexShrink:0}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 220px",alignItems:"stretch"}}>
            <div style={{padding:"12px 16px",borderRight:"1px solid rgba(255,255,255,0.05)"}}>
              <div style={{display:"flex",gap:0,marginBottom:8,borderBottom:"1px solid rgba(255,255,255,0.05)"}}>
                {[["manual","✏ Manual"],["file","📂 CSV"]].map(([id,l])=>(
                  <button key={id} onClick={()=>setITab(id)} style={{padding:"5px 13px",border:"none",cursor:"pointer",fontSize:11,fontWeight:700,background:"transparent",color:iTab===id?C.white:C.slate,borderBottom:iTab===id?`2px solid ${C.red}`:"2px solid transparent"}}>{l}</button>
                ))}
              </div>
              {iTab==="manual"?(
                <div style={{display:"flex",gap:10,alignItems:"flex-start"}}>
                  <textarea value={txt} onChange={e=>setTxt(e.target.value)} rows={3} placeholder={"Apple Inc, AAPL\nMicrosoft, MSFT\nTesla Inc, TSLA"}
                    style={{flex:1,borderRadius:6,border:"1px solid rgba(255,255,255,0.09)",padding:"7px 10px",fontSize:11,fontFamily:"monospace",color:C.white,background:"rgba(255,255,255,0.05)",outline:"none",lineHeight:1.7,resize:"none"}}/>
                  <div style={{fontSize:11,color:C.slate,lineHeight:2,whiteSpace:"nowrap"}}>One per line<br/>Name, TICKER<br/>Max 20</div>
                </div>
              ):(
                <div style={{display:"flex",gap:10,alignItems:"center"}}>
                  <div onClick={()=>fRef.current.click()} style={{flex:1,border:"1.5px dashed rgba(204,0,0,0.4)",borderRadius:7,padding:"10px",textAlign:"center",cursor:"pointer",background:"rgba(204,0,0,0.04)"}}
                    onMouseEnter={e=>e.currentTarget.style.borderColor=C.red} onMouseLeave={e=>e.currentTarget.style.borderColor="rgba(204,0,0,0.4)"}>
                    <div style={{fontSize:11,fontWeight:700,color:C.red}}>📂 Upload CSV</div>
                    <div style={{fontSize:11,color:C.slate,marginTop:2}}>company, ticker columns</div>
                    <input ref={fRef} type="file" accept=".csv" style={{display:"none"}} onChange={handleFile}/>
                  </div>
                  {fileCos.length>0&&<div style={{fontSize:11,color:C.ok,fontWeight:700}}>✓ {fileCos.length} loaded</div>}
                </div>
              )}
              {err&&<div style={{marginTop:6,padding:"5px 9px",background:"rgba(204,0,0,0.12)",border:"1px solid rgba(204,0,0,0.25)",borderRadius:5,fontSize:10,color:"#FF9999"}}>{err}</div>}
            </div>
            <div style={{padding:"12px 14px",display:"flex",flexDirection:"column",justifyContent:"center",gap:10}}>
              <button onClick={run} disabled={running} style={{padding:"10px 0",width:"100%",background:running?"rgba(255,255,255,0.07)":C.red,color:running?C.slate:C.white,border:"none",borderRadius:7,fontSize:12,fontWeight:800,cursor:running?"not-allowed":"pointer",boxShadow:running?"none":`0 4px 18px rgba(204,0,0,0.35)`}}>
                {running?`⏳ ${prog.d}/${prog.t}…`:"▶  Run Pipeline"}
              </button>
              {running&&<div><PBar v={prog.d} t={prog.t}/><div style={{fontSize:9,color:C.slate,marginTop:3,fontFamily:"monospace",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontSize:11}}>{logs[logs.length-1]||""}</div></div>}
              {results.length>0&&!running&&(
                <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:5}}>
                  {[{l:"Total",v:results.length,c:C.white},{l:"New CEO",v:pc.new_ceo_appointed||0,c:C.red},{l:"Transition",v:pc.transition_underway||0,c:C.orange},{l:"High",v:pc.high_likelihood||0,c:C.orange},{l:"Medium",v:pc.medium_likelihood||0,c:C.warn},{l:"Low",v:pc.low_likelihood||0,c:C.ok}].map(({l,v,c})=>(
                    <div key={l} style={{background:"rgba(255,255,255,0.05)",borderRadius:6,padding:"6px 4px",textAlign:"center",border:"1px solid rgba(255,255,255,0.05)"}}>
                      <div style={{fontSize:18,fontWeight:900,color:c,lineHeight:1}}>{v}</div>
                      <div style={{fontSize:10,color:C.slate,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em",marginTop:3}}>{l}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MAIN 2-COL */}
      <div style={{flex:1,display:"grid",gridTemplateColumns:sorted.length?"240px 1fr":"1fr",overflow:"hidden",minHeight:0}}>
        {sorted.length>0&&(
          <div style={{background:C.ink2,borderRight:"1px solid rgba(255,255,255,0.05)",display:"flex",flexDirection:"column",overflow:"hidden"}}>
            <div style={{padding:"8px 12px",borderBottom:"1px solid rgba(255,255,255,0.05)",background:"rgba(0,0,0,0.2)",flexShrink:0,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{fontSize:12,fontWeight:900,color:C.red,textTransform:"uppercase",letterSpacing:"0.08em"}}>{sorted.length} Companies</span>
              <span style={{fontSize:11,color:C.slate}}>by risk ↓</span>
            </div>
            <div style={{flex:1,overflowY:"auto"}}>
              {sorted.map((r,i)=><CRow key={i} r={r} idx={i} sel={sel===i} onClick={()=>setSel(i)}/>)}
            </div>
          </div>
        )}
        <div style={{position:"relative",overflow:"hidden",display:"flex",flexDirection:"column"}}>
          {selR?<Detail r={selR}/>:(
            <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:10}}>
              {sorted.length>0
                ?<><div style={{fontSize:26,opacity:0.15}}>←</div><div style={{fontSize:12,color:C.slate}}>Select a company</div></>
                :(
                  <div style={{textAlign:"center",maxWidth:440,padding:24}}>
                    <div style={{fontSize:40,marginBottom:10,opacity:0.1}}>📊</div>
                    <div style={{fontSize:18,fontWeight:900,color:"rgba(255,255,255,0.1)",marginBottom:8}}>CEO Succession Risk Analyzer</div>
                    <div style={{fontSize:12,color:C.slate,lineHeight:1.8,marginBottom:18}}>6-agent pipeline: Web Search → Research → Finance → Press → Industry → Prediction</div>
                    {!showIn&&<button onClick={()=>setShowIn(true)} style={{padding:"9px 20px",background:C.red,color:C.white,border:"none",borderRadius:7,fontSize:12,fontWeight:800,cursor:"pointer"}}>Open Input</button>}
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