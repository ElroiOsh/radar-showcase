import type { Profile } from "../types.js";
import type { RawJob } from "./adzuna.js";
import { looksLikeApplyUrl } from "./jooble.js";

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function parseDrushimHtml(html: string): RawJob[] {
  const jobs: RawJob[] = [];
  const seen = new Set<string>();
  const parts = html.split(/data-nagish="job-card-item"/i);

  for (let i = 1; i < parts.length; i++) {
    const block = parts[i];
    const hrefMatch = block.match(/href="(\/job\/(\d+)\/[a-f0-9]+\/)"/i);
    if (!hrefMatch) continue;
    const path = hrefMatch[1];
    const idNum = hrefMatch[2];
    const titleMatch = block.match(/aria-label="שמור משרה (.+?) למועדפים"/);
    const companyMatch =
      block.match(/data-nagish="job-card-company"[^>]*>([\s\S]*?)</i) ||
      block.match(/job-card-header[\s\S]{0,400}?<span[^>]*>([\s\S]*?)<\/span>/i);
    const locMatch =
      block.match(/data-nagish="job-card-location"[^>]*>([\s\S]*?)</i) ||
      block.match(/>([א-ת][א-ת\s-]{1,30})<\/span>/);

    const title = decodeHtml(titleMatch?.[1] ?? "");
    if (!title || title.length < 3) continue;
    const id = `drushim-${idNum}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const url = `https://www.drushim.co.il${path}`;
    if (!looksLikeApplyUrl(url)) continue;

    jobs.push({
      id,
      source: "Drushim",
      title,
      company: decodeHtml((companyMatch?.[1] ?? "Unknown company").replace(/<[^>]+>/g, "")),
      location: decodeHtml((locMatch?.[1] ?? "Israel").replace(/<[^>]+>/g, "")),
      description: `${title}. Open Drushim for full details and apply.`,
      requirements: "See the Drushim posting for requirements.",
      url,
    });
  }
  return jobs;
}

async function fetchPage(q: string): Promise<RawJob[]> {
  const url = `https://www.drushim.co.il/jobs/search/${encodeURIComponent(q)}/`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(20_000),
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "he-IL,he;q=0.9,en;q=0.8",
    },
  });
  if (!res.ok) {
    console.warn(`Drushim "${q}": HTTP ${res.status}`);
    return [];
  }
  return parseDrushimHtml(await res.text());
}

export async function fetchDrushim(profile: Profile): Promise<RawJob[]> {
  const queries = [
    "מנהל ייצור",
    "הנדסת ייצור",
    "ייצור חכם",
    "אוטומציה תעשייתית",
    "מנהל הנדסה",
    "MES",
    ...profile.search_queries.filter((q) => /[\u0590-\u05FF]/.test(q)).slice(0, 2),
  ];
  const unique = [...new Set(queries)].slice(0, 6);
  const all: RawJob[] = [];
  const seen = new Set<string>();

  for (const q of unique) {
    try {
      const batch = await fetchPage(q);
      for (const job of batch) {
        if (seen.has(job.id)) continue;
        seen.add(job.id);
        all.push(job);
      }
      console.log(`Drushim "${q}": ${batch.length} jobs`);
    } catch (err) {
      console.warn(`Drushim fetch failed for "${q}":`, err);
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  console.log(`Drushim total: ${all.length}`);
  return all;
}
