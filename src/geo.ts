/**
 * Keep Center / Shfela / Gush Dan + Kiryat Gat + Beit Shemesh + approved Sharon towns.
 * Drop north of TA and Netanya/Hadera belt. Haifa excluded.
 */

import { matchesAllowedCity, isUnclearLocation } from "./locations-allow.js";

const BLOCKED: string[] = [
  // North
  "haifa",
  "חיפה",
  "north district",
  "northern district",
  "צפון",
  "מחוז הצפון",
  "מחוז חיפה",
  "haifa district",
  "caesarea",
  "קיסריה",
  "yokneam",
  "yoqneam",
  "יקנעם",
  "karmiel",
  "כרמיאל",
  "nahariy",
  "נהרייה",
  "נהריה",
  "acre",
  "akko",
  "עכו",
  "tiberias",
  "טבריה",
  "nazareth",
  "נצרת",
  "nof hagalil",
  "נוף הגליל",
  "afula",
  "עפולה",
  "migdal haemek",
  "מגדל העמק",
  "beit shean",
  "beit she an",
  "בית שאן",
  "kiryat shmona",
  "קריית שמונה",
  "kiryat ata",
  "קריית אתא",
  "kiryat bim",
  "קריית ביאליק",
  "kiryat motzkin",
  "קריית מוצקין",
  "kiryat yam",
  "קריית ים",
  "kiryat tivon",
  "קריית טבעון",
  "nesher",
  "נשר",
  "tirat carmel",
  "טירת כרמל",
  "zichron",
  "זכרון",
  "pardes hanna",
  "פרדס חנה",
  "shefaram",
  "שפרעם",
  "maalot",
  "מעלות",
  "safed",
  "צפת",
  "katzrin",
  "קצרין",
  "golan",
  "גולן",
  // Far Sharon / coast north of allowed towns
  "netanya",
  "נתניה",
  "hadera",
  "חדרה",
  "or akiva",
  "אור עקיבא",
];

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[''`´ʼ]/g, "")
    .replace(/[־–—]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Returns false when the role is clearly outside the allowed geography. */
export function isLocationAllowed(location: string): boolean {
  const loc = norm(location || "");
  if (!loc || loc === "חסוי") return true;
  if (isUnclearLocation(location)) return true;
  if (matchesAllowedCity(location)) return true;
  return !BLOCKED.some((n) => loc.includes(norm(n)));
}

export function locationExcludeReason(location: string): string | null {
  if (isLocationAllowed(location)) return null;
  return `Outside allowed cities: ${location}`;
}
