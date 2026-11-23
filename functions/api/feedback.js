import { KEYS, authorize, corsHeaders, getJson, json, putJson } from "../_lib/kv.js";

function fingerprint(company, title) {
  return `${company || ""} ${title || ""}`
    .toLowerCase()
    .replace(/[^a-z0-9\u0590-\u05ff]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function summary(entries) {
  return {
    relevant: entries.filter((e) => e.verdict === "relevant").length,
    notRelevant: entries.filter((e) => e.verdict === "not_relevant").length,
    applied: entries.filter((e) => e.verdict === "applied").length,
    closed: entries.filter((e) => e.verdict === "closed").length,
  };
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!authorize(request, env)) return json({ error: "Unauthorized" }, 401);
  const entries = await getJson(env, KEYS.feedback, []);
  return json({ entries, summary: summary(entries) });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!authorize(request, env)) return json({ error: "Unauthorized" }, 401);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const verdict = body.verdict;
  if (
    !body.jobId ||
    (verdict !== "relevant" &&
      verdict !== "not_relevant" &&
      verdict !== "applied" &&
      verdict !== "closed")
  ) {
    return json({ error: "jobId and verdict required" }, 400);
  }
  let reasons = Array.isArray(body.reasons) ? body.reasons : [];
  if (verdict === "not_relevant" && reasons.length === 0) {
    return json({ error: "Pick at least one reason" }, 400);
  }
  // Relevant / applied / closed: one-tap — no reason chips
  if (verdict === "relevant" || verdict === "applied" || verdict === "closed") reasons = [];

  const entries = await getJson(env, KEYS.feedback, []);
  const prev = entries.find((e) => e.jobId === body.jobId);
  const history = [...(prev?.history || [])];
  if (prev) {
    history.unshift({
      verdict: prev.verdict,
      reasons: prev.reasons || [],
      note: prev.note,
      updatedAt: prev.updatedAt,
      snapshot: prev.snapshot,
    });
  }
  const title = body.title || prev?.title || "";
  const company = body.company || prev?.company || "";
  const next = {
    jobId: body.jobId,
    verdict,
    title,
    company,
    location: body.location || prev?.location || "",
    source: body.source || prev?.source || "",
    url: body.url || prev?.url || "",
    tokens: prev?.tokens || [],
    reasons,
    note: body.note || undefined,
    fingerprint: body.fingerprint || fingerprint(company, title),
    updatedAt: new Date().toISOString(),
    snapshot: prev?.snapshot || {
      title,
      company,
      location: body.location || "",
      source: body.source || "",
      url: body.url || "",
      seniorityWords: [],
      agency: false,
    },
    history,
  };
  const out = [next, ...entries.filter((e) => e.jobId !== body.jobId)];
  await putJson(env, KEYS.feedback, out.slice(0, 2000));
  return json({ ok: true, verdict, reasons, summary: summary(out) });
}

export async function onRequestDelete(context) {
  const { env, request } = context;
  if (!authorize(request, env)) return json({ error: "Unauthorized" }, 401);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  if (!body.jobId) return json({ error: "jobId required" }, 400);
  const entries = await getJson(env, KEYS.feedback, []);
  const out = entries.filter((e) => e.jobId !== body.jobId);
  await putJson(env, KEYS.feedback, out);
  return json({ ok: true, entries: out, summary: summary(out) });
}
