/**
 * Step A validation — run 3 Jooble searches. Never log the API key.
 */
import "dotenv/config";

interface JoobleJob {
  id?: string | number;
  title?: string;
  company?: string;
  location?: string;
  snippet?: string;
  type?: string;
  link?: string;
  updated?: string;
  salary?: string;
  source?: string;
}

interface JoobleResponse {
  totalCount?: number;
  jobs?: JoobleJob[];
}

const QUERIES = ["Process Engineer", "Manufacturing Engineer", "Automation Engineer"];
const TARGET_CITIES = ["Rehovot", "Kiryat Gat", "Petah Tikva", "Ashdod", "רחובות", "קריית גת", "פתח תקווה", "אשדוד"];

async function search(keywords: string, location: string): Promise<JoobleResponse> {
  const apiKey = process.env.JOOBLE_API_KEY?.trim();
  if (!apiKey) throw new Error("JOOBLE_API_KEY missing");

  const endpoints = [
    process.env.JOOBLE_API_URL?.trim(),
    `https://il.jooble.org/api/${apiKey}`,
    `https://jooble.org/api/${apiKey}`,
  ].filter(Boolean) as string[];

  let lastErr = "unknown";
  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keywords,
          location,
          radius: "80",
          page: "1",
          ResultOnPage: "20",
          companysearch: "false",
        }),
        signal: AbortSignal.timeout(40_000),
      });
      if (!res.ok) {
        lastErr = `HTTP ${res.status} via ${endpoint.includes("il.jooble") ? "il" : "us"}`;
        continue;
      }
      const data = (await res.json()) as JoobleResponse;
      const host = endpoint.includes("il.jooble") ? "il" : endpoint.includes("jooble.org") ? "us" : "custom";
      console.log(`(host=${host} keywords="${keywords}" location="${location}" total=${data.totalCount ?? "?"})`);
      return data;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
  }
  throw new Error(`Jooble failed for "${keywords}": ${lastErr}`);
}

function strip(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

async function main() {
  const allLocations = new Set<string>();
  const cityHits = new Map<string, number>();

  for (const keywords of QUERIES) {
    const data = await search(keywords, "Israel");
    const jobs = data.jobs ?? [];
    console.log(`\n=== ${keywords} | totalCount=${data.totalCount ?? "?"} | returned=${jobs.length} ===`);
    const top = jobs.slice(0, 10);
    if (!top.length) {
      console.log("(no jobs)");
    }
    for (const [i, j] of top.entries()) {
      const loc = j.location ?? "";
      allLocations.add(loc);
      console.log(
        [
          `${i + 1}. ${j.title ?? "?"}`,
          `   company: ${j.company ?? "?"}`,
          `   location: ${loc || "?"}`,
          `   date: ${j.updated ?? "?"}`,
          `   url: ${j.link ?? "?"}`,
          `   snippet_len: ${strip(j.snippet ?? "").length}`,
          `   type: ${j.type ?? "-"}`,
          `   id: ${j.id ?? "?"}`,
        ].join("\n")
      );
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  // Broader manufacturing sample for city check
  const mfg = await search("ייצור", "Israel");
  for (const j of mfg.jobs ?? []) {
    const loc = (j.location ?? "").toLowerCase();
    allLocations.add(j.location ?? "");
    for (const city of TARGET_CITIES) {
      if (loc.includes(city.toLowerCase())) {
        cityHits.set(city, (cityHits.get(city) || 0) + 1);
      }
    }
  }

  console.log("\n=== CITY CHECK (from ייצור + the 3 searches) ===");
  for (const city of ["Rehovot", "Kiryat Gat", "Petah Tikva", "Ashdod"]) {
    const he = { Rehovot: "רחובות", "Kiryat Gat": "קריית גת", "Petah Tikva": "פתח תקווה", Ashdod: "אשדוד" }[city]!;
    const n = (cityHits.get(city) || 0) + (cityHits.get(he) || 0);
    console.log(`${city}: ${n > 0 ? `YES (${n} hits)` : "not seen in this sample"}`);
  }

  console.log("\n=== SAMPLE LOCATIONS (unique, up to 25) ===");
  console.log([...allLocations].filter(Boolean).slice(0, 25).join(" | "));

  // Snippet vs "full description" probe on first job of Manufacturing Engineer
  const probe = await search("Manufacturing Engineer", "Israel");
  const first = probe.jobs?.[0];
  if (first) {
    const sn = strip(first.snippet ?? "");
    console.log("\n=== DETAILS PROBE ===");
    console.log(`First job id=${first.id}`);
    console.log(`snippet length=${sn.length}`);
    console.log(`snippet preview: ${sn.slice(0, 180)}…`);
    console.log("Official Jooble REST API: search only — no get-by-id details endpoint.");
  }
}

main().catch((err) => {
  console.error("VALIDATION_FAILED:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
