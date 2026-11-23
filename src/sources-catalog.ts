import { loadCompanies } from "./companies.js";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { projectRoot } from "./profile.js";

export type SourceStatus = "active" | "inactive" | "skipped";

export interface SourceRow {
  id: string;
  name: string;
  kind: "ats" | "board" | "aggregator" | "manual";
  status: SourceStatus;
  method: string;
  note: string;
  lastCount?: number;
  companies?: string[];
}

export function loadLastSourceCounts(): Record<string, number> {
  const path = join(projectRoot(), "data", "last-scan-sources.json");
  if (!existsSync(path)) return {};
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as { sources?: Record<string, number> };
    return raw.sources ?? {};
  } catch {
    return {};
  }
}

export function buildSourcesCatalog(): SourceRow[] {
  const companies = loadCompanies(false);
  const counts = loadLastSourceCounts();
  const byAts = (ats: string) =>
    companies.filter((c) => c.ats === ats && c.enabled && !c.blocked).map((c) => c.name);

  const rows: SourceRow[] = [
    {
      id: "workday",
      name: "Company boards · Workday",
      kind: "ats",
      status: "active",
      method: "Workday CXS public API (Israel search + location filter)",
      note: "All current Workday companies block automated requests from the scan servers — linked on the dashboard under Check yourself",
      lastCount: counts.workday,
      companies: byAts("workday"),
    },
    {
      id: "comeet",
      name: "Company boards · Comeet",
      kind: "ats",
      status: "active",
      method: "Public careers HTML (Comeet-backed pages)",
      note: "Razor Labs (Nova and Kornit block automated requests — linked on the dashboard)",
      lastCount: counts.comeet,
      companies: byAts("comeet"),
    },
    {
      id: "greenhouse",
      name: "Company boards · Greenhouse",
      kind: "ats",
      status: byAts("greenhouse").length ? "active" : "skipped",
      method: "Greenhouse boards public API",
      note: byAts("greenhouse").length
        ? "Enabled boards in config"
        : "Fetcher ready — no companies enabled (IAI Greenhouse “iai” is UK i.AI, not Israel Aerospace)",
      lastCount: counts.greenhouse,
      companies: byAts("greenhouse"),
    },
    {
      id: "lever",
      name: "Company boards · Lever",
      kind: "ats",
      status: byAts("lever").length ? "active" : "skipped",
      method: "Lever public postings API",
      note: byAts("lever").length ? "Enabled boards in config" : "Fetcher ready — no companies enabled yet",
      lastCount: counts.lever,
      companies: byAts("lever"),
    },
    {
      id: "smartrecruiters",
      name: "Company boards · SmartRecruiters",
      kind: "ats",
      status: byAts("smartrecruiters").length ? "active" : "skipped",
      method: "SmartRecruiters public postings API",
      note: byAts("smartrecruiters").length
        ? "Enabled boards in config"
        : "Fetcher ready — no companies enabled (Stratasys API returned 0 postings)",
      lastCount: counts.smartrecruiters,
      companies: byAts("smartrecruiters"),
    },
    {
      id: "linkedin",
      name: "LinkedIn guest search",
      kind: "board",
      status: "active",
      method: "Guest seeMore API · Israel · 7 days · 2 pages · 20 queries",
      note: "Polite delays 2–5s; backoff on 429; city allow-list + Location unclear flag",
      lastCount: counts.linkedin,
    },
    {
      id: "manual",
      name: "Add job (manual)",
      kind: "manual",
      status: "active",
      method: "Paste URL or full text → same scoring pipeline",
      note: "Covers LinkedIn alerts, WhatsApp, agencies",
      lastCount: counts.manual,
    },
    {
      id: "claude",
      name: "Claude (Google Sheet)",
      kind: "manual",
      status: "active",
      method: "Read tab “Claude” on the shared Sheet → rate like any job",
      note: "Claude writes rows; RADAR imports on each run. RADAR tab is written back after every scan.",
      lastCount: counts.claude,
    },
    {
      id: "drushim",
      name: "Drushim",
      kind: "board",
      status: "inactive",
      method: "HTML scraping (not enabled)",
      note: "Inactive (scraping, not enabled)",
    },
    {
      id: "jobmaster",
      name: "JobMaster",
      kind: "board",
      status: "inactive",
      method: "HTML scraping (not enabled)",
      note: "Inactive (scraping, not enabled)",
    },
    {
      id: "alljobs",
      name: "AllJobs",
      kind: "board",
      status: "inactive",
      method: "HTML scraping (not enabled)",
      note: "Inactive (scraping, not enabled)",
    },
    {
      id: "jooble",
      name: "Jooble",
      kind: "aggregator",
      status: "skipped",
      method: "Official API (il.jooble.org) — not enabled",
      note: "Israel covered, but free key is 500 lifetime requests — skipped for daily runs",
    },
  ];

  return rows;
}
