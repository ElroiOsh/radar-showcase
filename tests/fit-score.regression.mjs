/**
 * Regression fixtures for experience-fit scoring.
 * Run: node --import tsx tests/fit-score.regression.mjs
 * Fails with which requirement differed when assertions break.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { applyFitScore, verifyRequirementEvidence } from "../src/fit-score.ts";
import { detectCoreFromDuties } from "../src/job-text.ts";
import { evidenceInProfile, loadScoringProfileText } from "../src/scoring-profile.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const iaiText = readFileSync(join(root, "tests/fixtures/iai-robotics-me.txt"), "utf8");
const stratText = readFileSync(join(root, "tests/fixtures/stratasys-process-engineer.txt"), "utf8");

let failed = 0;

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    failed += 1;
  } else {
    console.log("ok:", msg);
  }
}

function reqDiff(expected, actual, label) {
  const a = (actual || []).map((r) => `${r.text}|${r.match}|core=${!!r.core}`).sort();
  const e = (expected || []).map((r) => `${r.text}|${r.match}|core=${!!r.core}`).sort();
  const missing = e.filter((x) => !a.some((y) => y.startsWith(x.split("|")[0].slice(0, 24))));
  const extra = a.filter((x) => !e.some((y) => y.startsWith(x.split("|")[0].slice(0, 24))));
  if (missing.length || extra.length) {
    console.error(`Requirement classification differ (${label}):`);
    for (const m of missing) console.error("  expected:", m);
    for (const x of extra) console.error("  actual:", x);
  }
}

// —— Evidence verification unit ——
{
  const profile = loadScoringProfileText();
  assert(evidenceInProfile("Designed custom tooling, molds, jigs, and fixtures", profile), "real CV evidence accepted");
  const downgraded = verifyRequirementEvidence([
    {
      text: "Gripper design",
      importance: "must",
      match: "partial",
      evidence: "Invented gripper experience that is not in the profile",
      core: true,
    },
  ]);
  assert(downgraded[0].match === "not_met", "fake evidence downgraded to not_met");
}

// —— IAI robotics ME ——
{
  const cores = detectCoreFromDuties(iaiText);
  assert(
    cores.some((c) => /robot.*programm|programm.*robot|תכנות/i.test(c) || /Industrial robot/i.test(c)),
    `IAI duties detect robot programming core (got: ${cores.join("; ")})`
  );
  assert(
    cores.some((c) => /gripper|end-effector|גריפ/i.test(c)),
    `IAI duties detect gripper core (got: ${cores.join("; ")})`
  );

  // Simulate generous model that wrongly marks fixtures as partial gripper credit
  const badModelReqs = [
    {
      text: "Industrial robot programming",
      importance: "must",
      match: "partial",
      evidence: "supported automated and semi-automated production lines",
      core: true,
    },
    {
      text: "Gripper / end-effector design",
      importance: "must",
      match: "partial",
      evidence: "Designed custom tooling, molds, jigs, and fixtures that increased line efficiency.",
      core: true,
    },
    {
      text: "B.Sc. Mechanical Engineering",
      importance: "must",
      match: "met",
      evidence: "B.Sc. in Mechanical Engineering — Ben Gurion University (2015 – 2019)",
      core: false,
    },
  ];

  const fit = applyFitScore({
    title: "מהנדס/ת מכונות לרובוטיקה ואוטומציה לקווי ייצור",
    description: iaiText,
    requirements: iaiText,
    matchScore: 70,
    aiRating: {
      experience_fit: "high",
      experience_fit_pct: 85,
      smart_manufacturing_fit: "high",
      management_fit: "medium",
      career_direction: "high",
      recommendation: "go",
      cv_track: "SM",
      why_yes: "test",
      gaps: "test",
      check: "",
      requirements: badModelReqs,
      core_requirements: ["Industrial robot programming", "Gripper / end-effector design"],
    },
  });

  const robot = (fit.requirements || []).find((r) => /robot|רובוט|programm/i.test(r.text));
  const gripper = (fit.requirements || []).find((r) => /gripper|גריפ|end-effector/i.test(r.text));
  if (!robot || robot.match !== "not_met" || !robot.core) {
    reqDiff(
      [{ text: "Industrial robot programming", match: "not_met", core: true }],
      fit.requirements,
      "IAI robot programming"
    );
  }
  assert(robot && robot.core && robot.match === "not_met", "IAI robot programming is core + not_met");
  if (!gripper || gripper.match !== "not_met" || !gripper.core) {
    reqDiff(
      [{ text: "Gripper / end-effector design", match: "not_met", core: true }],
      fit.requirements,
      "IAI gripper"
    );
  }
  assert(gripper && gripper.core && gripper.match === "not_met", "IAI gripper design is core + not_met");
  assert(fit.experienceFitPct <= 55, `IAI experience fit <= 55 (got ${fit.experienceFitPct})`);
  assert(
    fit.fitVerdict === "maybe" || fit.fitVerdict === "low",
    `IAI verdict Maybe or lower (got ${fit.fitVerdict})`
  );
  console.log("IAI calculation:", fit.calculation);
}

// —— Stratasys Process Engineer ——
{
  const fit = applyFitScore({
    title: "Process Engineer",
    description: stratText,
    requirements: stratText,
    matchScore: 80,
    aiRating: {
      experience_fit: "high",
      experience_fit_pct: 85,
      smart_manufacturing_fit: "medium",
      management_fit: "medium",
      career_direction: "high",
      recommendation: "go",
      cv_track: "SM",
      why_yes: "process engineering",
      gaps: "chemical degree",
      check: "",
      requirements: [
        {
          text: "B.Sc. Chemical or Materials Engineering (mandatory)",
          importance: "must",
          match: "not_met",
          evidence: "",
          core: false,
        },
        {
          text: "3+ years process/manufacturing engineering in regulated environment",
          importance: "must",
          match: "met",
          evidence: "Manufacturing process engineer with 7+ years improving and scaling production in regulated Medical Device (ISO 13485) and Pharma (GMP) environments.",
          core: false,
        },
        {
          text: "NPI / validation IQ OQ PQ",
          importance: "must",
          match: "met",
          evidence: "Led the transition from R&D to mass production (NPI), scaling up batch sizes (400g→800g)",
          core: false,
        },
        {
          text: "Manufacturing technology: milling/grinding, new line establishment, automation HMI",
          importance: "must",
          match: "partial",
          evidence: "Designed and implemented a PLC/Arduino-based automation system (controller-based water dosing for the mixer) that doubled output and improved process consistency.",
          core: false,
        },
      ],
      unmet_musts: [
        { kind: "degree", text: "B.Sc. degree in Chemical Engineering, Materials Engineering– mandatory." },
      ],
    },
  });

  assert(fit.experienceFitPct >= 80 && fit.experienceFitPct <= 90, `Stratasys fit ~80-90 (got ${fit.experienceFitPct})`);
  assert(fit.blocked === true, "Stratasys blocked=true");
  assert(
    /chemical|materials/i.test(fit.blockedBy || ""),
    `Stratasys blocked_by mentions chemical/materials (got ${fit.blockedBy})`
  );
  assert(fit.fitVerdict === "blocked", `Stratasys verdict Blocked (got ${fit.fitVerdict})`);
  console.log("Stratasys calculation:", fit.calculation);
}

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll regression assertions passed.");
