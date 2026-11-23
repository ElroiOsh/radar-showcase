import type { Job } from "./types.js";

const HEBREW = /[\u0590-\u05FF]/;

/** Common Hebrew job-title fragments → English (covers gendered /ת forms). */
const PHRASES: Array<[RegExp, string]> = [
  [/מהנדס\/?ת?\s*מכונות\s*לרובוטיקה\s*ואוטומציה\s*לקווי\s*ייצור/gi, "Mechanical Engineer — Robotics & Automation (Production Lines)"],
  [/ראש\/?ת?\s*תחום\s*רצפת\s*ייצור/gi, "Head of Production Floor"],
  [/ראש\/?ת?\s*צוות\s*מחלקת\s*תפ["״"]?י\s*מיקרואלקטרוניקה/gi, "Team Lead — Microelectronics Production Engineering"],
  [/מנהל\/?ת?\s*משמרת\s*למפעל\s*טבעול[־\-]?צבר\s*אסם\s*נסטלה/gi, "Shift Manager — Tivall-Tzabar (Osem Nestlé) Plant"],
  [/מנהל\/?ת?\s*משמרת\s*אוטומציה[־\-]?\s*מפעל\s*ההרכבות\s*Sodastream/gi, "Automation Shift Manager — Sodastream Assembly Plant"],
  [/מנהל\/?ת?\s*משמרת\s*מחלקת\s*הרכבות[־\-]?\s*מפעל\s*הפלסטיק/gi, "Shift Manager — Assembly Department (Plastics Plant)"],
  [/מנהל\.?\/?ת?\s*מחלקת\s*ייצור/gi, "Production Department Manager"],
  [/מהנדס\/?ת?\s*ייצור/gi, "Production Engineer"],
  [/מנהל\/?ת?\s*ייצור/gi, "Production Manager"],
  [/מנהל\/?ת?\s*משמרת/gi, "Shift Manager"],
  [/מנהל\/?ת?\s*תפעול/gi, "Operations Manager"],
  [/מנהל\/?ת?\s*הנדסה/gi, "Engineering Manager"],
  [/ראש\/?ת?\s*צוות/gi, "Team Lead"],
  [/ראש\/?ת?\s*תחום/gi, "Domain Lead"],
  [/מהנדס\/?ת?\s*מכונות/gi, "Mechanical Engineer"],
  [/מהנדס\/?ת?\s*תהליך/gi, "Process Engineer"],
  [/מהנדס\/?ת?\s*תעשייה\s*וניהול/gi, "Industrial Engineer"],
  [/מהנדס\/?ת?/gi, "Engineer"],
  [/אוטומציה/gi, "Automation"],
  [/רובוטיקה/gi, "Robotics"],
  [/ייצור\s*חכם/gi, "Smart Manufacturing"],
  [/רצפת\s*ייצור/gi, "Shop Floor"],
  [/קווי\s*ייצור/gi, "Production Lines"],
  [/מחלקת\s*הרכבות/gi, "Assembly Department"],
  [/מפעל\s*הפלסטיק/gi, "Plastics Plant"],
  [/מפעל\s*ההרכבות/gi, "Assembly Plant"],
  [/מיקרואלקטרוניקה/gi, "Microelectronics"],
  [/תפ["״"]?י/gi, "Production Engineering"],
  [/ייצור/gi, "Production"],
  [/תפעול/gi, "Operations"],
  [/משמרת/gi, "Shift"],
  [/מפעל/gi, "Plant"],
  [/למפעל/gi, "Plant"],
  [/מחלקה/gi, "Department"],
  [/מחלקת/gi, "Department"],
  [/צוות/gi, "Team"],
  [/תחום/gi, "Domain"],
  [/ישראל/gi, "Israel"],
  [/תל\s*אביב/gi, "Tel Aviv"],
  [/רחובות/gi, "Rehovot"],
  [/פתח\s*תקווה/gi, "Petah Tikva"],
  [/באר\s*שבע/gi, "Beer Sheva"],
  [/קריית\s*גת/gi, "Kiryat Gat"],
  [/אשדוד/gi, "Ashdod"],
  [/לוד/gi, "Lod"],
  [/יהוד/gi, "Yehud"],
  [/רמת\s*גן/gi, "Ramat Gan"],
  [/חיפה/gi, "Haifa"],
  [/נס\s*ציונה/gi, "Ness Ziona"],
  [/ראש\s*העין/gi, "Rosh HaAyin"],
];

export function containsHebrew(text: string): boolean {
  return HEBREW.test(text || "");
}

/** Prefer English slug from LinkedIn job URLs when the title is Hebrew. */
function englishFromLinkedInUrl(url: string): string | null {
  try {
    const path = decodeURIComponent(new URL(url).pathname);
    const m = path.match(/\/jobs\/view\/([^/]+)/i);
    if (!m) return null;
    let slug = m[1].replace(/-\d+$/, "");
    // Drop trailing -at-company
    slug = slug.replace(/-at-[a-z0-9-]+$/i, "");
    if (containsHebrew(slug)) return null;
    if (!/[a-z]/i.test(slug)) return null;
    return slug
      .split("-")
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  } catch {
    return null;
  }
}

export function toEnglish(text: string, url = ""): string {
  const raw = (text || "").trim();
  if (!raw) return raw;
  if (!containsHebrew(raw)) return raw;

  const fromUrl = url ? englishFromLinkedInUrl(url) : null;
  if (fromUrl && fromUrl.length >= 8) return fromUrl;

  let out = raw;
  for (const [re, en] of PHRASES) {
    out = out.replace(re, en);
  }
  // Strip leftover Hebrew letters / nikud
  out = out
    .replace(HEBREW, " ")
    .replace(/\s*[|/·•]+\s*/g, " — ")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+—\s+—/g, " — ")
    .trim()
    .replace(/^[\s—\-]+|[\s—\-]+$/g, "");

  if (!out || containsHebrew(out) || out.length < 3) {
    return fromUrl || "Job posting (see link)";
  }
  return out;
}

export function englishizeJob<T extends Pick<Job, "title" | "company" | "location" | "description" | "requirements" | "url">>(
  job: T
): T {
  return {
    ...job,
    title: toEnglish(job.title, job.url),
    company: toEnglish(job.company, ""),
    location: toEnglish(job.location, ""),
    description: containsHebrew(job.description) ? toEnglish(job.description.slice(0, 500), job.url) : job.description,
    requirements: containsHebrew(job.requirements)
      ? toEnglish(job.requirements.slice(0, 400), job.url)
      : job.requirements,
  };
}

export function englishizeJobs<T extends Pick<Job, "title" | "company" | "location" | "description" | "requirements" | "url">>(
  jobs: T[]
): T[] {
  return jobs.map(englishizeJob);
}
