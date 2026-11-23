/**
 * Center / Shfela / Gush Dan allow-list for LinkedIn guest filtering.
 * Match English, Hebrew, and common LinkedIn variants.
 */

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[''`´ʼ]/g, "")
    .replace(/[־–—]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Patterns matched as substrings against a normalized location string. */
export const ALLOWED_CITY_PATTERNS: string[] = [
  // Core / existing
  "tel aviv",
  "תל אביב",
  "rishon lezion",
  "rishon le zion",
  "ראשון לציון",
  "rehovot",
  "רחובות",
  "kiryat gat",
  "קריית גת",
  "ashdod",
  "אשדוד",
  "yavne",
  "יבנה",
  "ness ziona",
  "nes ziona",
  "נס ציונה",
  "modiin",
  "modi in",
  "מודיעין",
  "petah tikva",
  "petah tiqwa",
  "פתח תקווה",
  "פתח תקוה",
  "yehud monosson",
  "yehud",
  "יהוד",
  "airport city",
  "איירפורט סיטי",
  "rosh haayin",
  "rosh ha ayin",
  "ראש העין",
  "lod",
  "לוד",
  "herzliya",
  "הרצליה",
  // Added
  "or yehuda",
  "אור יהודה",
  "holon",
  "חולון",
  "ramla",
  "רמלה",
  "gedera",
  "גדרה",
  "gan yavne",
  "גן יבנה",
  "kiryat ekron",
  "קריית עקרון",
  "beer yaakov",
  "be er yaakov",
  "באר יעקב",
  "kiryat malachi",
  "kiryat malakhi",
  "קריית מלאכי",
  "shoham",
  "שהם",
  "שוהם",
  "kfar saba",
  "כפר סבא",
  "raanana",
  "ra anana",
  "רעננה",
  "hod hasharon",
  "hod ha sharon",
  "הוד השרון",
  // Soft neighbors already in geo keep
  "beit shemesh",
  "בית שמש",
  "bat yam",
  "בת ים",
  "ramat gan",
  "רמת גן",
  "givatayim",
  "גבעתיים",
  "bnei brak",
  "בני ברק",
];

const UNCLEAR_EXACT = new Set([
  "israel",
  "ישראל",
  "il",
  "center district",
  "center district israel",
  "central district",
  "central district israel",
  "מחוז המרכז",
  "מרכז",
  "center israel",
  "central israel",
]);

export function isUnclearLocation(location: string): boolean {
  const loc = norm(location || "");
  if (!loc) return true;
  if (UNCLEAR_EXACT.has(loc)) return true;
  // "Israel" alone or with only district wording
  if (/^(israel|ישראל)([,\s]+(center|central|מחוז המרכז|מרכז)(\s+district)?)?$/i.test(loc)) {
    return true;
  }
  if (/^(center|central)\s+district([,\s]+israel)?$/i.test(loc)) return true;
  if (loc === "מחוז המרכז" || loc === "מחוז המרכז ישראל") return true;
  return false;
}

export function matchesAllowedCity(location: string): boolean {
  const loc = norm(location || "");
  if (!loc) return false;
  return ALLOWED_CITY_PATTERNS.some((p) => loc.includes(norm(p)));
}

/** LinkedIn post-filter: keep allowed cities + unclear country/district; drop elsewhere. */
export function linkedInLocationKeep(location: string): {
  keep: boolean;
  unclear: boolean;
} {
  if (isUnclearLocation(location)) return { keep: true, unclear: true };
  if (matchesAllowedCity(location)) return { keep: true, unclear: false };
  return { keep: false, unclear: false };
}
