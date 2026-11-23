import type { CompanyBoard } from "../companies.js";
import type { RawJob } from "./adzuna.js";

interface GhJob {
  id?: number;
  title?: string;
  absolute_url?: string;
  location?: { name?: string };
  updated_at?: string;
  content?: string;
}

function boardToken(board: CompanyBoard): string | null {
  if (board.board_token) return board.board_token;
  try {
    const u = new URL(board.board_url);
    const parts = u.pathname.split("/").filter(Boolean);
    // https://boards-api.greenhouse.io/v1/boards/{token}/jobs
    const idx = parts.indexOf("boards");
    if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
    // https://job-boards.greenhouse.io/{token}
    return parts[0] || null;
  } catch {
    return null;
  }
}

function looksIsrael(loc: string): boolean {
  return /israel|ישראל|\bil\b|tel aviv|rehovot|haifa|herzliya|lod|modiin/i.test(loc);
}

export async function fetchGreenhouseCompany(board: CompanyBoard): Promise<RawJob[]> {
  const token = boardToken(board);
  if (!token) {
    console.warn(`Greenhouse ${board.name}: missing board token`);
    return [];
  }
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`;
  const res = await fetch(url, { signal: AbortSignal.timeout(25_000) });
  if (!res.ok) throw new Error(`Greenhouse ${board.name} HTTP ${res.status}`);
  const data = (await res.json()) as { jobs?: GhJob[]; name?: string };
  const out: RawJob[] = [];
  for (const j of data.jobs ?? []) {
    const loc = j.location?.name || "";
    if (loc && !looksIsrael(loc)) continue;
    if (!j.id || !j.title || !j.absolute_url) continue;
    const text = String(j.content || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    out.push({
      id: `greenhouse-${token}-${j.id}`,
      source: `Greenhouse/${board.name}`,
      title: j.title,
      company: board.name,
      location: loc || "Israel",
      description: text.slice(0, 4000) || `${j.title} at ${board.name}`,
      requirements: text.slice(0, 4000) || "See full posting.",
      url: j.absolute_url,
      postedAt: j.updated_at,
    });
  }
  console.log(`Greenhouse ${board.name} (${token}): ${out.length} Israel jobs`);
  return out;
}

export async function fetchAllGreenhouse(boards: CompanyBoard[]): Promise<RawJob[]> {
  const jobs: RawJob[] = [];
  for (const board of boards.filter((b) => b.ats === "greenhouse")) {
    try {
      jobs.push(...(await fetchGreenhouseCompany(board)));
    } catch (err) {
      console.warn(`Greenhouse ${board.name} failed:`, err instanceof Error ? err.message : err);
    }
  }
  return jobs;
}
