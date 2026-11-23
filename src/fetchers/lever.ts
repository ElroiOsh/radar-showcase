import type { CompanyBoard } from "../companies.js";
import type { RawJob } from "./adzuna.js";

interface LeverPosting {
  id?: string;
  text?: string;
  hostedUrl?: string;
  applyUrl?: string;
  createdAt?: number;
  categories?: { location?: string; commitment?: string; team?: string };
  descriptionPlain?: string;
  description?: string;
  lists?: Array<{ text?: string; content?: string }>;
}

function companySlug(board: CompanyBoard): string | null {
  if (board.board_token) return board.board_token;
  try {
    const u = new URL(board.board_url);
    const parts = u.pathname.split("/").filter(Boolean);
    return parts[0] || null;
  } catch {
    return null;
  }
}

function looksIsrael(loc: string): boolean {
  return /israel|ישראל|\bil\b|tel aviv|rehovot|haifa|herzliya/i.test(loc);
}

export async function fetchLeverCompany(board: CompanyBoard): Promise<RawJob[]> {
  const slug = companySlug(board);
  if (!slug) {
    console.warn(`Lever ${board.name}: missing company slug`);
    return [];
  }
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`;
  const res = await fetch(url, { signal: AbortSignal.timeout(25_000) });
  if (!res.ok) throw new Error(`Lever ${board.name} HTTP ${res.status}`);
  const data = (await res.json()) as LeverPosting[];
  const out: RawJob[] = [];
  for (const j of Array.isArray(data) ? data : []) {
    const loc = j.categories?.location || "";
    if (loc && !looksIsrael(loc)) continue;
    if (!j.id || !j.text) continue;
    const desc =
      j.descriptionPlain ||
      String(j.description || "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    const reqs = (j.lists || [])
      .map((l) => `${l.text || ""}: ${String(l.content || "").replace(/<[^>]+>/g, " ")}`)
      .join("\n")
      .replace(/\s+/g, " ")
      .trim();
    out.push({
      id: `lever-${slug}-${j.id}`,
      source: `Lever/${board.name}`,
      title: j.text,
      company: board.name,
      location: loc || "Israel",
      description: (desc || `${j.text} at ${board.name}`).slice(0, 4000),
      requirements: (reqs || desc || "See full posting.").slice(0, 4000),
      url: j.hostedUrl || j.applyUrl || `https://jobs.lever.co/${slug}/${j.id}`,
      postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : undefined,
    });
  }
  console.log(`Lever ${board.name} (${slug}): ${out.length} Israel jobs`);
  return out;
}

export async function fetchAllLever(boards: CompanyBoard[]): Promise<RawJob[]> {
  const jobs: RawJob[] = [];
  for (const board of boards.filter((b) => b.ats === "lever")) {
    try {
      jobs.push(...(await fetchLeverCompany(board)));
    } catch (err) {
      console.warn(`Lever ${board.name} failed:`, err instanceof Error ? err.message : err);
    }
  }
  return jobs;
}
