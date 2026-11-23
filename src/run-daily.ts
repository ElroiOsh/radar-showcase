import "dotenv/config";
import { runScan } from "./scan.js";
import { sendEmail } from "./email.js";

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const { result, profile, payload } = await runScan({
    skipFetch: args.has("--skip-fetch"),
    demo: args.has("--demo"),
  });

  const issues = (payload.sourceResults || []).filter(
    (s) => s.status === "timeout" || s.status === "failed"
  );
  console.log(
    `Dashboard rebuilt · rules ${payload.rulesKept} · no Gemini · sources WD ${payload.sources.workday ?? 0} / Comeet ${payload.sources.comeet ?? 0} / LI ${payload.sources.linkedin ?? 0}` +
      (payload.timedOut ? " · TIMED OUT" : "") +
      (issues.length ? ` · issues ${issues.map((i) => i.name).join(", ")}` : "")
  );
  console.log(`Visible jobs in result: ${result.totalCount} (${payload.newCount} newly seen)`);

  if (args.has("--email")) {
    await sendEmail(result, profile);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
