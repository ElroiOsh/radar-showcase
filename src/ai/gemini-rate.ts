import { anonymizedProfileForAi } from "./anonymized-profile.js";
import { hasEnoughPostingText } from "../job-text.js";
import { verifyRequirementEvidence, pctFromRequirements } from "../fit-score.js";
import { tagFingerprint } from "../tag-fingerprint.js";
import type {
  AiFitLevel,
  AiRecommendation,
  AiRating,
  AiRequirementMatch,
  AiUnmetMust,
  CvTrack,
  Job,
  ReqMatchLevel,
} from "../types.js";

const MODEL = process.env.GEMINI_MODEL?.trim() || "gemini-flash-lite-latest";

export interface RateStats {
  rated: number;
  skippedQuota: number;
  skippedAlreadyRated: number;
  errors: number;
  notEnoughInfo: number;
  geminiCalls: number;
}

function clampFit(v: unknown): AiFitLevel {
  const s = String(v || "").toLowerCase();
  if (s === "high" || s === "medium" || s === "low-medium" || s === "low") return s;
  return "low";
}

function parseJson(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < 0) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function companyTypeHint(company: string): string {
  const c = company.toLowerCase();
  if (/medtronic|philips|ge health|west pharm|johnson|j&j|nova|applied materials|kla|intel/.test(c)) {
    if (/nova|applied|kla|intel/.test(c)) return "semiconductor / industrial equipment company (Israel)";
    return "regulated medical device / healthcare equipment company (Israel)";
  }
  if (/hp|indigo|kornit/.test(c)) return "industrial printing / industrial equipment company (Israel)";
  if (/stratasys/.test(c)) return "additive manufacturing / 3D printing materials company (Israel)";
  if (/iai|israel aerospace/.test(c)) return "aerospace / defense manufacturing company (Israel)";
  if (/razor/.test(c)) return "industrial AI / predictive maintenance company (Israel)";
  return "industrial / manufacturing company (Israel)";
}

function scrubDescription(text: string, company: string): string {
  let out = text.slice(0, 6000);
  if (company.trim()) {
    const re = new RegExp(company.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    out = out.replace(re, "the company");
  }
  out = out.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[contact]");
  out = out.replace(/\+?\d[\d\s\-()]{7,}\d/g, "[phone]");
  return out;
}

function buildPrompt(job: Job): string {
  const profile = anonymizedProfileForAi();
  return `You rate one job for a candidate. Return ONLY strict JSON, no markdown.

Candidate profile (anonymized) — for every met/partial match, evidence MUST be copied WORD FOR WORD from this profile text:
${profile}

Job:
title: ${job.title}
company_type_hint: ${companyTypeHint(job.company)}
location: ${job.location}
full_posting:
${scrubDescription(`${job.description}\n\n${job.requirements || ""}`, job.company)}

Scoring rules:
1) Extract concrete requirements into "requirements" (array). Each item:
   - text: short requirement quote
   - importance: "must" or "nice"
   - match: "met" | "partial" | "not_met"
   - evidence: for met/partial ONLY — exact substring copied from the profile above (never invent). For not_met use "".
   - core: true if this is a day-to-day core skill (see rule 3)

2) Adjacent skills do NOT count. Mark not_met, not partial.
   A related but different skill does not count. Mark not_met, not partial. Examples: designing fixtures or jigs ≠ gripper or end-effector design. Supporting automated lines ≠ programming industrial robots. Analyzing inspection data ≠ working with industrial vision systems. Partial is allowed only when the profile shows the same skill at a lower level or for a shorter time.

3) core_requirements: choose 2–5 skills from DUTIES / day-to-day work ("התפקיד כולל" / "Responsibilities" / "As Part Of This Role"), NOT from generic requirements lists.
   - Degree, years of experience, language, and CAD can NEVER be core.
   - If duties repeat a skill (e.g. robots, robotic cells, robot programming, grippers), that skill MUST be core.
   - Core skills the candidate lacks → match not_met and list in unmet_musts with kind "core".

4) Hebrew יתרון rule: after a line marked יתרון / advantage, following bullets without their own חובה/יתרון/mandatory/advantage label remain "must".

5) experience_fit_pct: integer 0–100 from must-requirement matches (met=100, partial=50, not_met=0), averaged. Do NOT lower this number for unmet mandatory degree/certification/language — list those in unmet_musts (kind degree|certification|language) instead. Local code applies caps.

6) unmet_musts: {kind, text} kind one of degree|certification|language|core|other.

7) smart_manufacturing_fit, management_fit, career_direction: high|medium|low-medium|low
8) experience_fit: coarse mirror of experience_fit_pct (>=75 high, >=55 medium, >=45 low-medium, else low)
9) recommendation: go|maybe|skip (preliminary)
10) cv_track: SM or EM
11) why_yes / gaps / check: English only, short

JSON shape:
{"experience_fit_pct":0,"experience_fit":"","smart_manufacturing_fit":"","management_fit":"","career_direction":"","recommendation":"","cv_track":"","requirements":[{"text":"","importance":"must","match":"not_met","evidence":"","core":false}],"core_requirements":[],"unmet_musts":[],"why_yes":"","gaps":"","check":""}`;
}

async function callGemini(
  prompt: string
): Promise<{ ok: true; text: string } | { ok: false; quota: boolean; retryable: boolean; error: string }> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return { ok: false, quota: false, retryable: false, error: "GEMINI_API_KEY missing" };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(key)}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.15, maxOutputTokens: 2048 },
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (res.status === 429) return { ok: false, quota: true, retryable: true, error: "Gemini quota (429)" };
    if (!res.ok) {
      const body = await res.text();
      const quota = /quota|rate|limit/i.test(body);
      return {
        ok: false,
        quota,
        retryable: quota || res.status >= 500,
        error: `Gemini HTTP ${res.status}`,
      };
    }
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
    if (!text) return { ok: false, quota: false, retryable: true, error: "Empty Gemini response" };
    return { ok: true, text };
  } catch (err) {
    return {
      ok: false,
      quota: false,
      retryable: true,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function parseRequirements(raw: unknown): AiRequirementMatch[] {
  if (!Array.isArray(raw)) return [];
  const out: AiRequirementMatch[] = [];
  for (const row of raw) {
    const r = row as Record<string, unknown>;
    const match = String(r.match || "not_met").toLowerCase();
    const m: ReqMatchLevel =
      match === "met" || match === "partial" || match === "not_met" ? match : "not_met";
    const importance = String(r.importance || "must").toLowerCase() === "nice" ? "nice" : "must";
    const text = String(r.text || "").trim().slice(0, 200);
    if (!text) continue;
    out.push({
      text,
      importance,
      match: m,
      evidence: String(r.evidence || "").trim().slice(0, 300),
      core: Boolean(r.core),
    });
  }
  return out;
}

function ratingFromParsed(parsed: Record<string, unknown>, rawText: string): AiRating {
  let requirements = verifyRequirementEvidence(parseRequirements(parsed.requirements));
  const fromReqs = pctFromRequirements(requirements);
  const pctRaw = Number(parsed.experience_fit_pct);
  const experience_fit_pct =
    fromReqs != null
      ? fromReqs
      : Number.isFinite(pctRaw)
        ? Math.max(0, Math.min(100, Math.round(pctRaw)))
        : undefined;

  const unmetRaw = parsed.unmet_musts;
  const unmet_musts: AiUnmetMust[] = Array.isArray(unmetRaw)
    ? unmetRaw
        .map((u) => {
          const row = u as { kind?: unknown; text?: unknown };
          const kind = String(row.kind || "other");
          const text = String(row.text || "").trim().slice(0, 160);
          if (!text) return null;
          const k = (
            ["degree", "certification", "language", "core", "other"].includes(kind)
              ? kind
              : "other"
          ) as AiUnmetMust["kind"];
          return { kind: k, text };
        })
        .filter((u): u is AiUnmetMust => Boolean(u))
    : [];

  const core_requirements = Array.isArray(parsed.core_requirements)
    ? parsed.core_requirements.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 8)
    : [];

  return {
    experience_fit: clampFit(
      parsed.experience_fit ||
        (experience_fit_pct == null
          ? "low"
          : experience_fit_pct >= 75
            ? "high"
            : experience_fit_pct >= 55
              ? "medium"
              : experience_fit_pct >= 45
                ? "low-medium"
                : "low")
    ),
    experience_fit_pct,
    smart_manufacturing_fit: clampFit(parsed.smart_manufacturing_fit),
    management_fit: clampFit(parsed.management_fit),
    career_direction: clampFit(parsed.career_direction),
    recommendation: (["go", "maybe", "skip"].includes(String(parsed.recommendation))
      ? parsed.recommendation
      : "maybe") as AiRecommendation,
    cv_track: (String(parsed.cv_track).toUpperCase() === "EM" ? "EM" : "SM") as CvTrack,
    unmet_musts,
    requirements,
    core_requirements,
    rawModelJson: rawText.slice(0, 4000),
    why_yes: String(parsed.why_yes || "").slice(0, 400),
    gaps: String(parsed.gaps || "").slice(0, 400),
    check: String(parsed.check || "").slice(0, 300),
  };
}

export interface RateOptions {
  maxN?: number;
  /** Force Gemini even when a prior rating exists for the fingerprint. */
  forceRescore?: boolean;
  /** Prior ratings keyed by company+title fingerprint. */
  priorByFingerprint?: Map<string, Job>;
}

export async function rateJobsWithGemini(
  jobs: Job[],
  maxNOrOpts: number | RateOptions = 40
): Promise<{ jobs: Job[]; stats: RateStats }> {
  const opts: RateOptions =
    typeof maxNOrOpts === "number" ? { maxN: maxNOrOpts } : maxNOrOpts || {};
  const maxN = opts.maxN ?? Number(process.env.GEMINI_MAX_PER_RUN || 40);
  const forceRescore = Boolean(opts.forceRescore);
  const prior = opts.priorByFingerprint ?? new Map<string, Job>();

  const stats: RateStats = {
    rated: 0,
    skippedQuota: 0,
    skippedAlreadyRated: 0,
    errors: 0,
    notEnoughInfo: 0,
    geminiCalls: 0,
  };
  const out = jobs.map((j) => ({ ...j }));

  if (!process.env.GEMINI_API_KEY?.trim()) {
    console.warn("GEMINI_API_KEY missing — all jobs marked not AI-rated (run continues)");
    return {
      jobs: out.map((j) => {
        const fp = tagFingerprint(j);
        const prev = prior.get(fp);
        if (!forceRescore && prev?.aiStatus === "ai_rated" && prev.aiRating) {
          return {
            ...j,
            aiRating: prev.aiRating,
            aiStatus: "ai_rated" as const,
            notEnoughInfo: false,
            experienceFitPct: prev.experienceFitPct,
            blocked: prev.blocked,
            blockedBy: prev.blockedBy,
            blockedKind: prev.blockedKind,
            fitVerdict: prev.fitVerdict,
          };
        }
        return { ...j, aiStatus: "not_ai_rated" as const };
      }),
      stats: { ...stats, skippedQuota: out.length },
    };
  }

  let ratedCalls = 0;
  for (let i = 0; i < out.length; i++) {
    const fp = tagFingerprint(out[i]);
    const prev = prior.get(fp) || prior.get(out[i].id);

    if (!forceRescore && prev?.aiStatus === "ai_rated" && prev.aiRating) {
      out[i] = {
        ...out[i],
        aiRating: prev.aiRating,
        aiStatus: "ai_rated",
        notEnoughInfo: false,
        notEnoughInfoReason: undefined,
        experienceFitPct: prev.experienceFitPct,
        blocked: prev.blocked,
        blockedBy: prev.blockedBy,
        blockedKind: prev.blockedKind,
        fitVerdict: prev.fitVerdict,
      };
      stats.skippedAlreadyRated += 1;
      continue;
    }

    // Also inherit by same job id from prior run
    if (!forceRescore && !prev) {
      // try id match via map that may use id keys — handled below in scan when building map
    }

    const enough = hasEnoughPostingText(out[i]);
    if (!enough.ok) {
      out[i] = {
        ...out[i],
        aiRating: undefined,
        aiStatus: "not_enough_info",
        notEnoughInfo: true,
        notEnoughInfoReason: enough.code,
        requirementsInferred: false,
      };
      stats.notEnoughInfo += 1;
      continue;
    }
    if (enough.requirementsInferred) {
      out[i] = { ...out[i], requirementsInferred: true };
    }

    if (ratedCalls >= maxN) {
      out[i] = { ...out[i], aiRating: undefined, aiStatus: "not_ai_rated" };
      stats.skippedQuota += 1;
      continue;
    }

    let result: Awaited<ReturnType<typeof callGemini>> | null = null;
    for (let attempt = 1; attempt <= 4; attempt++) {
      result = await callGemini(buildPrompt(out[i]));
      stats.geminiCalls += 1;
      ratedCalls += 1;
      if (result.ok) break;
      if (result.retryable || result.quota) {
        const wait = Math.min(90_000, 2_000 * attempt * attempt);
        console.warn(
          `Gemini ${result.error} for ${out[i].id} — backoff ${wait}ms (attempt ${attempt})`
        );
        await new Promise((r) => setTimeout(r, wait));
        if (result.quota && attempt === 4) break;
        continue;
      }
      break;
    }

    if (!result || !result.ok) {
      if (result?.quota) {
        stats.skippedQuota += 1;
        out[i] = { ...out[i], aiStatus: "not_ai_rated" };
        console.warn("Gemini rate-limit exhausted — remaining jobs marked not AI-rated; run continues");
        // soft-stop further calls this run but don't fail
        ratedCalls = maxN;
        continue;
      }
      stats.errors += 1;
      out[i] = { ...out[i], aiStatus: "not_ai_rated" };
      console.warn(`Gemini rate failed for ${out[i].id}: ${result?.error || "unknown"}`);
      continue;
    }

    const parsed = parseJson(result.text);
    if (!parsed) {
      stats.errors += 1;
      out[i] = { ...out[i], aiStatus: "not_ai_rated" };
      continue;
    }

    const rating = ratingFromParsed(parsed, result.text);
    out[i] = { ...out[i], aiRating: rating, aiStatus: "ai_rated", notEnoughInfo: false };
    stats.rated += 1;
    await new Promise((r) => setTimeout(r, 400));
  }

  for (let i = 0; i < out.length; i++) {
    if (!out[i].aiStatus) out[i] = { ...out[i], aiStatus: "not_ai_rated" };
  }

  console.log(
    `Gemini calls this run: ${stats.geminiCalls} (new ratings ${stats.rated}, reused ${stats.skippedAlreadyRated}, not-enough-info ${stats.notEnoughInfo}, errors ${stats.errors})`
  );

  return { jobs: out, stats };
}
