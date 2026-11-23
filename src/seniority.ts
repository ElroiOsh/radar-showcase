/** Bilingual seniority / agency signals captured into feedback snapshots. */

export const SENIORITY_PATTERNS: Array<{ id: string; re: RegExp; keywords: string[] }> = [
  {
    id: "director",
    re: /\bdirectors?\b|דירקטור|מנהל\s*בכיר/i,
    keywords: ["Director", "Directors", "דירקטור", "מנהל בכיר"],
  },
  {
    id: "vp",
    re: /\bv\.?p\.?\b|\bvice[\s-]?president\b|סמנכ[״"']?ל/i,
    keywords: ["VP", "Vice President", "סמנכ״ל"],
  },
  {
    id: "head",
    re: /\bhead\s+of\b|ראש\s*(צוות|תחום|מחלקה)/i,
    keywords: ["Head of", "ראש צוות", "ראש תחום", "ראש מחלקה"],
  },
  {
    id: "lead",
    re: /\blead\b|team\s*lead|ליד\b/i,
    keywords: ["Lead", "Team Lead", "ליד"],
  },
  {
    id: "senior",
    re: /\bsenior\b|בכיר/i,
    keywords: ["Senior", "בכיר"],
  },
  {
    id: "manager",
    re: /\bmanagers?\b|מנהל\/?ת?\b|מנהלת\b/i,
    keywords: ["Manager", "Managers", "מנהל", "מנהלת"],
  },
  {
    id: "junior",
    re: /\bjunior\b|ג['׳']?וניור|מתחיל/i,
    keywords: ["Junior", "ג'וניור", "מתחיל"],
  },
];

const AGENCY_RE =
  /\b(agency|staffing|recruit|talent\s*partner|manpower|experis|jobsseek|jobseek)\b|חברת\s*השמה|גיוס/i;

export function extractSeniorityWords(title: string): string[] {
  const found: string[] = [];
  for (const p of SENIORITY_PATTERNS) {
    if (p.re.test(title)) found.push(p.id);
  }
  return found;
}

export function looksLikeAgency(company: string, source: string): boolean {
  return AGENCY_RE.test(`${company} ${source}`);
}

/** Keywords a title-rule should match (EN + HE), editable in proposals. */
export function keywordsForSeniorityId(id: string): string[] {
  return SENIORITY_PATTERNS.find((p) => p.id === id)?.keywords.slice() ?? [id];
}

export function titleMatchesKeywords(title: string, keywords: string[]): boolean {
  const t = title.toLowerCase();
  return keywords.some((k) => t.includes(k.toLowerCase()));
}
