import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { projectRoot } from "../profile.js";
import type { Profile } from "../types.js";
import type { RawJob } from "./adzuna.js";
import { looksLikeApplyUrl } from "./jooble.js";
import { linkedInLocationKeep } from "../locations-allow.js";

const QUERIES = [
  "Manufacturing Manager",
  "Engineering Manager Manufacturing",
  "Smart Manufacturing",
  "Industry 4.0",
  "Manufacturing Systems Engineer",
  "Production Engineering Manager",
  "MES Engineer",
  "Advanced Manufacturing",
  "Process Engineer",
  "Manufacturing Engineer",
  "NPI Engineer",
  "Process Lead",
  "Manufacturing Process Engineer",
  "Automation Engineer",
  "Operations Engineering Manager",
  "מהנדס תהליך",
  "מהנדס ייצור",
  "מהנדס NPI",
  "מנהל הנדסת ייצור",
  "מהנדס אוטומציה",
  "Industrial Engineer",
  "Operational Excellence",
  "Continuous Improvement",
  "Plant Manager",
  "מנהל הנדסה",
  "מהנדס תעשייה וניהול",
];

const WEEK_SEC = 604_800;
/** Guest search returns ~10 cards per request; page by what actually came back. */
const MAX_PAGES_PER_QUERY = 3;
const FULL_PAGE_CARDS = 10;

export interface LinkedInFetchOptions {
  /** Epoch ms — stop cleanly before this and return what was collected. */
  deadlineAt?: number;
  /** Live status line for the dashboard ("LinkedIn 12/26 …"). */
  onProgress?: (message: string) => void;
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function parseCards(html: string): { jobs: RawJob[]; rawCount: number } {
  const jobs: RawJob[] = [];
  const blocks = html.split('data-entity-urn="urn:li:jobPosting:');
  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i];
    const idMatch = block.match(/^(\d+)/);
    if (!idMatch) continue;
    const idNum = idMatch[1];

    const hrefMatch = block.match(/href="(https:\/\/[^"]*linkedin\.com\/jobs\/view\/[^"?]+)/i);
    const titleMatch = block.match(/class="base-search-card__title"[^>]*>\s*([^<]+)/i);
    const companyMatch =
      block.match(/class="base-search-card__subtitle"[^>]*>[\s\S]*?<a[^>]*>\s*([^<]+)/i) ||
      block.match(/class="hidden-nested-link"[^>]*>\s*([^<]+)/i);
    const locationMatch = block.match(/class="job-search-card__location"[^>]*>\s*([^<]+)/i);
    const timeMatch = block.match(/datetime="([^"]+)"/i);

    const title = decodeHtml(titleMatch?.[1] ?? "");
    const company = decodeHtml(companyMatch?.[1] ?? "Unknown company");
    const location = decodeHtml(locationMatch?.[1] ?? "Israel");
    let url = hrefMatch?.[1]
      ? decodeHtml(hrefMatch[1])
      : `https://www.linkedin.com/jobs/view/${idNum}`;
    url = url.split("?")[0];

    if (!title || !looksLikeApplyUrl(url)) continue;

    const { keep, unclear } = linkedInLocationKeep(location);
    if (!keep) continue;

    jobs.push({
      id: `linkedin-${idNum}`,
      source: "LinkedIn",
      title,
      company,
      location,
      description: `${title} at ${company} — ${location}. Open the LinkedIn posting for the full description and apply.`,
      requirements: "See the full LinkedIn posting for requirements and Easy Apply / Apply.",
      url,
      postedAt: timeMatch?.[1] ?? new Date().toISOString(),
      locationUnclear: unclear,
    });
  }
  return { jobs, rawCount: blocks.length - 1 };
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function politeDelay(): Promise<void> {
  const ms = 2000 + Math.floor(Math.random() * 3001); // 2–5s
  return delay(ms);
}

async function fetchQuery(
  keywords: string,
  start: number,
  counters: { requests: number; retries: number; blocked: number }
): Promise<{ jobs: RawJob[]; rawCount: number }> {
  const url = new URL(
    "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search"
  );
  url.searchParams.set("keywords", keywords);
  url.searchParams.set("location", "Israel");
  url.searchParams.set("f_TPR", `r${WEEK_SEC}`);
  url.searchParams.set("start", String(start));

  for (let attempt = 1; attempt <= 4; attempt++) {
    counters.requests += 1;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9,he;q=0.8",
      },
    });
    if (res.status === 429) {
      counters.retries += 1;
      const wait = Math.min(60_000, 5_000 * attempt * attempt);
      console.warn(`LinkedIn 429 for "${keywords}" start=${start} — backoff ${wait}ms`);
      await delay(wait);
      continue;
    }
    if (!res.ok) {
      console.warn(`LinkedIn guest "${keywords}" start=${start}: HTTP ${res.status}`);
      counters.blocked += 1;
      return { jobs: [], rawCount: 0 };
    }
    return parseCards(await res.text());
  }
  console.warn(`LinkedIn guest gave up after 429s: "${keywords}" start=${start}`);
  counters.blocked += 1;
  return { jobs: [], rawCount: 0 };
}

export async function fetchLinkedInGuest(
  profile: Profile,
  extraKeywords: string[] = [],
  options: LinkedInFetchOptions = {}
): Promise<RawJob[]> {
  void profile; // fixed query set; profile reserved for future boosts
  const uniqueQueries = [
    ...new Set([...QUERIES, ...extraKeywords.map((q) => q.trim()).filter(Boolean)]),
  ];
  const all: RawJob[] = [];
  const seen = new Set<string>();
  const counters = { requests: 0, retries: 0, blocked: 0 };
  const deadlineAt = options.deadlineAt ?? Number.POSITIVE_INFINITY;
  let stoppedEarly = "";

  console.log(
    `LinkedIn guest plan: ${uniqueQueries.length} queries × up to ${MAX_PAGES_PER_QUERY} pages × 7d`
  );

  queries: for (let qi = 0; qi < uniqueQueries.length; qi++) {
    const q = uniqueQueries[qi];
    options.onProgress?.(
      `Fetching LinkedIn… ${qi + 1}/${uniqueQueries.length} "${q}" · ${all.length} jobs so far`
    );
    let start = 0;
    for (let page = 0; page < MAX_PAGES_PER_QUERY; page++) {
      if (Date.now() > deadlineAt - 20_000) {
        stoppedEarly = "time limit";
        break queries;
      }
      // LinkedIn is refusing us — stop instead of burning minutes on back-offs.
      if (counters.blocked >= 6 && all.length === 0) {
        stoppedEarly = "blocked by LinkedIn";
        break queries;
      }
      let rawCount = 0;
      try {
        const batch = await fetchQuery(q, start, counters);
        rawCount = batch.rawCount;
        let kept = 0;
        for (const job of batch.jobs) {
          if (seen.has(job.id)) continue;
          seen.add(job.id);
          all.push(job);
          kept += 1;
        }
        console.log(
          `LinkedIn 7d "${q}" start=${start}: ${rawCount} cards · ${batch.jobs.length} in area · ${kept} new`
        );
      } catch (err) {
        counters.blocked += 1;
        console.warn(
          `LinkedIn fetch failed for "${q}" start=${start}:`,
          err instanceof Error ? err.message : err
        );
      }
      await politeDelay();
      if (rawCount < FULL_PAGE_CARDS) break; // last page for this query
      start += rawCount;
    }
  }

  if (stoppedEarly) {
    console.warn(`LinkedIn stopped early (${stoppedEarly}) — keeping ${all.length} jobs collected so far`);
  }
  if (!all.length && counters.blocked > 0) {
    throw new Error(
      `LinkedIn returned no jobs (${counters.blocked} blocked/failed requests) — likely rate-limited, try again later`
    );
  }

  try {
    const dir = join(projectRoot(), "data");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "live-jobs.json"), JSON.stringify(all, null, 2), "utf8");
  } catch (err) {
    console.warn("Could not write live-jobs.json:", err);
  }

  console.log(
    `LinkedIn guest done: ${all.length} jobs · requests=${counters.requests} · 429-retries=${counters.retries} · unclear=${
      all.filter((j) => j.locationUnclear).length
    }`
  );
  return all;
}
