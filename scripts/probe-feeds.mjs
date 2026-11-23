async function main() {
  const tower = await fetch("https://www.towersemi.com/feed");
  const t = await tower.text();
  console.log("tower ct", tower.headers.get("content-type"), "len", t.length);
  const titles = [...t.matchAll(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>([^<]+)<\/title>/g)]
    .slice(0, 8)
    .map((m) => m[1] || m[2]);
  console.log("tower titles", titles);

  const jp = await fetch("https://jp.towersemi.com/careers/feed");
  const j = await jp.text();
  console.log("jp careers feed", j.slice(0, 600));

  const sf = await fetch(
    "https://career4.successfactors.com/career?company=Stratasys&career_ns=job_listing_summary&clientId=jobs2web"
  );
  const h = await sf.text();
  const links = [...h.matchAll(/href=["']([^"']*(?:rss|atom|xml|feed)[^"']*)["']/gi)].map((m) => m[1]);
  console.log("SF feed-ish links", [...new Set(links)].slice(0, 20));
  console.log("SF has JobReq", /JobReq/.test(h), "jobTitle hits", (h.match(/jobTitle/g) || []).length);

  const twSf = await fetch(
    "https://career2.successfactors.eu/career?company=towersemic&career_ns=job_listing_summary&clientId=jobs2web"
  );
  const th = await twSf.text();
  const tlinks = [...th.matchAll(/href=["']([^"']*(?:rss|atom|xml|feed)[^"']*)["']/gi)].map((m) => m[1]);
  console.log("Tower SF feed-ish links", [...new Set(tlinks)].slice(0, 20));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
