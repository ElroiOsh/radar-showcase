import type { Job } from "./types.js";
import {
  enrichJobsWithFullText,
  fetchLinkedInJobDescription,
  fetchWorkdayJobDescription,
} from "./fetchers/linkedin-detail.js";

const MIN_CHARS = 600;

export function postingPlainText(job: Pick<Job, "description" | "requirements">): string {
  const d = String(job.description || "").trim();
  const r = String(job.requirements || "").trim();
  if (!r) return d;
  if (!d) return r;
  if (d.includes(r.slice(0, Math.min(80, r.length)))) return d;
  return `${d}\n\n${r}`.trim();
}

export function buildAnalyzeBlock(job: Job, flags: string[]): string {
  const posted = job.postedAt
    ? new Date(job.postedAt).toLocaleDateString("en-IL", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "unknown";
  const flagLine = flags.length ? flags.join("; ") : "none";
  const body = postingPlainText(job);
  return `JOB-RADAR ANALYZE
Title: ${job.title}
Company: ${job.company}
Location: ${job.location}
Source: ${job.source} | URL: ${job.url}
Posted: ${posted}
Radar flags: ${flagLine}
--- POSTING START ---
${body}
--- POSTING END ---`;
}

export async function ensureFullDescription(job: Job): Promise<{
  job: Job;
  chars: number;
  incomplete: boolean;
}> {
  let next = { ...job };
  const current = postingPlainText(next);
  if (current.length >= MIN_CHARS) {
    return { job: next, chars: current.length, incomplete: false };
  }

  // Try targeted fetch then generic enrich
  try {
    if (/myworkdayjobs\.com/i.test(next.url)) {
      const text = await fetchWorkdayJobDescription(next.url);
      if (text && text.length > current.length) {
        next = { ...next, description: text, requirements: next.requirements || "" };
      }
    } else if (/linkedin\.com/i.test(next.url)) {
      const m = next.id.match(/^linkedin-(\d+)$/i) || next.url.match(/(\d{8,})/);
      if (m) {
        const r = await fetchLinkedInJobDescription(m[1]);
        if (r.text && r.text.length > current.length) {
          next = { ...next, description: r.text, requirements: next.requirements || "" };
        }
      }
    }
  } catch {
    /* continue */
  }

  if (postingPlainText(next).length < MIN_CHARS) {
    try {
      const [enriched] = await enrichJobsWithFullText([next]);
      next = enriched;
    } catch {
      /* keep */
    }
  }

  const chars = postingPlainText(next).length;
  return { job: next, chars, incomplete: chars < MIN_CHARS };
}
