/** @typedef {{ RADAR_TAGS: KVNamespace, RADAR_API_TOKEN?: string }} Env */

const KEYS = {
  feedback: "feedback",
  rules: "rules",
  proposals: "rule-proposals",
};

export function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Radar-Token",
  };
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders() },
  });
}

/** Optional bearer/token for Actions; browser relies on Cloudflare Access in front. */
export function authorize(request, env) {
  const expected = (env.RADAR_API_TOKEN || "").trim();
  if (!expected) return true; // Access-only until token is configured
  const auth = request.headers.get("Authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const header = (request.headers.get("X-Radar-Token") || "").trim();
  // Browser sessions (Access cookie) have no token — allow when Access already passed.
  // Service callers must send the token.
  if (!bearer && !header) return true;
  return bearer === expected || header === expected;
}

export function requireKv(env) {
  if (!env.RADAR_TAGS) {
    throw new Error(
      "RADAR_TAGS KV binding missing. Create KV namespace RADAR_TAGS and set GitHub variable RADAR_KV_NAMESPACE_ID."
    );
  }
}

export async function getJson(env, key, fallback) {
  requireKv(env);
  const raw = await env.RADAR_TAGS.get(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export async function putJson(env, key, value) {
  requireKv(env);
  await env.RADAR_TAGS.put(key, JSON.stringify(value));
}

export { KEYS };
