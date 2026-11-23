/** Mutable scan progress for /api/scan/status (no AI). */

export interface SourceResult {
  name: string;
  status: "ok" | "timeout" | "failed" | "skipped";
  count: number;
  ms: number;
  error?: string;
}

export interface ScanProgress {
  running: boolean;
  phase: string;
  currentSource: string;
  message: string;
  sources: SourceResult[];
  startedAt: number | null;
  hardDeadlineAt: number | null;
  timedOut: boolean;
  abortedReason?: string;
}

const state: ScanProgress = {
  running: false,
  phase: "",
  currentSource: "",
  message: "",
  sources: [],
  startedAt: null,
  hardDeadlineAt: null,
  timedOut: false,
};

export function getScanProgress(): ScanProgress {
  return { ...state, sources: state.sources.map((s) => ({ ...s })) };
}

export function beginScanProgress(hardLimitMs: number): void {
  state.running = true;
  state.phase = "fetch";
  state.currentSource = "";
  state.message = "Starting scan…";
  state.sources = [];
  state.startedAt = Date.now();
  state.hardDeadlineAt = Date.now() + hardLimitMs;
  state.timedOut = false;
  state.abortedReason = undefined;
}

export function setScanMessage(message: string, currentSource = ""): void {
  state.message = message;
  if (currentSource) state.currentSource = currentSource;
}

export function setScanPhase(phase: string): void {
  state.phase = phase;
}

export function pushSourceResult(result: SourceResult): void {
  const idx = state.sources.findIndex((s) => s.name === result.name);
  if (idx >= 0) state.sources[idx] = result;
  else state.sources.push(result);
}

export function endScanProgress(opts?: { timedOut?: boolean; reason?: string }): void {
  state.running = false;
  state.phase = "done";
  state.currentSource = "";
  if (opts?.timedOut) {
    state.timedOut = true;
    state.abortedReason = opts.reason || "Hard time limit reached";
    state.message = opts.reason || "Stopped — hard time limit";
  } else {
    state.message = "";
  }
}

export function remainingMs(): number {
  if (!state.hardDeadlineAt) return Number.POSITIVE_INFINITY;
  return Math.max(0, state.hardDeadlineAt - Date.now());
}

export function hardLimitExceeded(): boolean {
  return remainingMs() <= 0;
}
