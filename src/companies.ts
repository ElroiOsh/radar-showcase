import { readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import { projectRoot } from "./profile.js";

export type AtsType = "workday" | "comeet" | "greenhouse" | "lever" | "smartrecruiters";

export interface CompanyBoard {
  name: string;
  ats: AtsType;
  board_url: string;
  enabled: boolean;
  /** Careers site blocks automated requests: skip fetching, link it on the dashboard instead. */
  blocked?: boolean;
  /** Greenhouse board token, Lever company slug, or SmartRecruiters company identifier when not in URL. */
  board_token?: string;
}

interface CompaniesFile {
  companies: CompanyBoard[];
}

export function loadCompanies(onlyEnabled = true): CompanyBoard[] {
  const path = join(projectRoot(), "config", "companies.yaml");
  const raw = yaml.load(readFileSync(path, "utf8")) as CompaniesFile;
  const list = raw.companies ?? [];
  return onlyEnabled ? list.filter((c) => c.enabled && !c.blocked) : list;
}

/** Enabled companies whose careers sites block the scan — shown as manual links. */
export function loadBlockedCompanies(): CompanyBoard[] {
  return loadCompanies(false).filter((c) => c.enabled && c.blocked);
}
