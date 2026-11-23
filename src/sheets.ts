/**
 * Google Sheets sync (free service-account auth).
 * Tabs: "RADAR" (we write) · "Claude" (we read). Never touch "Job Tracker".
 */
import { createSign } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { loadFeedback, findTagForJob } from "./feedback.js";
import type { Job, RunResult } from "./types.js";

const DEFAULT_SHEET_ID = ""; // set GOOGLE_SHEET_ID in .env
const RADAR_TAB = "RADAR";
const CLAUDE_TAB = "Claude";
const FORBIDDEN_TAB = "Job Tracker";

const RADAR_HEADERS = [
  "job_key",
  "source",
  "title",
  "company",
  "city",
  "posted_date",
  "url",
  "experience_fit",
  "smart_fit",
  "management_fit",
  "career_direction",
  "recommendation",
  "cv_track",
  "my_tag",
  "tag_reasons",
  "tag_note",
  "tag_date",
  "first_seen",
  "last_seen",
] as const;

const CLAUDE_HEADERS = ["title", "company", "city", "url", "posted_date", "notes"] as const;

export interface ClaudeSheetRow {
  title: string;
  company: string;
  city: string;
  url: string;
  posted_date?: string;
  notes?: string;
}

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

function sheetId(): string {
  return (process.env.GOOGLE_SHEET_ID || DEFAULT_SHEET_ID).trim();
}

function loadServiceAccount(): ServiceAccount | null {
  const rawJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson) as ServiceAccount;
      if (parsed.client_email && parsed.private_key) return parsed;
    } catch (err) {
      console.warn("GOOGLE_SERVICE_ACCOUNT_JSON invalid JSON:", err);
    }
  }
  const path = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (path && existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as ServiceAccount;
      if (parsed.client_email && parsed.private_key) return parsed;
    } catch (err) {
      console.warn("Failed reading GOOGLE_APPLICATION_CREDENTIALS:", err);
    }
  }
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  let key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.trim();
  if (email && key) {
    key = key.replace(/\\n/g, "\n");
    return { client_email: email, private_key: key };
  }
  return null;
}

function b64url(input: Buffer | string): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/spreadsheets",
      aud: sa.token_uri || "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })
  );
  const unsigned = `${header}.${claim}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const sig = b64url(signer.sign(sa.private_key));
  const assertion = `${unsigned}.${sig}`;

  const res = await fetch(sa.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    throw new Error(`Google token HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("Google token response missing access_token");
  return data.access_token;
}

async function sheetsFetch(
  token: string,
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const url = path.startsWith("http")
    ? path
    : `https://sheets.googleapis.com/v4/spreadsheets/${sheetId()}${path}`;
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(30_000),
  });
}

async function ensureTabs(token: string): Promise<{ radarId: number; claudeId: number }> {
  const metaRes = await sheetsFetch(token, "?fields=sheets.properties");
  if (!metaRes.ok) {
    throw new Error(`Sheets meta HTTP ${metaRes.status}: ${(await metaRes.text()).slice(0, 200)}`);
  }
  const meta = (await metaRes.json()) as {
    sheets?: Array<{ properties?: { sheetId?: number; title?: string } }>;
  };
  const titles = new Map<string, number>();
  for (const s of meta.sheets || []) {
    const t = s.properties?.title || "";
    if (t === FORBIDDEN_TAB) continue;
    if (typeof s.properties?.sheetId === "number") titles.set(t, s.properties.sheetId);
  }

  const requests: unknown[] = [];
  if (!titles.has(RADAR_TAB)) {
    requests.push({ addSheet: { properties: { title: RADAR_TAB } } });
  }
  if (!titles.has(CLAUDE_TAB)) {
    requests.push({ addSheet: { properties: { title: CLAUDE_TAB } } });
  }
  if (requests.length) {
    const bat = await sheetsFetch(token, ":batchUpdate", {
      method: "POST",
      body: JSON.stringify({ requests }),
    });
    if (!bat.ok) {
      throw new Error(`Sheets addSheet HTTP ${bat.status}: ${(await bat.text()).slice(0, 200)}`);
    }
    const body = (await bat.json()) as {
      replies?: Array<{ addSheet?: { properties?: { sheetId?: number; title?: string } } }>;
    };
    for (const r of body.replies || []) {
      const p = r.addSheet?.properties;
      if (p?.title && typeof p.sheetId === "number") titles.set(p.title, p.sheetId);
    }
  }

  // Ensure header rows
  await ensureHeader(token, RADAR_TAB, [...RADAR_HEADERS]);
  await ensureHeader(token, CLAUDE_TAB, [...CLAUDE_HEADERS]);

  return {
    radarId: titles.get(RADAR_TAB) ?? 0,
    claudeId: titles.get(CLAUDE_TAB) ?? 0,
  };
}

async function ensureHeader(token: string, tab: string, headers: string[]): Promise<void> {
  const range = encodeURIComponent(`${tab}!A1:${colLetter(headers.length)}1`);
  const res = await sheetsFetch(token, `/values/${range}`);
  if (!res.ok) return;
  const data = (await res.json()) as { values?: string[][] };
  const row = data.values?.[0] || [];
  const same =
    row.length >= headers.length && headers.every((h, i) => String(row[i] || "").trim() === h);
  if (same) return;
  await sheetsFetch(token, `/values/${range}?valueInputOption=RAW`, {
    method: "PUT",
    body: JSON.stringify({ values: [headers] }),
  });
}

function colLetter(n: number): string {
  let s = "";
  let x = n;
  while (x > 0) {
    const m = (x - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s || "A";
}

function jobKey(job: Pick<Job, "id" | "source">): string {
  return `${job.source}::${job.id}`;
}

function fitVal(job: Job, key: "experience_fit" | "smart_manufacturing_fit" | "management_fit" | "career_direction"): string {
  if (key === "experience_fit") {
    const pct = job.experienceFitPct ?? job.aiRating?.experience_fit_pct;
    if (typeof pct === "number") return String(pct);
    return job.aiRating?.experience_fit || "";
  }
  return String(job.aiRating?.[key] || "");
}

function radarRow(
  job: Job,
  tag: { verdict?: string; reasons?: string[]; note?: string; updatedAt?: string } | undefined,
  firstSeen: string,
  lastSeen: string
): string[] {
  return [
    jobKey(job),
    job.source,
    job.title,
    job.company,
    job.location,
    job.postedAt || "",
    job.url,
    fitVal(job, "experience_fit"),
    fitVal(job, "smart_manufacturing_fit"),
    fitVal(job, "management_fit"),
    fitVal(job, "career_direction"),
    job.fitVerdict || job.aiRating?.recommendation || "",
    job.aiRating?.cv_track || "",
    tag?.verdict || "",
    (tag?.reasons || []).join(","),
    tag?.note || "",
    tag?.updatedAt || "",
    firstSeen,
    lastSeen,
  ];
}

async function readAllRows(token: string, tab: string): Promise<string[][]> {
  const range = encodeURIComponent(`${tab}!A:Z`);
  const res = await sheetsFetch(token, `/values/${range}`);
  if (!res.ok) {
    throw new Error(`Sheets read ${tab} HTTP ${res.status}`);
  }
  const data = (await res.json()) as { values?: string[][] };
  return data.values || [];
}

/** Upsert RADAR tab from current run + tags. Returns rows written (data rows). */
export async function syncRadarSheet(result: RunResult): Promise<number> {
  const sa = loadServiceAccount();
  if (!sa) {
    console.warn("Google Sheets: no service account configured — skip RADAR sync");
    return 0;
  }
  try {
    const token = await getAccessToken(sa);
    await ensureTabs(token);
    const feedback = loadFeedback();
    const existing = await readAllRows(token, RADAR_TAB);
    const header = existing[0] || [...RADAR_HEADERS];
    const keyIdx = header.indexOf("job_key");
    const firstIdx = header.indexOf("first_seen");
    const byKey = new Map<string, string[]>();
    for (const row of existing.slice(1)) {
      const k = row[keyIdx >= 0 ? keyIdx : 0];
      if (k) byKey.set(k, row);
    }

    const now = result.generatedAt || new Date().toISOString();
    for (const job of result.jobs) {
      if (job.id.startsWith("board-")) continue;
      const key = jobKey(job);
      const prev = byKey.get(key);
      const firstSeen =
        (firstIdx >= 0 && prev?.[firstIdx]) || prev?.[RADAR_HEADERS.indexOf("first_seen")] || now;
      const tag = findTagForJob(feedback, job);
      byKey.set(
        key,
        radarRow(
          job,
          tag
            ? {
                verdict: tag.verdict,
                reasons: tag.reasons,
                note: tag.note,
                updatedAt: tag.updatedAt,
              }
            : undefined,
          firstSeen,
          now
        )
      );
    }

    const values = [[...RADAR_HEADERS], ...byKey.values()];
    const clear = await sheetsFetch(
      token,
      `/values/${encodeURIComponent(`${RADAR_TAB}!A:S`)}:clear`,
      { method: "POST", body: "{}" }
    );
    if (!clear.ok) {
      console.warn(`Sheets clear RADAR HTTP ${clear.status}`);
    }
    const write = await sheetsFetch(
      token,
      `/values/${encodeURIComponent(`${RADAR_TAB}!A1`)}?valueInputOption=RAW`,
      { method: "PUT", body: JSON.stringify({ values }) }
    );
    if (!write.ok) {
      throw new Error(`Sheets write RADAR HTTP ${write.status}: ${(await write.text()).slice(0, 200)}`);
    }
    const dataRows = values.length - 1;
    console.log(`Google Sheets RADAR: upserted ${dataRows} rows`);
    return dataRows;
  } catch (err) {
    console.warn("Google Sheets RADAR sync failed (run continues):", err instanceof Error ? err.message : err);
    return 0;
  }
}

/** Patch a single job's tag columns on RADAR (best-effort). */
export async function syncRadarTagForJob(job: Job): Promise<void> {
  const sa = loadServiceAccount();
  if (!sa) return;
  try {
    const token = await getAccessToken(sa);
    await ensureTabs(token);
    const feedback = loadFeedback();
    const tag = findTagForJob(feedback, job);
    const existing = await readAllRows(token, RADAR_TAB);
    const header = existing[0] || [...RADAR_HEADERS];
    const keyIdx = Math.max(0, header.indexOf("job_key"));
    const key = jobKey(job);
    let rowIndex = -1;
    for (let i = 1; i < existing.length; i++) {
      if (existing[i][keyIdx] === key) {
        rowIndex = i + 1; // 1-based
        break;
      }
    }
    const now = new Date().toISOString();
    const firstSeen =
      rowIndex > 0
        ? existing[rowIndex - 1][header.indexOf("first_seen")] || now
        : now;
    const row = radarRow(
      job,
      tag
        ? {
            verdict: tag.verdict,
            reasons: tag.reasons,
            note: tag.note,
            updatedAt: tag.updatedAt,
          }
        : undefined,
      firstSeen,
      now
    );
    if (rowIndex > 0) {
      const range = encodeURIComponent(`${RADAR_TAB}!A${rowIndex}:S${rowIndex}`);
      await sheetsFetch(token, `/values/${range}?valueInputOption=RAW`, {
        method: "PUT",
        body: JSON.stringify({ values: [row] }),
      });
    } else {
      await sheetsFetch(
        token,
        `/values/${encodeURIComponent(`${RADAR_TAB}!A:S`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
        { method: "POST", body: JSON.stringify({ values: [row] }) }
      );
    }
  } catch (err) {
    console.warn("Google Sheets tag sync failed:", err instanceof Error ? err.message : err);
  }
}

/** Read Claude tab rows (skips header / empty titles). */
export async function fetchClaudeSheetJobs(): Promise<ClaudeSheetRow[]> {
  const sa = loadServiceAccount();
  if (!sa) {
    console.warn("Google Sheets: no service account — skip Claude import");
    return [];
  }
  try {
    const token = await getAccessToken(sa);
    await ensureTabs(token);
    const rows = await readAllRows(token, CLAUDE_TAB);
    if (rows.length < 2) return [];
    const header = rows[0].map((h) => h.toLowerCase().trim());
    const idx = (name: string) => header.indexOf(name);
    const out: ClaudeSheetRow[] = [];
    for (const row of rows.slice(1)) {
      const title = String(row[idx("title")] || "").trim();
      if (!title) continue;
      out.push({
        title,
        company: String(row[idx("company")] || "Unknown").trim() || "Unknown",
        city: String(row[idx("city")] || "Israel").trim() || "Israel",
        url: String(row[idx("url")] || "").trim(),
        posted_date: String(row[idx("posted_date")] || "").trim() || undefined,
        notes: String(row[idx("notes")] || "").trim() || undefined,
      });
    }
    console.log(`Google Sheets Claude: read ${out.length} rows`);
    return out;
  } catch (err) {
    console.warn("Google Sheets Claude read failed (run continues):", err instanceof Error ? err.message : err);
    return [];
  }
}

export function claudeRowsToRawJobs(rows: ClaudeSheetRow[]) {
  return rows.map((r, i) => {
    const slug = Buffer.from(`${r.company}|${r.title}|${r.url}`)
      .toString("base64url")
      .slice(0, 18);
    const body = [r.notes, r.title, r.company, r.city].filter(Boolean).join("\n\n");
    return {
      id: `claude-${slug || i}`,
      source: "Claude",
      title: r.title,
      company: r.company,
      location: r.city || "Israel",
      description: body || r.title,
      requirements: body || "See Claude notes.",
      url: r.url || `manual://claude/${slug || i}`,
      postedAt: r.posted_date || new Date().toISOString(),
    };
  });
}
