/** Normalize company+title so reposts / cross-source dupes share one tag. */
export function normalizeTagFingerprint(company: string, title: string): string {
  return `${company} ${title}`
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9א-ת]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tagFingerprint(entry: { company?: string; title?: string }): string {
  return normalizeTagFingerprint(entry.company || "", entry.title || "");
}

/** Strip tracking query noise so the same posting from two links shares a key. */
export function normalizeUrlKey(url: string): string {
  const raw = String(url || "").trim();
  if (!raw) return "";
  try {
    const u = new URL(raw);
    u.hash = "";
    // Drop common trackers; keep path + host
    const drop = new Set([
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "trk",
      "refId",
      "refid",
      "ePID",
    ]);
    for (const key of [...u.searchParams.keys()]) {
      if (drop.has(key) || key.toLowerCase().startsWith("utm_")) {
        u.searchParams.delete(key);
      }
    }
    const path = u.pathname.replace(/\/+$/, "") || "/";
    const q = u.searchParams.toString();
    return `${u.hostname.toLowerCase()}${path}${q ? `?${q}` : ""}`.toLowerCase();
  } catch {
    return raw
      .toLowerCase()
      .split("?")[0]
      .replace(/\/+$/, "")
      .trim();
  }
}
