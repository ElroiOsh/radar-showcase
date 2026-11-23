import "dotenv/config";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { projectRoot } from "./profile.js";
import {
  clearFeedback,
  entryFromJob,
  feedbackSummary,
  loadFeedback,
  reasonCountsLastDays,
  upsertFeedback,
} from "./feedback.js";
import { reasonsMetaPayload, type FeedbackReasonId } from "./reasons.js";
import { syncRadarTagForJob } from "./sheets.js";
import {
  approveProposal,
  deleteRule,
  loadProposals,
  loadRules,
  loadShowAnyway,
  regenerateProposals,
  rejectProposal,
  saveShowAnyway,
  updateRule,
} from "./rules-learn.js";
import { addManualJob } from "./add-job.js";
import { buildAnalyzeBlock, ensureFullDescription } from "./analyze-block.js";
import { loadClaudeSent, markClaudeSent } from "./claude-sent.js";
import { runScan, type ScanPayload } from "./scan.js";
import { getScanProgress } from "./scan-progress.js";
import { saveRun } from "./store.js";
import { buildSourcesCatalog } from "./sources-catalog.js";
import type { FeedbackVerdict, Job, LearnedRule, RunResult } from "./types.js";

const PORT = Number(process.env.PORT || 8787);
const root = projectRoot();
const SCAN_COOLDOWN_MS = Number(process.env.SCAN_COOLDOWN_MS || 3 * 60_000);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
};

const BINARY = new Set([".png", ".jpg", ".jpeg", ".ico", ".gif", ".webp"]);

function send(res: import("node:http").ServerResponse, status: number, body: string | Buffer, type: string) {
  res.writeHead(status, {
    "Content-Type": type,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(body);
}

function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function loadLatestJobs(): Job[] {
  const latestPath = join(root, "data", "latest.json");
  if (!existsSync(latestPath)) return [];
  try {
    const latest = JSON.parse(readFileSync(latestPath, "utf8")) as RunResult;
    return latest.jobs ?? [];
  } catch {
    return [];
  }
}

function findJob(jobId: string): Job | undefined {
  return loadLatestJobs().find((j) => j.id === jobId);
}

function refreshProposals() {
  return regenerateProposals(loadLatestJobs());
}

let inFlight: Promise<ScanPayload> | null = null;
let lastScanFinishedAt = 0;
let lastScanPayload: ScanPayload | null = null;
let scanMessage = "";

async function handleScan(opts: {
  forceRescore?: boolean;
  extraKeywords?: string[];
  bypassCooldown?: boolean;
} = {}): Promise<ScanPayload> {
  if (inFlight) return inFlight;
  const since = Date.now() - lastScanFinishedAt;
  if (!opts.bypassCooldown && !opts.forceRescore && lastScanFinishedAt && since < SCAN_COOLDOWN_MS) {
    const wait = SCAN_COOLDOWN_MS - since;
    throw new Error(`Scan cooldown — try again in ${Math.ceil(wait / 1000)}s`);
  }
  scanMessage = "Scanning sources…";
  inFlight = runScan({
    extraKeywords: opts.extraKeywords,
  })
    .then((r) => {
      refreshProposals();
      lastScanFinishedAt = Date.now();
      lastScanPayload = r.payload;
      scanMessage = "";
      return r.payload;
    })
    .finally(() => {
      inFlight = null;
      scanMessage = "";
    });
  return inFlight;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);

  if (req.method === "OPTIONS") {
    send(res, 204, "", "text/plain");
    return;
  }

  if (url.pathname === "/api/health" && req.method === "GET") {
    send(res, 200, JSON.stringify({ ok: true, live: true }), "application/json; charset=utf-8");
    return;
  }

  if (url.pathname === "/api/meta/reasons" && req.method === "GET") {
    send(res, 200, JSON.stringify(reasonsMetaPayload()), "application/json; charset=utf-8");
    return;
  }

  if (url.pathname === "/api/scan/status" && req.method === "GET") {
    const cooldownMs =
      lastScanFinishedAt && !inFlight
        ? Math.max(0, SCAN_COOLDOWN_MS - (Date.now() - lastScanFinishedAt))
        : 0;
    const progress = getScanProgress();
    send(
      res,
      200,
      JSON.stringify({
        running: Boolean(inFlight) || progress.running,
        message:
          progress.message ||
          scanMessage ||
          (inFlight ? "Scan running…" : ""),
        currentSource: progress.currentSource || "",
        phase: progress.phase || "",
        sourceResults: lastScanPayload?.sourceResults || progress.sources || [],
        timedOut: lastScanPayload?.timedOut || progress.timedOut || false,
        abortedReason: lastScanPayload?.abortedReason || progress.abortedReason || null,
        cooldownMs,
        lastFinishedAt: lastScanFinishedAt || null,
        lastFinishedLabel: lastScanFinishedAt
          ? new Date(lastScanFinishedAt).toLocaleString("en-IL", {
              dateStyle: "medium",
              timeStyle: "short",
            })
          : null,
        lastGeminiCalls: 0,
        lastTotal: lastScanPayload?.totalCount ?? null,
        generatedAt: lastScanPayload?.generatedAt ?? null,
        durationMs: lastScanPayload?.durationMs ?? null,
      }),
      "application/json; charset=utf-8"
    );
    return;
  }

  if (url.pathname === "/api/analyze-block" && req.method === "POST") {
    try {
      const raw = await readBody(req);
      const body = JSON.parse(raw || "{}") as { jobId?: string };
      if (!body.jobId) {
        send(res, 400, JSON.stringify({ error: "jobId required" }), "application/json");
        return;
      }
      const found = findJob(body.jobId);
      if (!found) {
        send(res, 404, JSON.stringify({ error: "Job not found" }), "application/json");
        return;
      }
      const ensured = await ensureFullDescription(found);
      // Persist enriched description for next time
      if (ensured.job.description !== found.description) {
        const jobs = loadLatestJobs().map((j) =>
          j.id === found.id
            ? {
                ...j,
                description: ensured.job.description,
                requirements: ensured.job.requirements,
              }
            : j
        );
        const result: RunResult = {
          generatedAt: new Date().toISOString(),
          jobs,
          newCount: jobs.filter((j) => j.isNew).length,
          totalCount: jobs.length,
        };
        try {
          saveRun(result);
        } catch {
          /* ignore lock */
        }
      }
      const flags: string[] = [];
      if (ensured.job.locationUnclear) flags.push("Location unclear");
      if (ensured.incomplete) flags.push("Description incomplete");
      const block = buildAnalyzeBlock(ensured.job, flags);
      send(
        res,
        200,
        JSON.stringify({
          ok: true,
          block,
          incomplete: ensured.incomplete,
          chars: ensured.chars,
        }),
        "application/json; charset=utf-8"
      );
    } catch (err) {
      send(res, 500, JSON.stringify({ error: String(err) }), "application/json");
    }
    return;
  }

  if (url.pathname === "/api/claude-sent" && req.method === "POST") {
    try {
      const raw = await readBody(req);
      const body = JSON.parse(raw || "{}") as { jobId?: string };
      if (!body.jobId) {
        send(res, 400, JSON.stringify({ error: "jobId required" }), "application/json");
        return;
      }
      const map = markClaudeSent(body.jobId);
      send(res, 200, JSON.stringify({ ok: true, sentAt: map[body.jobId] }), "application/json");
    } catch (err) {
      send(res, 500, JSON.stringify({ error: String(err) }), "application/json");
    }
    return;
  }

  if (url.pathname === "/api/claude-sent" && req.method === "GET") {
    send(res, 200, JSON.stringify({ sent: loadClaudeSent() }), "application/json; charset=utf-8");
    return;
  }

  if ((url.pathname === "/api/scan" || url.pathname === "/api/refresh") && (req.method === "POST" || req.method === "GET")) {
    try {
      let forceRescore = url.searchParams.get("rescore") === "1";
      let extraKeywords: string[] = [];
      let wait = url.searchParams.get("wait") === "1";
      if (req.method === "POST") {
        try {
          const body = JSON.parse((await readBody(req)) || "{}") as {
            forceRescore?: boolean;
            extraKeywords?: string[];
            wait?: boolean;
          };
          if (body.forceRescore) forceRescore = true;
          if (body.wait) wait = true;
          if (Array.isArray(body.extraKeywords)) {
            extraKeywords = body.extraKeywords.map(String).filter(Boolean);
          }
        } catch {
          /* empty body ok */
        }
      }

      // Default: start in background and return 202 so the browser does not hang
      // on a 10–20 minute LinkedIn+ATS+Gemini run.
      if (!wait) {
        if (inFlight) {
          send(
            res,
            202,
            JSON.stringify({
              started: true,
              alreadyRunning: true,
              message: scanMessage || "Scan already running…",
            }),
            "application/json; charset=utf-8"
          );
          return;
        }
        const since = Date.now() - lastScanFinishedAt;
        if (!forceRescore && lastScanFinishedAt && since < SCAN_COOLDOWN_MS) {
          send(
            res,
            429,
            JSON.stringify({
              error: `Scan cooldown — try again in ${Math.ceil((SCAN_COOLDOWN_MS - since) / 1000)}s`,
              cooldownMs: SCAN_COOLDOWN_MS - since,
              lastTotal: lastScanPayload?.totalCount ?? null,
              generatedAt: lastScanPayload?.generatedAt ?? null,
            }),
            "application/json; charset=utf-8"
          );
          return;
        }
        void handleScan({
          forceRescore,
          extraKeywords,
          bypassCooldown: forceRescore,
        }).catch((err) => {
          console.warn("Background scan failed:", err instanceof Error ? err.message : err);
        });
        send(
          res,
          202,
          JSON.stringify({
            started: true,
            alreadyRunning: false,
            message: forceRescore ? "Re-score started…" : "Scan started…",
          }),
          "application/json; charset=utf-8"
        );
        return;
      }

      const payload = await handleScan({
        forceRescore,
        extraKeywords,
        bypassCooldown: forceRescore,
      });
      send(res, 200, JSON.stringify(payload), "application/json; charset=utf-8");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = /cooldown/i.test(msg) ? 429 : 500;
      send(res, status, JSON.stringify({ error: msg }), "application/json; charset=utf-8");
    }
    return;
  }

  if (url.pathname === "/api/sources" && req.method === "GET") {
    send(
      res,
      200,
      JSON.stringify({ sources: buildSourcesCatalog(), generatedAt: new Date().toISOString() }),
      "application/json; charset=utf-8"
    );
    return;
  }

  if (url.pathname === "/api/jobs/add" && req.method === "POST") {
    try {
      const body = JSON.parse(await readBody(req)) as {
        url?: string;
        text?: string;
        title?: string;
        company?: string;
      };
      const { job, totalCount } = await addManualJob(body);
      refreshProposals();
      send(
        res,
        200,
        JSON.stringify({
          ok: true,
          job: {
            id: job.id,
            title: job.title,
            company: job.company,
            location: job.location,
            url: job.url,
            aiStatus: job.aiStatus,
            fitVerdict: job.fitVerdict,
            experienceFitPct: job.experienceFitPct,
          },
          totalCount,
        }),
        "application/json; charset=utf-8"
      );
    } catch (err) {
      send(
        res,
        400,
        JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
        "application/json; charset=utf-8"
      );
    }
    return;
  }

  if (url.pathname === "/api/feedback" && req.method === "GET") {
    const entries = loadFeedback();
    send(
      res,
      200,
      JSON.stringify({ entries, summary: feedbackSummary(entries) }),
      "application/json; charset=utf-8"
    );
    return;
  }

  if (url.pathname === "/api/feedback" && req.method === "DELETE") {
    try {
      const raw = await readBody(req);
      const body = JSON.parse(raw || "{}") as { jobId?: string };
      if (!body.jobId) {
        send(res, 400, JSON.stringify({ error: "jobId required" }), "application/json");
        return;
      }
      const entries = clearFeedback(body.jobId);
      refreshProposals();
      send(
        res,
        200,
        JSON.stringify({ ok: true, entries, summary: feedbackSummary(entries) }),
        "application/json; charset=utf-8"
      );
    } catch (err) {
      send(res, 500, JSON.stringify({ error: String(err) }), "application/json");
    }
    return;
  }

  if (url.pathname === "/api/feedback" && req.method === "POST") {
    try {
      const raw = await readBody(req);
      const body = JSON.parse(raw) as {
        jobId?: string;
        verdict?: FeedbackVerdict;
        reasons?: FeedbackReasonId[];
        note?: string;
        job?: Job;
        title?: string;
        company?: string;
        location?: string;
        source?: string;
        url?: string;
      };

      if (
        !body.jobId ||
        (body.verdict !== "relevant" &&
          body.verdict !== "not_relevant" &&
          body.verdict !== "applied" &&
          body.verdict !== "closed")
      ) {
        send(res, 400, JSON.stringify({ error: "jobId and verdict required" }), "application/json");
        return;
      }

      const job =
        body.job ||
        findJob(body.jobId) ||
        ({
          id: body.jobId,
          source: body.source || "Saved",
          title: body.title || "",
          company: body.company || "",
          location: body.location || "",
          description: "",
          requirements: "",
          url: body.url || "",
          matchScore: 90,
          matchReasons: [],
          isNew: false,
        } as Job);
      if (body.title) job.title = body.title;
      if (body.company) job.company = body.company;
      if (body.location) job.location = body.location;
      if (body.source) job.source = body.source;
      if (body.url) job.url = body.url;

      if (!job.title || !job.url) {
        send(res, 400, JSON.stringify({ error: "job details required to keep this rating" }), "application/json");
        return;
      }

      const reasons = Array.isArray(body.reasons) ? body.reasons : [];
      if (body.verdict === "not_relevant" && reasons.length === 0) {
        send(res, 400, JSON.stringify({ error: "Pick at least one reason" }), "application/json");
        return;
      }
      // Relevant / applied / closed: one-tap — no reason chips
      const saveReasons =
        body.verdict === "applied" ||
        body.verdict === "relevant" ||
        body.verdict === "closed"
          ? []
          : (reasons as FeedbackReasonId[]);

      const entries = upsertFeedback(entryFromJob(job, body.verdict, saveReasons, body.note));
      const proposals = refreshProposals();
      void syncRadarTagForJob(job);
      send(
        res,
        200,
        JSON.stringify({
          ok: true,
          summary: feedbackSummary(entries),
          verdict: body.verdict,
          reasons: saveReasons,
          proposalsOpen: proposals.length,
        }),
        "application/json; charset=utf-8"
      );
      console.log(`Feedback: ${body.verdict} [${saveReasons.join(", ")}] → ${job.title}`);
    } catch (err) {
      send(res, 500, JSON.stringify({ error: String(err) }), "application/json");
    }
    return;
  }

  if (url.pathname === "/api/rules" && req.method === "GET") {
    refreshProposals();
    const { applyRulesToJobs } = await import("./rules-learn.js");
    const { hidden } = applyRulesToJobs(loadLatestJobs(), loadRules(), loadShowAnyway());
    send(
      res,
      200,
      JSON.stringify({
        rules: loadRules(),
        proposals: loadProposals().filter((p) => p.status === "open"),
        insights: reasonCountsLastDays(30),
        showAnyway: [...loadShowAnyway()],
        hidden: hidden.map(({ job, rule }) => ({
          jobId: job.id,
          title: job.title,
          company: job.company,
          url: job.url,
          ruleId: rule.id,
          ruleText: rule.plainEnglish,
        })),
      }),
      "application/json; charset=utf-8"
    );
    return;
  }

  if (url.pathname === "/api/rules/approve" && req.method === "POST") {
    try {
      const body = JSON.parse(await readBody(req)) as {
        proposalId?: string;
        plainEnglish?: string;
        keywords?: string[];
        type?: LearnedRule["type"];
      };
      if (!body.proposalId) {
        send(res, 400, JSON.stringify({ error: "proposalId required" }), "application/json");
        return;
      }
      const rule = approveProposal(body.proposalId, {
        plainEnglish: body.plainEnglish,
        keywords: body.keywords,
        type: body.type,
      });
      if (!rule) {
        send(res, 404, JSON.stringify({ error: "proposal not found" }), "application/json");
        return;
      }
      send(res, 200, JSON.stringify({ ok: true, rule, rules: loadRules() }), "application/json; charset=utf-8");
    } catch (err) {
      send(res, 500, JSON.stringify({ error: String(err) }), "application/json");
    }
    return;
  }

  if (url.pathname === "/api/rules/reject" && req.method === "POST") {
    try {
      const body = JSON.parse(await readBody(req)) as { proposalId?: string };
      if (!body.proposalId) {
        send(res, 400, JSON.stringify({ error: "proposalId required" }), "application/json");
        return;
      }
      rejectProposal(body.proposalId);
      send(res, 200, JSON.stringify({ ok: true }), "application/json; charset=utf-8");
    } catch (err) {
      send(res, 500, JSON.stringify({ error: String(err) }), "application/json");
    }
    return;
  }

  if (url.pathname === "/api/rules/update" && req.method === "POST") {
    try {
      const body = JSON.parse(await readBody(req)) as { id?: string } & Partial<LearnedRule>;
      if (!body.id) {
        send(res, 400, JSON.stringify({ error: "id required" }), "application/json");
        return;
      }
      const { id, ...patch } = body;
      const rule = updateRule(id, patch);
      if (!rule) {
        send(res, 404, JSON.stringify({ error: "rule not found" }), "application/json");
        return;
      }
      send(res, 200, JSON.stringify({ ok: true, rule }), "application/json; charset=utf-8");
    } catch (err) {
      send(res, 500, JSON.stringify({ error: String(err) }), "application/json");
    }
    return;
  }

  if (url.pathname === "/api/rules/delete" && req.method === "POST") {
    try {
      const body = JSON.parse(await readBody(req)) as { id?: string };
      if (!body.id) {
        send(res, 400, JSON.stringify({ error: "id required" }), "application/json");
        return;
      }
      deleteRule(body.id);
      send(res, 200, JSON.stringify({ ok: true, rules: loadRules() }), "application/json; charset=utf-8");
    } catch (err) {
      send(res, 500, JSON.stringify({ error: String(err) }), "application/json");
    }
    return;
  }

  if (url.pathname === "/api/rules/show-anyway" && req.method === "POST") {
    try {
      const body = JSON.parse(await readBody(req)) as { jobId?: string };
      if (!body.jobId) {
        send(res, 400, JSON.stringify({ error: "jobId required" }), "application/json");
        return;
      }
      const ids = [...loadShowAnyway(), body.jobId];
      saveShowAnyway(ids);
      send(res, 200, JSON.stringify({ ok: true, showAnyway: ids }), "application/json; charset=utf-8");
    } catch (err) {
      send(res, 500, JSON.stringify({ error: String(err) }), "application/json");
    }
    return;
  }

  const rel = (url.pathname === "/" ? "index.html" : url.pathname)
    .replace(/^\/+/, "")
    .split("/")
    .filter((p) => p && p !== "." && p !== "..")
    .join("/");
  const filePath = join(root, "web", rel || "index.html");
  if (!existsSync(filePath)) {
    send(res, 404, "Not found", "text/plain");
    return;
  }

  const type = MIME[extname(filePath)] || "application/octet-stream";
  if (BINARY.has(extname(filePath).toLowerCase())) {
    send(res, 200, readFileSync(filePath), type);
    return;
  }
  send(res, 200, readFileSync(filePath, "utf8"), type);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`RADAR live search: http://localhost:${PORT}`);
  console.log("On this Wi-Fi, open http://<this-pc-ip>:" + PORT + " from your phone.");
});
