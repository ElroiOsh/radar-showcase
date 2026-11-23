import type { CompanyBoard } from "../companies.js";
import type { RawJob } from "./adzuna.js";

interface WdJobPosting {
  title?: string;
  externalPath?: string;
  locationsText?: string;
  postedOn?: string;
  bulletFields?: string[];
}

interface WdSearchResponse {
  total?: number;
  jobPostings?: WdJobPosting[];
}

function parseBoard(boardUrl: string): { host: string; site: string; tenant: string } | null {
  try {
    const u = new URL(boardUrl);
    const host = u.origin;
    const parts = u.pathname.split("/").filter(Boolean);
    const site = parts[0] || "External";
    const tenant = u.hostname.split(".")[0] || "tenant";
    return { host, site, tenant };
  } catch {
    return null;
  }
}

function looksIsrael(location: string): boolean {
  const loc = location.toLowerCase().trim();
  if (!loc) return false;
  if (/\bisrael\b|ישראל/.test(loc)) return true;
  if (/(^|[\s,])isr($|[\s,])/.test(loc) || /,\s*isr\b/.test(loc) || loc.endsWith(",isr")) return true;
  if (/(^|[\s,])il($|[\s,])/.test(loc) || /,\s*il\b/.test(loc)) return true;
  // Common IL city tokens when country omitted
  if (
    /rehovot|herzliya|haifa|tel aviv|petah|modiin|yokneam|caesarea|netanya|rishon|ashdod|kiryat gat|raanana|ra'anana/i.test(
      loc
    )
  ) {
    return true;
  }
  if (/\d+\s+locations?/i.test(loc)) return true;
  return false;
}

function postedDate(postedOn?: string): string | undefined {
  if (!postedOn) return undefined;
  const now = new Date();
  const m = postedOn.match(/(\d+)\s+Day/i);
  if (/today/i.test(postedOn)) return now.toISOString();
  if (/yesterday/i.test(postedOn)) {
    now.setDate(now.getDate() - 1);
    return now.toISOString();
  }
  if (m) {
    now.setDate(now.getDate() - Number(m[1]));
    return now.toISOString();
  }
  return undefined;
}

async function searchBoard(
  board: CompanyBoard,
  offset: number,
  searchText: string
): Promise<{ jobs: WdJobPosting[]; total: number; meta: { host: string; site: string; tenant: string } }> {
  const meta = parseBoard(board.board_url);
  if (!meta) return { jobs: [], total: 0, meta: { host: "", site: "", tenant: "" } };

  const url = `${meta.host}/wday/cxs/${meta.tenant}/${meta.site}/jobs`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      appliedFacets: {},
      limit: 20,
      offset,
      searchText,
    }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`Workday ${board.name} HTTP ${res.status}`);
  const type = res.headers.get("content-type") || "";
  if (!type.includes("json")) {
    throw new Error(
      `Workday ${board.name}: board URL no longer serves jobs (got ${type || "non-JSON"}) — update board_url in config/companies.yaml`
    );
  }
  const data = (await res.json()) as WdSearchResponse;
  return { jobs: data.jobPostings ?? [], total: data.total ?? 0, meta };
}

export async function fetchWorkdayCompany(board: CompanyBoard): Promise<RawJob[]> {
  const out: RawJob[] = [];
  const seen = new Set<string>();
  let offset = 0;
  let total = Infinity;
  let meta = { host: "", site: "", tenant: "" };
  const israelBoard = board.board_url.toLowerCase().includes("/israel");
  // Global boards: search "Israel" then hard-filter locations so they don't flood the scan.
  const searchText = israelBoard ? "" : "Israel";
  const maxOffset = 400;

  while (offset < total && offset < maxOffset) {
    const page = await searchBoard(board, offset, searchText);
    meta = page.meta;
    // Workday reports `total` only on the first page (0 afterwards) — don't let that end paging.
    if (page.total > 0) total = page.total;
    if (!page.jobs.length) break;

    for (const j of page.jobs) {
      const loc = j.locationsText ?? "";
      if (!israelBoard && !looksIsrael(loc)) continue;
      if (israelBoard && loc && !looksIsrael(loc) && !/israel|ישראל/i.test(loc)) {
        // Israel-site boards can still list remote abroad — keep IL-ish only when location present
        if (/united states|germany|china|india|singapore|korea|taiwan|japan|ireland|netherlands/i.test(loc)) {
          continue;
        }
      }
      const path = j.externalPath ?? "";
      if (!path || !j.title) continue;
      const idNum =
        path.match(/_([A-Za-z0-9-]+)(?:\/)?$/)?.[1] ??
        Buffer.from(path).toString("base64url").slice(0, 16);
      const id = `workday-${meta.tenant}-${idNum}`;
      if (seen.has(id)) continue;
      seen.add(id);

      const applyUrl = `${meta.host}/${meta.site}${path.startsWith("/") ? path : `/${path}`}`;

      out.push({
        id,
        source: `Workday/${board.name}`,
        title: j.title,
        company: board.name,
        location: loc || "Israel",
        description: `${j.title} at ${board.name} — ${loc}`,
        requirements: "See full posting.",
        url: applyUrl,
        postedAt: postedDate(j.postedOn),
      });
    }
    offset += 20;
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log(`Workday ${board.name}: ${out.length} Israel jobs (searched "${searchText || "(board)"}")`);
  return out;
}

export async function fetchAllWorkday(boards: CompanyBoard[]): Promise<RawJob[]> {
  const jobs: RawJob[] = [];
  for (const board of boards.filter((b) => b.ats === "workday")) {
    try {
      jobs.push(...(await fetchWorkdayCompany(board)));
    } catch (err) {
      console.warn(`Workday ${board.name} failed:`, err instanceof Error ? err.message : err);
    }
  }
  return jobs;
}
