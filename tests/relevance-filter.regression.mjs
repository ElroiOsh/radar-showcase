/**
 * Regression fixtures for deterministic relevance filter.
 * Run: npm run test:relevance
 */
import { evaluateTitleRelevance, applyRelevanceFilter, formatFilterSummary } from "../src/relevance-filter.ts";
import { enrichAndFilterDetailed } from "../src/match.ts";
import { normalizeUrlKey, tagFingerprint } from "../src/tag-fingerprint.ts";

let failed = 0;

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    failed += 1;
  } else {
    console.log("ok:", msg);
  }
}

function job(partial) {
  return {
    id: partial.id || "j1",
    source: partial.source || "Test",
    title: partial.title || "",
    company: partial.company || "Acme",
    location: partial.location || "Rehovot, Israel",
    description: partial.description || "",
    requirements: partial.requirements || "",
    url: partial.url || "https://example.com/jobs/1",
    matchScore: 0,
    matchReasons: [],
    isNew: true,
  };
}

// —— Title gate fixtures ——
{
  assert(evaluateTitleRelevance("Manufacturing Process Engineer").keep, "Manufacturing Process Engineer → shown");
  assert(evaluateTitleRelevance("מהנדס/ת תהליך").keep, "מהנדס/ת תהליך → shown");

  const fs = evaluateTitleRelevance("Full Stack Developer");
  assert(!fs.keep, "Full Stack Developer → excluded even if description mentions manufacturing");
  // Description must not save a title exclude:
  const withDesc = applyRelevanceFilter(
    [
      job({
        title: "Full Stack Developer",
        description: "Build manufacturing dashboards for the factory floor",
      }),
    ],
    []
  );
  assert(withDesc.kept.length === 0, "Full Stack + manufacturing description still excluded");

  const sales = evaluateTitleRelevance("Sales Engineer – Industrial Automation");
  assert(!sales.keep && /sales/i.test(sales.reason), "Sales Engineer – Industrial Automation → excluded (title exclusion wins)");

  assert(!evaluateTitleRelevance("Office Manager").keep, "Office Manager → excluded");

  assert(
    !evaluateTitleRelevance("Cellular SW Tools & Automation Engineering Manager").keep,
    "SW Automation Engineering Manager without mfg context → excluded"
  );
}

// —— Tag hide across URL change ——
{
  const feedback = [
    {
      jobId: "linkedin-111",
      verdict: "not_relevant",
      title: "Process Engineer",
      company: "Stratasys",
      location: "Kiryat Gat",
      source: "LinkedIn",
      url: "https://il.linkedin.com/jobs/view/process-engineer-111?trk=foo",
      tokens: [],
      reasons: ["wrong_role"],
      fingerprint: tagFingerprint({ company: "Stratasys", title: "Process Engineer" }),
      updatedAt: new Date().toISOString(),
    },
  ];
  const again = applyRelevanceFilter(
    [
      job({
        id: "workday-999",
        title: "Process Engineer",
        company: "Stratasys",
        url: "https://company.myworkdayjobs.com/en-US/job/Process-Engineer_999",
      }),
    ],
    feedback
  );
  assert(
    again.kept.length === 0 && again.stats.hiddenByTag === 1,
    "Previously tagged Not relevant, new URL / same company+title → hidden"
  );
}

// —— Dedup two sources ——
{
  const two = applyRelevanceFilter(
    [
      job({
        id: "li-1",
        title: "Manufacturing Engineer",
        company: "KLA",
        url: "https://li.example/1",
      }),
      job({
        id: "wd-1",
        title: "Manufacturing Engineer",
        company: "KLA",
        url: "https://wd.example/1",
      }),
    ],
    []
  );
  assert(two.kept.length === 1 && two.stats.duplicates === 1, "Same job from two sources → shown once");
}

// —— Pass-rate warning helper ——
{
  const many = Array.from({ length: 20 }, (_, i) =>
    job({
      id: `m-${i}`,
      title: "Manufacturing Engineer",
      company: `Co${i}`,
      url: `https://example.com/${i}`,
    })
  );
  const r = applyRelevanceFilter(many, [], { fetchedCount: 20 });
  assert(r.stats.passRateWarning === true, "pass-rate >50% on 20/20 manufacturing titles warns");
  assert(/WARNING/i.test(formatFilterSummary(r.stats)), "summary includes WARNING text");
}

// —— URL key stability ——
{
  const a = normalizeUrlKey("https://il.linkedin.com/jobs/view/123?trk=public&utm_source=x");
  const b = normalizeUrlKey("https://il.linkedin.com/jobs/view/123");
  assert(a === b, "normalizeUrlKey strips trackers");
}

// —— enrichAndFilterDetailed geo + archive ——
{
  const feedback = [
    {
      jobId: "old-1",
      verdict: "applied",
      title: "Industrial Engineer",
      company: "HP",
      location: "Kiryat Gat",
      source: "LinkedIn",
      url: "https://example.com/old",
      tokens: [],
      reasons: [],
      fingerprint: tagFingerprint({ company: "HP", title: "Industrial Engineer" }),
      updatedAt: new Date().toISOString(),
    },
  ];
  const detailed = enrichAndFilterDetailed(
    [
      job({
        id: "new-1",
        title: "Industrial Engineer",
        company: "HP",
        url: "https://example.com/new-different",
      }),
      job({
        id: "bad",
        title: "Office Manager",
        company: "HP",
      }),
    ],
    { min_match_score: 0 },
    new Set(),
    feedback
  );
  assert(detailed.jobs.every((j) => j.title !== "Industrial Engineer"), "Applied tag not in main New feed");
  assert(
    detailed.taggedArchive.some((j) => j.userFeedback === "applied"),
    "Applied job kept in tagged archive for tabs"
  );
  assert(detailed.jobs.every((j) => j.title !== "Office Manager"), "Office Manager not in feed");
}

// —— Calibration from real tags + real dropped titles (Nov 2026) ——
{
  const keep = [
    "Manufacturing Execution & Systems Eng",
    "Hardware Manufacturing Integrator",
    "Production Team Leader",
    "Manufacturing Operations Manager",
    "Automation Development Engineer",
    "Motion & Control Supplier Engineer",
    "Head of Assembly Division",
    "Technical Project Manager",
    "מהנדס.ת תהליך",
    "ראש/ת תחום רצפת ייצור",
    "מנהל/ת הנדסה",
    "מהנדס/ת תפעול ואוטומציה",
  ];
  for (const t of keep) assert(evaluateTitleRelevance(t).keep, `${t} → shown`);

  const drop = [
    "SoC Clocks Design Automation Engineer",
    "Principal Automation Engineer (Data Security)",
    "Network Automation Engineer",
    "Senior Quality Engineer - Manufacturing",
    "Production & Material Planner",
    "Production Infrastructure & SRE Team Lead",
    "Manufacturing Technician",
    "NPI Engineer",
    "מנהל/ת משמרת אוטומציה",
    "עובד/ת ייצור",
    "Engineering Manager",
  ];
  for (const t of drop) assert(!evaluateTitleRelevance(t).keep, `${t} → filtered out`);

  // Same employer under two spellings is one job
  const dup = applyRelevanceFilter(
    [
      job({ id: "a", title: "Process Engineer", company: "Applied Materials", url: "https://x.example/a" }),
      job({ id: "b", title: "Process Engineer", company: "Applied Materials - Israel", url: "https://x.example/b" }),
    ],
    []
  );
  assert(dup.kept.length === 1, "Applied Materials / Applied Materials - Israel deduped");

  // Automation title + software body (after enrichment) is dropped; factory body is kept
  const sw = "We build CI/CD pipelines, Kubernetes clusters and Python microservices for our cloud platform. ".repeat(6);
  const mfg = "Design PLC-controlled assembly stations for the production line, work with machine builders on the factory floor. ".repeat(6);
  const auto = applyRelevanceFilter(
    [
      job({ id: "s", title: "Automation Engineer", company: "SoftCo", description: sw, url: "https://x.example/s" }),
      job({ id: "m", title: "Automation Engineer", company: "PlantCo", description: mfg, url: "https://x.example/m" }),
    ],
    []
  );
  assert(auto.kept.length === 1 && auto.kept[0].company === "PlantCo", "Automation Engineer: software body dropped, factory body kept");
}

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll relevance regression checks passed.");
