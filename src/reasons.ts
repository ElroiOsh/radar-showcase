/** Tag reason taxonomy — store KEYS only; English labels for UI. */

export interface ReasonChip {
  id: string;
  label: string;
}

export interface ReasonGroup {
  id: string;
  label: string;
  reasons: ReasonChip[];
}

/** Flat reject chips (one screen, no wizard groups). */
export const REJECT_REASONS: ReasonChip[] = [
  { id: "location", label: "Location" },
  { id: "wrong_role", label: "Wrong role" },
  { id: "seniority", label: "Seniority" },
  { id: "missing_requirement", label: "Missing requirement" },
  { id: "company_industry", label: "Company / industry" },
  { id: "other", label: "Other" },
];

/** Relevant is one-tap — no accept reason chips. */
export const ACCEPT_REASONS: ReasonChip[] = [];

/** Single group for API/meta compatibility with older clients. */
export const REJECT_GROUPS: ReasonGroup[] = [
  { id: "not_relevant", label: "Not relevant", reasons: REJECT_REASONS },
];

export const ACCEPT_GROUPS: ReasonGroup[] = [];

export type RejectReasonId = (typeof REJECT_REASONS)[number]["id"];
export type AcceptReasonId = never;
export type FeedbackReasonId = RejectReasonId;

/** Reasons that may propose hard hide rules (after threshold). */
export const HARD_HIDE_REASONS = new Set<FeedbackReasonId>([
  "location",
  "wrong_role",
  "seniority",
  "missing_requirement",
  "company_industry",
]);

/** Min matching tags before a suggestion appears (still needs approve). */
export function proposalThreshold(reasonId: FeedbackReasonId): number {
  return reasonId === "missing_requirement" ? 2 : 3;
}

/**
 * Map legacy reason ids → new taxonomy.
 * Special verdict migrations (already_applied / old_closed) are handled in migrateFeedback().
 */
const LEGACY: Record<string, FeedbackReasonId> = {
  // Location
  location: "location",
  too_far: "location",
  frequent_travel: "location",
  distance_location: "location",
  wrong_location: "location",

  // Wrong role
  wrong_role: "wrong_role",
  wrong_title: "wrong_role",
  not_looking: "wrong_role",
  ops_production: "wrong_role",
  ops_production_mgmt: "wrong_role",
  manufacturing_pm: "wrong_role",
  design_role: "wrong_role",
  product_design: "wrong_role",
  classic_npi_design: "wrong_role",
  npi_only: "wrong_role",
  quality_regulatory: "wrong_role",
  maintenance: "wrong_role",
  it_ot: "wrong_role",
  technician_student: "wrong_role",

  // Seniority
  seniority: "seniority",
  too_junior: "seniority",
  too_senior: "seniority",

  // Missing requirement
  missing_requirement: "missing_requirement",
  degree_mismatch: "missing_requirement",
  experience_years_gap: "missing_requirement",
  chemistry_materials: "missing_requirement",
  chemistry_semi: "missing_requirement",
  semiconductor_photonics: "missing_requirement",
  software_required: "missing_requirement",
  robotics_vision_required: "missing_requirement",
  robots_vision: "missing_requirement",
  ee_required: "missing_requirement",

  // Company / industry
  company_industry: "company_industry",
  wrong_industry: "company_industry",
  industry_not_interesting: "company_industry",
  traditional_factory: "company_industry",
  agency_unknown: "company_industry",
  agency_contractor: "company_industry",
  temp_contract: "company_industry",
  shifts: "company_industry",

  // Other
  other: "other",

  // Former accept reasons → not used on relevant (one-tap); if seen on reject, treat as other
  good_industry: "company_industry",
  strong_company: "company_industry",
  good_location: "location",
  automation_lines: "wrong_role",
  smart_i40: "wrong_role",
  smart_mfg: "wrong_role",
  process_yield: "wrong_role",
  mes_data: "wrong_role",
  manage_engineers: "wrong_role",
  management_potential: "wrong_role",
  management_scope: "wrong_role",
  build_from_scratch: "wrong_role",
  ai_in_work: "wrong_role",
  defense_clearance: "company_industry",
  matches_experience: "wrong_role",
  company_want: "company_industry",
  good_role: "wrong_role",
};

/** Reasons that change the verdict instead of mapping to a chip. */
export const VERDICT_LEGACY: Record<string, "applied" | "closed"> = {
  already_applied: "applied",
  old_closed: "closed",
};

export function normalizeReasonId(id: string): FeedbackReasonId | null {
  if (VERDICT_LEGACY[id]) return null;
  const mapped = LEGACY[id] ?? id;
  if (REJECT_REASONS.some((r) => r.id === mapped)) {
    return mapped as FeedbackReasonId;
  }
  return null;
}

/** Label for UI; falls back to raw id so history never goes blank. */
export function reasonLabel(id: string): string {
  const norm = normalizeReasonId(id);
  if (norm) return REJECT_REASONS.find((r) => r.id === norm)?.label ?? norm;
  if (id === "already_applied") return "Already applied / duplicate";
  if (id === "old_closed") return "Old or closed posting";
  return id;
}

export function isRejectReason(id: string): id is RejectReasonId {
  return Boolean(normalizeReasonId(id));
}

export function isAcceptReason(_id: string): boolean {
  return false;
}

/** Public meta payload for dashboard / Pages Functions. */
export function reasonsMetaPayload() {
  return {
    reject: REJECT_REASONS,
    accept: ACCEPT_REASONS,
    rejectGroups: REJECT_GROUPS,
    acceptGroups: ACCEPT_GROUPS,
    noteOptional: true,
    relevantNeedsReasons: false,
  };
}
