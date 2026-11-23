/**
 * Pull or push feedback/rules JSON between local data/ and Cloudflare KV.
 * Usage:
 *   node scripts/sync-tags-kv.mjs pull
 *   node scripts/sync-tags-kv.mjs push
 * Env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, RADAR_KV_NAMESPACE_ID (or wrangler.toml id)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";

const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
const account = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
const mode = process.argv[2] || "pull";

function kvIdFromToml() {
  try {
    const t = readFileSync("wrangler.toml", "utf8");
    const m = t.match(/binding = "RADAR_TAGS"[\s\S]*?id = "([a-f0-9]{32})"/);
    return m?.[1];
  } catch {
    return null;
  }
}

const ns =
  process.env.RADAR_KV_NAMESPACE_ID?.trim() ||
  kvIdFromToml() ||
  "";

if (!token || !account || !ns || /^0+$/.test(ns)) {
  console.error("Need CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, and a real RADAR_TAGS KV id");
  process.exit(1);
}

const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
const base = `https://api.cloudflare.com/client/v4/accounts/${account}/storage/kv/namespaces/${ns}/values`;

const MAP = [
  { key: "feedback", file: "data/feedback.json", fallback: [] },
  { key: "rules", file: "data/rules.json", fallback: [] },
  { key: "rule-proposals", file: "data/rule-proposals.json", fallback: [] },
];

async function getKey(key) {
  const res = await fetch(`${base}/${encodeURIComponent(key)}`, { headers });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET ${key}: HTTP ${res.status}`);
  return await res.text();
}

async function putKey(key, text) {
  const res = await fetch(`${base}/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "text/plain" },
    body: text,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    throw new Error(`PUT ${key}: ${res.status} ${JSON.stringify(data.errors || data)}`);
  }
}

const SEEDED_KEY = "feedback-seeded";

function readLocal(file) {
  try {
    const v = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

if (mode === "pull") {
  // Until the tags saved in the repo have been pushed to KV once, keep them:
  // otherwise the cloud scan forgets every job tagged on the PC.
  const seeded = (await getKey(SEEDED_KEY)) != null;
  for (const { key, file, fallback } of MAP) {
    const raw = await getKey(key);
    mkdirSync(dirname(file), { recursive: true });
    const local = seeded ? null : readLocal(file);
    if (raw == null) {
      if (local?.length) {
        console.log(`pull ${key}: not in KV yet → keeping ${local.length} entries from ${file}`);
      } else {
        writeFileSync(file, JSON.stringify(fallback, null, 2));
        console.log(`pull ${key}: empty → ${file}`);
      }
      continue;
    }
    if (key === "feedback" && local?.length) {
      let remote = [];
      try {
        const v = JSON.parse(raw);
        if (Array.isArray(v)) remote = v;
      } catch {
        /* keep remote empty */
      }
      const ids = new Set(remote.map((e) => e.jobId));
      const merged = [...remote, ...local.filter((e) => !ids.has(e.jobId))];
      writeFileSync(file, JSON.stringify(merged, null, 2));
      console.log(`pull ${key}: ${remote.length} from KV + ${merged.length - remote.length} repo-only → ${file}`);
      continue;
    }
    writeFileSync(file, raw);
    console.log(`pull ${key}: ${raw.length} bytes → ${file}`);
  }
} else if (mode === "push") {
  for (const { key, file, fallback } of MAP) {
    let text = JSON.stringify(fallback);
    if (existsSync(file)) text = readFileSync(file, "utf8");
    await putKey(key, text);
    console.log(`push ${key}: ${text.length} bytes from ${file}`);
  }
  await putKey(SEEDED_KEY, new Date().toISOString());
} else {
  console.error("Usage: sync-tags-kv.mjs pull|push");
  process.exit(1);
}
