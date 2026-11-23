// Diagnostic: checks that each job source answers the way the fetchers expect.
// Run: node scripts/probe-sources.mjs
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const H = { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.9,he;q=0.8" };

async function get(url, init = {}) {
  try {
    const res = await fetch(url, { headers: H, redirect: "follow", signal: AbortSignal.timeout(25000), ...init });
    const text = await res.text();
    return { status: res.status, type: res.headers.get("content-type") || "", url: res.url, text };
  } catch (e) {
    return { status: 0, type: "", url, text: "", err: String(e?.cause?.code || e?.message || e) };
  }
}
const uniq = (a) => [...new Set(a)];

console.log("== Comeet-backed career pages ==");
const BROWSER = {
  ...H,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "sec-ch-ua": '"Chromium";v="131", "Not_A Brand";v="24"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
};
for (const u of [
  "https://www.novami.com/location_filter/israel/",
  "https://www.novami.com/comeetitem/c8b68/",
  "https://www.novami.com/wp-json/wp/v2/types",
  "https://careers.kornit.com/all-positions/",
  "https://careers.kornit.com/?p=79291",
  "https://careers.kornit.com/wp-json/wp/v2/types",
  "https://www.razor-labs.com/careers/",
]) {
  const r = await get(u, { headers: BROWSER });
  const t = r.text;
  console.log(`\n${u}\n  -> ${r.status} ${r.type.split(";")[0]} len=${t.length} ${r.err || ""}`);
  console.log("  head:", t.slice(0, 200).replace(/\s+/g, " "));
  const i = t.indexOf("comeet_token");
  if (i >= 0) console.log("  comeet ctx:", t.slice(Math.max(0, i - 400), i + 200).replace(/\s+/g, " "));
  const links = uniq(t.match(/href="[^"]*\/careers\/co\/[^"]*"/gi) || []);
  console.log("  plugin links:", links.length, links.filter((l) => /israel/i.test(l)).slice(0, 12));
}

console.log("\n== Intel Workday ==");
for (const [host, tenant, site] of [
  ["https://intel.wd1.myworkdayjobs.com", "intel", "External"],
  ["https://intel.wd1.myworkdayjobs.com", "intel", "Intel"],
  ["https://intel.wd1.myworkdayjobs.com", "intel", "External_Careers"],
]) {
  const r = await get(`${host}/wday/cxs/${tenant}/${site}/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": UA },
    body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: "Israel" }),
  });
  console.log(`${site}: ${r.status} ${r.type.split(";")[0]} ${r.err || ""} ${r.text.slice(0, 160).replace(/\s+/g, " ")}`);
}
{
  const r = await get("https://intel.wd1.myworkdayjobs.com/External");
  console.log(`board page: ${r.status} final=${r.url} title=${(r.text.match(/<title>([^<]*)/i) || [])[1] || ""}`);
  const r2 = await get("https://jobs.intel.com/en/search-jobs/Israel");
  console.log(`jobs.intel.com: ${r2.status} final=${r2.url} len=${r2.text.length} hints=${["workday", "phenom", "radancy", "talentbrew"].filter((k) => r2.text.toLowerCase().includes(k))}`);
}

console.log("\n== Workday paging (Applied Materials) ==");
for (const offset of [0, 20, 40, 60]) {
  const r = await get("https://amat.wd1.myworkdayjobs.com/wday/cxs/amat/External/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": UA },
    body: JSON.stringify({ appliedFacets: {}, limit: 20, offset, searchText: "Israel" }),
  });
  try {
    const d = JSON.parse(r.text);
    console.log(`offset ${offset}: total=${d.total} postings=${(d.jobPostings || []).length}`);
  } catch {
    console.log(`offset ${offset}: ${r.status} not JSON`);
  }
}

console.log("\n== LinkedIn guest page size ==");
for (const start of [0, 10, 25]) {
  const u = new URL("https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search");
  u.searchParams.set("keywords", "Process Engineer");
  u.searchParams.set("location", "Israel");
  u.searchParams.set("f_TPR", "r604800");
  u.searchParams.set("start", String(start));
  const r = await get(u);
  const ids = uniq((r.text.match(/urn:li:jobPosting:(\d+)/g) || []));
  console.log(`start=${start}: ${r.status} cards=${ids.length} first=${ids[0] || "-"}`);
  await new Promise((s) => setTimeout(s, 2500));
}
