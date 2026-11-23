import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadCompanies, type CompanyBoard } from "./companies.js";
import { writeHebrewDashboard } from "./dashboard-he.js";
import { fetchComeetCompany } from "./fetchers/comeet.js";
import { fetchWorkdayCompany } from "./fetchers/workday.js";
import { fetchGreenhouseCompany } from "./fetchers/greenhouse.js";
import { fetchLeverCompany } from "./fetchers/lever.js";
import { fetchSmartRecruitersCompany } from "./fetchers/smartrecruiters.js";
import { fetchLinkedInGuest } from "./fetchers/linkedin-guest.js";
import { fetchLiveFileJobs } from "./fetchers/live-file.js";
import { fetchDemoJobs } from "./fetchers/demo.js";
import { enrichAndFilter, enrichAndFilterDetailed } from "./match.js";
import type { FilteredOutItem } from "./relevance-filter.js";
import { enrichJobsWithFullText } from "./fetchers/linkedin-detail.js";
import { loadFeedback, feedbackSummary } from "./feedback.js";
import { loadProfile, projectRoot } from "./profile.js";
import { loadSeenIds, markSeen, saveRun, saveSeenIds, writeJsonFile } from "./store.js";
import { claudeRowsToRawJobs, fetchClaudeSheetJobs, syncRadarSheet } from "./sheets.js";
import {
  beginScanProgress,
  endScanProgress,
  hardLimitExceeded,
  pushSourceResult,
  remainingMs,
  setScanMessage,
  setScanPhase,
  type SourceResult,
} from "./scan-progress.js";
import type { Job, Profile, RunResult } from "./types.js";

export type Raw = Omit<
  Job,
  | "matchScore"
  | "matchReasons"
  | "isNew"
  | "userFeedback"
  | "userFeedbackReasons"
  | "aiRating"
  | "aiStatus"
>;

export interface ScanOptions {
  skipFetch?: boolean;
  demo?: boolean;
  /** @deprecated Gemini removed from scan — ignored. */
  aiMax?: number;
  /** @deprecated Gemini removed — ignored. */
  forceRescore?: boolean;
  extraKeywords?: string[];
}

export interface ScanPayload {
  generatedAt: string;
  newCount: number;
  totalCount: number;
  newHtml: string;
  ratedHtml: string;
  ratedCount: number;
  dateLabel: string;
  sources: Record<string, number>;
  sourceResults: SourceResult[];
  rulesKept: number;
  aiRated: number;
  aiSkipped: number;
  aiReused: number;
  geminiCalls: number;
  cvLoaded: boolean;
  sheetRadarRows: number;
  claudeImported: number;
  timedOut: boolean;
  abortedReason?: string;
  durationMs: number;
  filterSummary?: string;
  filteredOut?: FilteredOutItem[];
  filterStats?: {
    fetched: number;
    duplicates: number;
    excludedByRule: number;
    hiddenByTag: number;
    shown: number;
  };
}

const HARD_LIMIT_MS = 20 * 60_000;
const LINKEDIN_TIMEOUT_MS = 10 * 60_000;
const BOARD_TIMEOUT_MS = 2 * 60_000;

function mergeRaw(...lists: Raw[][]): Raw[] {
  const map = new Map<string, Raw>();
  for (const list of lists) {
    for (const job of list) {
      if (!map.has(job.id)) map.set(job.id, job);
    }
  }
  return [...map.values()];
}

async function withTimeout<T>(
  name: string,
  fn: () => Promise<T>,
  ms: number,
  fallback: T
): Promise<{ value: T; status: "ok" | "timeout" | "failed"; error?: string; ms: number }> {
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      fn(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${name} timed out after ${Math.round(ms / 1000)}s`)), ms);
      }),
    ]);
    return { value, status: "ok", ms: Date.now() - started };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = /timed out/i.test(msg) ? "timeout" : "failed";
    console.warn(`${name}: ${msg}`);
    return { value: fallback, status, error: msg, ms: Date.now() - started };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Record a source outcome for both the live status line and the saved scan report. */
function record(list: SourceResult[], r: SourceResult): void {
  pushSourceResult(r);
  const idx = list.findIndex((s) => s.name === r.name);
  if (idx >= 0) list[idx] = r;
  else list.push(r);
}

function savePartialRaw(raw: Raw[], sources: Record<string, number>, sourceResults: SourceResult[]): void {
  try {
    const dir = join(projectRoot(), "data");
    mkdirSync(dir, { recursive: true });
    writeJsonFile(join(dir, "live-jobs.json"), raw);
    writeJsonFile(join(dir, "last-scan-sources.json"), {
      generatedAt: new Date().toISOString(),
      sources,
      sourceResults,
    });
  } catch (err) {
    console.warn("Could not write partial scan files:", err);
  }
}

function loadPriorJobs(): Job[] {
  const path = join(projectRoot(), "data", "latest.json");
  if (!existsSync(path)) return [];
  try {
    const latest = JSON.parse(readFileSync(path, "utf8")) as RunResult;
    return latest.jobs ?? [];
  } catch {
    return [];
  }
}

function stripAiDisplayFields(j: Job, priorById: Map<string, Job>): Job {
  const prev = priorById.get(j.id);
  return {
    ...j,
    aiRating: prev?.aiRating,
    aiStatus: undefined,
    experienceFitPct: undefined,
    fitVerdict: undefined,
    blocked: undefined,
    blockedBy: undefined,
    blockedKind: undefined,
    notEnoughInfo: undefined,
    notEnoughInfoReason: undefined,
  };
}

function rebuildAndSave(
  raw: Raw[],
  profile: Profile,
  seen: Set<string>,
  feedback: ReturnType<typeof loadFeedback>,
  sources: Record<string, number>,
  sourceResults: SourceResult[],
  extras: { timedOut: boolean; abortedReason?: string; startedAt: number; claudeImported: number }
): { result: RunResult; payload: ScanPayload } {
  setScanPhase("filter");
  setScanMessage("Filtering by search profile + tags…");

  const filtered = enrichAndFilterDetailed(raw, profile, seen, feedback);
  console.log(filtered.summary);
  for (const d of filtered.dropped.slice(0, 20)) {
    console.log(`  drop: ${d.reason} · ${d.title}`);
  }
  for (const j of filtered.jobs.slice(0, 80)) {
    console.log(`  show: ${j.title} · ${j.company} · ${j.location}`);
  }
  if (filtered.stats.passRateWarning) {
    console.warn(
      `WARNING: ${(filtered.stats.passRate * 100).toFixed(0)}% of fetched jobs passed the filter — check config/search-profile.json`
    );
  }

  setScanPhase("save");
  setScanMessage("Saving shortlist…");

  const prior = loadPriorJobs();
  const priorById = new Map(prior.map((j) => [j.id, j]));
  // Main feed + tagged archive (tabs only; never counted as New)
  const jobs: Job[] = [...filtered.jobs, ...filtered.taggedArchive].map((j) =>
    stripAiDisplayFields(j, priorById)
  );

  const newCount = filtered.jobs.filter((j) => j.isNew).length;
  const result: RunResult = {
    generatedAt: new Date().toISOString(),
    jobs,
    newCount,
    totalCount: filtered.jobs.length,
  };

  try {
    saveRun(result);
  } catch (err) {
    console.warn("Could not write latest.json:", err);
  }
  try {
    saveSeenIds(markSeen(filtered.jobs, seen));
  } catch (err) {
    console.warn("Could not write seen-ids.json:", err);
  }
  try {
    writeHebrewDashboard(result, {
      sources,
      rulesKept: filtered.jobs.length,
      aiRated: 0,
      aiSkipped: 0,
      sourceResults,
      timedOut: extras.timedOut,
      filteredOut: filtered.dropped,
      filterSummary: filtered.summary,
    });
  } catch (err) {
    console.warn("Could not write dashboard:", err);
  }

  const dateLabel = new Date(result.generatedAt).toLocaleString("en-IL", {
    dateStyle: "full",
    timeStyle: "short",
  });

  const payload: ScanPayload = {
    generatedAt: result.generatedAt,
    newCount,
    totalCount: filtered.jobs.length,
    newHtml: "",
    ratedHtml: "",
    ratedCount: 0,
    dateLabel,
    sources,
    sourceResults,
    rulesKept: filtered.jobs.length,
    aiRated: 0,
    aiSkipped: 0,
    aiReused: 0,
    geminiCalls: 0,
    filterSummary: filtered.summary,
    filteredOut: filtered.dropped,
    filterStats: {
      fetched: filtered.stats.fetched,
      duplicates: filtered.stats.duplicates,
      excludedByRule: filtered.stats.excludedByRule,
      hiddenByTag: filtered.stats.hiddenByTag,
      shown: filtered.stats.shown,
    },
    cvLoaded: false,
    sheetRadarRows: 0,
    claudeImported: extras.claudeImported,
    timedOut: extras.timedOut,
    abortedReason: extras.abortedReason,
    durationMs: Date.now() - extras.startedAt,
  };

  return { result, payload };
}

async function fetchBoardsByCompany(
  label: string,
  boards: CompanyBoard[],
  ats: CompanyBoard["ats"],
  fetchOne: (b: CompanyBoard) => Promise<Raw[]>,
  acc: Raw[],
  sources: Record<string, number>,
  sourceResults: SourceResult[],
  sourceKey: string
): Promise<void> {
  const subset = boards.filter((b) => b.ats === ats);
  for (const board of subset) {
    if (hardLimitExceeded()) {
      record(sourceResults, {
        name: `${label}/${board.name}`,
        status: "skipped",
        count: 0,
        ms: 0,
        error: "Hard time limit",
      });
      continue;
    }
    const budget = Math.min(BOARD_TIMEOUT_MS, remainingMs());
    setScanMessage(`Fetching ${label}: ${board.name}…`, `${label}/${board.name}`);
    const r = await withTimeout(`${label} ${board.name}`, () => fetchOne(board), budget, [] as Raw[]);
    record(sourceResults, {
      name: `${label}/${board.name}`,
      status: r.status,
      count: r.value.length,
      ms: r.ms,
      error: r.error,
    });
    if (r.value.length) {
      acc.push(...r.value);
      sources[sourceKey] = (sources[sourceKey] || 0) + r.value.length;
      savePartialRaw(mergeRaw(acc), sources, sourceResults);
    }
  }
}

export async function runScan(
  options: ScanOptions = {}
): Promise<{ result: RunResult; profile: Profile; payload: ScanPayload }> {
  const skipFetch = Boolean(options.skipFetch);
  const demo = Boolean(options.demo);
  const extraKeywords = options.extraKeywords ?? [];
  const startedAt = Date.now();

  beginScanProgress(HARD_LIMIT_MS);

  const profile = loadProfile();
  const seen = loadSeenIds();
  const feedback = loadFeedback();
  const learned = feedbackSummary(feedback);
  const priorJobs = loadPriorJobs();

  let raw: Raw[] = [];
  const sources: Record<string, number> = {
    workday: 0,
    comeet: 0,
    greenhouse: 0,
    lever: 0,
    smartrecruiters: 0,
    linkedin: 0,
    manual: 0,
    claude: 0,
  };
  const sourceResults: SourceResult[] = [];
  let claudeImported = 0;
  let timedOut = false;
  let abortedReason: string | undefined;

  try {
    if (!skipFetch) {
      const companies = loadCompanies(true);
      console.log(
        `Companies enabled: ${companies.map((c) => `${c.name}(${c.ats})`).join(", ") || "(none)"}`
      );

      const acc: Raw[] = [];

      // LinkedIn first (longest) — hard 10 min; abort early if global budget lower
      if (!hardLimitExceeded()) {
        const liBudget = Math.min(LINKEDIN_TIMEOUT_MS, remainingMs());
        setScanMessage("Fetching LinkedIn…", "LinkedIn");
        const li = await withTimeout(
          "LinkedIn",
          () =>
            fetchLinkedInGuest(profile, extraKeywords, {
              deadlineAt: Date.now() + liBudget,
              onProgress: (m) => setScanMessage(m, "LinkedIn"),
            }),
          liBudget,
          [] as Raw[]
        );
        record(sourceResults, {
          name: "LinkedIn",
          status: li.status,
          count: li.value.length,
          ms: li.ms,
          error: li.error,
        });
        sources.linkedin = li.value.length;
        acc.push(...li.value);
        savePartialRaw(mergeRaw(acc), sources, sourceResults);
      } else {
        record(sourceResults, {
          name: "LinkedIn",
          status: "skipped",
          count: 0,
          ms: 0,
          error: "Hard time limit",
        });
      }

      await fetchBoardsByCompany(
        "Workday",
        companies,
        "workday",
        (b) => fetchWorkdayCompany(b) as Promise<Raw[]>,
        acc,
        sources,
        sourceResults,
        "workday"
      );
      await fetchBoardsByCompany(
        "Comeet",
        companies,
        "comeet",
        (b) => fetchComeetCompany(b) as Promise<Raw[]>,
        acc,
        sources,
        sourceResults,
        "comeet"
      );
      await fetchBoardsByCompany(
        "Greenhouse",
        companies,
        "greenhouse",
        (b) => fetchGreenhouseCompany(b) as Promise<Raw[]>,
        acc,
        sources,
        sourceResults,
        "greenhouse"
      );
      await fetchBoardsByCompany(
        "Lever",
        companies,
        "lever",
        (b) => fetchLeverCompany(b) as Promise<Raw[]>,
        acc,
        sources,
        sourceResults,
        "lever"
      );
      await fetchBoardsByCompany(
        "SmartRecruiters",
        companies,
        "smartrecruiters",
        (b) => fetchSmartRecruitersCompany(b) as Promise<Raw[]>,
        acc,
        sources,
        sourceResults,
        "smartrecruiters"
      );

      if (!hardLimitExceeded()) {
        setScanMessage("Importing Claude sheet…", "Claude sheet");
        const claude = await withTimeout(
          "Claude sheet",
          async () => {
            const rows = await fetchClaudeSheetJobs();
            return claudeRowsToRawJobs(rows) as Raw[];
          },
          Math.min(60_000, remainingMs()),
          [] as Raw[]
        );
        record(sourceResults, {
          name: "Claude sheet",
          status: claude.status,
          count: claude.value.length,
          ms: claude.ms,
          error: claude.error,
        });
        claudeImported = claude.value.length;
        sources.claude = claude.value.length;
        acc.push(...claude.value);
      }

      const manualPrev = priorJobs.filter(
        (j) => j.source === "Manual" || j.source.startsWith("Manual/")
      ) as unknown as Raw[];
      sources.manual = manualPrev.length;
      if (manualPrev.length) {
        record(sourceResults, {
          name: "Manual",
          status: "ok",
          count: manualPrev.length,
          ms: 0,
        });
        acc.push(...manualPrev);
      }

      raw = mergeRaw(acc);
      savePartialRaw(raw, sources, sourceResults);
      console.log(
        `Fresh listings: ${raw.length} (WD ${sources.workday} · Comeet ${sources.comeet} · GH ${sources.greenhouse} · Lever ${sources.lever} · SR ${sources.smartrecruiters} · LI ${sources.linkedin} · Claude ${sources.claude} · Manual ${sources.manual})`
      );

      if (hardLimitExceeded()) {
        timedOut = true;
        abortedReason = "Hard 20-minute limit reached during fetch";
      }
    } else {
      setScanMessage("Loading cached listings…", "cache");
      raw = fetchLiveFileJobs();
      try {
        const prev = JSON.parse(
          readFileSync(join(projectRoot(), "data", "last-scan-sources.json"), "utf8")
        ) as { sources?: Record<string, number>; sourceResults?: SourceResult[] };
        if (prev.sources) Object.assign(sources, prev.sources);
        if (Array.isArray(prev.sourceResults)) sourceResults.push(...prev.sourceResults);
      } catch {
        /* no prior */
      }
    }

    if (demo) {
      raw = mergeRaw(raw, fetchDemoJobs());
    }

    // Best-effort description enrich within remaining budget (for Analyze in Claude)
    if (!hardLimitExceeded() && raw.length) {
      setScanPhase("enrich");
      setScanMessage("Enriching short descriptions…", "enrich");
      const preFilter = enrichAndFilter(raw, profile, seen, feedback);
      const budget = Math.min(180_000, remainingMs());
      const enrich = await withTimeout(
        "Description enrich",
        () => enrichJobsWithFullText(preFilter),
        budget,
        preFilter
      );
      record(sourceResults, {
        name: "Description enrich",
        status: enrich.status,
        count: enrich.value.length,
        ms: enrich.ms,
        error: enrich.error,
      });
      // Merge enriched text back into raw by id
      const byId = new Map(enrich.value.map((j) => [j.id, j]));
      raw = raw.map((j) => {
        const e = byId.get(j.id);
        return e
          ? {
              ...j,
              description: e.description || j.description,
              requirements: e.requirements || j.requirements,
            }
          : j;
      });
      savePartialRaw(raw, sources, sourceResults);
    }

    if (hardLimitExceeded() && !timedOut) {
      timedOut = true;
      abortedReason = abortedReason || "Hard 20-minute limit reached";
    }

    const { result, payload } = rebuildAndSave(raw, profile, seen, feedback, sources, sourceResults, {
      timedOut,
      abortedReason,
      startedAt,
      claudeImported,
    });

    try {
      setScanMessage("Syncing Google Sheet…", "sheet");
      payload.sheetRadarRows = await syncRadarSheet(result);
    } catch (err) {
      console.warn("RADAR sheet sync failed:", err instanceof Error ? err.message : err);
    }

    if (learned.relevant || learned.notRelevant) {
      console.log(
        `Feedback memory: ${learned.relevant} relevant / ${learned.notRelevant} not relevant`
      );
    }

    const failed = sourceResults.filter((s) => s.status === "timeout" || s.status === "failed");
    console.log(
      `Dashboard shortlist (rules only, no Gemini): ${result.jobs.length} (${result.newCount} new) in ${payload.durationMs}ms` +
        (timedOut ? ` · TIMED OUT` : "") +
        (failed.length ? ` · issues: ${failed.map((f) => f.name).join(", ")}` : "")
    );

    endScanProgress(
      timedOut ? { timedOut: true, reason: abortedReason } : undefined
    );

    return { result, profile, payload };
  } catch (err) {
    endScanProgress({
      timedOut: true,
      reason: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
