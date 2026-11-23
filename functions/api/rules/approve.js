import { KEYS, authorize, corsHeaders, getJson, json, putJson } from "../../_lib/kv.js";

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!authorize(request, env)) return json({ error: "Unauthorized" }, 401);
  const body = await request.json().catch(() => ({}));
  const id = body.proposalId || body.id;
  if (!id) return json({ error: "proposalId required" }, 400);
  const proposals = await getJson(env, KEYS.proposals, []);
  const prop = proposals.find((p) => p.id === id && p.status === "open");
  if (!prop) return json({ error: "proposal not found" }, 404);
  const rules = await getJson(env, KEYS.rules, []);
  const rule = {
    id: `rule-${Date.now().toString(36)}`,
    type: prop.type || "hide",
    attribute: prop.attribute,
    value: prop.value,
    keywords: prop.keywords || [],
    reasonId: prop.reasonId,
    plainEnglish: body.plainEnglish || prop.plainEnglish,
    enabled: true,
    createdAt: new Date().toISOString(),
    evidenceJobIds: prop.evidenceJobIds || [],
  };
  rules.unshift(rule);
  const nextProps = proposals.map((p) =>
    p.id === id ? { ...p, status: "rejected", rejectedAt: new Date().toISOString() } : p
  );
  await putJson(env, KEYS.rules, rules);
  await putJson(env, KEYS.proposals, nextProps);
  return json({ ok: true, rule, rules });
}
