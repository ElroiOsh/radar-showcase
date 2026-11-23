import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { projectRoot } from "./profile.js";
import { writeJsonFile } from "./store.js";
import {
  normalizeReasonId,
  reasonLabel,
  VERDICT_LEGACY,
  type FeedbackReasonId,
} from "./reasons.js";
import { extractSeniorityWords, looksLikeAgency } from "./seniority.js";
import { normalizeUrlKey, tagFingerprint } from "./tag-fingerprint.js";
import type {
  FeedbackEntry,
  FeedbackHistoryItem,
  FeedbackSnapshot,
  FeedbackVerdict,
  Job,
} from "./types.js";

/** Bumped when reject taxonomy changes; used to migrate feedback.json once. */
export const REASONS_TAXONOMY_VERSION = 2;

const STOP = new Set([
  "the", "and", "for", "with", "from", "that", "this", "your", "our", "you",
  "are", "was", "will", "have", "has", "job", "role", "team", "work", "working",
  "israel", "tel", "aviv", "את", "של", "על", "עם", "או", "הוא", "היא", "ל", "ב",
  "and", "or", "to", "in", "of", "a", "an", "as", "by", "be", "is", "on",
  "district", "ago", "hiring", "applicant",
]);

function feedbackPath(): string {
  const dir = join(projectRoot(), "data");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, "feedback.json");
}

function archivePath(): string {
  return join(projectRoot(), "data", "feedback-archive.json");
}

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9א-ת+#./\s-]/gi, " ")
    .split(/[\s,/|]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !STOP.has(t));
}

function jobTokens(job: Pick<Job, "title" | "description" | "requirements" | "company">): Set<string> {
  return new Set(tokens([job.title, job.company, job.description, job.requirements].join(" ")));
}

export function buildSnapshot(job: Job): FeedbackSnapshot {
  return {
    title: job.title,
    company: job.company,
    location: job.location,
    source: job.source,
    url: job.url,
    industry: undefined,
    seniorityWords: extractSeniorityWords(job.title),
    agency: looksLikeAgency(job.company, job.source),
    aiRecommendation: job.aiRating?.recommendation,
  };
}

function coerceVerdict(v: unknown): FeedbackVerdict {
  if (v === "relevant" || v === "applied" || v === "not_relevant" || v === "closed") return v;
  return "not_relevant";
}

function dedupeReasons(ids: FeedbackReasonId[]): FeedbackReasonId[] {
  return [...new Set(ids)];
}

function migrateReasonsAndVerdict(
  verdict: FeedbackVerdict,
  rawReasons: string[]
): { verdict: FeedbackVerdict; reasons: FeedbackReasonId[] } {
  let nextVerdict = verdict;
  const reasons: FeedbackReasonId[] = [];

  for (const raw of rawReasons) {
    const special = VERDICT_LEGACY[raw];
    if (special) {
      nextVerdict = special;
      continue;
    }
    const n = normalizeReasonId(raw);
    if (n) reasons.push(n);
  }

  if (nextVerdict === "relevant" || nextVerdict === "applied" || nextVerdict === "closed") {
    return { verdict: nextVerdict, reasons: [] };
  }
  return { verdict: nextVerdict, reasons: dedupeReasons(reasons) };
}

function coerceEntry(raw: Partial<FeedbackEntry> & { taxonomyVersion?: number }): FeedbackEntry | null {
  const jobId = String(raw.jobId ?? "");
  if (!jobId) return null;
  let verdict = coerceVerdict(raw.verdict);
  const rawReasons = (Array.isArray(raw.reasons) ? raw.reasons : []).map(String);
  const migrated = migrateReasonsAndVerdict(verdict, rawReasons);
  verdict = migrated.verdict;
  const reasons = migrated.reasons;
  const snapshot: FeedbackSnapshot = raw.snapshot ?? {
    title: String(raw.title ?? ""),
    company: String(raw.company ?? ""),
    location: String(raw.location ?? ""),
    source: String(raw.source ?? ""),
    url: String(raw.url ?? ""),
    seniorityWords: extractSeniorityWords(String(raw.title ?? "")),
    agency: looksLikeAgency(String(raw.company ?? ""), String(raw.source ?? "")),
  };
  const title = String(raw.title ?? snapshot.title);
  const company = String(raw.company ?? snapshot.company);
  return {
    jobId,
    verdict,
    title,
    company,
    location: String(raw.location ?? snapshot.location),
    source: String(raw.source ?? snapshot.source),
    url: String(raw.url ?? snapshot.url),
    tokens: Array.isArray(raw.tokens) ? raw.tokens.map(String) : [],
    reasons,
    note: raw.note ? String(raw.note) : undefined,
    fingerprint: raw.fingerprint || tagFingerprint({ company, title }),
    updatedAt: String(raw.updatedAt ?? new Date().toISOString()),
    snapshot,
    history: Array.isArray(raw.history) ? (raw.history as FeedbackHistoryItem[]) : [],
  };
}

/** Resolve tag by id, then URL, then company+title fingerprint. */
export function findTagForJob(
  entries: FeedbackEntry[],
  job: Pick<Job, "id" | "company" | "title" | "source" | "url">
): FeedbackEntry | undefined {
  const byId = entries.find((e) => e.jobId === job.id);
  if (byId) return byId;
  const urlKey = normalizeUrlKey(job.url || "");
  if (urlKey) {
    const byUrl = entries.find((e) => normalizeUrlKey(e.url || "") === urlKey);
    if (byUrl) return byUrl;
  }
  const fp = tagFingerprint(job);
  if (!fp) return undefined;
  return entries.find((e) => (e.fingerprint || tagFingerprint(e)) === fp);
}

export function loadFeedback(): FeedbackEntry[] {
  const path = feedbackPath();
  if (!existsSync(path)) return [];
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Array<
      Partial<FeedbackEntry> & { taxonomyVersion?: number }
    >;
    return raw.map(coerceEntry).filter((e): e is FeedbackEntry => Boolean(e));
  } catch {
    return [];
  }
}

/**
 * One-shot rewrite of feedback.json to the simplified reject taxonomy.
 * Preserves original reasons in history; maps already_applied → applied,
 * old_closed → closed; clears reasons on relevant/applied/closed.
 */
export function migrateFeedbackTaxonomy(): {
  changed: number;
  appliedFromReject: number;
  closedFromReject: number;
  total: number;
} {
  const path = feedbackPath();
  if (!existsSync(path)) {
    return { changed: 0, appliedFromReject: 0, closedFromReject: 0, total: 0 };
  }
  const raw = JSON.parse(readFileSync(path, "utf8")) as Array<
    Partial<FeedbackEntry> & { taxonomyVersion?: number }
  >;
  let changed = 0;
  let appliedFromReject = 0;
  let closedFromReject = 0;
  const now = new Date().toISOString();
  const out: Array<FeedbackEntry & { taxonomyVersion: number }> = [];

  for (const entry of raw) {
    const jobId = String(entry.jobId ?? "");
    if (!jobId) continue;
    const prevReasons = (Array.isArray(entry.reasons) ? entry.reasons : []).map(String);
    const prevVerdict = coerceVerdict(entry.verdict);
    const migrated = migrateReasonsAndVerdict(prevVerdict, prevReasons);
    const history = Array.isArray(entry.history) ? [...(entry.history as FeedbackHistoryItem[])] : [];

    const needsHistory =
      entry.taxonomyVersion !== REASONS_TAXONOMY_VERSION ||
      migrated.verdict !== prevVerdict ||
      prevReasons.join("|") !== migrated.reasons.join("|");

    if (needsHistory) {
      history.unshift({
        verdict: prevVerdict,
        reasons: prevReasons,
        note: entry.note ? String(entry.note) : undefined,
        updatedAt: String(entry.updatedAt ?? now),
        snapshot:
          (entry.snapshot as FeedbackSnapshot) ??
          ({
            title: String(entry.title ?? ""),
            company: String(entry.company ?? ""),
            location: String(entry.location ?? ""),
            source: String(entry.source ?? ""),
            url: String(entry.url ?? ""),
            seniorityWords: [],
            agency: false,
          } satisfies FeedbackSnapshot),
      });
      changed += 1;
      if (migrated.verdict === "applied" && prevVerdict === "not_relevant") appliedFromReject += 1;
      if (migrated.verdict === "closed" && prevVerdict === "not_relevant") closedFromReject += 1;
    }

    const coerced = coerceEntry({
      ...entry,
      verdict: migrated.verdict,
      reasons: migrated.reasons,
      history,
    });
    if (coerced) {
      out.push({ ...coerced, taxonomyVersion: REASONS_TAXONOMY_VERSION });
    }
  }

  writeJsonFile(path, out);
  return { changed, appliedFromReject, closedFromReject, total: out.length };
}

export function saveFeedback(entries: FeedbackEntry[]): void {
  writeJsonFile(feedbackPath(), entries);
}

export function upsertFeedback(
  payload: Omit<FeedbackEntry, "updatedAt" | "history"> & {
    updatedAt?: string;
    history?: FeedbackHistoryItem[];
  }
): FeedbackEntry[] {
  const existing = loadFeedback();
  const prev = existing.find((e) => e.jobId === payload.jobId);
  const history = [...(prev?.history ?? [])];
  if (prev) {
    history.unshift({
      verdict: prev.verdict,
      reasons: prev.reasons ?? [],
      note: prev.note,
      updatedAt: prev.updatedAt,
      snapshot:
        prev.snapshot ??
        buildSnapshot({
          id: prev.jobId,
          source: prev.source,
          title: prev.title,
          company: prev.company,
          location: prev.location,
          description: "",
          requirements: "",
          url: prev.url,
          matchScore: 0,
          matchReasons: [],
          isNew: false,
        }),
    });
  }
  const next: FeedbackEntry = {
    ...payload,
    reasons: payload.reasons ?? [],
    snapshot: payload.snapshot,
    history,
    updatedAt: payload.updatedAt ?? new Date().toISOString(),
  };
  const entries = existing.filter((e) => e.jobId !== payload.jobId);
  entries.unshift(next);
  saveFeedback(entries);
  return entries;
}

export function clearFeedback(jobId: string): FeedbackEntry[] {
  const existing = loadFeedback();
  const prev = existing.find((e) => e.jobId === jobId);
  if (!prev) return existing;

  let archive: FeedbackEntry[] = [];
  try {
    if (existsSync(archivePath())) archive = JSON.parse(readFileSync(archivePath(), "utf8"));
  } catch {
    archive = [];
  }
  archive.unshift(prev);
  writeJsonFile(archivePath(), archive.slice(0, 2000));

  const next = existing.filter((e) => e.jobId !== jobId);
  saveFeedback(next);
  return next;
}

export function feedbackMap(entries: FeedbackEntry[] = loadFeedback()): Map<string, FeedbackVerdict> {
  return new Map(entries.map((e) => [e.jobId, e.verdict]));
}

export function feedbackReasonsMap(
  entries: FeedbackEntry[] = loadFeedback()
): Map<string, FeedbackReasonId[]> {
  return new Map(entries.map((e) => [e.jobId, e.reasons ?? []]));
}

/** Direct same-jobId annotation only — no silent pattern learning. */
export function applyFeedbackToScore(
  job: Omit<Job, "matchScore" | "matchReasons" | "isNew" | "userFeedback" | "userFeedbackReasons">,
  baseScore: number,
  reasons: string[],
  entries: FeedbackEntry[]
): { matchScore: number; matchReasons: string[] } {
  const direct = entries.find((e) => e.jobId === job.id);
  if (direct?.verdict === "relevant") {
    const why = (direct.reasons ?? []).map(reasonLabel).join(", ");
    return {
      matchScore: Math.max(baseScore, 92),
      matchReasons: [
        ...reasons,
        why ? `You marked relevant: ${why}` : "You marked this as relevant",
      ],
    };
  }
  if (direct?.verdict === "not_relevant") {
    const why = (direct.reasons ?? []).map(reasonLabel).join(", ");
    return {
      matchScore: baseScore,
      matchReasons: [
        ...reasons,
        why ? `You marked not relevant: ${why}` : "You marked this as not relevant",
      ],
    };
  }
  return { matchScore: baseScore, matchReasons: reasons };
}

export function entryFromJob(
  job: Job,
  verdict: FeedbackVerdict,
  reasons: FeedbackReasonId[] = [],
  note?: string
): FeedbackEntry {
  const snapshot = buildSnapshot(job);
  return {
    jobId: job.id,
    verdict,
    title: job.title,
    company: job.company,
    location: job.location,
    source: job.source,
    url: job.url,
    tokens: [...jobTokens(job)].slice(0, 80),
    reasons,
    note,
    fingerprint: tagFingerprint(job),
    updatedAt: new Date().toISOString(),
    snapshot,
    history: [],
  };
}

export function feedbackSummary(entries: FeedbackEntry[] = loadFeedback()): {
  relevant: number;
  notRelevant: number;
  applied: number;
  closed: number;
} {
  return {
    relevant: entries.filter((e) => e.verdict === "relevant").length,
    notRelevant: entries.filter((e) => e.verdict === "not_relevant").length,
    applied: entries.filter((e) => e.verdict === "applied").length,
    closed: entries.filter((e) => e.verdict === "closed").length,
  };
}

export function reasonCountsLastDays(days = 30): Array<{ id: string; label: string; count: number }> {
  const since = Date.now() - days * 86_400_000;
  const counts = new Map<string, number>();
  for (const e of loadFeedback()) {
    if (Date.parse(e.updatedAt) < since) continue;
    for (const r of e.reasons ?? []) {
      counts.set(r, (counts.get(r) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([id, count]) => ({ id, label: reasonLabel(id), count }))
    .sort((a, b) => b.count - a.count);
}
