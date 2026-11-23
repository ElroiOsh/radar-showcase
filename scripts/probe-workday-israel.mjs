/**
 * One-off probe: does this Workday board return Israel roles?
 * Usage: node scripts/probe-workday-israel.mjs
 */
const BOARDS = [
  { name: "West Pharmaceutical", url: "https://westpharma.wd1.myworkdayjobs.com/West_External_Career_Site" },
  { name: "West Pharmaceutical (alt)", url: "https://west.wd1.myworkdayjobs.com/External" },
  { name: "Medtronic", url: "https://medtronic.wd1.myworkdayjobs.com/MedtronicCareers" },
  { name: "Philips", url: "https://philips.wd3.myworkdayjobs.com/jobs-and-careers" },
  { name: "GE HealthCare", url: "https://gehc.wd5.myworkdayjobs.com/GEHC_ExternalSite" },
  { name: "Johnson & Johnson", url: "https://jnj.wd5.myworkdayjobs.com/en-US/JNJ_External" },
  { name: "J&J (alt)", url: "https://jj.wd5.myworkdayjobs.com/JJ_External" },
];

function parseBoard(boardUrl) {
  const u = new URL(boardUrl);
  const parts = u.pathname.split("/").filter(Boolean);
  return { host: u.origin, site: parts[0] || "External", tenant: u.hostname.split(".")[0] };
}

async function probe(board) {
  try {
    const meta = parseBoard(board.url);
    const url = `${meta.host}/wday/cxs/${meta.tenant}/${meta.site}/jobs`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: "Israel" }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return { name: board.name, ok: false, status: res.status, url: board.url };
    const data = await res.json();
    const jobs = data.jobPostings || [];
    const israel = jobs.filter((j) => /israel|ישראל/i.test(j.locationsText || ""));
    return {
      name: board.name,
      ok: true,
      total: data.total ?? jobs.length,
      israelOnPage: israel.length,
      sample: israel.slice(0, 3).map((j) => `${j.title} @ ${j.locationsText}`),
      url: board.url,
    };
  } catch (err) {
    return { name: board.name, ok: false, error: String(err.message || err), url: board.url };
  }
}

const results = [];
for (const b of BOARDS) {
  results.push(await probe(b));
  await new Promise((r) => setTimeout(r, 400));
}
console.log(JSON.stringify(results, null, 2));
