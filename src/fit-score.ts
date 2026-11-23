import { detectCoreFromDuties, hasEnoughPostingText, postingBlob } from "./job-text.js";
import { evidenceInProfile, loadScoringProfileText } from "./scoring-profile.js";
import type {
  AiRating,
  AiRequirementMatch,
  BlockedKind,
  FitVerdict,
  Job,
  ReqMatchLevel,
} from "./types.js";

export type MustKind = "degree" | "certification" | "language" | "core" | "other";

export interface UnmetMust {
  kind: MustKind;
  text: string;
}

export interface FitScoreResult {
  experienceFitPct: number;
  blocked: boolean;
  blockedBy?: string;
  fitVerdict: FitVerdict;
  unmetMusts: UnmetMust[];
  requirements?: AiRequirementMatch[];
  coreRequirements?: string[];
  notEnoughInfo?: boolean;
  notEnoughInfoReason?: string;
  calculation?: string;
}

const GO_MIN = 75;
const MAYBE_MIN = 55;
const CORE_CAP = 55;
const MULTI_MUST_CAP = 60;

export function categoricalToPct(level: string | undefined): number {
  switch (String(level || "").toLowerCase()) {
    case "high":
      return 85;
    case "medium":
      return 68;
    case "low-medium":
      return 52;
    case "low":
      return 35;
    default:
      return 50;
  }
}

function clipReq(match: string, max = 120): string {
  return match.replace(/\s+/g, " ").trim().slice(0, max);
}

function matchScore(level: ReqMatchLevel): number {
  if (level === "met") return 1;
  if (level === "partial") return 0.5;
  return 0;
}

/**
 * Fix 1: evidence for met/partial must appear in the profile file (normalized).
 * Fake evidence → downgrade to not_met.
 */
export function verifyRequirementEvidence(
  requirements: AiRequirementMatch[],
  profileText?: string
): AiRequirementMatch[] {
  const profile = profileText ?? loadScoringProfileText();
  return requirements.map((r) => {
    if (r.match !== "met" && r.match !== "partial") return r;
    if (evidenceInProfile(r.evidence, profile)) return r;
    console.warn(
      `Evidence not in profile — downgrading to not_met: req="${r.text.slice(0, 80)}" evidence="${String(
        r.evidence || ""
      ).slice(0, 80)}"`
    );
    return { ...r, match: "not_met" as const, evidence: "" };
  });
}

function isCredentialReq(text: string): boolean {
  return /degree|b\.?\s*sc|bachelor|תואר|certif|belt|pmp|language|english|hebrew|arabic|russian|שפה|אנגלית/i.test(
    text
  );
}

export function pctFromRequirements(requirements: AiRequirementMatch[]): number | null {
  // Degree / cert / language musts do not lower the experience % (blocked separately).
  const musts = requirements.filter((r) => r.importance === "must" && !isCredentialReq(r.text));
  const pool = musts.length
    ? musts
    : requirements.filter((r) => !isCredentialReq(r.text));
  if (!pool.length) return null;
  const avg = pool.reduce((s, r) => s + matchScore(r.match), 0) / pool.length;
  return Math.max(0, Math.min(100, Math.round(avg * 100)));
}

/** Detect unmet must-requirements against known profile gaps (local backup). */
export function detectUnmetMusts(
  job: Pick<Job, "title" | "description" | "requirements">
): UnmetMust[] {
  const blob = postingBlob(job);
  const out: UnmetMust[] = [];
  const push = (kind: MustKind, text: string) => {
    if (!out.some((u) => u.text === text && u.kind === kind)) out.push({ kind, text });
  };

  const degreePatterns: Array<{ re: RegExp; label: string }> = [
    {
      re: /b\.?\s*sc\.?\s*(?:degree\s+)?(?:in\s+)?chemical\s*engineering[^.\n]{0,40}/i,
      label: "B.Sc. Chemical Engineering (mandatory)",
    },
    {
      re: /b\.?\s*sc\.?[^\n.]{0,40}chemical\s*engineering[^\n.]{0,40}materials?\s*engineering/i,
      label: "B.Sc. Chemical or Materials Engineering (mandatory)",
    },
    {
      re: /(?:bachelor|b\.?\s*sc\.?|degree).{0,60}chemical(?:\s+or\s+materials?)?\s*engineering/i,
      label: "B.Sc. Chemical or Materials Engineering (mandatory)",
    },
    {
      re: /(?:bachelor|b\.?\s*sc\.?|degree).{0,40}materials?\s*engineering/i,
      label: "B.Sc. Materials Engineering (mandatory)",
    },
    {
      re: /תואר\s*ראשון.{0,40}(?:כימ|חומרים)/i,
      label: "First degree in Chemical / Materials (mandatory)",
    },
  ];
  for (const { re, label } of degreePatterns) {
    const m = blob.match(re);
    if (m) {
      push("degree", clipReq(m[0]) || label);
      break;
    }
  }

  // Electrical-only mandatory degree (candidate has mechanical — block if exclusive)
  if (
    /תואר\s*ראשון\s*בהנדסת\s*מכונות\s*\/\s*חשמל/i.test(blob) ||
    /b\.?\s*sc\.?.{0,40}mechanical\s*(?:\/|or)\s*electrical/i.test(blob)
  ) {
    // mechanical OR electrical — candidate has mechanical → met, do not block
  } else if (/(?:bachelor|b\.?\s*sc\.?|degree).{0,40}electrical\s*engineering.{0,20}(mandatory|חובה|required)/i.test(blob)) {
    push("degree", "B.Sc. Electrical Engineering (mandatory)");
  }

  const corePatterns: Array<{ re: RegExp; label: string }> = [
    {
      re: /תכנות\s*רובוט(?:ים)?(?:\s*\/\s*קובוט(?:ים)?)?\s*תעשייתיים?/i,
      label: "Industrial robot / cobot programming",
    },
    {
      re: /\b(industrial )?robot (programming|programmer|coder)\b/i,
      label: "Industrial robot programming",
    },
    {
      re: /תכנון\s*מערכות\s*גריפה|גריפרים|gripper|end[ -]?effector/i,
      label: "Gripper / end-effector design",
    },
    {
      re: /\b(python|matlab)\b.{0,30}(required|must|mandatory|חובה)/i,
      label: "Python / MATLAB (mandatory)",
    },
    {
      re: /\bmes\b.{0,25}(required|must|mandatory|experience|hands[ -]?on)/i,
      label: "MES experience (mandatory)",
    },
    {
      re: /מערכות\s*vision\s*תעשיית|industrial\s*vision/i,
      label: "Industrial vision systems",
    },
  ];
  for (const { re, label } of corePatterns) {
    const m = blob.match(re);
    if (m) push("core", clipReq(m[0]) || label);
  }

  return out;
}

function verdictFromPct(pct: number, blocked: boolean): FitVerdict {
  if (blocked) return "blocked";
  if (pct >= GO_MIN) return "go";
  if (pct >= MAYBE_MIN) return "maybe";
  return "low";
}

function credentialLabel(kind: MustKind): string {
  if (kind === "degree") return "degree";
  if (kind === "certification") return "certification";
  if (kind === "language") return "language";
  return kind;
}

function looksLikeCoreForbidden(text: string): boolean {
  return /degree|b\.?\s*sc|bachelor|תואר|years?\s+of\s+experience|ניסיון\s+של|language|english|hebrew|cad|solidworks|inventor|creo|תיב.?ם/i.test(
    text
  );
}

/** Profile hard gaps — never met/partial, even with adjacent-skill evidence. */
const HARD_GAP_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /robot(?:ic)?\s*programm|תכנות\s*רובוט|industrial\s*robot|קובוט/i, label: "robot_programming" },
  { re: /gripper|end[ -]?effector|גריפר|מערכות\s*גריפה/i, label: "gripper" },
  { re: /industrial\s*vision|vision\s*תעשיית|מערכות\s*vision/i, label: "vision" },
  { re: /\bmes\b(?!\s*implement)/i, label: "mes" },
  { re: /\bpython\b|\bmatlab\b/i, label: "python_matlab" },
];

function isHardProfileGap(text: string): boolean {
  return HARD_GAP_PATTERNS.some((p) => p.re.test(text));
}

/** Fix 2 enforcement: adjacent evidence cannot keep met/partial on hard-gap skills. */
function stripAdjacentCredit(requirements: AiRequirementMatch[]): AiRequirementMatch[] {
  return requirements.map((r) => {
    if (r.match === "not_met") return r;
    if (!isHardProfileGap(r.text) && !(r.core && isHardProfileGap(r.text))) return r;
    if (isHardProfileGap(r.text)) {
      console.warn(
        `Adjacent/hard-gap credit stripped → not_met: "${r.text.slice(0, 80)}" (was ${r.match})`
      );
      return { ...r, match: "not_met" as const, evidence: "" };
    }
    return r;
  });
}

/**
 * Apply scoring spec with verified requirement matches + caps.
 */
export function applyFitScore(
  job: Pick<Job, "title" | "description" | "requirements" | "aiRating" | "matchScore" | "aiStatus">,
  localUnmet?: UnmetMust[]
): FitScoreResult {
  const enough = hasEnoughPostingText(job);
  if (!enough.ok) {
    return {
      experienceFitPct: 0,
      blocked: false,
      fitVerdict: "low",
      unmetMusts: [],
      notEnoughInfo: true,
      notEnoughInfoReason: enough.code,
      calculation: `Not enough info: ${enough.reason}`,
    };
  }

  const ai = job.aiRating;
  let requirements = stripAdjacentCredit(verifyRequirementEvidence(ai?.requirements || []));
  const dutiesCores = detectCoreFromDuties(postingBlob(job));
  const modelCores = (ai?.core_requirements || []).filter((c) => c && !looksLikeCoreForbidden(c));
  const coreRequirements = [...new Set([...dutiesCores, ...modelCores])];

  // Mark requirements that match core labels as core + ensure unmet cores exist
  requirements = requirements.map((r) => {
    const isCore =
      r.core ||
      coreRequirements.some(
        (c) =>
          normalizeLoose(c) === normalizeLoose(r.text) ||
          normalizeLoose(r.text).includes(normalizeLoose(c).slice(0, 18)) ||
          normalizeLoose(c).includes(normalizeLoose(r.text).slice(0, 18))
      );
    return isCore ? { ...r, core: true, importance: "must" as const } : r;
  });

  // Only inject duties-derived hard-gap cores as explicit not_met rows.
  // Do NOT invent not_met rows for every model core label (would falsely cap strong fits).
  for (const core of dutiesCores) {
    if (!isHardProfileGap(core)) continue;
    const exists = requirements.some(
      (r) =>
        normalizeLoose(r.text).includes(normalizeLoose(core).slice(0, 16)) ||
        normalizeLoose(core).includes(normalizeLoose(r.text).slice(0, 16))
    );
    if (!exists) {
      requirements.push({
        text: core,
        importance: "must",
        match: "not_met",
        evidence: "",
        core: true,
      });
    }
  }

  const fromReqs = pctFromRequirements(requirements);
  const rawPct =
    fromReqs != null
      ? fromReqs
      : typeof ai?.experience_fit_pct === "number" && Number.isFinite(ai.experience_fit_pct)
        ? Math.max(0, Math.min(100, Math.round(ai.experience_fit_pct)))
        : categoricalToPct(typeof ai?.experience_fit === "string" ? ai.experience_fit : undefined);

  const fromAi = (ai?.unmet_musts || [])
    .map((u) => ({
      kind: (["degree", "certification", "language", "core", "other"].includes(String(u.kind))
        ? u.kind
        : "other") as MustKind,
      text: String(u.text || "").trim(),
    }))
    .filter((u) => u.text);

  const fromReqNotMet: UnmetMust[] = requirements
    .filter((r) => r.importance === "must" && r.match === "not_met")
    .map((r) => ({
      kind: (r.core ? "core" : isCredentialReq(r.text) ? guessCredentialKind(r.text) : "other") as MustKind,
      text: r.text,
    }));

  const unmet = [...fromAi, ...fromReqNotMet, ...(localUnmet || detectUnmetMusts(job))];
  const seen = new Set<string>();
  const unmetMusts = unmet.filter((u) => {
    const key = `${u.kind}|${normalizeLoose(u.text)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Force core unmet only for duties-derived hard gaps the candidate lacks
  for (const core of dutiesCores) {
    if (!isHardProfileGap(core)) continue;
    const hasMet = requirements.some(
      (r) =>
        r.match !== "not_met" &&
        (normalizeLoose(r.text).includes(normalizeLoose(core).slice(0, 16)) ||
          normalizeLoose(core).includes(normalizeLoose(r.text).slice(0, 16)))
    );
    if (
      !hasMet &&
      !unmetMusts.some((u) => u.kind === "core" && normalizeLoose(u.text).includes(normalizeLoose(core).slice(0, 12)))
    ) {
      unmetMusts.push({ kind: "core", text: core });
    }
  }

  const credential = unmetMusts.find(
    (u) => u.kind === "degree" || u.kind === "certification" || u.kind === "language"
  );

  let experienceFitPct = rawPct;
  let blocked = false;
  let blockedBy: string | undefined;
  const steps: string[] = [`raw=${rawPct}`];

  if (credential) {
    blocked = true;
    blockedBy = credential.text;
    steps.push(`blocked_by_credential(${credential.kind})`);
  } else {
    const coreUnmet = unmetMusts.some((u) => u.kind === "core") || requirements.some((r) => r.core && r.match === "not_met");
    if (coreUnmet) {
      experienceFitPct = Math.min(experienceFitPct, CORE_CAP);
      steps.push(`core_cap→${experienceFitPct}`);
    } else if (unmetMusts.filter((u) => u.kind !== "degree" && u.kind !== "certification" && u.kind !== "language").length >= 2) {
      experienceFitPct = Math.min(experienceFitPct, MULTI_MUST_CAP);
      steps.push(`multi_must_cap→${experienceFitPct}`);
    }
  }

  const fitVerdict = verdictFromPct(experienceFitPct, blocked);
  steps.push(`verdict=${fitVerdict}`);

  return {
    experienceFitPct,
    blocked,
    blockedBy,
    fitVerdict,
    unmetMusts,
    requirements,
    coreRequirements,
    calculation: steps.join(" · "),
  };
}

function normalizeLoose(s: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function guessCredentialKind(text: string): MustKind {
  if (/degree|b\.?\s*sc|bachelor|תואר/i.test(text)) return "degree";
  if (/cert|belt|pmp/i.test(text)) return "certification";
  if (/language|english|hebrew|arabic|אנגלית|שפה/i.test(text)) return "language";
  return "other";
}

export function applyFitScoreToJobs(jobs: Job[]): Job[] {
  return jobs.map((j) => {
    const fit = applyFitScore(j);
    if (fit.notEnoughInfo) {
      return {
        ...j,
        experienceFitPct: undefined,
        blocked: false,
        blockedBy: undefined,
        blockedKind: undefined,
        fitVerdict: undefined,
        notEnoughInfo: true,
        notEnoughInfoReason: fit.notEnoughInfoReason || j.notEnoughInfoReason,
        aiStatus: "not_enough_info" as const,
        aiRating: j.aiRating
          ? { ...j.aiRating, experience_fit_pct: undefined, recommendation: "skip" as const }
          : j.aiRating,
      };
    }

    const aiRating: AiRating | undefined = j.aiRating
      ? {
          ...j.aiRating,
          experience_fit_pct: fit.experienceFitPct,
          requirements: fit.requirements || j.aiRating.requirements,
          core_requirements: fit.coreRequirements || j.aiRating.core_requirements,
          recommendation:
            fit.fitVerdict === "blocked"
              ? j.aiRating.recommendation
              : fit.fitVerdict === "low"
                ? "skip"
                : fit.fitVerdict,
        }
      : {
          experience_fit:
            fit.experienceFitPct >= 75
              ? "high"
              : fit.experienceFitPct >= 55
                ? "medium"
                : fit.experienceFitPct >= 45
                  ? "low-medium"
                  : "low",
          experience_fit_pct: fit.experienceFitPct,
          smart_manufacturing_fit: "medium",
          management_fit: "medium",
          career_direction: "medium",
          recommendation:
            fit.fitVerdict === "blocked"
              ? "maybe"
              : fit.fitVerdict === "low"
                ? "skip"
                : fit.fitVerdict,
          cv_track: "SM",
          why_yes: "",
          gaps: fit.unmetMusts.map((u) => u.text).join("; "),
          check: fit.calculation || "",
          requirements: fit.requirements,
          core_requirements: fit.coreRequirements,
        };

    const cred = fit.unmetMusts.find(
      (u) => u.kind === "degree" || u.kind === "certification" || u.kind === "language"
    );
    return {
      ...j,
      experienceFitPct: fit.experienceFitPct,
      blocked: fit.blocked,
      blockedBy: fit.blockedBy,
      fitVerdict: fit.fitVerdict,
      blockedKind: cred ? (cred.kind as BlockedKind) : undefined,
      notEnoughInfo: false,
      notEnoughInfoReason: undefined,
      requirementsInferred: j.requirementsInferred,
      aiRating,
      aiStatus: j.aiStatus === "not_ai_rated" ? "not_ai_rated" : "ai_rated",
    };
  });
}

export function blockedStrongFit(job: Pick<Job, "blocked" | "experienceFitPct">): boolean {
  return Boolean(job.blocked) && (job.experienceFitPct ?? 0) >= GO_MIN;
}

export function blockedPillLabel(job: Pick<Job, "blockedKind" | "blockedBy">): string {
  if (job.blockedKind) return `Blocked · ${credentialLabel(job.blockedKind)}`;
  if (job.blockedBy) {
    const t = job.blockedBy.toLowerCase();
    if (/degree|b\.?\s*sc|bachelor|תואר/.test(t)) return "Blocked · degree";
    if (/cert|belt|pmp/.test(t)) return "Blocked · certification";
    if (/language|arabic|russian|fluent|אנגלית/.test(t)) return "Blocked · language";
  }
  return "Blocked";
}
