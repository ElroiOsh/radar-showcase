import { findTagForJob, loadFeedback } from "./feedback.js";
import { isLocationAllowed, locationExcludeReason } from "./geo.js";
import { isUnclearLocation } from "./locations-allow.js";
import {
  applyRelevanceFilter,
  buildTagHideIndex,
  evaluateTitleRelevance,
  formatFilterSummary,
  loadSearchProfile,
  sortScoreForJob,
  tagHideReason,
  type FilteredOutItem,
  type FilterStats,
} from "./relevance-filter.js";
import type { FeedbackEntry, Job, Profile } from "./types.js";

function isRecentlyPosted(postedAt: string | undefined, hours = 72): boolean {
  if (!postedAt) return false;
  const t = Date.parse(postedAt);
  if (Number.isNaN(t)) return false;
  return Date.now() - t <= hours * 3_600_000;
}

export interface EnrichFilterResult {
  /** Jobs for New / main feed (not tag-hidden). */
  jobs: Job[];
  /** Tagged applied / not_relevant / closed — kept for tabs only, never New. */
  taggedArchive: Job[];
  dropped: FilteredOutItem[];
  stats: FilterStats;
  summary: string;
}

function toJob(
  job: Omit<Job, "matchScore" | "matchReasons" | "isNew" | "userFeedback" | "userFeedbackReasons">,
  feedback: FeedbackEntry[],
  seenIds: Set<string>,
  forceNotNew = false
): Job {
  const tag = findTagForJob(feedback, job);
  const titleDec = evaluateTitleRelevance(job.title);
  const score = sortScoreForJob(job.title, job.description || "", job.requirements || "");
  return {
    ...job,
    matchScore: score,
    matchReasons: [titleDec.keep ? titleDec.reason : titleDec.reason],
    locationUnclear: isUnclearLocation(job.location) || Boolean(job.locationUnclear),
    isNew: forceNotNew ? false : !seenIds.has(job.id) || isRecentlyPosted(job.postedAt, 72),
    userFeedback: tag?.verdict,
    userFeedbackReasons: tag?.reasons,
  };
}

/**
 * Geo → title relevance → tag hide → dedupe.
 * Tag-hidden jobs go to taggedArchive (tabs) and filtered-out debug, not New.
 */
export function enrichAndFilterDetailed(
  jobs: Omit<Job, "matchScore" | "matchReasons" | "isNew" | "userFeedback" | "userFeedbackReasons">[],
  _profile: Profile,
  seenIds: Set<string>,
  feedback: FeedbackEntry[] = loadFeedback()
): EnrichFilterResult {
  const geoDropped: FilteredOutItem[] = [];
  const geoKept: typeof jobs = [];

  for (const job of jobs) {
    const geoReason = locationExcludeReason(job.location);
    if (geoReason || !isLocationAllowed(job.location)) {
      geoDropped.push({
        title: job.title,
        company: job.company,
        reason: geoReason ?? `Location not allowed: ${job.location}`,
        kind: "geo",
      });
      continue;
    }
    geoKept.push(job);
  }

  const tagIndex = buildTagHideIndex(feedback);
  const preTag: typeof jobs = [];
  const taggedRaw: typeof jobs = [];
  const tagDropped: FilteredOutItem[] = [];

  for (const job of geoKept) {
    const hide = tagHideReason(job, tagIndex);
    if (hide) {
      taggedRaw.push(job);
      tagDropped.push({
        title: job.title,
        company: job.company,
        reason: hide,
        kind: "tag",
      });
      continue;
    }
    preTag.push(job);
  }

  // Title exclude + include + dedupe (no tag hide inside — already split)
  const { kept, dropped: ruleDropped, stats } = applyRelevanceFilter(preTag, [], {
    fetchedCount: jobs.length,
  });

  const jobsOut = kept.map((j) => toJob(j, feedback, seenIds, false));
  const taggedArchive = taggedRaw.map((j) => toJob(j, feedback, seenIds, true));

  const allDropped = [...geoDropped, ...tagDropped, ...ruleDropped];
  const finalStats: FilterStats = {
    fetched: jobs.length,
    duplicates: stats.duplicates,
    excludedByRule: stats.excludedByRule + geoDropped.length,
    hiddenByTag: tagDropped.length,
    shown: jobsOut.length,
    passRate: jobs.length > 0 ? jobsOut.length / jobs.length : 0,
    passRateWarning:
      jobs.length >= 10 &&
      jobsOut.length / jobs.length > loadSearchProfile().passRateWarnAbove,
  };

  jobsOut.sort((a, b) => {
    if (a.isNew !== b.isNew) return a.isNew ? -1 : 1;
    return b.matchScore - a.matchScore;
  });

  return {
    jobs: jobsOut,
    taggedArchive,
    dropped: allDropped,
    stats: finalStats,
    summary: formatFilterSummary(finalStats),
  };
}

/** Back-compat: main feed only (no tag archive). */
export function enrichAndFilter(
  jobs: Omit<Job, "matchScore" | "matchReasons" | "isNew" | "userFeedback" | "userFeedbackReasons">[],
  profile: Profile,
  seenIds: Set<string>,
  feedback: FeedbackEntry[] = []
): Job[] {
  return enrichAndFilterDetailed(jobs, profile, seenIds, feedback).jobs;
}

export function scoreJob(
  job: Omit<Job, "matchScore" | "matchReasons" | "isNew" | "userFeedback" | "userFeedbackReasons">,
  _profile: Profile,
  feedback: FeedbackEntry[] = []
): { matchScore: number; matchReasons: string[]; excluded: boolean } {
  const geoReason = locationExcludeReason(job.location);
  if (geoReason || !isLocationAllowed(job.location)) {
    return {
      matchScore: 0,
      matchReasons: [geoReason ?? `Location not allowed: ${job.location}`],
      excluded: true,
    };
  }
  const hide = tagHideReason(job, buildTagHideIndex(feedback));
  if (hide) return { matchScore: 0, matchReasons: [hide], excluded: true };
  const titleDec = evaluateTitleRelevance(job.title);
  if (!titleDec.keep) {
    return { matchScore: 0, matchReasons: [titleDec.reason], excluded: true };
  }
  return {
    matchScore: sortScoreForJob(job.title, job.description || "", job.requirements || ""),
    matchReasons: [titleDec.reason],
    excluded: false,
  };
}
