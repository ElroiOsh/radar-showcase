import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeHebrewDashboard } from "./dashboard-he.js";
import { fetchLinkedInJobDescription } from "./fetchers/linkedin-detail.js";
import { loadFeedback, feedbackSummary } from "./feedback.js";
import { enrichAndFilter } from "./match.js";
import { loadProfile, projectRoot } from "./profile.js";
import { sortScoreForJob } from "./relevance-filter.js";
import { loadSeenIds, markSeen, saveRun, saveSeenIds } from "./store.js";
import { tagFingerprint } from "./tag-fingerprint.js";
import type { Job, RunResult } from "./types.js";
import type { RawJob } from "./fetchers/adzuna.js";

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function loadLatest(): RunResult | null {
  const path = join(projectRoot(), "data", "latest.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as RunResult;
  } catch {
    return null;
  }
}

async function fromLinkedInUrl(url: string): Promise<RawJob | null> {
  const m = url.match(/linkedin\.com\/jobs\/view\/(?:[^/?#]*-)?(\d+)/i);
  if (!m) return null;
  const idNum = m[1];
  const detail = await fetchLinkedInJobDescription(idNum);
  const text = detail?.text || "";
  const title =
    text.match(/^([^\n]{5,120})/)?.[1]?.trim() ||
    `LinkedIn job ${idNum}`;
  return {
    id: `manual-linkedin-${idNum}`,
    source: "Manual/LinkedIn",
    title,
    company: "Unknown company",
    location: "Israel",
    description: text.slice(0, 8000) || `Pasted LinkedIn job ${idNum}`,
    requirements: text.slice(0, 8000) || "See pasted posting.",
    url: url.split("?")[0],
    postedAt: new Date().toISOString(),
    locationUnclear: true,
  };
}

async function fromGenericUrl(url: string): Promise<RawJob> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(20_000),
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
  });
  if (!res.ok) throw new Error(`Fetch URL HTTP ${res.status}`);
  const html = await res.text();
  const title =
    stripHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").slice(0, 140) ||
    "Pasted job";
  const text = stripHtml(html).slice(0, 10000);
  const hash = createHash("sha1").update(url).digest("hex").slice(0, 12);
  return {
    id: `manual-url-${hash}`,
    source: "Manual",
    title,
    company: "Unknown company",
    location: "Israel",
    description: text || title,
    requirements: text || "See pasted posting.",
    url,
    postedAt: new Date().toISOString(),
    locationUnclear: true,
  };
}

function fromPasteText(text: string, titleHint?: string, companyHint?: string): RawJob {
  const clean = text.replace(/\s+/g, " ").trim();
  const hash = createHash("sha1").update(clean).digest("hex").slice(0, 12);
  const firstLine = clean.split(/[.!?]/)[0]?.slice(0, 100) || "Pasted job";
  return {
    id: `manual-text-${hash}`,
    source: "Manual",
    title: (titleHint || firstLine).slice(0, 160),
    company: (companyHint || "Unknown company").slice(0, 120),
    location: "Israel",
    description: clean.slice(0, 10000),
    requirements: clean.slice(0, 10000),
    url: `manual://paste/${hash}`,
    postedAt: new Date().toISOString(),
    locationUnclear: true,
  };
}

export interface AddJobInput {
  url?: string;
  text?: string;
  title?: string;
  company?: string;
}

export async function addManualJob(input: AddJobInput): Promise<{ job: Job; totalCount: number }> {
  const url = String(input.url || "").trim();
  const text = String(input.text || "").trim();
  if (!url && text.length < 80) {
    throw new Error("Paste a job URL or at least ~80 characters of job text");
  }

  let raw: RawJob;
  if (url) {
    if (/linkedin\.com\/jobs\/view/i.test(url)) {
      raw = (await fromLinkedInUrl(url)) || (await fromGenericUrl(url));
      if (text.length > 80) {
        raw = {
          ...raw,
          description: text.slice(0, 10000),
          requirements: text.slice(0, 10000),
        };
      }
    } else {
      raw = await fromGenericUrl(url);
      if (text.length > 80) {
        raw.description = text.slice(0, 10000);
        raw.requirements = text.slice(0, 10000);
      }
    }
    if (input.title) raw.title = input.title;
    if (input.company) raw.company = input.company;
  } else {
    raw = fromPasteText(text, input.title, input.company);
  }

  const profile = loadProfile();
  const seen = loadSeenIds();
  const feedback = loadFeedback();
  const previous = loadLatest();
  const priorJobs = previous?.jobs ?? [];

  // Manual add bypasses title/geo hard drops: force through scoring with a soft floor
  const scored = enrichAndFilter([raw], profile, seen, feedback);
  let job: Job =
    scored[0] ||
    ({
      ...raw,
      matchScore: 70,
      matchReasons: ["Manually added"],
      isNew: true,
    } as Job);

  // If filters dropped it, keep it anyway as a manual shortlist item
  if (!scored[0]) {
    job = {
      ...raw,
      matchScore: Math.max(profile.min_match_score, 55),
      matchReasons: ["Manually added (kept despite title/location filters)"],
      isNew: true,
    };
  }

  const sort = sortScoreForJob(job.title, job.description || "", job.requirements || "");
  job = {
    ...job,
    matchScore: Math.max(job.matchScore, sort.score, 40),
    aiStatus: undefined,
    fitVerdict: undefined,
    experienceFitPct: undefined,
  };

  const merged = new Map<string, Job>();
  for (const j of priorJobs) merged.set(j.id, j);
  merged.set(job.id, job);
  // Also replace same fingerprint
  const fp = tagFingerprint(job);
  for (const [id, j] of merged) {
    if (id !== job.id && tagFingerprint(j) === fp) merged.set(id, job);
  }

  const list = [...merged.values()];
  const result: RunResult = {
    generatedAt: new Date().toISOString(),
    jobs: list,
    newCount: list.filter((j) => j.isNew).length,
    totalCount: list.length,
  };
  saveRun(result);
  saveSeenIds(markSeen([job], seen));

  const sources = {
    workday: 0,
    comeet: 0,
    linkedin: 0,
    manual: 1,
    ...(previous
      ? {}
      : {}),
  };
  try {
    const prevSrc = JSON.parse(
      readFileSync(join(projectRoot(), "data", "last-scan-sources.json"), "utf8")
    ) as { sources?: Record<string, number> };
    Object.assign(sources, prevSrc.sources || {});
    sources.manual = (sources.manual || 0) + 1;
  } catch {
    /* ignore */
  }

  writeHebrewDashboard(result, {
    sources,
    rulesKept: list.length,
  });

  void feedbackSummary(feedback);
  return { job, totalCount: list.length };
}
