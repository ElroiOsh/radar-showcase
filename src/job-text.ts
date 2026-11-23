import type { Job } from "./types.js";

const MIN_POSTING_CHARS = 600;
/** Long postings without a clear requirements heading can still be scored. */
const INFER_REQUIREMENTS_MIN_CHARS = 1500;

const REQUIREMENTS_MARKERS =
  /(?:key\s+qualifications?|qualifications?|what you(?:'ll| will)?\s+bring|what we(?:'re| are)\s+looking\s+for|who you are|must\s+have|skills|experience|your\s+profile|requirements?|essential education|מה אנחנו מחפשים|דרישות(?:\s+התפקיד)?|כישורים|ניסיון)/i;

const DUTIES_MARKERS =
  /(?:התפקיד כולל|responsibilities|as part of this role|what (?:you(?:'ll| will) be doing|you will)|in this role)/i;

export type NotEnoughInfoCode =
  | "linkedin_blocked"
  | "no_description"
  | "no_requirements_section"
  | "too_short";

export type PostingTextCheck =
  | { ok: true; requirementsInferred?: boolean }
  | { ok: false; reason: string; code: NotEnoughInfoCode };

export function notEnoughInfoLabel(code?: string | null): string {
  switch (code) {
    case "linkedin_blocked":
      return "LinkedIn blocked";
    case "no_description":
      return "no description";
    case "no_requirements_section":
      return "no requirements section";
    case "too_short":
      return "no description";
    default:
      return "Full posting text missing or too short";
  }
}

/** True when stored posting is thick enough to score honestly. */
export function hasEnoughPostingText(
  job: Pick<Job, "description" | "requirements" | "notEnoughInfoReason">
): PostingTextCheck {
  if (job.notEnoughInfoReason === "linkedin_blocked") {
    return { ok: false, reason: "LinkedIn blocked", code: "linkedin_blocked" };
  }

  const desc = String(job.description || "").trim();
  const req = String(job.requirements || "").trim();
  const combined = `${desc}\n${req}`.trim();

  const stub =
    /open the linkedin posting|see (?:the )?full (?:linkedin )?posting|see full posting/i.test(
      combined
    );

  if (combined.length < MIN_POSTING_CHARS || (stub && combined.length < 900)) {
    return {
      ok: false,
      reason: stub
        ? "Stub description without full body"
        : `Posting text too short (${combined.length} < ${MIN_POSTING_CHARS})`,
      code: "no_description",
    };
  }

  const hasReqSection =
    REQUIREMENTS_MARKERS.test(combined) ||
    /(?:mandatory|חובה|required|must have)/i.test(combined);

  if (!hasReqSection) {
    if (combined.length >= INFER_REQUIREMENTS_MIN_CHARS) {
      return { ok: true, requirementsInferred: true };
    }
    return {
      ok: false,
      reason: "No requirements section detected",
      code: "no_requirements_section",
    };
  }

  return { ok: true };
}

/** Slice duties / day-to-day section when present. */
export function extractDutiesSection(text: string): string {
  const t = String(text || "");
  const duty = t.search(DUTIES_MARKERS);
  if (duty < 0) return "";
  const after = t.slice(duty);
  const end = after.search(REQUIREMENTS_MARKERS);
  return (end > 0 ? after.slice(0, end) : after).trim();
}

/**
 * Hebrew יתרון rule: after a line marked יתרון, following bullets without their own
 * חובה/יתרון/mandatory/advantage label stay "must".
 */
export function classifyHebrewRequirementLines(text: string): Array<{
  line: string;
  must: boolean;
}> {
  const lines = String(text || "")
    .split(/\n|•|·|(?:^|\s)-\s+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 8);

  let afterAdvantage = false;
  const out: Array<{ line: string; must: boolean }> = [];
  for (const line of lines) {
    const isAdv = /יתרון|advantage/i.test(line);
    const isMust = /חובה|mandatory|required|must\b/i.test(line);
    if (isAdv && !isMust) {
      afterAdvantage = true;
      out.push({ line, must: false });
      continue;
    }
    if (isMust) {
      afterAdvantage = false;
      out.push({ line, must: true });
      continue;
    }
    if (afterAdvantage) {
      out.push({ line, must: true });
    } else {
      out.push({ line, must: true });
    }
  }
  return out;
}

/** Skills that appear repeatedly in duties are core (never degree/years/language/CAD). */
export function detectCoreFromDuties(text: string): string[] {
  const duties = extractDutiesSection(text) || text;
  const cores: Array<{ key: string; label: string; re: RegExp }> = [
    {
      key: "robot_programming",
      label: "Industrial robot / cobot programming",
      re: /תכנות\s*רובוט|robot(?:ic)?\s*programm|programming\s*(?:industrial\s*)?robots?|קובוט/gi,
    },
    {
      key: "gripper",
      label: "Gripper / end-effector design",
      re: /גריפר|gripper|end[ -]?effector/gi,
    },
    {
      key: "robotic_cells",
      label: "Robotic cells / robotic production lines",
      re: /תא(?:ים)?\s*רובוט|robotic\s*cells?|קווי\s*ייצור\s*רובוט|מערכות\s*אוטומציה\s*וקווי\s*ייצור\s*רובוט/gi,
    },
    {
      key: "vision",
      label: "Industrial vision systems",
      re: /vision\s*תעשיית|industrial\s*vision|מערכות\s*vision/gi,
    },
  ];

  const found: string[] = [];
  for (const c of cores) {
    const matches = duties.match(c.re) || [];
    if (matches.length >= 1 && /robot|רובוט|gripper|גריפר|vision/i.test(c.label + matches.join(""))) {
      if (matches.length >= 2 || c.key === "robot_programming" || c.key === "gripper") {
        found.push(c.label);
      }
    }
  }
  return found;
}

export function postingBlob(job: Pick<Job, "title" | "description" | "requirements">): string {
  return `${job.title}\n${job.description}\n${job.requirements}`;
}

export function requirementsSliceFromFull(full: string): string {
  const reqIdx = full.search(REQUIREMENTS_MARKERS);
  if (reqIdx >= 0) return full.slice(reqIdx);
  return full.slice(Math.floor(full.length * 0.45));
}
