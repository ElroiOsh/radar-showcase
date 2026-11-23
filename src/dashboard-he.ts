import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadBlockedCompanies } from "./companies.js";
import { buildAnalyzeBlock, postingPlainText } from "./analyze-block.js";
import { loadClaudeSent } from "./claude-sent.js";
import { findTagForJob, loadFeedback } from "./feedback.js";
import { projectRoot } from "./profile.js";
import { applyRulesToJobs, loadRules, regenerateProposals } from "./rules-learn.js";
import type { FilteredOutItem } from "./relevance-filter.js";
import type { SourceResult } from "./scan-progress.js";
import type { FeedbackVerdict, Job, RunResult } from "./types.js";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function dateMs(job: Job): number {
  const t = job.postedAt ? Date.parse(job.postedAt) : 0;
  return Number.isNaN(t) ? 0 : t;
}

/** Board stubs only — AI ratings are kept in history but not shown. */
export function shouldHideFromDashboard(job: Job): boolean {
  return job.id.startsWith("board-");
}

function visibleJobs(jobs: Job[]): { shown: Job[]; hiddenCount: number } {
  const base = jobs.filter((j) => !shouldHideFromDashboard(j));
  const shown = [...base].sort((a, b) => {
    if (a.isNew !== b.isNew) return a.isNew ? -1 : 1;
    if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
    return dateMs(b) - dateMs(a);
  });
  return { shown, hiddenCount: jobs.length - shown.length };
}

function tagFilter(verdict?: FeedbackVerdict): string {
  if (verdict === "relevant") return "relevant";
  if (verdict === "not_relevant") return "not_relevant";
  if (verdict === "applied") return "applied";
  if (verdict === "closed") return "closed";
  return "untagged";
}

function card(job: Job, sentMap: Record<string, string>): string {
  const date = job.postedAt
    ? new Date(job.postedAt).toLocaleDateString("en-IL")
    : "No date";
  const badge = job.isNew ? `<span class="new">New</span>` : "";
  const fb = job.userFeedback;
  const tag = tagFilter(fb);
  const ruleNotes = (job.matchReasons || []).filter(
    (r) => r.startsWith("Rule ") || r.startsWith("Title:") || r.startsWith("Body:") || r === "Location unclear"
  );
  const tagLabel =
    fb === "relevant"
      ? "Tagged relevant"
      : fb === "not_relevant"
        ? "Tagged not relevant"
        : fb === "applied"
          ? "Tagged applied"
          : fb === "closed"
            ? "Closed"
            : "";
  const sent = Boolean(sentMap[job.id]);
  const unclear = job.locationUnclear
    ? `<span class="loc-unclear" title="City not specified on the posting">Location unclear</span>`
    : "";
  const flags = [];
  if (job.locationUnclear) flags.push("Location unclear");
  const sentLabel = sent
    ? `<span class="claude-sent" data-claude-sent="1">Sent to Claude</span>`
    : `<span class="claude-sent" data-claude-sent="0" hidden>Sent to Claude</span>`;

  return `<article class="job" data-rec="pass" data-id="${esc(job.id)}" data-tag="${esc(
    tag
  )}" data-title="${esc(job.title)}" data-company="${esc(job.company)}" data-location="${esc(
    job.location
  )}" data-source="${esc(job.source)}" data-url="${esc(job.url)}" data-posted="${esc(
    job.postedAt || ""
  )}" data-location-unclear="${job.locationUnclear ? "1" : "0"}" data-claude-sent="${
    sent ? "1" : "0"
  }">
  <header>
    <div class="meta"><span dir="auto">${esc(job.source)}</span><span class="sep" aria-hidden="true">·</span><span dir="auto">${esc(
      job.location
    )}</span>${unclear}<span class="sep" aria-hidden="true">·</span><span>${esc(date)}</span>${badge} ${sentLabel}</div>
    <h2><a href="${esc(job.url)}" target="_blank" rel="noopener noreferrer" dir="auto">${esc(job.title)}</a></h2>
    <p class="company" dir="auto">${esc(job.company)}</p>
  </header>
  ${ruleNotes.map((n) => `<p class="rule-note">${esc(n)}</p>`).join("")}
  <div class="card-actions">
    <div class="card-actions-left">
      <a class="cta" href="${esc(job.url)}" target="_blank" rel="noopener noreferrer">Open job posting<span aria-hidden="true"> →</span></a>
      <button type="button" class="btn-analyze" data-analyze="1">Analyze in Claude</button>
    </div>
    <div class="tag-row" role="group" aria-label="Relevance tag">
      <button type="button" class="tag-btn tag-up${fb === "relevant" ? " is-on" : ""}" data-verdict="relevant" aria-pressed="${
        fb === "relevant" ? "true" : "false"
      }" aria-label="Mark relevant">✅ Relevant</button>
      <button type="button" class="tag-btn tag-down${
        fb === "not_relevant" ? " is-on" : ""
      }" data-verdict="not_relevant" aria-pressed="${
        fb === "not_relevant" ? "true" : "false"
      }" aria-label="Mark not relevant">❌ Not relevant</button>
      <button type="button" class="tag-btn tag-applied${fb === "applied" ? " is-on" : ""}" data-verdict="applied" aria-pressed="${
        fb === "applied" ? "true" : "false"
      }" aria-label="Mark applied">📨 Applied</button>
      <span class="tag-state" data-empty="${tagLabel ? "0" : "1"}">${esc(tagLabel)}</span>
    </div>
  </div>
</article>`;
}

export type DashboardMeta = {
  sources: Record<string, number>;
  rulesKept: number;
  aiRated?: number;
  aiSkipped?: number;
  sourceResults?: SourceResult[];
  timedOut?: boolean;
  filteredOut?: FilteredOutItem[];
  filterSummary?: string;
};

/**
 * Ready-to-send "JOB-RADAR ANALYZE" prompts, embedded in the page so the button
 * works on the static cloud site (no server call needed at click time).
 */
function analyzeBlocksJson(jobs: Job[]): string {
  const map: Record<string, { block: string; incomplete: boolean }> = {};
  for (const job of jobs) {
    const incomplete = postingPlainText(job).length < 600;
    const flags: string[] = [];
    if (job.locationUnclear) flags.push("Location unclear");
    if (incomplete) flags.push("Description incomplete");
    map[job.id] = { block: buildAnalyzeBlock(job, flags), incomplete };
  }
  // Safe inside <script>: no raw "<" (so no </script> or <!--), no JS line separators.
  return JSON.stringify(map)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function renderHebrewDashboard(result: RunResult, meta: DashboardMeta): string {
  const feedback = loadFeedback();
  const withFb = result.jobs.map((j) => {
    const e = findTagForJob(feedback, j);
    return e
      ? { ...j, userFeedback: e.verdict, userFeedbackReasons: e.reasons }
      : j;
  });
  const { visible, hidden } = applyRulesToJobs(withFb, loadRules());
  regenerateProposals(withFb);
  const { shown: jobs, hiddenCount: qualityHidden } = visibleJobs(visible);
  const dropList: FilteredOutItem[] = [
    ...(meta.filteredOut || []),
    ...hidden.map((h) => ({
      title: h.job.title,
      company: h.job.company,
      reason: `hidden: approved rule — ${h.rule.plainEnglish}`,
      kind: "other" as const,
    })),
  ];
  const filteredOutCount = Math.max(dropList.length, qualityHidden + hidden.length);
  const sentMap = loadClaudeSent();
  const dateLabel = new Date(result.generatedAt).toLocaleString("en-IL", {
    dateStyle: "full",
    timeStyle: "short",
  });
  const dropPreview = dropList
    .slice(0, 40)
    .map(
      (d) =>
        `<li><span dir="auto">${esc(d.title)}</span> · <span dir="auto">${esc(d.company)}</span> — ${esc(d.reason)}</li>`
    )
    .join("");
  return `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex,nofollow" />
  <meta name="color-scheme" content="light" />
  <meta name="theme-color" content="#0e1614" />
  <title>RADAR · Filtered jobs</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700;800&display=swap" rel="stylesheet" />
  <style>
    :root {
      --ink: #101816;
      --muted: #5a6a64;
      --paper: #f3f6f4;
      --mint-wash: #e8f2ec;
      --panel: #ffffff;
      --line: #d5ddd8;
      --yield: #0f8a6a;
      --cta: #0a5c48;
      --maybe: #c45c26;
      --unrated: #889992;
      --brand-spark: #8fe0c5;
      --hero-ink: #f4f7f5;
      --hero-muted: #c9d7d0;
      --focus: #0f8a6a;
      --radius-badge: 6px;
      --radius-stat: 10px;
      --radius-card: 14px;
      --desk: 720px;
    }
    * { box-sizing: border-box; }
    html { -webkit-text-size-adjust: 100%; }
    body {
      margin: 0;
      font-family: "DM Sans", "Segoe UI", sans-serif;
      background: linear-gradient(180deg, var(--mint-wash), var(--paper));
      color: var(--ink);
      line-height: 1.45;
      text-wrap: pretty;
    }
    ::selection {
      background: rgba(15, 138, 106, 0.22);
      color: var(--ink);
    }
    a:focus-visible,
    .cta:focus-visible,
    h2 a:focus-visible {
      outline: 2px solid var(--focus);
      outline-offset: 3px;
      border-radius: 4px;
    }
    header.hero {
      padding: 1.35rem 1rem 1.15rem;
      background: linear-gradient(145deg, #0e1614, #1c3a4a);
      color: var(--hero-ink);
    }
    .hero-inner { max-width: var(--desk); margin: 0 auto; }
    .brand {
      font-weight: 800;
      font-size: clamp(1.75rem, 4vw, 2rem);
      margin: 0;
      letter-spacing: -0.03em;
      line-height: 1.1;
    }
    .brand span { color: var(--brand-spark); }
    .hero p {
      margin: 0.45rem 0 0;
      color: var(--hero-muted);
      font-size: 0.95rem;
    }
    main {
      max-width: var(--desk);
      margin: 0 auto;
      padding: 1.15rem 1rem 0.5rem;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.5rem;
      margin: 0 0 0.85rem;
    }
    .stat {
      background: var(--panel);
      border: 1px solid var(--line);
      padding: 0.7rem 0.8rem;
      border-radius: var(--radius-stat);
    }
    .stat strong {
      display: block;
      font-size: 1.25rem;
      font-variant-numeric: tabular-nums;
      letter-spacing: -0.02em;
    }
    .stat span { color: var(--muted); font-size: 0.85rem; }
    .sources {
      color: var(--muted);
      font-size: 0.9rem;
      margin: 0 0 0.75rem;
    }
    .toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 0.45rem;
      margin: 0 0 1rem;
      align-items: center;
    }
    .toolbar button, .toolbar a.tool-btn {
      appearance: none; -webkit-appearance: none;
      border: 1px solid var(--line);
      background: var(--panel);
      color: var(--ink);
      font: inherit;
      font-weight: 700;
      font-size: 0.88rem;
      padding: 0.55rem 0.8rem;
      border-radius: 10px;
      min-height: 2.5rem;
      cursor: pointer;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
    }
    .toolbar button.primary {
      background: var(--cta);
      color: #fff;
      border-color: var(--cta);
    }
    .toolbar button:disabled { opacity: 0.55; cursor: wait; }
    .toolbar #scan-status {
      color: var(--muted);
      font-size: 0.85rem;
      flex: 1 1 12rem;
    }
    .loc-unclear {
      display: inline-block;
      margin-inline-start: 0.25rem;
      padding: 0.1rem 0.4rem;
      border-radius: var(--radius-badge);
      background: #f3e6d8;
      color: #8a3f18;
      font-size: 0.72rem;
      font-weight: 700;
    }
    .add-panel, .scan-extra {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: var(--radius-card);
      padding: 0.85rem 0.9rem;
      margin: 0 0 1rem;
    }
    .add-panel[hidden], .scan-extra[hidden] { display: none; }
    .add-panel label, .scan-extra label {
      display: block;
      font-size: 0.82rem;
      font-weight: 700;
      margin: 0.35rem 0 0.25rem;
    }
    .add-panel input, .add-panel textarea, .scan-extra input {
      width: 100%;
      font: inherit;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 0.55rem 0.65rem;
    }
    .add-panel textarea { min-height: 7rem; resize: vertical; }
    .add-actions { display: flex; gap: 0.45rem; margin-top: 0.65rem; flex-wrap: wrap; }
    .jobs { display: grid; gap: 0.85rem; }
    .job {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: var(--radius-card);
      padding: 1rem 1rem 1.05rem;
      border-left: 5px solid var(--yield);
    }
    .job[data-rec="maybe"] { border-left-color: var(--maybe); }
    .job[data-rec="blocked"] { border-left-color: #6b7a74; }
    .job[data-rec="unrated"] { border-left-color: var(--unrated); }
    .meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.25rem 0.35rem;
      color: var(--muted);
      font-size: 0.85rem;
      margin-bottom: 0.4rem;
    }
    .meta .sep { opacity: 0.7; }
    .new {
      background: #dff0e9;
      color: var(--cta);
      font-weight: 700;
      font-size: 0.78rem;
      letter-spacing: 0.02em;
      padding: 0.15rem 0.45rem;
      border-radius: var(--radius-badge);
      margin-left: 0.15rem;
    }
    h2 {
      margin: 0;
      font-size: 1.2rem;
      font-weight: 700;
      line-height: 1.3;
      text-wrap: balance;
    }
    h2 a {
      color: inherit;
      text-decoration: none;
    }
    h2 a:hover { text-decoration: underline; text-underline-offset: 0.15em; }
    .company {
      margin: 0.3rem 0 0.85rem;
      color: var(--muted);
      font-size: 0.95rem;
    }
    .rec-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.45rem 0.65rem;
      margin: 0 0 0.75rem;
    }
    .rec-pill {
      font-size: 0.78rem;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      padding: 0.18rem 0.5rem;
      border-radius: var(--radius-badge);
      border: 1px solid transparent;
    }
    .rec-go {
      color: var(--cta);
      background: #dff0e9;
      border-color: #b9ddd0;
    }
    .rec-maybe {
      color: #8a3f18;
      background: #f7e4d6;
      border-color: #ebc9b0;
    }
    .rec-blocked {
      color: #3d4a45;
      background: #e6ebe8;
      border-color: #c5cfc9;
      text-transform: none;
      letter-spacing: 0;
    }
    .rec-meta { color: var(--muted); font-size: 0.85rem; }
    .filtered-out {
      margin: 1.25rem 0 0;
      border: 1px dashed var(--line);
      border-radius: 10px;
      background: #eef2f0;
      color: var(--muted);
      font-size: 0.85rem;
    }
    .filtered-out summary {
      cursor: pointer;
      padding: 0.55rem 0.75rem;
      font-weight: 700;
      list-style: none;
    }
    .filtered-out summary::-webkit-details-marker { display: none; }
    .filtered-out p {
      margin: 0;
      padding: 0 0.75rem 0.45rem;
      font-size: 0.8rem;
    }
    .filtered-out-list {
      margin: 0;
      padding: 0 0.75rem 0.75rem 1.6rem;
      font-size: 0.78rem;
      color: var(--muted);
      max-height: 14rem;
      overflow: auto;
    }
    .filtered-out-list li { margin: 0.2rem 0; }
    .fits {
      display: grid;
      gap: 0.4rem;
      margin: 0 0 0.85rem;
      padding: 0.15rem 0 0.25rem;
      border-top: 1px solid var(--line);
      padding-top: 0.7rem;
    }
    .fit {
      display: grid;
      grid-template-columns: 0.7rem 1fr auto;
      gap: 0.5rem;
      align-items: center;
      font-size: 0.9rem;
    }
    .fit-dot {
      width: 0.55rem;
      height: 0.55rem;
      border-radius: 50%;
      background: var(--unrated);
    }
    .fit-high { background: var(--yield); }
    .fit-medium { background: #c4a035; }
    .fit-low-medium { background: var(--maybe); }
    .fit-low { background: #b44a4a; }
    .fit-label { color: var(--muted); }
    .fit-val { font-weight: 600; font-variant-numeric: tabular-nums; }
    .why, .gaps, .check, .unrated {
      margin: 0.45rem 0;
      font-size: 0.95rem;
      max-width: 68ch;
    }
    .k {
      display: inline-block;
      min-width: 4.6rem;
      font-weight: 700;
      color: var(--ink);
      margin-right: 0.25rem;
    }
    .unrated { color: #8a3f18; }
    .unrated .k { color: #8a3f18; }
    .cta {
      display: inline-flex;
      align-items: center;
      min-height: 2.75rem;
      margin-top: 0.55rem;
      padding: 0.35rem 0;
      font-weight: 700;
      color: var(--cta);
      text-decoration: none;
      text-underline-offset: 0.18em;
    }
    .cta:hover { text-decoration: underline; }
    .empty {
      padding: 1.35rem 1.1rem;
      border: 1px dashed var(--line);
      color: var(--muted);
      border-radius: 12px;
      background: rgba(255,255,255,0.55);
    }
    footer {
      text-align: center;
      color: var(--muted);
      padding: 1.75rem 1rem 2.25rem;
      font-size: 0.85rem;
    }
    @media (min-width: 640px) {
      .stats { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    }
    .hero-links { margin-top: 0.65rem; }
    .hero-links a {
      color: var(--brand-spark);
      font-weight: 700;
      font-size: 0.9rem;
      text-decoration: none;
    }
    .hero-links a:hover { text-decoration: underline; text-underline-offset: 0.15em; }
    .filters {
      display: flex; flex-wrap: wrap; gap: 0.4rem;
      margin: 0 0 1rem;
    }
    .filter-btn {
      appearance: none; border: 1px solid var(--line); background: var(--panel);
      color: var(--muted); font: inherit; font-size: 0.85rem; font-weight: 600;
      padding: 0.4rem 0.7rem; border-radius: 999px; min-height: 2.4rem; cursor: pointer;
    }
    .filter-btn.is-on { border-color: #b9ddd0; background: #dff0e9; color: var(--cta); }
    .filter-btn:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
    .tab-count {
      display: inline-block; min-width: 1.4em; margin-inline-start: 0.25rem;
      font-weight: 800; opacity: 0.75;
    }
    .tag-btn.tag-applied.is-on { border-color: #5b7c99; background: #e8f0f7; color: #1e3a54; }
    .learn-panel {
      margin: 0 0 1.25rem; padding: 1rem 1.1rem; border: 1px solid var(--line);
      border-radius: 12px; background: var(--panel);
    }
    .learn-panel h2 { margin: 0 0 0.35rem; font-size: 1.05rem; }
    .learn-panel h2 + .learn-lead { margin: 0 0 0.85rem; color: var(--muted); font-size: 0.9rem; }
    .learn-panel h2:not(:first-child) { margin-top: 1.1rem; }
    .suggestions { display: grid; gap: 0.65rem; }
    .suggestion {
      border: 1px solid var(--line); border-radius: 10px; padding: 0.75rem 0.85rem;
      background: #f7faf8;
    }
    .suggestion strong { display: block; margin-bottom: 0.35rem; }
    .suggestion .row { display: flex; flex-wrap: wrap; gap: 0.45rem; margin-top: 0.55rem; }
    .suggestion button {
      appearance: none; border: 1px solid var(--line); background: #fff; color: var(--ink);
      font: inherit; font-weight: 700; padding: 0.45rem 0.7rem; border-radius: 8px; cursor: pointer;
    }
    .suggestion button.primary { background: var(--cta); color: #fff; border-color: var(--cta); }
    .card-actions {
      display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between;
      gap: 0.5rem 1rem; margin-top: 0.35rem;
    }
    .tag-row { display: flex; flex-wrap: wrap; align-items: center; gap: 0.35rem; }
    .tag-btn {
      appearance: none; border: 1px solid var(--line); background: var(--panel);
      color: var(--ink); font: inherit; font-size: 0.82rem; font-weight: 700;
      padding: 0.4rem 0.65rem; border-radius: 8px; min-height: 2.5rem; cursor: pointer;
    }
    .tag-btn.is-on.tag-up { border-color: #b9ddd0; background: #dff0e9; color: var(--cta); }
    .tag-btn.is-on.tag-down { border-color: #ebc9b0; background: #f7e4d6; color: #8a3f18; }
    .tag-btn:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
    .tag-state {
      font-size: 0.8rem; color: var(--muted); min-height: 1.1em;
    }
    .tag-state[data-empty="1"] { opacity: 0; }
    .job[data-tag="relevant"] { box-shadow: inset 0 0 0 1px #b9ddd0; }
    .job[data-tag="not_relevant"] { box-shadow: inset 0 0 0 1px #ebc9b0; }
    .rule-note { margin: 0.35rem 0; font-size: 0.85rem; color: var(--muted); }
    .job.is-filter-hidden { display: none; }
    .sheet-backdrop {
      position: fixed; inset: 0; background: rgba(16,24,22,0.45);
      opacity: 0; pointer-events: none; transition: opacity 0.18s ease;
      z-index: 40;
    }
    .sheet-backdrop.is-open { opacity: 1; pointer-events: auto; }
    .sheet {
      position: fixed; left: 0; right: 0; bottom: 0; z-index: 50;
      display: flex; flex-direction: column;
      background: var(--panel); border-radius: 16px 16px 0 0;
      border: 1px solid var(--line); border-bottom: 0;
      padding: 0;
      transform: translateY(110%); transition: transform 0.2s ease;
      max-height: min(100dvh, 100vh); overflow: hidden;
    }
    .sheet.is-open { transform: translateY(0); }
    .sheet-body {
      flex: 0 1 auto; overflow: visible; padding: 0.85rem 1rem 0.35rem;
    }
    .sheet-footer {
      flex: 0 0 auto;
      padding: 0.65rem 1rem calc(0.75rem + env(safe-area-inset-bottom));
      border-top: 1px solid var(--line);
      background: var(--panel);
      position: sticky; bottom: 0;
    }
    @media (min-width: 720px) {
      .sheet {
        left: 50%; right: auto; bottom: auto; top: 12vh;
        width: min(420px, calc(100vw - 2rem));
        transform: translate(-50%, -8px) scale(0.98); opacity: 0;
        border-radius: 14px; border-bottom: 1px solid var(--line);
        pointer-events: none; max-height: min(88vh, 560px);
      }
      .sheet.is-open { transform: translate(-50%, 0) scale(1); opacity: 1; pointer-events: auto; }
    }
    .sheet h3 { margin: 0 0 0.4rem; font-size: 1.02rem; }
    .sheet-job {
      color: var(--muted); font-size: 0.85rem; margin: 0 0 0.65rem;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    }
    .chips { display: flex; flex-wrap: wrap; gap: 0.4rem; margin: 0 0 0.35rem; }
    .chip {
      appearance: none; -webkit-appearance: none;
      border: 2px solid var(--line); background: #f7faf8;
      color: var(--ink); font: inherit; font-size: 0.9rem; font-weight: 600;
      padding: 0.55rem 0.7rem; border-radius: 12px; cursor: pointer; min-height: 2.55rem;
      flex: 1 1 calc(50% - 0.4rem); text-align: start;
    }
    .chip.is-on {
      border-color: var(--cta); background: #dff0e9; color: var(--cta); font-weight: 800;
      box-shadow: inset 0 0 0 1px var(--cta);
    }
    .chip.is-on::before { content: "✓ "; font-weight: 800; }
    .chip:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
    .sheet-note-wrap[hidden] { display: none; }
    .sheet label { display: block; font-size: 0.85rem; font-weight: 700; margin: 0.35rem 0 0.3rem; }
    .sheet textarea {
      width: 100%; min-height: 2.75rem; max-height: 5.5rem; resize: vertical; font: inherit;
      border: 1px solid var(--line); border-radius: 10px; padding: 0.55rem;
      color: var(--ink); background: #fff;
    }
    .sheet textarea:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
    .sheet-actions {
      display: flex; flex-wrap: wrap; gap: 0.5rem;
    }
    .sheet-actions button {
      appearance: none; -webkit-appearance: none;
      border: 1px solid var(--line); background: var(--panel); color: var(--ink);
      font: inherit; font-weight: 700; padding: 0.65rem 0.9rem; border-radius: 10px;
      min-height: 2.75rem; cursor: pointer;
    }
    .sheet-actions button:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
    /* Must beat .sheet-actions button (0,2,0) — was white-on-white blank Save */
    .sheet-actions button.sheet-save {
      background: var(--cta); color: #fff; border-color: var(--cta);
    }
    .sheet-actions button.sheet-clear { color: #8a3f18; }
    .sheet-actions button.sheet-clear[hidden] { display: none; }
    .sheet-error { color: #8a3f18; font-size: 0.85rem; min-height: 1.2em; margin: 0 0 0.55rem; font-weight: 600; }
    @media (prefers-reduced-motion: reduce) {
      .sheet, .sheet-backdrop { transition: none; }
    }
    .btn-analyze {
      appearance: none; -webkit-appearance: none;
      border: 1px solid var(--cta); background: #dff0e9; color: var(--cta);
      font: inherit; font-weight: 700; font-size: 0.88rem;
      padding: 0.45rem 0.75rem; border-radius: 10px; min-height: 2.5rem; cursor: pointer;
    }
    .btn-analyze:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
    .card-actions-left { display: flex; flex-wrap: wrap; gap: 0.45rem; align-items: center; }
    .claude-sent {
      font-size: 0.75rem; font-weight: 700; color: #5a6a64;
      background: #eef2f0; border-radius: 6px; padding: 0.12rem 0.4rem;
    }
    .claude-sent[hidden] { display: none; }
    .toast {
      position: fixed; left: 50%; bottom: calc(1.25rem + env(safe-area-inset-bottom));
      transform: translateX(-50%); z-index: 80;
      background: #0e1614; color: #f4f7f5; font-weight: 700; font-size: 0.92rem;
      padding: 0.7rem 1.1rem; border-radius: 999px; box-shadow: 0 8px 24px rgba(0,0,0,0.25);
      opacity: 0; pointer-events: none; transition: opacity 0.2s ease;
    }
    .toast.is-on { opacity: 1; }
    #copy-fallback-sheet textarea {
      width: 100%; min-height: 10rem; font: inherit; font-size: 0.85rem;
      border: 1px solid var(--line); border-radius: 10px; padding: 0.65rem;
    }
  </style>
</head>
<body>
  <header class="hero">
    <div class="hero-inner">
      <p class="brand">RADAR<span>.</span></p>
      <p>Rule-filtered · Claude rates outside · Updated ${esc(dateLabel)}${meta.timedOut ? " · timed out" : ""}</p>
      <p class="hero-links"><a href="/rules.html">Rules${
        hidden.length ? ` · Hidden (${hidden.length})` : ""
      }</a> · <a href="/sources.html">Sources</a></p>
    </div>
  </header>
  <main>
    <div class="stats" role="group" aria-label="Scan summary">
      <div class="stat"><strong>${jobs.length}</strong><span>Shown on dashboard</span></div>
      <div class="stat"><strong>${meta.rulesKept}</strong><span>Passed filters</span></div>
      <div class="stat"><strong>${meta.sources.linkedin ?? 0}</strong><span>LinkedIn raw</span></div>
      <div class="stat"><strong>${(meta.sources.workday ?? 0) + (meta.sources.comeet ?? 0)}</strong><span>Company boards</span></div>
    </div>
    <p class="sources">
      Sources: Workday ${meta.sources.workday ?? 0} · Comeet ${meta.sources.comeet ?? 0} · LinkedIn ${meta.sources.linkedin ?? 0}${(meta.sources.greenhouse || meta.sources.lever || meta.sources.smartrecruiters) ? ` · ATS+ ${ (meta.sources.greenhouse ?? 0) + (meta.sources.lever ?? 0) + (meta.sources.smartrecruiters ?? 0) }` : ""} · <a href="/sources.html">All sources</a>
    </p>
    ${(() => {
      const bad = (meta.sourceResults ?? []).filter(
        (r) => r.status === "failed" || r.status === "timeout" || r.status === "skipped"
      );
      const blocked = loadBlockedCompanies();
      const manual = blocked.length
        ? `<p class="sources"><strong>Check yourself</strong> (these careers sites block automated scans; their roles often still appear via LinkedIn): ${blocked
            .map((c) => `<a href="${esc(c.board_url)}" target="_blank" rel="noopener">${esc(c.name)}</a>`)
            .join(" · ")}</p>`
        : "";
      if (!bad.length) return manual;
      return manual + `<p class="sources" role="status" style="color:#9a3412"><strong>${bad.length} source${
        bad.length > 1 ? "s" : ""
      } did not load:</strong> ${bad
        .map((r) => `${esc(r.name)} (${esc((r.error || r.status).slice(0, 90))})`)
        .join(" · ")}</p>`;
    })()}
    <div class="toolbar" role="group" aria-label="Scan actions">
      <button type="button" class="primary" id="btn-scan">Search now</button>
      <button type="button" id="btn-add-job">Add job</button>
      <button type="button" id="btn-rescore" hidden>Re-score</button>
      <a class="tool-btn" href="/sources.html">Sources</a>
      <span id="scan-status" aria-live="polite"></span>
    </div>
    <div class="scan-extra" id="scan-extra" hidden>
      <label for="extra-keywords">Extra keywords this run (optional, comma-separated)</label>
      <input id="extra-keywords" type="text" placeholder="e.g. Production Engineer, מנהל ייצור" />
    </div>
    <div class="add-panel" id="add-panel" hidden>
      <label for="add-url">Job URL (LinkedIn or careers page)</label>
      <input id="add-url" type="url" placeholder="https://…" />
      <label for="add-text">Or paste full job text</label>
      <textarea id="add-text" placeholder="Paste the job description here…"></textarea>
      <label for="add-title">Title override (optional)</label>
      <input id="add-title" type="text" />
      <label for="add-company">Company override (optional)</label>
      <input id="add-company" type="text" />
      <div class="add-actions">
        <button type="button" class="primary" id="add-save">Save job</button>
        <button type="button" id="add-cancel">Cancel</button>
      </div>
      <p class="sheet-error" id="add-error" aria-live="polite"></p>
    </div>
    <div class="filters" role="tablist" aria-label="Job tabs">
      <button type="button" class="filter-btn is-on" data-filter="untagged" aria-pressed="true">New <span class="tab-count" data-count-for="untagged">0</span></button>
      <button type="button" class="filter-btn" data-filter="relevant" aria-pressed="false">Relevant <span class="tab-count" data-count-for="relevant">0</span></button>
      <button type="button" class="filter-btn" data-filter="applied" aria-pressed="false">Applied <span class="tab-count" data-count-for="applied">0</span></button>
      <button type="button" class="filter-btn" data-filter="not_relevant" aria-pressed="false">Not relevant <span class="tab-count" data-count-for="not_relevant">0</span></button>

    </div>
    <section class="learn-panel" id="learn-panel" hidden>
      <h2>Suggested filters</h2>
      <p class="learn-lead">Approve only what you want hidden. Nothing auto-hides.</p>
      <div id="suggestions" class="suggestions"></div>
      <h2>Approved filters</h2>
      <div id="approved-filters" class="suggestions"></div>
    </section>
    <div class="jobs">
      ${
        jobs.length
          ? jobs.map((j) => card(j, sentMap)).join("\n")
          : `<div class="empty">No jobs passed location + title filters this scan.</div>`
      }
    </div>
    ${
      filteredOutCount > 0
        ? `<details class="filtered-out"><summary>Filtered out (${filteredOutCount})</summary>
      <p>${esc(meta.filterSummary || "Rule / tag / geo / duplicate drops. Debug only — not in New.")}</p>
      <ul class="filtered-out-list">${dropPreview}${
          dropList.length > 40 ? `<li>…and ${dropList.length - 40} more</li>` : ""
        }</ul>
    </details>`
        : ""
    }
  </main>
  <footer>Private · personal use only · full profile is not shown here<br/>Tags sync via Cloudflare (PC + phone behind Access). Google Sheet tabs RADAR / Claude stay in sync after each scan.</footer>
  <div class="sheet-backdrop" id="sheet-backdrop" hidden></div>
  <div class="sheet" id="tag-sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" hidden>
    <div class="sheet-body">
      <h3 id="sheet-title">Why not relevant?</h3>
      <p class="sheet-job" id="sheet-job" dir="auto"></p>
      <div class="chips" id="sheet-chips" role="group" aria-label="Reasons"></div>
      <div class="sheet-note-wrap" id="sheet-note-wrap" hidden>
        <label for="sheet-note" id="sheet-note-label">Note (optional)</label>
        <textarea id="sheet-note" maxlength="500" placeholder="Optional detail" dir="auto"></textarea>
      </div>
    </div>
    <div class="sheet-footer">
      <p class="sheet-error" id="sheet-error" aria-live="polite"></p>
      <div class="sheet-actions">
        <button type="button" class="sheet-save" id="sheet-save">Save</button>
        <button type="button" id="sheet-cancel">Cancel</button>
        <button type="button" class="sheet-clear" id="sheet-clear" hidden>Remove tag</button>
      </div>
    </div>
  </div>
  <div class="sheet" id="copy-fallback-sheet" role="dialog" aria-modal="true" hidden>
    <div class="sheet-body">
      <h3>Copy failed — select all and copy</h3>
      <p class="sheet-job">Description incomplete or clipboard blocked. Select the text and copy manually.</p>
      <textarea id="copy-fallback-text" readonly dir="auto"></textarea>
    </div>
    <div class="sheet-footer">
      <div class="sheet-actions">
        <button type="button" class="sheet-save" id="copy-fallback-select">Select all</button>
        <button type="button" id="copy-fallback-close">Close</button>
      </div>
    </div>
  </div>
  <div class="toast" id="toast" role="status" aria-live="polite"></div>
  <script type="application/json" id="analyze-blocks">${analyzeBlocksJson(jobs)}</script>
  <script src="/app-net.js" defer></script>
  <script src="/app-feedback.js" defer></script>
  <script src="/app-scan.js" defer></script>
  <script src="/app-claude.js" defer></script>
</body>
</html>`;
}

export function writeHebrewDashboard(result: RunResult, meta: DashboardMeta): string {
  const webDir = join(projectRoot(), "web");
  mkdirSync(webDir, { recursive: true });
  const path = join(webDir, "index.html");
  writeFileSync(path, renderHebrewDashboard(result, meta), "utf8");
  return path;
}
