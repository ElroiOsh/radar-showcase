import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import { projectRoot } from "./profile.js";

export interface TitleKeywordLists {
  positive: string[];
  negative: string[];
}

const DEFAULTS: TitleKeywordLists = {
  positive: [
    "process engineer",
    "manufacturing engineer",
    "NPI",
    "process lead",
    "automation engineer",
    "manufacturing systems",
    "MES",
    "smart manufacturing",
    "industry 4.0",
    "advanced manufacturing",
    "operations engineering",
    "engineering manager",
    "industrial engineer",
    "production engineering",
    "מהנדס תהליך",
    "מהנדס ייצור",
    "מהנדס NPI",
    "מהנדס אוטומציה",
    "הנדסת ייצור",
    "מנהל הנדסה",
  ],
  negative: [
    "technician",
    "maintenance technician",
    "sales",
    "account manager",
    "software engineer",
    "data scientist",
    "student",
    "intern",
    "junior",
    "טכנאי",
    "מכירות",
    "סטודנט",
  ],
};

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/\/ת/g, "")
    .replace(/\/ה/g, "")
    .replace(/[./·]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

let cached: TitleKeywordLists | null = null;
let cachedAt = 0;

export function loadTitleKeywords(force = false): TitleKeywordLists {
  const now = Date.now();
  if (!force && cached && now - cachedAt < 5_000) return cached;
  const path = join(projectRoot(), "config", "title-keywords.yaml");
  if (!existsSync(path)) {
    cached = DEFAULTS;
    cachedAt = now;
    return cached;
  }
  try {
    const raw = yaml.load(readFileSync(path, "utf8")) as Partial<TitleKeywordLists>;
    cached = {
      positive: Array.isArray(raw.positive) && raw.positive.length ? raw.positive.map(String) : DEFAULTS.positive,
      negative: Array.isArray(raw.negative) && raw.negative.length ? raw.negative.map(String) : DEFAULTS.negative,
    };
  } catch {
    cached = DEFAULTS;
  }
  cachedAt = now;
  return cached;
}

/** Whole-word-ish match for short tokens like MES / NPI; substring for phrases. */
export function keywordHits(text: string, keywords: string[]): string[] {
  const t = norm(text);
  const hits: string[] = [];
  for (const kw of keywords) {
    const k = norm(kw);
    if (!k) continue;
    if (k.length <= 3 && /^[a-z0-9]+$/i.test(k)) {
      const re = new RegExp(`(?:^|[^a-z0-9])${k}(?:[^a-z0-9]|$)`, "i");
      if (re.test(t)) hits.push(kw);
    } else if (t.includes(k)) {
      hits.push(kw);
    }
  }
  return hits;
}

export function titlePassesKeywords(title: string): {
  ok: boolean;
  reason?: string;
  positiveHits: string[];
  negativeHits: string[];
} {
  const { positive, negative } = loadTitleKeywords();
  const negativeHits = keywordHits(title, negative);
  const positiveHits = keywordHits(title, positive);
  if (negativeHits.length && !positiveHits.length) {
    return {
      ok: false,
      reason: `Negative title keyword: ${negativeHits[0]}`,
      positiveHits,
      negativeHits,
    };
  }
  if (negativeHits.length && positiveHits.length) {
    // Negative wins when both match (e.g. "Junior Process Engineer")
    return {
      ok: false,
      reason: `Negative title keyword: ${negativeHits[0]}`,
      positiveHits,
      negativeHits,
    };
  }
  if (!positiveHits.length) {
    return {
      ok: false,
      reason: "No positive title keyword",
      positiveHits,
      negativeHits,
    };
  }
  return { ok: true, positiveHits, negativeHits };
}

/** Sort-only score: title hits ×3 + description hits ×1 − negative hits (title+body). Not a %. */
export function keywordSortScore(
  title: string,
  description: string,
  requirements = ""
): { score: number; titleHits: string[]; bodyHits: string[]; negativeHits: string[] } {
  const { positive, negative } = loadTitleKeywords();
  const body = `${description}\n${requirements}`;
  const titleHits = keywordHits(title, positive);
  const bodyOnly = keywordHits(body, positive).filter((h) => !titleHits.includes(h));
  const negativeHits = [
    ...keywordHits(title, negative),
    ...keywordHits(body, negative).filter((h) => !keywordHits(title, negative).includes(h)),
  ];
  const score = titleHits.length * 3 + bodyOnly.length * 1 - negativeHits.length;
  return { score, titleHits, bodyHits: bodyOnly, negativeHits };
}
