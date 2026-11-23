(() => {
  const toastEl = document.getElementById("toast");
  const fallbackSheet = document.getElementById("copy-fallback-sheet");
  const fallbackText = document.getElementById("copy-fallback-text");
  const backdrop = document.getElementById("sheet-backdrop");

  function showToast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add("is-on");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toastEl.classList.remove("is-on"), 2800);
  }

  function openFallback(text) {
    if (!fallbackSheet || !fallbackText) {
      alert(text.slice(0, 500));
      return;
    }
    fallbackText.value = text;
    fallbackSheet.hidden = false;
    fallbackSheet.classList.add("is-open");
    if (backdrop) {
      backdrop.hidden = false;
      backdrop.classList.add("is-open");
    }
  }

  function closeFallback() {
    if (!fallbackSheet) return;
    fallbackSheet.classList.remove("is-open");
    setTimeout(() => {
      fallbackSheet.hidden = true;
    }, 180);
    if (backdrop && document.getElementById("tag-sheet")?.hidden !== false) {
      backdrop.classList.remove("is-open");
      setTimeout(() => {
        backdrop.hidden = true;
      }, 180);
    }
  }

  async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        /* fall through */
      }
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "0";
      ta.style.left = "0";
      ta.style.opacity = "0";
      ta.style.pointerEvents = "none";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }

  const SENT_KEY = "radar-claude-sent";

  function readSentLocal() {
    try {
      return JSON.parse(localStorage.getItem(SENT_KEY) || "{}") || {};
    } catch {
      return {};
    }
  }

  function markSent(card, persist) {
    card.dataset.claudeSent = "1";
    const label = card.querySelector(".claude-sent");
    if (label) {
      label.hidden = false;
      label.dataset.claudeSent = "1";
    }
    if (!persist) return;
    try {
      const map = readSentLocal();
      map[card.dataset.id] = new Date().toISOString();
      localStorage.setItem(SENT_KEY, JSON.stringify(map));
    } catch {
      /* private mode / storage blocked — the label still shows for this visit */
    }
  }

  // Prompts are embedded in the page at build time (works on the static cloud site).
  let blocksCache = null;
  function embeddedBlock(jobId) {
    if (!blocksCache) {
      try {
        blocksCache = JSON.parse(document.getElementById("analyze-blocks")?.textContent || "{}");
      } catch {
        blocksCache = {};
      }
    }
    return blocksCache[jobId] || null;
  }

  // claude.ai/new?q= prefills the message box. Keep the link under ~14k encoded
  // characters so no server on the way rejects it (Hebrew encodes ~6x longer).
  const MAX_ENCODED = 14000;
  const CUT_NOTE =
    "\n[... posting cut here to fit the link. The full text is in the clipboard: select all, paste, send.]\n--- POSTING END ---";

  function promptForLink(block) {
    if (encodeURIComponent(block).length <= MAX_ENCODED) return { text: block, cut: false };
    const budget = MAX_ENCODED - encodeURIComponent(CUT_NOTE).length;
    let lo = 0;
    let hi = block.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (encodeURIComponent(block.slice(0, mid)).length <= budget) lo = mid;
      else hi = mid - 1;
    }
    return { text: block.slice(0, lo) + CUT_NOTE, cut: true };
  }

  function claudeUrl(text) {
    return "https://claude.ai/new?q=" + encodeURIComponent(text);
  }

  async function serverBlock(jobId) {
    const res = await fetch("/api/analyze-block", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId }),
      signal: AbortSignal.timeout(45_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.block) throw new Error(data.error || "no block");
    return { block: data.block, incomplete: Boolean(data.incomplete) };
  }

  function finish(card, jobId, entry, cut) {
    markSent(card, true);
    showToast(
      cut
        ? "Opened Claude. Long posting: full text copied, paste it over the draft"
        : entry.incomplete
          ? "Opened Claude. Description is short: check the posting itself"
          : "Opened Claude with the posting. Just press send"
    );
    // Local server keeps its own record; on the cloud site this simply fails quietly.
    fetch("/api/claude-sent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId }),
    }).catch(() => {});
  }

  function analyze(card) {
    const jobId = card.dataset.id;
    if (!jobId) return;
    const embedded = embeddedBlock(jobId);

    // Normal path: everything is in the page, so the new tab opens inside the click
    // itself (browsers block tabs opened after a network wait).
    if (embedded && !embedded.incomplete) {
      const { text, cut } = promptForLink(embedded.block);
      copyText(embedded.block); // backup copy; not awaited on purpose
      const win = window.open(claudeUrl(text), "_blank");
      if (!win) {
        openFallback(embedded.block);
        showToast("Pop-up blocked. Allow pop-ups for this site, or copy the text below");
        return;
      }
      try {
        win.opener = null;
      } catch {
        /* cross-origin: already isolated */
      }
      finish(card, jobId, embedded, cut);
      return;
    }

    // Short or missing description: open the tab now, then ask the local server
    // (if there is one) to fetch the full posting before pointing the tab at Claude.
    const btn = card.querySelector("[data-analyze]");
    if (btn) btn.disabled = true;
    const win = window.open("about:blank", "_blank");
    serverBlock(jobId)
      .catch(() => embedded)
      .then((entry) => {
        if (!entry) {
          if (win) win.close();
          showToast("No posting text for this job. Open the posting and copy it manually");
          return;
        }
        const { text, cut } = promptForLink(entry.block);
        copyText(entry.block);
        if (!win) {
          openFallback(entry.block);
          showToast("Pop-up blocked. Allow pop-ups for this site, or copy the text below");
          return;
        }
        win.location.href = claudeUrl(text);
        finish(card, jobId, entry, cut);
      })
      .finally(() => {
        if (btn) btn.disabled = false;
      });
  }

  // Restore "Sent to Claude" labels remembered in this browser.
  const sentLocal = readSentLocal();
  document.querySelectorAll(".job[data-id]").forEach((card) => {
    if (sentLocal[card.dataset.id]) markSent(card, false);
  });

  document.addEventListener("click", (e) => {
    const analyzeBtn = e.target.closest("[data-analyze]");
    if (analyzeBtn) {
      const card = analyzeBtn.closest(".job");
      if (card) analyze(card);
      return;
    }
    if (e.target.closest("#copy-fallback-select") && fallbackText) {
      fallbackText.focus();
      fallbackText.select();
      fallbackText.setSelectionRange(0, fallbackText.value.length);
      return;
    }
    if (e.target.closest("#copy-fallback-close")) {
      closeFallback();
    }
  });
})();
