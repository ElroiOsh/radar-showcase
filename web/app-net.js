/**
 * Network guard for the cloud site (Cloudflare Access in front of /api).
 *
 * When the Access sign-in expires, a same-origin fetch to /api is redirected to
 * the cloudflareaccess.com login page. The browser blocks that cross-origin
 * redirect and fetch() fails with a bare "Failed to fetch".
 *
 * This wrapper catches that case, keeps the change you just made (tag, untag,
 * rule action), reloads the page so Access can sign you in again, and replays
 * the saved change once the page is back.
 */
(() => {
  const QUEUE_KEY = "radar-pending-api";
  const RELOAD_KEY = "radar-auth-reload-at";
  const nativeFetch = window.fetch.bind(window);

  function isApi(input) {
    try {
      const url = new URL(typeof input === "string" ? input : input.url, location.href);
      return url.origin === location.origin && url.pathname.startsWith("/api/");
    } catch {
      return false;
    }
  }

  function readQueue() {
    try {
      return JSON.parse(sessionStorage.getItem(QUEUE_KEY) || "[]") || [];
    } catch {
      return [];
    }
  }

  function writeQueue(q) {
    try {
      if (q.length) sessionStorage.setItem(QUEUE_KEY, JSON.stringify(q));
      else sessionStorage.removeItem(QUEUE_KEY);
    } catch {
      /* storage blocked */
    }
  }

  function banner(text) {
    let el = document.getElementById("radar-net-banner");
    if (!el) {
      el = document.createElement("div");
      el.id = "radar-net-banner";
      el.setAttribute("role", "status");
      el.style.cssText =
        "position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:9999;" +
        "background:#1f2937;color:#fff;padding:10px 16px;border-radius:10px;" +
        "font:500 14px/1.4 system-ui,sans-serif;max-width:92vw;box-shadow:0 6px 20px rgba(0,0,0,.25)";
      document.body.appendChild(el);
    }
    el.textContent = text;
  }

  function signInAgain(pending) {
    if (pending) {
      const q = readQueue();
      q.push(pending);
      writeQueue(q.slice(-20));
    }
    let last = 0;
    try {
      last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    } catch {
      /* ignore */
    }
    // Already reloaded a moment ago and it still fails: don't loop.
    if (Date.now() - last < 60_000) {
      banner("Could not reach RADAR. Close this tab and open the site again (you may be asked to sign in).");
      return;
    }
    try {
      sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
    banner("Sign-in expired. Reloading to sign in again; your change will be saved after that…");
    setTimeout(() => location.reload(), 1200);
  }

  class AuthExpiredError extends Error {
    constructor() {
      super("Sign-in expired. Reloading…");
      this.name = "AuthExpiredError";
    }
  }

  // Replay changes saved before the reload, before any other /api call runs.
  const replay = (async () => {
    const q = readQueue();
    if (!q.length) return;
    writeQueue([]);
    const failed = [];
    for (const item of q) {
      try {
        const res = await nativeFetch(item.url, {
          method: item.method,
          headers: { "Content-Type": "application/json" },
          body: item.body,
          credentials: "same-origin",
          redirect: "manual",
        });
        if (res.type === "opaqueredirect" || !res.ok) failed.push(item);
      } catch {
        failed.push(item);
      }
    }
    if (failed.length) {
      writeQueue(failed);
      banner("Some changes were not saved yet. They will be retried on the next page load.");
    } else {
      banner(`Saved ${q.length} change${q.length > 1 ? "s" : ""} from before the sign-in.`);
      setTimeout(() => document.getElementById("radar-net-banner")?.remove(), 3500);
    }
  })();

  window.fetch = async (input, init = {}) => {
    if (!isApi(input)) return nativeFetch(input, init);
    await replay;
    const method = String(init.method || "GET").toUpperCase();
    const pending =
      method !== "GET" && typeof init.body === "string"
        ? { url: typeof input === "string" ? input : input.url, method, body: init.body }
        : null;
    let res;
    try {
      res = await nativeFetch(input, { credentials: "same-origin", ...init, redirect: "manual" });
    } catch (err) {
      if (err && err.name === "AbortError") throw err;
      if (!navigator.onLine) throw new Error("You are offline. Try again when connected.");
      // A blocked cross-origin redirect also ends up here on some browsers.
      signInAgain(pending);
      throw new AuthExpiredError();
    }
    if (res.type === "opaqueredirect" || res.status === 401) {
      signInAgain(pending);
      throw new AuthExpiredError();
    }
    try {
      sessionStorage.removeItem(RELOAD_KEY);
    } catch {
      /* ignore */
    }
    return res;
  };

  // Don't show a second alert() on top of the banner.
  const nativeAlert = window.alert.bind(window);
  window.alert = (msg) => {
    if (/Sign-in expired/.test(String(msg))) return;
    nativeAlert(msg);
  };
})();
