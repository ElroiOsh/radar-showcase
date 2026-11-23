import "dotenv/config";

const key = process.env.JOOBLE_API_KEY?.trim();
if (!key) {
  console.error("missing key");
  process.exit(1);
}

async function hit(host: "il" | "us", keywords: string, location: string) {
  const base = host === "il" ? "https://il.jooble.org/api/" : "https://jooble.org/api/";
  const url = base + key;
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        keywords,
        location,
        page: "1",
        ResultOnPage: "5",
        companysearch: "false",
      }),
      signal: AbortSignal.timeout(25_000),
    });
    const text = await res.text();
    const safe = text.split(key).join("[REDACTED]");
    let total = "?";
    let n = "?";
    try {
      const j = JSON.parse(text) as { totalCount?: number; jobs?: unknown[] };
      total = String(j.totalCount ?? "?");
      n = String(j.jobs?.length ?? 0);
    } catch {
      /* ignore */
    }
    console.log(
      `${host} ${keywords} @ ${location} → HTTP ${res.status} total=${total} jobs=${n} ${Date.now() - started}ms body=${safe.slice(0, 100)}`
    );
  } catch (e) {
    console.log(`${host} ${keywords} @ ${location} → FAIL ${Date.now() - started}ms ${(e as Error).message}`);
  }
}

await hit("us", "Software Engineer", "New York");
await hit("us", "Process Engineer", "Israel");
await hit("il", "Process Engineer", "Israel");
await hit("il", "Process Engineer", "Tel Aviv");
await hit("us", "nurse", "Austin");
