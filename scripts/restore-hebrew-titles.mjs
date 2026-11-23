import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const latest = JSON.parse(readFileSync(join(root, "data/latest.json"), "utf8"));
const live = JSON.parse(readFileSync(join(root, "data/live-jobs.json"), "utf8"));
const byId = new Map(live.map((j) => [j.id, j]));

let restored = 0;
for (const job of latest.jobs || []) {
  const raw = byId.get(job.id);
  if (!raw) continue;
  if (raw.title && raw.title !== job.title) {
    job.title = raw.title;
    restored += 1;
  }
  if (raw.company) job.company = raw.company;
  if (raw.location) job.location = raw.location;
  if (raw.description) job.description = raw.description;
  if (raw.requirements) job.requirements = raw.requirements;
}
writeFileSync(join(root, "data/latest.json"), JSON.stringify(latest, null, 2));
console.log("restored", restored, "titles");
console.log(
  "hebrew titles",
  (latest.jobs || []).filter((j) => /[\u0590-\u05FF]/.test(j.title)).length
);
