import type { CompanyBoard } from "../companies.js";
import type { RawJob } from "./adzuna.js";

interface SrPosting {
  id?: string;
  name?: string;
  releasedDate?: string;
  location?: { city?: string; region?: string; country?: string; remote?: boolean };
  refNumber?: string;
}

interface SrList {
  content?: SrPosting[];
  totalFound?: number;
}

function companyId(board: CompanyBoard): string | null {
  if (board.board_token) return board.board_token;
  try {
    const u = new URL(board.board_url);
    const parts = u.pathname.split("/").filter(Boolean);
    // careers.smartrecruiters.com/{Company} or api.../companies/{id}/postings
    const idx = parts.indexOf("companies");
    if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
    return parts[0] || null;
  } catch {
    return null;
  }
}

function locText(p: SrPosting): string {
  const bits = [p.location?.city, p.location?.region, p.location?.country].filter(Boolean);
  return bits.join(", ");
}

function looksIsrael(p: SrPosting): boolean {
  const country = (p.location?.country || "").toLowerCase();
  if (country === "il" || country === "israel") return true;
  return /israel|ישראל/i.test(locText(p));
}

export async function fetchSmartRecruitersCompany(board: CompanyBoard): Promise<RawJob[]> {
  const id = companyId(board);
  if (!id) {
    console.warn(`SmartRecruiters ${board.name}: missing company id`);
    return [];
  }
  const out: RawJob[] = [];
  let offset = 0;
  const limit = 100;
  let total = Infinity;

  while (offset < total && offset < 500) {
    const url = new URL(
      `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(id)}/postings`
    );
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("country", "il");
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(25_000) });
    if (!res.ok) throw new Error(`SmartRecruiters ${board.name} HTTP ${res.status}`);
    const data = (await res.json()) as SrList;
    total = data.totalFound ?? 0;
    const page = data.content ?? [];
    if (!page.length) break;

    for (const j of page) {
      if (!looksIsrael(j)) continue;
      if (!j.id || !j.name) continue;
      const loc = locText(j) || "Israel";
      out.push({
        id: `sr-${id}-${j.id}`,
        source: `SmartRecruiters/${board.name}`,
        title: j.name,
        company: board.name,
        location: loc,
        description: `${j.name} at ${board.name} — ${loc}`,
        requirements: "See full posting.",
        url: `https://jobs.smartrecruiters.com/${id}/${j.id}`,
        postedAt: j.releasedDate,
      });
    }
    offset += limit;
    await new Promise((r) => setTimeout(r, 250));
  }

  console.log(`SmartRecruiters ${board.name} (${id}): ${out.length} Israel jobs`);
  return out;
}

export async function fetchAllSmartRecruiters(boards: CompanyBoard[]): Promise<RawJob[]> {
  const jobs: RawJob[] = [];
  for (const board of boards.filter((b) => b.ats === "smartrecruiters")) {
    try {
      jobs.push(...(await fetchSmartRecruitersCompany(board)));
    } catch (err) {
      console.warn(
        `SmartRecruiters ${board.name} failed:`,
        err instanceof Error ? err.message : err
      );
    }
  }
  return jobs;
}
