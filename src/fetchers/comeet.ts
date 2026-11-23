import type { CompanyBoard } from "../companies.js";
import type { RawJob } from "./adzuna.js";

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

function absUrl(base: string, href: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9,he;q=0.8",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
};

/** Scrape public Comeet-backed career listing pages (Nova / Kornit / Razor Labs style). */
async function fetchListHtml(boardUrl: string, name: string): Promise<string> {
  let lastStatus = 0;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(boardUrl, {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(25_000),
    });
    lastStatus = res.status;
    if (res.ok) return await res.text();
    if (res.status >= 500) {
      await new Promise((r) => setTimeout(r, 800 * attempt));
      continue;
    }
    break;
  }
  const why =
    lastStatus === 403 || lastStatus === 502 || lastStatus === 503
      ? " — the careers site refuses automated requests from this network"
      : "";
  throw new Error(`Comeet ${name} list HTTP ${lastStatus}${why}`);
}

/** Comeet WordPress plugin URLs: /careers/co/<location-slug>/<position-uid>/<title-slug>/all */
function parseComeetPluginUrl(url: string): { location: string; title: string } | null {
  const m = url.match(/\/co\/([^/]+)\/[0-9A-Za-z]{2}\.[0-9A-Za-z]{3}\/([^/]+)/);
  if (!m) return null;
  const words = (slug: string) =>
    decodeURIComponent(slug)
      .split("-")
      .filter(Boolean)
      .map((w) => (w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
      .join(" ");
  return { location: words(m[1]), title: words(m[2]) };
}

export async function fetchComeetCompany(board: CompanyBoard): Promise<RawJob[]> {
  const html = await fetchListHtml(board.board_url, board.name);
  const base = board.board_url;

  const linkRe =
    /href="([^"]*(?:comeetitem|cmcareer|\/job\/|position|\/careers\/co\/)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  const candidates: { url: string; titleHint: string }[] = [];
  const seen = new Set<string>();

  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html))) {
    const url = absUrl(base, m[1]);
    if (seen.has(url)) continue;
    if (/privacy|wp-|department|about|referral|feed|xmlrpc/i.test(url)) continue;
    seen.add(url);
    const plugin = parseComeetPluginUrl(url);
    // Plugin URLs carry the location — skip offices abroad before fetching details.
    if (plugin && !/israel|tel aviv|rehovot|haifa|jerusalem|petah|herzliya|yokneam|rosh/i.test(plugin.location)) {
      continue;
    }
    const titleHint = stripHtml(m[2]).slice(0, 120);
    candidates.push({ url, titleHint });
  }

  // Nova: also catch bare comeetitem paths in page
  const pathRe = /(?:href=")?(https?:\/\/[^"\s]+comeetitem\/[a-z0-9]+\/?|\/comeetitem\/[a-z0-9]+\/?)/gi;
  while ((m = pathRe.exec(html))) {
    const url = absUrl(base, m[1]);
    if (seen.has(url)) continue;
    seen.add(url);
    candidates.push({ url, titleHint: "" });
  }

  const jobs: RawJob[] = [];
  for (const c of candidates.slice(0, 40)) {
    try {
      const detail = await fetch(c.url, {
        headers: BROWSER_HEADERS,
        signal: AbortSignal.timeout(15_000),
      });
      if (!detail.ok) continue;
      const page = await detail.text();
      const plugin = parseComeetPluginUrl(c.url);
      const title =
        page.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ||
        page.match(/property="og:title" content="([^"]+)"/i)?.[1] ||
        c.titleHint;
      let cleanTitle = stripHtml(title || "").replace(/\s*[|\-–].*$/, "").trim();
      // Plugin pages often use a generic <h1> ("Careers") — the URL slug is the reliable title.
      if (plugin && (!cleanTitle || cleanTitle.length < 3 || /^(careers?|jobs?|open positions?|join us)$/i.test(cleanTitle))) {
        cleanTitle = plugin.title;
      }
      if (!cleanTitle || cleanTitle.length < 3) continue;

      const loc =
        plugin?.location ||
        page.match(/Rehovot[^<,]{0,40}|Rosh Haayin[^<,]{0,40}|Israel|ישראל|רחובות|ראש העין/i)?.[0] ||
        "Israel";
      const descMatch =
        page.match(/Role Description([\s\S]{0,4000})/i) ||
        page.match(/<article[\s\S]{0,6000}/i) ||
        page.match(/property="og:description" content="([^"]+)"/i);
      const description = stripHtml(descMatch?.[1] || descMatch?.[0] || cleanTitle).slice(0, 4000);

      const idSeed = c.url.replace(/https?:\/\//, "").replace(/[^\w]+/g, "-").slice(0, 48);
      jobs.push({
        id: `comeet-${idSeed}`,
        source: `Comeet/${board.name}`,
        title: cleanTitle,
        company: board.name,
        location: loc,
        description,
        requirements: description.slice(0, 600),
        url: c.url.split("?")[0],
        postedAt: undefined,
      });
      await new Promise((r) => setTimeout(r, 200));
    } catch {
      /* skip one card */
    }
  }

  console.log(`Comeet ${board.name}: ${jobs.length} jobs from ${candidates.length} links`);
  return jobs;
}

export async function fetchAllComeet(boards: CompanyBoard[]): Promise<RawJob[]> {
  const jobs: RawJob[] = [];
  for (const board of boards.filter((b) => b.ats === "comeet")) {
    try {
      jobs.push(...(await fetchComeetCompany(board)));
    } catch (err) {
      console.warn(`Comeet ${board.name} failed:`, err instanceof Error ? err.message : err);
    }
  }
  return jobs;
}
