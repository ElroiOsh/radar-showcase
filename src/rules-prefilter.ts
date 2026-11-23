import type { Job } from "./types.js";

const TITLE_DROP =
  /\b(student|intern|internship|technician|operator|טכנאי|מפעיל|סטודנט|מתלמד|junior\s+only)\b/i;

/**
 * Software / IT / cyber / pure digital automation — drop unless manufacturing context.
 * Prefer multi-word phrases; avoid bare "software" / "QA" / "network" (too many false hits
 * in manufacturing postings: supplier network, quality assurance, software tools).
 */
const SOFTWARE_IT_RE =
  /\b(network\s+automation|network(?:ing)?\s+engineer|devops|site\s+reliability|sre\b|cloud\s+(?:engineer|architect|security|ops)|cyber(?:\s*security)?|information\s+security|infosec|software\s+(?:engineer|developer|architect|development)|full[\s-]?stack|frontend\s+developer|front[\s-]?end\s+developer|backend\s+developer|back[\s-]?end\s+developer|qa\s+(?:engineer|automation|analyst)|sdet\b|test\s+automation|rpa\b|it[\s-]?automation|ci\s*\/\s*cd|cicd|python\s+developer|data\s+engineer|ccna\b|kubernetes|k8s\b|react\s+developer|node\.?js\s+developer|microservices|secops|soc\s+analyst|penetration\s+test|tcp\/ip|routing\s+and\s+switching)\b/i;

const HEBREW_IT_RE =
  /אבטחת\s*מידע|סייבר|מפתח\s*תוכנה|מהנדס\s*תוכנה|devops|רשתות\s*מחשבים|מהנדס\s*רשת|אוטומציית\s*בדיקות/;

/** Strong title-only IT signals (even without the long phrases above). */
const TITLE_IT_RE =
  /\b(network|networking|devops|cyber|cloud|software|sdet|qa\b|rpa\b|kubernetes|full[\s-]?stack|data\s+engineer|python\s+developer|it\s+automation|ci\s*\/\s*cd|ccna)\b/i;

const MFG_CONTEXT_RE =
  /\b(production(?:\s+line|\s+engineer|\s+manager|\s+engineering)?|manufacturing|factory|plant\b|machines?\b|equipment|plc\b|assembly|process\s+engineering|robot(?:ic)?s?\b|cobots?|shop\s+floor|industrial\s+automation|mes\b|smart\s+manufacturing|industry\s*4|cnc\b|machining|injection\s+mold|smt\b|pcb(?:a)?\b)\b/i;

const HEBREW_MFG_RE = /ייצור|קו\s*ייצור|מפעל|רצפת\s*ייצור|אוטומציה\s*תעשייתית|מהנדס\s*תהליך|תפ["״]?י/;

const AUTOMATION_TITLE_RE = /\bautomation\b|אוטומציה|אוטמציה/i;

function blobOf(job: Pick<Job, "title" | "description" | "requirements">): string {
  return `${job.title}\n${job.description || ""}\n${job.requirements || ""}`;
}

function hasMfgContext(text: string): boolean {
  return MFG_CONTEXT_RE.test(text) || HEBREW_MFG_RE.test(text);
}

function hasSoftwareItSignal(text: string): boolean {
  return SOFTWARE_IT_RE.test(text) || HEBREW_IT_RE.test(text);
}

/**
 * Title-only hard drop + software/IT drop (unless manufacturing context).
 * Credential gaps are scored in fit-score.ts — not removed here.
 */
export function rulesDropReason(
  job: Pick<Job, "title" | "description" | "requirements">
): string | null {
  if (TITLE_DROP.test(job.title)) return `Title drop: ${job.title}`;

  const blob = blobOf(job);
  const title = job.title || "";
  const titleIt = TITLE_IT_RE.test(title) || HEBREW_IT_RE.test(title);
  const bodyIt = hasSoftwareItSignal(blob);

  if (titleIt || bodyIt) {
    // Manufacturing title/context can save non-IT-titled roles that mention tools in the body.
    if (!titleIt && hasMfgContext(title)) return null;
    if (AUTOMATION_TITLE_RE.test(title) && hasMfgContext(blob) && !titleIt) return null;
    if (!titleIt && hasMfgContext(blob) && !TITLE_IT_RE.test(blob.slice(0, 400))) {
      // Incidental phrase deep in a manufacturing JD — keep
      return null;
    }
    const hit =
      title.match(TITLE_IT_RE)?.[0] ||
      blob.match(SOFTWARE_IT_RE)?.[0] ||
      blob.match(HEBREW_IT_RE)?.[0] ||
      "software/IT";
    return `Software/IT role (${hit}): ${title}`;
  }

  // Automation-only title with no manufacturing signal → drop
  if (AUTOMATION_TITLE_RE.test(title) && !hasMfgContext(blob)) {
    return `Automation without manufacturing context: ${title}`;
  }

  return null;
}

export interface PrefilterResult<T> {
  kept: T[];
  dropped: number;
  droppedDetails: Array<{ title: string; reason: string }>;
}

export function applyRulesPrefilter<T extends Pick<Job, "title" | "description" | "requirements">>(
  jobs: T[]
): PrefilterResult<T> {
  const kept: T[] = [];
  const droppedDetails: Array<{ title: string; reason: string }> = [];
  for (const job of jobs) {
    const reason = rulesDropReason(job);
    if (reason) {
      droppedDetails.push({ title: job.title, reason });
      continue;
    }
    kept.push(job);
  }
  return { kept, dropped: droppedDetails.length, droppedDetails };
}
