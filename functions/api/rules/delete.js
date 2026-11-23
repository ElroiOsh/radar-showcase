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
  const next = rules.filter((r) => r.id !== body.id);
  await putJson(env, KEYS.rules, next);
  return json({ ok: true, rules: next });
}
