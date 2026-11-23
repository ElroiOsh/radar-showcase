import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { anonymizedProfileForAi } from "./ai/anonymized-profile.js";
import { projectRoot } from "./profile.js";

/** Normalize for evidence substring checks. */
export function normalizeEvidence(s: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Profile text used for evidence verification.
 * Prefers the local CV file; falls back to the anonymized AI profile blob.
 */
export function loadScoringProfileText(): string {
  const cvPath = join(projectRoot(), "cv", "Elroi_Oshri_CV_ManufacturingProcessLead.txt");
  const parts: string[] = [anonymizedProfileForAi()];
  if (existsSync(cvPath)) {
    try {
      parts.push(readFileSync(cvPath, "utf8"));
    } catch {
      /* ignore */
    }
  }
  return parts.join("\n\n");
}

export function evidenceInProfile(evidence: string, profileText?: string): boolean {
  const ev = normalizeEvidence(evidence);
  if (ev.length < 8) return false;
  const profile = normalizeEvidence(profileText ?? loadScoringProfileText());
  return profile.includes(ev);
}
