import type { FeedbackReasonId } from "./reasons.js";

export type FeedbackVerdict = "relevant" | "not_relevant" | "applied" | "closed";
export type AiFitLevel = "high" | "medium" | "low-medium" | "low";
export type AiRecommendation = "go" | "maybe" | "skip";
/** Dashboard verdict after caps / credential blocks. */
export type FitVerdict = "go" | "maybe" | "low" | "blocked";
export type CvTrack = "SM" | "EM";
export type BlockedKind = "degree" | "certification" | "language";

export interface AiUnmetMust {
  kind: "degree" | "certification" | "language" | "core" | "other";
  text: string;
}

export type ReqMatchLevel = "met" | "partial" | "not_met";
export type AiStatus = "ai_rated" | "not_ai_rated" | "not_enough_info";

export interface AiRequirementMatch {
  text: string;
  importance: "must" | "nice";
  match: ReqMatchLevel;
  /** Copied verbatim from the profile text; verified locally. */
  evidence: string;
  core?: boolean;
}

/** Frozen job attributes at tagging time (jobs may vanish from sources later). */
export interface FeedbackSnapshot {
  title: string;
  company: string;
  location: string;
  source: string;
  url: string;
  industry?: string;
  seniorityWords: string[];
  agency: boolean;
  aiRecommendation?: AiRecommendation;
}

export interface FeedbackHistoryItem {
  verdict: FeedbackVerdict;
  /** Original reason ids (may predate current taxonomy). */
  reasons: string[];
  note?: string;
  updatedAt: string;
  snapshot: FeedbackSnapshot;
}

export interface FeedbackEntry {
  jobId: string;
  verdict: FeedbackVerdict;
  title: string;
  company: string;
  location: string;
  source: string;
  url: string;
  tokens: string[];
  reasons: FeedbackReasonId[];
  note?: string;
  updatedAt: string;
  /** Normalized company+title for cross-source / repost matching. */
  fingerprint?: string;
  snapshot?: FeedbackSnapshot;
  history?: FeedbackHistoryItem[];
}

export type RuleType = "hide" | "demote" | "boost";
export type RuleAttribute =
  | "company"
  | "location"
  | "source"
  | "seniority"
  | "title_keyword"
  | "agency"
  | "industry";

export interface LearnedRule {
  id: string;
  type: RuleType;
  attribute: RuleAttribute;
  value: string;
  /** Exact keywords matched for title/seniority rules (EN+HE), user-editable. */
  keywords: string[];
  reasonId: FeedbackReasonId;
  plainEnglish: string;
  enabled: boolean;
  createdAt: string;
  evidenceJobIds: string[];
}

export interface RuleProposal {
  id: string;
  type: RuleType;
  attribute: RuleAttribute;
  value: string;
  keywords: string[];
  reasonId: FeedbackReasonId;
  plainEnglish: string;
  evidenceJobIds: string[];
  evidenceCount: number;
  predictedAffect: number;
  highFitUntaggedWarning: boolean;
  highFitUntaggedJobIds: string[];
  status: "open" | "rejected";
  rejectedAt?: string;
  rejectedEvidenceCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface AiRating {
  /** Legacy categorical; still filled for older snapshots. */
  experience_fit: AiFitLevel;
  /** 0–100 experience fit (recalculated locally from verified requirement matches). */
  experience_fit_pct?: number;
  smart_manufacturing_fit: AiFitLevel;
  management_fit: AiFitLevel;
  career_direction: AiFitLevel;
  recommendation: AiRecommendation;
  cv_track: CvTrack;
  why_yes: string;
  gaps: string;
  check: string;
  unmet_musts?: AiUnmetMust[];
  requirements?: AiRequirementMatch[];
  core_requirements?: string[];
  /** Truncated raw model JSON for diagnosis. */
  rawModelJson?: string;
}

export interface Job {
  id: string;
  source: string;
  title: string;
  company: string;
  location: string;
  description: string;
  requirements: string;
  salary?: string;
  url: string;
  postedAt?: string;
  matchScore: number;
  matchReasons: string[];
  isNew: boolean;
  userFeedback?: FeedbackVerdict;
  userFeedbackReasons?: FeedbackReasonId[];
  aiRating?: AiRating;
  /** ai_rated | not_ai_rated | not_enough_info */
  aiStatus?: AiStatus;
  /** Final experience fit % after non-credential caps (credential blocks do not lower this). */
  experienceFitPct?: number;
  blocked?: boolean;
  blockedBy?: string;
  blockedKind?: BlockedKind;
  fitVerdict?: FitVerdict;
  notEnoughInfo?: boolean;
  /** Why scoring was skipped: linkedin_blocked | no_description | no_requirements_section */
  notEnoughInfoReason?: string;
  /** Long posting scored without a clear requirements heading. */
  requirementsInferred?: boolean;
  /** Location is only Israel / Center District — city unknown. */
  locationUnclear?: boolean;
}

export interface Profile {
  candidate: {
    name: string;
    email: string;
    location_home: string;
    summary: string;
  };
  experience_highlights: string[];
  target_roles: string[];
  locations: {
    preferred: string[];
    avoid_unless_strong_match: string[];
  };
  search_queries: string[];
  boost_keywords: string[];
  deprioritize_keywords: string[];
  hard_exclude_keywords: string[];
  min_match_score: number;
  max_jobs_in_email: number;
  max_days_old: number;
}

export interface RunResult {
  generatedAt: string;
  jobs: Job[];
  newCount: number;
  totalCount: number;
}
