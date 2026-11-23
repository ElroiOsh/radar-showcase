/**
 * Public demo mode.
 *
 * The real RADAR runs with a Node API (local server or Cloudflare Pages Functions)
 * that saves tags, learns rules and runs live scans. This public copy is a static
 * snapshot, so this script answers the /api calls in the browser:
 * tags work for the current visit only, live scanning is switched off.
 * Loaded first, before the other app scripts.
 */
(() => {
  const nativeFetch = window.fetch.bind(window);
  const entries = [];

  const json = (body, status = 200) =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      })
    );

  function apiPath(input) {
    try {
      const url = new URL(typeof input === "string" ? input : input.url, location.href);
      const i = url.pathname.indexOf("/api/");
      return i === -1 ? null : url.pathname.slice(i);
    } catch {
      return null;
    }
  }

  window.fetch = (input, init = {}) => {
    const path = apiPath(input);
    if (!path) return nativeFetch(input, init);
    const method = (init.method || "GET").toUpperCase();

    if (path === "/api/health") return json({ ok: true, live: false, demo: true });
    if (path === "/api/scan" || path.startsWith("/api/scan/") || path === "/api/jobs/add") {
      return json({ error: "Live scanning is switched off in this public demo" }, 403);
    }
    if (path === "/api/feedback") {
      if (method === "POST") {
        try {
          entries.push(JSON.parse(init.body || "{}"));
        } catch {
          /* ignore */
        }
        return json({ ok: true, demo: true });
      }
      if (method === "DELETE") return json({ ok: true });
      return json({ entries, summary: { relevant: 0, notRelevant: 0 } });
    }
    if (path === "/api/rules") return json({ rules: [], proposals: [], hidden: [] });
    if (path.startsWith("/api/rules/")) return json({ ok: true });
    // Everything else (reasons, analyze-block, claude-sent): let the app use its fallback.
    return json({ error: "Not available in the demo" }, 404);
  };

  function banner() {
    if (document.getElementById("demo-banner")) return;
    const el = document.createElement("div");
    el.id = "demo-banner";
    el.setAttribute("role", "note");
    el.style.cssText =
      "background:#0a5c48;color:#fff;text-align:center;padding:9px 16px;" +
      "font:500 14px/1.45 system-ui,sans-serif";
    el.innerHTML =
      "Public demo: a snapshot of real postings from one scan. " +
      "Tags work for this visit only, live scanning is off. " +
      '<a href="https://github.com/ElroiOsh/radar-showcase" style="color:#8fe0c5">How it works</a>';
    document.body.prepend(el);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", banner);
  } else {
    banner();
  }
})();
