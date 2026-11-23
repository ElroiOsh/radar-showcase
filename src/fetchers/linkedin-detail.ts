import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { projectRoot } from "../profile.js";
import { requirementsSliceFromFull } from "../job-text.js";
import type { Job } from "../types.js";

const CACHE_PATH = () => join(projectRoot(), "data", "linkedin-desc-cache.json");
const DEFAULT_LI_CAP = 30;
const LI_DELAY_MS = 700;
const WD_DELAY_MS = 150;

type CacheEntry =
  | { ok: true; text: string; fetchedAt: string }
  | { ok: false; status?: number; error?: string; fetchedAt: string };

type CacheFile = Record<string, CacheEntry>;

function loadCache(): CacheFile {
  try {
    if (!existsSync(CACHE_PATH())) return {};
    return JSON.parse(readFileSync(CACHE_PATH(), "utf8")) as CacheFile;
  } catch {
    return {};
  }
}

function saveCache(cache: CacheFile): void {
  const path = CACHE_PATH();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(cache, null, 2), "utf8");
}

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<h[1-6][^>]*>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractMarkup(html: string): string {
  const start = html.indexOf('class="show-more-less-html__markup');
  if (start < 0) {
    // Fallback: description module used on some guest pages
    const alt = html.match(
      /class="[^"]*description__text[^"]*"[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>/i
    );
    return alt ? htmlToText(alt[1]) : "";
  }
  const openEnd = html.indexOf(">", start);
  if (openEnd < 0) return "";
  const close = html.indexOf("</div>", openEnd);
  if (close < 0) return "";
  return htmlToText(html.slice(openEnd + 1, close));
}

function linkedInNumericId(job: Pick<Job, "id" | "url">): string | null {
  const fromId = String(job.id || "").match(/^linkedin-(\d+)$/i);
  if (fromId) return fromId[1];
  const fromUrl = String(job.url || "").match(/linkedin\.com\/jobs\/view\/.*?(\d{8,})/i);
  return fromUrl?.[1] || null;
}

function isThinPosting(job: Pick<Job, "description" | "requirements">): boolean {
  const blob = `${job.description}\n${job.requirements}`.trim();
  if (blob.length < 600) return true;
  return /open the linkedin posting|see (?:the )?full (?:linkedin )?posting|see full posting/i.test(
    blob
  );
}

function isWorkdayJob(job: Pick<Job, "id" | "source" | "url">): boolean {
  return (
    /^workday-/i.test(job.id) ||
    /^Workday\//i.test(job.source) ||
    /myworkdayjobs\.com/i.test(job.url)
  );
}

/** Build CXS job-detail URL from a public Workday posting URL. */
export function workdayDetailUrlFromPosting(postingUrl: string): string | null {
  try {
    const u = new URL(postingUrl);
    if (!/myworkdayjobs\.com$/i.test(u.hostname) && !/\.myworkdayjobs\.com$/i.test(u.hostname)) {
      return null;
    }
    const tenant = u.hostname.split(".")[0];
    const parts = u.pathname.split("/").filter(Boolean);
    // ExternalCareerSite/job/... or External/job/...
    const jobIdx = parts.findIndex((p) => p.toLowerCase() === "job");
    if (jobIdx < 1) return null;
    const site = parts[0];
    const externalPath = parts.slice(jobIdx).join("/"); // job/Loc/Title_id
    return `${u.origin}/wday/cxs/${tenant}/${site}/${externalPath}`;
  } catch {
    return null;
  }
}

export async function fetchWorkdayJobDescription(postingUrl: string): Promise<string | null> {
  const detailUrl = workdayDetailUrlFromPosting(postingUrl);
  if (!detailUrl) return null;
  try {
    const res = await fetch(detailUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      console.warn(`Workday detail HTTP ${res.status}: ${detailUrl}`);
      return null;
    }
    const data = (await res.json()) as {
      jobPostingInfo?: { jobDescription?: string };
    };
    const html = data.jobPostingInfo?.jobDescription ?? "";
    const text = htmlToText(html);
    return text.length >= 200 ? text : null;
  } catch (err) {
    console.warn(
      `Workday detail failed:`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

export async function fetchLinkedInJobDescription(
  jobIdNum: string
): Promise<{ text: string | null; status?: number; blocked?: boolean }> {
  const url = `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${jobIdNum}`;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9,he;q=0.8",
      },
    });
    if (res.status === 429 || res.status === 999 || res.status === 403) {
      console.warn(`LinkedIn detail ${jobIdNum}: blocked HTTP ${res.status}`);
      return { text: null, status: res.status, blocked: true };
    }
    if (!res.ok) {
      console.warn(`LinkedIn detail ${jobIdNum}: HTTP ${res.status}`);
      return { text: null, status: res.status, blocked: res.status >= 400 };
    }
    const html = await res.text();
    const text = extractMarkup(html);
    return { text: text.length >= 200 ? text : null, status: res.status };
  } catch (err) {
    console.warn(`LinkedIn detail ${jobIdNum} failed:`, err instanceof Error ? err.message : err);
    return { text: null, blocked: true };
  }
}

function withFullText<T extends Job>(job: T, full: string): T {
  return {
    ...job,
    description: full,
    requirements: requirementsSliceFromFull(full),
    notEnoughInfoReason: undefined,
  };
}

/**
 * After location/title/rules filters: pull full Workday CXS + LinkedIn guest text.
 * LinkedIn uses disk cache (never refetch same id) + delay + per-run cap.
 */
export async function enrichJobsWithFullText<T extends Job>(jobs: T[]): Promise<T[]> {
  const out = jobs.map((j) => ({ ...j }));
  const cache = loadCache();
  let cacheDirty = false;
  const liCap = Number(process.env.LINKEDIN_DETAIL_MAX || DEFAULT_LI_CAP) || DEFAULT_LI_CAP;
  let liFetches = 0;

  // 1) Workday: every thin posting that survived filters
  for (let i = 0; i < out.length; i++) {
    const job = out[i];
    if (!isWorkdayJob(job) || !isThinPosting(job)) continue;
    const full = await fetchWorkdayJobDescription(job.url);
    if (full) {
      out[i] = withFullText(job, full);
      console.log(`Enriched Workday ${job.id}: ${full.length} chars`);
    } else {
      out[i] = { ...job, notEnoughInfoReason: "no_description" };
      console.warn(`Workday enrich miss ${job.id}`);
    }
    await new Promise((r) => setTimeout(r, WD_DELAY_MS));
  }

  // 2) LinkedIn guest detail for remaining thin candidates
  for (let i = 0; i < out.length; i++) {
    const job = out[i];
    const idNum = linkedInNumericId(job);
    if (!idNum || !isThinPosting(out[i])) continue;

    const cached = cache[idNum];
    if (cached) {
      if (cached.ok && cached.text.length >= 200) {
        out[i] = withFullText(out[i], cached.text);
        console.log(`LinkedIn cache hit ${idNum}: ${cached.text.length} chars`);
      } else {
        out[i] = {
          ...out[i],
          notEnoughInfoReason: "linkedin_blocked",
        };
        console.log(`LinkedIn cache miss/blocked ${idNum}`);
      }
      continue;
    }

    if (liFetches >= liCap) {
      out[i] = { ...out[i], notEnoughInfoReason: "no_description" };
      console.warn(`LinkedIn detail cap (${liCap}) — skip ${idNum}`);
      continue;
    }

    liFetches += 1;
    const result = await fetchLinkedInJobDescription(idNum);
    if (result.text) {
      cache[idNum] = { ok: true, text: result.text, fetchedAt: new Date().toISOString() };
      cacheDirty = true;
      out[i] = withFullText(out[i], result.text);
      console.log(`Enriched LinkedIn ${idNum}: ${result.text.length} chars`);
    } else {
      cache[idNum] = {
        ok: false,
        status: result.status,
        error: result.blocked ? "blocked" : "empty",
        fetchedAt: new Date().toISOString(),
      };
      cacheDirty = true;
      out[i] = {
        ...out[i],
        notEnoughInfoReason: result.blocked ? "linkedin_blocked" : "no_description",
      };
    }
    await new Promise((r) => setTimeout(r, LI_DELAY_MS));
  }

  if (cacheDirty) saveCache(cache);
  return out;
}
