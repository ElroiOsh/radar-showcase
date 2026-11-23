import { KEYS, authorize, corsHeaders, getJson, json, putJson } from "../_lib/kv.js";

function titlePattern(title) {
  const t = String(title || "").toLowerCase();
  const patterns = [
    {
      value: "production_manager",
      keywords: ["production manager", "מנהל ייצור", "מנהל/ת ייצור", "מנהל משמרת"],
      plain: 'Hide jobs with titles like "Production Manager"?',
    },
    {
      value: "shift_manager",
      keywords: ["shift manager", "מנהל משמרת", "מנהל/ת משמרת"],
      plain: 'Hide jobs with titles like "Shift Manager"?',
    },
  ];
  for (const p of patterns) {
    if (p.keywords.some((k) => t.includes(k.toLowerCase()))) return p;
  }
  return null;
}

/** Lightweight suggestions from KV tags (title patterns × reject reason ≥ 3). */
async function refreshProposals(env, feedback) {
  const buckets = new Map();
  for (const e of feedback) {
    if (e.verdict !== "not_relevant") continue;
    const pat = titlePattern(e.title);
    if (!pat) continue;
    for (const reasonId of e.reasons || []) {
      const key = `${pat.value}|${reasonId}`;
      const b = buckets.get(key) || { pat, reasonId, jobIds: [] };
      if (!b.jobIds.includes(e.jobId)) b.jobIds.push(e.jobId);
      buckets.set(key, b);
    }
  }
  const rules = await getJson(env, KEYS.rules, []);
  const existing = await getJson(env, KEYS.proposals, []);
  const rejected = new Set(
    existing.filter((p) => p.status === "rejected").map((p) => `${p.value}|${p.reasonId}`)
  );
  const open = [];
  for (const b of buckets.values()) {
    if (b.jobIds.length < 3) continue;
    const key = `${b.pat.value}|${b.reasonId}`;
    if (rejected.has(key)) continue;
    if (rules.some((r) => r.value === b.pat.value && r.reasonId === b.reasonId)) continue;
    const prev = existing.find((p) => p.value === b.pat.value && p.reasonId === b.reasonId);
    open.push({
      id: prev?.id || `prop-${b.pat.value}-${b.reasonId}`,
      type: "hide",
      attribute: "title_keyword",
      value: b.pat.value,
      keywords: b.pat.keywords,
      reasonId: b.reasonId,
      plainEnglish: b.pat.plain,
      evidenceJobIds: b.jobIds,
      evidenceCount: b.jobIds.length,
      predictedAffect: 0,
      highFitUntaggedWarning: false,
      highFitUntaggedJobIds: [],
      status: "open",
      createdAt: prev?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
  const keptRejected = existing.filter((p) => p.status === "rejected");
  await putJson(env, KEYS.proposals, [...open, ...keptRejected].slice(0, 200));
  return open;
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!authorize(request, env)) return json({ error: "Unauthorized" }, 401);
  const feedback = await getJson(env, KEYS.feedback, []);
  const proposals = await refreshProposals(env, feedback);
  const rules = await getJson(env, KEYS.rules, []);
  return json({ rules, proposals, insights: [], showAnyway: [], hidden: [] });
}
