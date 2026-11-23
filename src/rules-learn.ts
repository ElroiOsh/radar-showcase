import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadFeedback } from "./feedback.js";
import { projectRoot } from "./profile.js";
import {
  HARD_HIDE_REASONS,
  proposalThreshold,
  reasonLabel,
  type FeedbackReasonId,
} from "./reasons.js";
import {
  keywordsForSeniorityId,
  titleMatchesKeywords,
} from "./seniority.js";
import { writeJsonFile } from "./store.js";
import type {
  FeedbackEntry,
  Job,
  LearnedRule,
  RuleAttribute,
  RuleProposal,
  RuleType,
} from "./types.js";

function dataPath(name: string): string {
  const dir = join(projectRoot(), "data");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, name);
}

function loadJson<T>(name: string, fallback: T): T {
  const path = dataPath(name);
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function loadRules(): LearnedRule[] {
  return loadJson("rules.json", [] as LearnedRule[]);
}

export function saveRules(rules: LearnedRule[]): void {
  writeJsonFile(dataPath("rules.json"), rules);
}

export function loadProposals(): RuleProposal[] {
  return loadJson("rule-proposals.json", [] as RuleProposal[]);
}

export function saveProposals(list: RuleProposal[]): void {
  writeJsonFile(dataPath("rule-proposals.json"), list);
}

function cityBand(location: string): string {
  const loc = location.toLowerCase();
  if (/rehovot|רחובות/.test(loc)) return "Rehovot";
  if (/kiryat[\s-]?gat|קריית\s*גת/.test(loc)) return "Kiryat Gat";
  if (/tel[\s-]?aviv|תל\s*אביב/.test(loc)) return "Tel Aviv";
  if (/petah|פתח/.test(loc)) return "Petah Tikva";
  if (/yavne|יבנה/.test(loc)) return "Yavne";
  if (/ness|nes ziona|נס ציונה/.test(loc)) return "Ness Ziona";
  if (/ashdod|אשדוד/.test(loc)) return "Ashdod";
  if (/modiin|מודיעין/.test(loc)) return "Modiin";
  if (/rishon|ראשון/.test(loc)) return "Rishon LeZion";
  return location.split(",")[0]?.trim() || location || "Unknown";
}

type AttrKey = { attribute: RuleAttribute; value: string; keywords: string[] };

function titlePatternKeywords(title: string): AttrKey | null {
  const t = title.toLowerCase();
  const patterns: Array<{ value: string; keywords: string[] }> = [
    {
      value: "production_manager",
      keywords: ["production manager", "מנהל ייצור", "מנהל/ת ייצור", "מנהל משמרת"],
    },
    {
      value: "shift_manager",
      keywords: ["shift manager", "מנהל משמרת", "מנהל/ת משמרת"],
    },
    {
      value: "process_engineer",
      keywords: ["process engineer", "מהנדס תהליך", "מהנדס/ת תהליך"],
    },
  ];
  for (const p of patterns) {
    if (p.keywords.some((k) => t.includes(k.toLowerCase()))) {
      return { attribute: "title_keyword", value: p.value, keywords: p.keywords };
    }
  }
  return null;
}

function attributesFromEntry(e: FeedbackEntry): AttrKey[] {
  const snap = e.snapshot;
  const out: AttrKey[] = [];
  const company = snap?.company || e.company;
  const location = snap?.location || e.location;
  const source = (snap?.source || e.source).split("/")[0] || "Unknown";
  const title = snap?.title || e.title || "";
  if (company) out.push({ attribute: "company", value: company, keywords: [] });
  if (location) out.push({ attribute: "location", value: cityBand(location), keywords: [] });
  if (source) out.push({ attribute: "source", value: source, keywords: [] });
  if (snap?.agency) out.push({ attribute: "agency", value: "agency", keywords: [] });
  for (const s of snap?.seniorityWords ?? []) {
    out.push({
      attribute: "seniority",
      value: s,
      keywords: keywordsForSeniorityId(s),
    });
  }
  const titlePat = titlePatternKeywords(title);
  if (titlePat && e.verdict === "not_relevant") out.push(titlePat);
  return out;
}

function ruleTypeFor(
  verdict: "relevant" | "not_relevant" | "applied",
  reasonId: FeedbackReasonId
): RuleType {
  if (verdict === "relevant" || verdict === "applied") return "boost";
  if (HARD_HIDE_REASONS.has(reasonId)) return "hide";
  return "demote";
}

function plainEnglish(
  type: RuleType,
  attribute: RuleAttribute,
  value: string,
  keywords: string[]
): string {
  const verb = type === "hide" ? "Hide" : type === "demote" ? "Demote" : "Boost";
  if (attribute === "seniority" || attribute === "title_keyword") {
    const kw = keywords.length ? keywords.join(" / ") : value;
    return `${verb} jobs whose title matches: ${kw}`;
  }
  if (attribute === "company") return `${verb} jobs at ${value}`;
  if (attribute === "location") return `${verb} jobs in ${value}`;
  if (attribute === "source") return `${verb} jobs from source ${value}`;
  if (attribute === "agency") return `${verb} agency / staffing postings`;
  if (attribute === "industry") return `${verb} jobs in industry ${value}`;
  return `${verb} jobs where ${attribute}=${value}`;
}

function proposalKey(p: Pick<RuleProposal, "type" | "attribute" | "value" | "reasonId">): string {
  return `${p.type}|${p.attribute}|${p.value}|${p.reasonId}`;
}

export function jobMatchesRule(job: Job, rule: LearnedRule): boolean {
  if (!rule.enabled) return false;
  switch (rule.attribute) {
    case "company":
      return job.company.toLowerCase() === rule.value.toLowerCase();
    case "location":
      return cityBand(job.location).toLowerCase() === rule.value.toLowerCase();
    case "source":
      return job.source.toLowerCase().startsWith(rule.value.toLowerCase());
    case "agency":
      return looksAgencyJob(job);
    case "seniority":
    case "title_keyword":
      return titleMatchesKeywords(job.title, rule.keywords.length ? rule.keywords : [rule.value]);
    case "industry":
      return `${job.description} ${job.company}`.toLowerCase().includes(rule.value.toLowerCase());
    default:
      return false;
  }
}

function looksAgencyJob(job: Job): boolean {
  return /agency|staffing|experis|jobsseek|השמה/i.test(`${job.company} ${job.source}`);
}

export function loadShowAnyway(): Set<string> {
  return new Set(loadJson("rule-show-anyway.json", [] as string[]));
}

export function saveShowAnyway(ids: string[]): void {
  writeJsonFile(dataPath("rule-show-anyway.json"), [...new Set(ids)]);
}

export function applyRulesToJobs(
  jobs: Job[],
  rules: LearnedRule[] = loadRules(),
  showAnyway: Set<string> = loadShowAnyway()
): {
  visible: Job[];
  hidden: Array<{ job: Job; rule: LearnedRule }>;
} {
  const enabled = rules.filter((r) => r.enabled);
  const hidden: Array<{ job: Job; rule: LearnedRule }> = [];
  const visible: Job[] = [];

  for (const job of jobs) {
    const hideRule = enabled.find((r) => r.type === "hide" && jobMatchesRule(job, r));
    if (hideRule && !showAnyway.has(job.id)) {
      hidden.push({ job, rule: hideRule });
      continue;
    }
    let j = { ...job, matchReasons: [...job.matchReasons] };
    for (const r of enabled) {
      if (!jobMatchesRule(j, r)) continue;
      if (r.type === "demote") {
        j = {
          ...j,
          matchScore: Math.max(0, j.matchScore - 25),
          matchReasons: [...j.matchReasons, `Rule demote: ${r.plainEnglish}`],
        };
      }
      if (r.type === "boost") {
        j = {
          ...j,
          matchScore: Math.min(99, j.matchScore + 15),
          matchReasons: [...j.matchReasons, `Rule boost: ${r.plainEnglish}`],
        };
      }
    }
    visible.push(j);
  }

  visible.sort((a, b) => {
    const ra = a.aiRating?.recommendation;
    const rb = b.aiRating?.recommendation;
    const rank = (r?: string) => (r === "go" ? 0 : r === "maybe" ? 1 : 2);
    const d = rank(ra) - rank(rb);
    if (d !== 0) return d;
    return b.matchScore - a.matchScore;
  });

  return { visible, hidden };
}

export function regenerateProposals(currentJobs: Job[] = []): RuleProposal[] {
  const feedback = loadFeedback();
  const existing = loadProposals();
  const rejected = existing.filter((p) => p.status === "rejected");
  const openOld = existing.filter((p) => p.status === "open");

  type Bucket = {
    verdict: "relevant" | "not_relevant";
    reasonId: FeedbackReasonId;
    attribute: RuleAttribute;
    value: string;
    keywords: string[];
    jobIds: string[];
  };
  const buckets = new Map<string, Bucket>();

  for (const e of feedback) {
    if (e.verdict === "applied" || e.verdict === "closed") continue;
    // Relevant is one-tap (no reasons) — only not_relevant chips drive suggestions
    if (e.verdict !== "not_relevant") continue;
    for (const reasonId of e.reasons ?? []) {
      for (const attr of attributesFromEntry(e)) {
        const key = `${e.verdict}|${reasonId}|${attr.attribute}|${attr.value}`;
        const b = buckets.get(key) ?? {
          verdict: e.verdict === "relevant" ? "relevant" : "not_relevant",
          reasonId,
          attribute: attr.attribute,
          value: attr.value,
          keywords: attr.keywords,
          jobIds: [],
        };
        if (!b.jobIds.includes(e.jobId)) b.jobIds.push(e.jobId);
        if (attr.keywords.length) b.keywords = attr.keywords;
        buckets.set(key, b);
      }
    }
  }

  const feedbackById = new Map(feedback.map((e) => [e.jobId, e]));
  const nextOpen: RuleProposal[] = [];

  for (const b of buckets.values()) {
    const need = proposalThreshold(b.reasonId);
    if (b.jobIds.length < need) continue;

    // Opposite verdict with same attribute value blocks proposal
    const opposite = b.verdict === "relevant" ? "not_relevant" : "relevant";
    const blocked = feedback.some(
      (e) =>
        e.verdict === opposite &&
        attributesFromEntry(e).some((a) => a.attribute === b.attribute && a.value === b.value)
    );
    if (blocked) continue;

    const type = ruleTypeFor(b.verdict, b.reasonId);
    const draft: LearnedRule = {
      id: "draft",
      type,
      attribute: b.attribute,
      value: b.value,
      keywords: b.keywords,
      reasonId: b.reasonId,
      plainEnglish: plainEnglish(type, b.attribute, b.value, b.keywords),
      enabled: true,
      createdAt: new Date().toISOString(),
      evidenceJobIds: b.jobIds,
    };

    // Already an approved rule with same key?
    const approved = loadRules().some(
      (r) =>
        r.type === draft.type &&
        r.attribute === draft.attribute &&
        r.value === draft.value &&
        r.reasonId === draft.reasonId
    );
    if (approved) continue;

    const affected = currentJobs.filter((j) => jobMatchesRule(j, draft));
    const taggedIds = new Set(feedback.map((e) => e.jobId));
    const highFitUntagged = affected.filter((j) => {
      if (taggedIds.has(j.id)) return false;
      const go = j.aiRating?.recommendation === "go";
      const high =
        j.aiRating?.experience_fit === "high" ||
        j.aiRating?.smart_manufacturing_fit === "high" ||
        j.matchScore >= 80;
      return go || high;
    });

    const key = proposalKey({
      type: draft.type,
      attribute: draft.attribute,
      value: draft.value,
      reasonId: draft.reasonId,
    });
    const prevRejected = rejected.find((p) => proposalKey(p) === key);
    if (prevRejected) {
      const min = Math.max(6, (prevRejected.rejectedEvidenceCount ?? prevRejected.evidenceCount) * 2);
      if (b.jobIds.length < min) continue;
    }

    const prevOpen = openOld.find((p) => proposalKey(p) === key);
    nextOpen.push({
      id: prevOpen?.id ?? `prop-${Buffer.from(key).toString("base64url").slice(0, 18)}`,
      type: draft.type,
      attribute: draft.attribute,
      value: draft.value,
      keywords: draft.keywords,
      reasonId: draft.reasonId,
      plainEnglish: draft.plainEnglish,
      evidenceJobIds: b.jobIds,
      evidenceCount: b.jobIds.length,
      predictedAffect: affected.length,
      highFitUntaggedWarning: highFitUntagged.length > 0,
      highFitUntaggedJobIds: highFitUntagged.map((j) => j.id),
      status: "open",
      createdAt: prevOpen?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    void feedbackById;
    void reasonLabel;
  }

  const merged = [...nextOpen, ...rejected];
  saveProposals(merged);
  return nextOpen;
}

export function approveProposal(
  proposalId: string,
  edits?: Partial<Pick<LearnedRule, "plainEnglish" | "keywords" | "type" | "enabled">>
): LearnedRule | null {
  const proposals = loadProposals();
  const p = proposals.find((x) => x.id === proposalId && x.status === "open");
  if (!p) return null;
  const rule: LearnedRule = {
    id: `rule-${Date.now().toString(36)}`,
    type: edits?.type ?? p.type,
    attribute: p.attribute,
    value: p.value,
    keywords: edits?.keywords ?? p.keywords,
    reasonId: p.reasonId,
    plainEnglish: edits?.plainEnglish ?? p.plainEnglish,
    enabled: edits?.enabled ?? true,
    createdAt: new Date().toISOString(),
    evidenceJobIds: p.evidenceJobIds,
  };
  const rules = loadRules();
  rules.unshift(rule);
  saveRules(rules);
  saveProposals(proposals.filter((x) => x.id !== proposalId));
  return rule;
}

export function rejectProposal(proposalId: string): void {
  const proposals = loadProposals();
  const next = proposals.map((p) =>
    p.id === proposalId
      ? {
          ...p,
          status: "rejected" as const,
          rejectedAt: new Date().toISOString(),
          rejectedEvidenceCount: p.evidenceCount,
        }
      : p
  );
  saveProposals(next);
}

export function updateRule(id: string, patch: Partial<LearnedRule>): LearnedRule | null {
  const rules = loadRules();
  const i = rules.findIndex((r) => r.id === id);
  if (i < 0) return null;
  rules[i] = { ...rules[i], ...patch, id: rules[i].id };
  saveRules(rules);
  return rules[i];
}

export function deleteRule(id: string): void {
  saveRules(loadRules().filter((r) => r.id !== id));
}
