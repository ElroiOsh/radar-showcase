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
  const next = proposals.map((p) =>
    p.id === id
      ? {
          ...p,
          status: "rejected",
          rejectedAt: new Date().toISOString(),
          rejectedEvidenceCount: p.evidenceCount,
        }
      : p
  );
  await putJson(env, KEYS.proposals, next);
  return json({ ok: true });
}
