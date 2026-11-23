import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { projectRoot } from "./profile.js";
import { writeJsonFile } from "./store.js";

function path(): string {
  return join(projectRoot(), "data", "claude-sent.json");
}

export type ClaudeSentMap = Record<string, string>; // jobId → ISO timestamp

export function loadClaudeSent(): ClaudeSentMap {
  if (!existsSync(path())) return {};
  try {
    return JSON.parse(readFileSync(path(), "utf8")) as ClaudeSentMap;
  } catch {
    return {};
  }
}

export function markClaudeSent(jobId: string): ClaudeSentMap {
  const map = loadClaudeSent();
  map[jobId] = new Date().toISOString();
  writeJsonFile(path(), map);
  return map;
}

export function wasClaudeSent(jobId: string): boolean {
  return Boolean(loadClaudeSent()[jobId]);
}
