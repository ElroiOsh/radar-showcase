/**
 * Deterministic relevance filter (no AI).
 * Config: config/search-profile.json
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { projectRoot } from "./profile.js";
import { normalizeTagFingerprint, normalizeUrlKey, tagFingerprint } from "./tag-fingerprint.js";
import type { FeedbackEntry, Job } from "./types.js";

/** Same employer under different source spellings: "Applied Materials - Israel", "Nova Ltd." */
function normCompany(company: string): string {
  return norm(company)
    .replace(/\b(israel|ltd|inc|corp|corporation|group|technologies)\b/g, " ")
    .replace(/בע"?מ|ישראל/g, " ")
    .replace(/[^a-z0-9\u0590-\u05ff]+/g, " ")
    .trim();
}

/** Only judge the body once the real description was fetched (stubs are ~100 chars). */
const BODY_CHECK_MIN_CHARS = 400;
const AUTOMATION_TITLE = /\bautomation\b|אוטומציה/i;

const SOFTWARE_BODY_TERMS: RegExp[] = [
  /\bselenium\b/i, /\bplaywright\b/i, /\bcypress\b/i, /\bappium\b/i, /\bpytest\b/i,
  /\btest automation\b|\bautomated tests?\b|\bautomation tests?\b|\bautomation framework/i,
  /\bqa\b|\bquality assurance engineer/i, /\bci\s*\/\s*cd\b|\bjenkins\b|\bgitlab\b|\bgithub actions\b/i,
  /\bkubernetes\b|\bk8s\b|\bdocker\b/i, /\baws\b|\bazure\b|\bgcp\b|\bcloud\b/i,
  /\bmicroservices?\b|\brest(?:ful)? apis?\b|\bbackend\b|\bfront[\s-]?end\b/i,
  /\bjavascript\b|\btypescript\b|\bnode\.?js\b|\bjava\b|\bc#|\bgolang\b/i,
  /\bsaas\b/i, /\bdevops\b|\bsre\b/i, /\bcyber|\bsecurity (?:product|platform|research)/i,
  /\bsoftware (?:development|engineering|products?|company)\b/i, /\bweb (?:app|application|ui)\b/i,
  /אוטומציית בדיקות|בדיקות אוטומטיות|פיתוח תוכנה|סייבר/,
];
const FACTORY_BODY_TERMS: RegExp[] = [
  /\bplcs?\b/i, /\bscada\b|\bhmi\b/i, /\bproduction (?:line|floor|machines?|equipment)\b|\bassembly lines?\b/i,
  /\bmanufacturing\b/i, /\bfactory\b|\bplant\b|\bshop floor\b/i, /\bmachines?\b|\bmachinery\b/i,
  /\brobot(?:s|ics?)?\b|\bcobots?\b/i, /\bpneumatics?\b|\bhydraulics?\b|\bconveyors?\b|\bservo\b/i,
  /\bsiemens\b|\ballen[\s-]?bradley\b|\brockwell\b|\bbeckhoff\b|\bomron\b/i,
  /\bcommissioning\b|\bfat\b|\bsat\b/i, /\bindustrial\b/i, /\bmes\b/i, /\bmechanical\b|\belectrical cabinets?\b/i,
  /\bpackaging\b|\bcnc\b|\bmachining\b|\bsmt\b/i,
  /ייצור|מפעל|מכונות|בקרים|בקר מתוכנת|פיקוד|פנאומט|רובוט/,
];

/** For "automation" titles with a real description: software/QA automation vs factory automation. */
export function automationBodyVerdict(body: string): { software: number; factory: number; drop: boolean } {
  const software = SOFTWARE_BODY_TERMS.filter((re) => re.test(body)).length;
  const factory = FACTORY_BODY_TERMS.filter((re) => re.test(body)).length;
  const drop = (software >= 1 && factory === 0) || (software >= 3 && software > factory * 2);
  return { software, factory, drop };
}

export interface IncludeNeedsContext {
  phrase: string;
  context: string[];
}

export interface SearchProfile {
  titleInclude: string[];
  titleIncludeNeedsContext: IncludeNeedsContext[];
  titleExclude: string[];
  passRateWarnAbove: number;
}

const DEFAULT_PROFILE: SearchProfile = {
  titleInclude: [
    "manufacturing engineer",
    "process engineer",
    "automation engineer",
    "industrial engineer",
    "operational excellence",
    "smart manufacturing",
    "mes",
    "מהנדס תהליך",
    "מהנדס ייצור",
  ],
  titleIncludeNeedsContext: [
    { phrase: "engineering manager", context: ["manufacturing", "production", "process"] },
    { phrase: "npi", context: ["manufacturing", "production", "process"] },
  ],
  titleExclude: ["software engineer", "sales", "marketing", "student", "intern", "junior"],
  passRateWarnAbove: 0.5,
};

function norm(s: string): string {
  return s
    .toLowerCase()
    // Hebrew gender suffixes: מהנדס/ת, מהנדס.ת, אחראי/ית, מנהל/ה, מהנדס/ות
    .replace(/[\/.]\s?(?:ית|ות|ת|ה)(?![\u0590-\u05ff])/g, "")
    .replace(/[./·–—-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function keywordHit(text: string, keyword: string): boolean {
  const t = norm(text);
  const k = norm(keyword);
  if (!k) return false;
  // Whole-phrase boundaries so "automation engineer" ≠ "automation engineering"
  const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  // Hebrew keywords also match with a one-letter prefix (ו/ה/ב/ל/מ/ש/כ): "והייצור", "לאוטומציה"
  const hePrefix = /^[\u0590-\u05ff]/.test(k) ? "[והבלמשכ]{0,2}" : "";
  const re = new RegExp(
    `(?:^|[^a-z0-9\\u0590-\\u05ff])${hePrefix}${escaped}(?:[^a-z0-9\\u0590-\\u05ff]|$)`,
    "i"
  );
  return re.test(t);
}

function findHits(text: string, keywords: string[]): string[] {
  return keywords.filter((kw) => keywordHit(text, kw));
}

let cached: SearchProfile | null = null;
let cachedAt = 0;

export function loadSearchProfile(force = false): SearchProfile {
  const now = Date.now();
  if (!force && cached && now - cachedAt < 3_000) return cached;
  const path = join(projectRoot(), "config", "search-profile.json");
  if (!existsSync(path)) {
    cached = DEFAULT_PROFILE;
    cachedAt = now;
    return cached;
  }
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<SearchProfile>;
    cached = {
      titleInclude: Array.isArray(raw.titleInclude) ? raw.titleInclude.map(String) : DEFAULT_PROFILE.titleInclude,
      titleIncludeNeedsContext: Array.isArray(raw.titleIncludeNeedsContext)
        ? raw.titleIncludeNeedsContext.map((x) => ({
            phrase: String(x.phrase || ""),
            context: Array.isArray(x.context) ? x.context.map(String) : [],
          }))
        : DEFAULT_PROFILE.titleIncludeNeedsContext,
      titleExclude: Array.isArray(raw.titleExclude) ? raw.titleExclude.map(String) : DEFAULT_PROFILE.titleExclude,
      passRateWarnAbove:
        typeof raw.passRateWarnAbove === "number" ? raw.passRateWarnAbove : DEFAULT_PROFILE.passRateWarnAbove,
    };
  } catch {
    cached = DEFAULT_PROFILE;
  }
  cachedAt = now;
  return cached;
}

export type DropKind = "exclude" | "no_include" | "tag" | "duplicate" | "geo" | "other";

export interface FilterDecision {
  keep: boolean;
  reason: string;
  kind?: DropKind;
  sortScore: number;
  includeHits: string[];
  excludeHits: string[];
}

/** Title-only relevance (exclude always wins). */
export function evaluateTitleRelevance(title: string, profile = loadSearchProfile()): FilterDecision {
  const excludeHits = findHits(title, profile.titleExclude);
  if (excludeHits.length) {
    return {
      keep: false,
      reason: `excluded: title matched '${excludeHits[0]}'`,
      kind: "exclude",
      sortScore: 0,
      includeHits: [],
      excludeHits,
    };
  }

  const directHits = findHits(title, profile.titleInclude);
  const contextHits: string[] = [];
  for (const rule of profile.titleIncludeNeedsContext) {
    if (!keywordHit(title, rule.phrase)) continue;
    const ctx = rule.context.find((c) => keywordHit(title, c));
    if (ctx) contextHits.push(`${rule.phrase}+${ctx}`);
  }

  const includeHits = [...directHits, ...contextHits];
  if (!includeHits.length) {
    return {
      keep: false,
      reason: "excluded: no positive title match",
      kind: "no_include",
      sortScore: 0,
      includeHits: [],
      excludeHits: [],
    };
  }

  const bodyBoostUnused = 0;
  const sortScore = includeHits.length * 3 + bodyBoostUnused;
  return {
    keep: true,
    reason: `Title: ${includeHits.slice(0, 3).join(", ")}`,
    sortScore,
    includeHits,
    excludeHits: [],
  };
}

/** Sort-only: title include ×3 + description include ×1 − exclude hits in body. */
export function sortScoreForJob(
  title: string,
  description: string,
  requirements = "",
  profile = loadSearchProfile()
): number {
  const titleHits = [
    ...findHits(title, profile.titleInclude),
    ...profile.titleIncludeNeedsContext
      .filter((r) => keywordHit(title, r.phrase) && r.context.some((c) => keywordHit(title, c)))
      .map((r) => r.phrase),
  ];
  const body = `${description}\n${requirements}`;
  const bodyInclude = findHits(body, profile.titleInclude).filter((h) => !titleHits.includes(h));
  const bodyExclude = findHits(body, profile.titleExclude);
  return Math.max(0, titleHits.length * 3 + bodyInclude.length - bodyExclude.length);
}

export function stableJobKeys(job: Pick<Job, "id" | "company" | "title" | "url">): string[] {
  const keys = [String(job.id || "")];
  const urlKey = normalizeUrlKey(job.url || "");
  if (urlKey) keys.push(`url:${urlKey}`);
  const fp = tagFingerprint(job);
  if (fp) keys.push(`fp:${fp}`);
  return keys.filter(Boolean);
}

export type HideVerdict = "not_relevant" | "applied" | "closed";

export function buildTagHideIndex(
  feedback: FeedbackEntry[]
): Map<string, { verdict: HideVerdict; label: string }> {
  const map = new Map<string, { verdict: HideVerdict; label: string }>();
  for (const e of feedback) {
    if (e.verdict !== "not_relevant" && e.verdict !== "applied" && e.verdict !== "closed") continue;
    const label =
      e.verdict === "not_relevant"
        ? "hidden: tagged Not relevant"
        : e.verdict === "applied"
          ? "hidden: tagged Applied"
          : "hidden: marked closed";
    const entry = { verdict: e.verdict as HideVerdict, label };
    map.set(e.jobId, entry);
    const urlKey = normalizeUrlKey(e.url || "");
    if (urlKey) map.set(`url:${urlKey}`, entry);
    const fp = e.fingerprint || normalizeTagFingerprint(e.company || "", e.title || "");
    if (fp) map.set(`fp:${fp}`, entry);
  }
  return map;
}

export function tagHideReason(
  job: Pick<Job, "id" | "company" | "title" | "url">,
  index: Map<string, { verdict: HideVerdict; label: string }>
): string | null {
  for (const k of stableJobKeys(job)) {
    const hit = index.get(k);
    if (hit) return hit.label;
  }
  return null;
}

export interface FilterStats {
  fetched: number;
  duplicates: number;
  excludedByRule: number;
  hiddenByTag: number;
  shown: number;
  passRate: number;
  passRateWarning: boolean;
}

export interface FilteredOutItem {
  title: string;
  company: string;
  reason: string;
  kind: DropKind;
}

export interface RelevanceFilterResult<T extends Pick<Job, "id" | "title" | "company" | "url" | "description" | "requirements">> {
  kept: T[];
  dropped: FilteredOutItem[];
  stats: FilterStats;
}

/**
 * Apply title relevance + tag hides + title|company dedupe.
 * Geo should already have been applied by the caller, or pass pre-geo-filtered jobs.
 */
export function applyRelevanceFilter<
  T extends Pick<Job, "id" | "title" | "company" | "url" | "description" | "requirements"> & {
    matchScore?: number;
    matchReasons?: string[];
  }
>(
  jobs: T[],
  feedback: FeedbackEntry[],
  opts?: { fetchedCount?: number }
): RelevanceFilterResult<T> {
  const profile = loadSearchProfile();
  const tagIndex = buildTagHideIndex(feedback);
  const kept: T[] = [];
  const dropped: FilteredOutItem[] = [];
  const seenFp = new Set<string>();
  let duplicates = 0;
  let excludedByRule = 0;
  let hiddenByTag = 0;

  for (const job of jobs) {
    const tagReason = tagHideReason(job, tagIndex);
    if (tagReason) {
      hiddenByTag += 1;
      dropped.push({
        title: job.title,
        company: job.company,
        reason: tagReason,
        kind: "tag",
      });
      continue;
    }

    const titleDec = evaluateTitleRelevance(job.title, profile);
    if (!titleDec.keep) {
      excludedByRule += 1;
      dropped.push({
        title: job.title,
        company: job.company,
        reason: titleDec.reason,
        kind: titleDec.kind || "exclude",
      });
      continue;
    }

    // "Automation" titles are half software/IT: check the full description when we have it.
    if (
      AUTOMATION_TITLE.test(job.title) &&
      (job.description || "").length >= BODY_CHECK_MIN_CHARS
    ) {
      const v = automationBodyVerdict(`${job.description || ""}\n${job.requirements || ""}`);
      if (v.drop) {
        excludedByRule += 1;
        dropped.push({
          title: job.title,
          company: job.company,
          reason: `excluded: software/QA automation, not factory (description: ${v.software} software vs ${v.factory} factory signals)`,
          kind: "exclude",
        });
        continue;
      }
    }

    const dedupeKey = `${norm(job.title)}|${normCompany(job.company) || norm(job.company)}`;
    if (seenFp.has(dedupeKey)) {
      duplicates += 1;
      dropped.push({
        title: job.title,
        company: job.company,
        reason: "duplicate: same title+company",
        kind: "duplicate",
      });
      continue;
    }
    seenFp.add(dedupeKey);

    const score = sortScoreForJob(job.title, job.description || "", job.requirements || "", profile);
    kept.push({
      ...job,
      matchScore: score,
      matchReasons: [titleDec.reason],
    });
  }

  kept.sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0));

  const fetched = opts?.fetchedCount ?? jobs.length;
  const passRate = fetched > 0 ? kept.length / fetched : 0;
  const passRateWarning = fetched >= 10 && passRate > profile.passRateWarnAbove;

  return {
    kept,
    dropped,
    stats: {
      fetched,
      duplicates,
      excludedByRule,
      hiddenByTag,
      shown: kept.length,
      passRate,
      passRateWarning,
    },
  };
}

export function formatFilterSummary(stats: FilterStats): string {
  const base = `Filter: fetched ${stats.fetched} · duplicates ${stats.duplicates} · excluded by rule ${stats.excludedByRule} · hidden by tag ${stats.hiddenByTag} · shown ${stats.shown}`;
  if (stats.passRateWarning) {
    return `${base} · WARNING pass-rate ${(stats.passRate * 100).toFixed(0)}% > ${loadSearchProfile().passRateWarnAbove * 100}% (filter may be broken)`;
  }
  return base;
}
