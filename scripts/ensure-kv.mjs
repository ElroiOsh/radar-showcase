/**
 * Resolve Cloudflare KV namespace id for RADAR_TAGS and patch wrangler.toml.
 *
 * Order:
 * 1) RADAR_KV_NAMESPACE_ID env (GitHub variable/secret) — preferred
 * 2) Create/list via API if the token has Workers KV Storage permission
 */
import { readFileSync, writeFileSync } from "fs";

const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
const account = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
const fromEnv = process.env.RADAR_KV_NAMESPACE_ID?.trim();
const TITLE = "RADAR_TAGS";

function patchToml(id) {
  const path = "wrangler.toml";
  let text = readFileSync(path, "utf8");
  // Remove any previous kv block, then append a clean one.
  text = text.replace(/\n\[\[kv_namespaces\]\][\s\S]*?(?=\n\[|\n*$)/g, "\n");
  text = text.trimEnd() + `

[[kv_namespaces]]
binding = "RADAR_TAGS"
id = "${id}"
preview_id = "${id}"
`;
  writeFileSync(path, text);
  console.log(`Patched wrangler.toml with KV id ${id}`);
}

function writeOutput(id) {
  if (process.env.GITHUB_OUTPUT) {
    writeFileSync(process.env.GITHUB_OUTPUT, `kv_id=${id}\n`, { flag: "a" });
  }
}

if (fromEnv && /^[a-f0-9]{32}$/i.test(fromEnv)) {
  console.log(`Using RADAR_KV_NAMESPACE_ID=${fromEnv}`);
  patchToml(fromEnv);
  writeOutput(fromEnv);
  process.exit(0);
}

if (!token || !account) {
  console.error("Missing CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
};

async function listNamespaces() {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/storage/kv/namespaces?per_page=100`,
    { headers }
  );
  const data = await res.json();
  if (!data.success) throw new Error(JSON.stringify(data.errors || data));
  return data.result || [];
}

async function createNamespace() {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/storage/kv/namespaces`,
    { method: "POST", headers, body: JSON.stringify({ title: TITLE }) }
  );
  const data = await res.json();
  if (!data.success) throw new Error(JSON.stringify(data.errors || data));
  return data.result;
}

try {
  const existing = (await listNamespaces()).find((n) => n.title === TITLE);
  const ns = existing || (await createNamespace());
  console.log(`${existing ? "Found" : "Created"} KV ${TITLE} id=${ns.id}`);
  patchToml(ns.id);
  writeOutput(ns.id);
} catch (err) {
  console.error("KV API failed:", err instanceof Error ? err.message : err);
  console.error(`
Set this up once (free tier):
1. Cloudflare dashboard → Workers & Pages → KV → Create namespace named RADAR_TAGS
2. Copy the Namespace ID
3. GitHub → Settings → Secrets and variables → Actions → Variables → New:
   Name: RADAR_KV_NAMESPACE_ID  Value: <paste id>
4. Edit your CLOUDFLARE_API_TOKEN permissions to include Account → Workers KV Storage → Edit
   (or keep using the variable and skip API create)
`);
  process.exit(1);
}
