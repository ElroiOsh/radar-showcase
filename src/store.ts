import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Job, RunResult } from "./types.js";
import { projectRoot } from "./profile.js";

function dataDir(): string {
  const dir = join(projectRoot(), "data");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** OneDrive often locks files mid-write; retry via a temp file instead of crashing the scan. */
export function writeJsonFile(path: string, data: unknown): void {
  const tmp = `${path}.${process.pid}.tmp`;
  const body = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  let last: unknown;
  for (let i = 0; i < 8; i++) {
    try {
      writeFileSync(tmp, body, "utf8");
      try {
        renameSync(tmp, path);
      } catch {
        copyFileSync(tmp, path);
        try {
          unlinkSync(tmp);
        } catch {
          /* ignore */
        }
      }
      return;
    } catch (err) {
      last = err;
      sleep(90 * (i + 1));
    }
  }
  try {
    unlinkSync(tmp);
  } catch {
    /* ignore */
  }
  throw last instanceof Error ? last : new Error(String(last));
}

export function loadSeenIds(): Set<string> {
  const path = join(dataDir(), "seen-ids.json");
  if (!existsSync(path)) return new Set();
  try {
    const arr = JSON.parse(readFileSync(path, "utf8")) as string[];
    return new Set(arr);
  } catch {
    return new Set();
  }
}

export function saveSeenIds(ids: Set<string>): void {
  writeJsonFile(join(dataDir(), "seen-ids.json"), [...ids]);
}

export function saveRun(result: RunResult): void {
  writeJsonFile(join(dataDir(), "latest.json"), result);
  const day = result.generatedAt.slice(0, 10);
  writeJsonFile(join(dataDir(), `run-${day}.json`), result);
}

export function markSeen(jobs: Job[], seen: Set<string>): Set<string> {
  const next = new Set(seen);
  for (const j of jobs) next.add(j.id);
  return next;
}

/** Keep prior shortlist jobs so you can keep training feedback across runs. */
export function loadPreviousListings(): Omit<
  Job,
  "matchScore" | "matchReasons" | "isNew" | "userFeedback" | "userFeedbackReasons"
>[] {
  const path = join(dataDir(), "latest.json");
  if (!existsSync(path)) return [];
  try {
    const latest = JSON.parse(readFileSync(path, "utf8")) as RunResult;
    return latest.jobs
      .filter((j) => !j.id.startsWith("board-"))
      .map(
        ({
          matchScore: _m,
          matchReasons: _r,
          isNew: _n,
          userFeedback: _u,
          userFeedbackReasons: _w,
          ...rest
        }) => rest
      );
  } catch {
    return [];
  }
}
