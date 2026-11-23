import { KEYS, authorize, corsHeaders, getJson, json, putJson } from "../../_lib/kv.js";

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!authorize(request, env)) return json({ error: "Unauthorized" }, 401);
  const body = await request.json().catch(() => ({}));
  if (!body.id) return json({ error: "id required" }, 400);
  const rules = await getJson(env, KEYS.rules, []);
  const idx = rules.findIndex((r) => r.id === body.id);
  if (idx < 0) return json({ error: "rule not found" }, 404);
  const { id, ...patch } = body;
  rules[idx] = { ...rules[idx], ...patch, id };
  await putJson(env, KEYS.rules, rules);
  return json({ ok: true, rule: rules[idx] });
}
