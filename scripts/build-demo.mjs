// Builds the public static demo in web/ from the saved job snapshot in data/.
// 1. Rebuild the dashboard without fetching (rules only, no tags).
// 2. Load demo.js first on every page, so /api calls are answered in the browser.
// 3. Make root paths relative, so the site works under /<repo>/ on GitHub Pages.
import { execSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

execSync("npx tsx src/run-daily.ts --skip-fetch", { stdio: "inherit" });

const webDir = "web";
for (const name of readdirSync(webDir).filter((f) => f.endsWith(".html"))) {
  const file = join(webDir, name);
  let html = readFileSync(file, "utf8");
  html = html.replace(/(src|href)="\/(?!\/)/g, '$1="./');
  if (!html.includes("demo.js")) {
    html = html.replace(/<script\b/, '<script src="./demo.js"></script>\n  <script');
  }
  writeFileSync(file, html);
  console.log(`demo: ${file}`);
}
