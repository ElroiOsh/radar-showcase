(() => {
  const hint = document.getElementById("serve-hint");
  const newList = document.getElementById("job-list-new");
  const ratedList = document.getElementById("job-list-rated");
  const panelNew = document.getElementById("panel-new");
  const panelRated = document.getElementById("panel-rated");
  const tabNew = document.getElementById("tab-new");
  const tabRated = document.getElementById("tab-rated");
  const overlay = document.getElementById("scan-overlay");
  const scanStatus = document.getElementById("scan-status");
  const btnScan = document.getElementById("btn-scan");
  const btnDismiss = document.getElementById("btn-dismiss-scan");
  const heroLead = document.getElementById("hero-lead");
  const LS_KEY = "radar-feedback-v1";
  const feedbackUrl = "/api/feedback";

  let scanning = false;
  let REASON_LABELS = {};
  try {
    const raw = document.getElementById("radar-reasons");
    if (raw) REASON_LABELS = JSON.parse(raw.textContent || "{}");
  } catch {
    REASON_LABELS = {};
  }

  function labelReasons(reasons) {
    return (reasons || []).map((r) => REASON_LABELS[r] || r);
  }

  function loadLocalFeedback() {
    try {
      return JSON.parse(localStorage.getItem(LS_KEY) || "[]");
    } catch {
      return [];
    }
  }

  function saveLocalFeedback(entry) {
    const all = loadLocalFeedback().filter((e) => e.jobId !== entry.jobId);
    all.unshift(entry);
    localStorage.setItem(LS_KEY, JSON.stringify(all.slice(0, 200)));
  }

  function jobFromArticle(article) {
    const node = article.querySelector(".job-json");
    try {
      return JSON.parse(node ? node.textContent || "{}" : "{}");
    } catch {
      return { id: article.dataset.id, title: article.querySelector("h3")?.innerText || "", url: article.querySelector("a")?.href || "" };
    }
  }

  function showStatus(article, text) {
    const status = article.querySelector(".fb-status");
    if (!status) return;
    status.hidden = false;
    status.textContent = text;
  }

  function ensureEmpty(listEl, id, message) {
    if (!listEl) return;
    if (listEl.querySelector(".job")) {
      listEl.querySelector(".empty")?.remove();
      return;
    }
    if (!listEl.querySelector(".empty")) {
      const d = document.createElement("div");
      d.className = "empty";
      d.id = id;
      d.textContent = message;
      listEl.appendChild(d);
    }
  }

  function updateCounts() {
    const n = newList.querySelectorAll(".job").length;
    const r = ratedList.querySelectorAll(".job").length;
    const cn = document.getElementById("count-new");
    const cr = document.getElementById("count-rated");
    const sn = document.getElementById("stat-new");
    const sr = document.getElementById("stat-rated");
    if (cn) cn.textContent = "(" + n + ")";
    if (cr) cr.textContent = "(" + r + ")";
    if (sn) sn.textContent = String(n);
    if (sr) sr.textContent = String(r);
    ensureEmpty(newList, "empty-new", "No new unrated jobs. Check Rated / viewed.");
    ensureEmpty(ratedList, "empty-rated", "No rated jobs yet.");
  }

  function setRatedBadge(article, verdict, reasons) {
    const meta = article.querySelector(".job-meta");
    if (!meta) return;
    let badge = meta.querySelector(".tag-rated");
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "tag-rated";
      meta.appendChild(badge);
    }
    badge.className = "tag-rated " + (verdict === "relevant" ? "yes" : "no");
    const labels = (reasons || []).join(", ");
    badge.textContent =
      (verdict === "relevant" ? "Relevant" : "Not relevant") + (labels ? " · " + labels : "");
  }

  function selectTab(which) {
    const isNew = which === "new";
    tabNew?.setAttribute("aria-selected", String(isNew));
    tabRated?.setAttribute("aria-selected", String(!isNew));
    if (panelNew) panelNew.hidden = !isNew;
    if (panelRated) panelRated.hidden = isNew;
  }

  function hideOverlay() {
    if (overlay) overlay.hidden = true;
    scanning = false;
  }

  function moveToRated(article, verdict, reasons, animate) {
    const finish = () => {
      article.classList.remove("leaving");
      article.dataset.feedback = verdict;
      article.dataset.list = "rated";
      setRatedBadge(article, verdict, labelReasons(reasons));
      article.querySelectorAll(".fb").forEach((b) => {
        b.setAttribute("aria-pressed", String(b.getAttribute("data-verdict") === verdict));
      });
      const status = article.querySelector(".fb-status");
      if (status) {
        status.hidden = true;
        status.textContent = "";
      }
      ratedList.prepend(article);
      updateCounts();
    };
    if (animate) {
      article.classList.add("leaving");
      setTimeout(finish, 220);
    } else {
      finish();
    }
  }

  function openReasonPanel(article, verdict) {
    const panel = article.querySelector(".reason-panel");
    if (!panel) return;
    panel.hidden = false;
    panel.dataset.kind = verdict;
    const reject = panel.querySelector(".reject-reasons");
    const accept = panel.querySelector(".accept-reasons");
    if (reject) reject.hidden = verdict !== "not_relevant";
    if (accept) accept.hidden = verdict !== "relevant";
    const title = panel.querySelector(".reason-title");
    if (title) {
      title.textContent =
        verdict === "not_relevant"
          ? "Why is this not relevant? (pick one or more)"
          : "Why is this relevant? (optional — pick any)";
    }
    showStatus(article, "Pick why, then Save");
  }

  function selectedReasons(panel, kind) {
    const box = panel.querySelector(kind === "not_relevant" ? ".reject-reasons" : ".accept-reasons");
    if (!box) return [];
    return [...box.querySelectorAll("input:checked")].map((i) => i.value);
  }

  async function postFeedback(article, verdict, reasons) {
    const job = jobFromArticle(article);
    const payload = {
      jobId: job.id || article.dataset.id,
      verdict,
      reasons,
      job,
      title: job.title,
      company: job.company,
      location: job.location,
      source: job.source,
      url: job.url,
      updatedAt: new Date().toISOString(),
    };
    saveLocalFeedback(payload);
    try {
      await fetch(feedbackUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      /* local copy is enough */
    }
  }

  function restoreKeptCard(e) {
    if (e.verdict !== "relevant") return null;
    const job = e.job || e;
    if (!job || !job.title || !(job.url || e.url)) return null;
    const id = String(e.jobId || job.id || "");
    if (!id || document.querySelector('.job[data-id="' + CSS.escape(id) + '"]')) return null;

    const article = document.createElement("article");
    article.className = "job";
    article.dataset.id = id;
    article.dataset.feedback = "relevant";
    article.dataset.list = "rated";

    const json = document.createElement("script");
    json.type = "application/json";
    json.className = "job-json";
    json.textContent = JSON.stringify({
      id,
      source: job.source || e.source || "Saved",
      title: job.title,
      company: job.company || "",
      location: job.location || "",
      description: job.description || "",
      url: job.url || e.url,
    });

    article.innerHTML =
      '<header class="job-head"><div class="job-meta"><span class="src"></span>' +
      '<span class="tag-rated yes">Relevant · saved</span></div>' +
      "<h3><a target=\"_blank\" rel=\"noopener noreferrer\"></a></h3>" +
      '<p class="company"></p></header>' +
      '<div class="job-actions"><a class="job-cta" target="_blank" rel="noopener noreferrer">Open saved job →</a></div>';

    article.querySelector(".src").textContent = job.source || e.source || "Saved";
    const link = article.querySelector("h3 a");
    link.href = job.url || e.url;
    link.textContent = job.title;
    article.querySelector(".company").textContent = (job.company || "") + " · " + (job.location || "");
    article.querySelector(".job-cta").href = job.url || e.url;
    article.prepend(json);
    ratedList.prepend(article);
    return article;
  }

  function applyLocalRatings() {
    loadLocalFeedback().forEach((e) => {
      let article = document.querySelector('.job[data-id="' + CSS.escape(e.jobId) + '"]');
      if (!article && e.verdict === "relevant") article = restoreKeptCard(e);
      if (!article) return;
      if (article.dataset.list === "rated") {
        setRatedBadge(article, e.verdict, labelReasons(e.reasons || []));
        return;
      }
      moveToRated(article, e.verdict, e.reasons || [], false);
    });
    selectTab("new");
    updateCounts();
  }

  async function apiAvailable() {
    try {
      const res = await fetch("/api/health", { signal: AbortSignal.timeout(2500) });
      const data = await res.json();
      return res.ok && data && data.ok;
    } catch {
      return false;
    }
  }

  let userIsRating = false;

  async function startScan(reason) {
    if (scanning) return;
    const live = await apiAvailable();
    if (!live) {
      if (hint) hint.textContent = "This page is a saved snapshot. Open http://localhost:8787 on the PC to search live.";
      return;
    }
    scanning = true;
    const showOverlay = reason === "button";
    if (showOverlay && overlay) overlay.hidden = false;
    if (scanStatus) scanStatus.textContent = "Searching LinkedIn, JobMaster, Drushim…";
    if (hint) hint.textContent = "Scanning job boards… ratings still work while this runs.";
    try {
      const res = await fetch("/api/scan", { method: "POST", signal: AbortSignal.timeout(180000) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Scan failed");
      if (userIsRating && reason !== "button") {
        if (hint) hint.textContent = "Scan finished in the background. Click Search now when you want the new list.";
        return;
      }
      if (newList) newList.innerHTML = data.newHtml || "";
      if (ratedList) ratedList.innerHTML = data.ratedHtml || "";
      applyLocalRatings();
      if (heroLead) {
        heroLead.textContent =
          "Smart Manufacturing, systems, engineering leadership — Center & Shfela. Updated " +
          (data.dateLabel || "just now") +
          ".";
      }
      if (hint) {
        hint.textContent =
          "Scan done — " + data.totalCount + " in shortlist (" + data.newCount + " newly seen).";
      }
    } catch (err) {
      if (hint) hint.textContent = "Scan failed: " + (err && err.message ? err.message : err);
    } finally {
      hideOverlay();
    }
  }

  document.addEventListener("click", (ev) => {
    const t = ev.target;
    if (!(t instanceof Element)) return;

    if (t.closest("#tab-new")) {
      selectTab("new");
      return;
    }
    if (t.closest("#tab-rated")) {
      selectTab("rated");
      return;
    }
    if (t.closest("#btn-scan")) {
      startScan("button");
      return;
    }
    if (t.closest("#btn-dismiss-scan")) {
      hideOverlay();
      return;
    }

    const article = t.closest("article.job");
    if (!article) return;

    const fb = t.closest(".fb");
    if (fb) {
      userIsRating = true;
      openReasonPanel(article, fb.getAttribute("data-verdict"));
      article.querySelectorAll(".fb").forEach((b) => {
        b.setAttribute("aria-pressed", String(b.getAttribute("data-verdict") === fb.getAttribute("data-verdict")));
      });
      return;
    }
    if (t.closest(".reason-cancel")) {
      const panel = article.querySelector(".reason-panel");
      if (panel) panel.hidden = true;
      return;
    }
    if (t.closest(".reason-save")) {
      const panel = article.querySelector(".reason-panel");
      if (!panel) return;
      const verdict = panel.dataset.kind;
      const reasons = selectedReasons(panel, verdict);
      if (verdict === "not_relevant" && reasons.length === 0) {
        showStatus(article, "Pick at least one reason");
        return;
      }
      postFeedback(article, verdict, reasons).then(() => {
        panel.hidden = true;
        moveToRated(article, verdict, reasons, true);
        if (hint) hint.textContent = "Saved — card left New. Still browsing unrated jobs.";
      });
    }
  });

  applyLocalRatings();

  apiAvailable().then(async (ok) => {
    if (!ok) {
      if (hint) hint.textContent = "Snapshot mode. Relevant / Not relevant still work on this device. For live search open http://localhost:8787";
      return;
    }
    if (hint) hint.textContent = "Live. Rate jobs below, or click Search now to scan boards.";
    const all = loadLocalFeedback();
    for (const e of all) {
      try {
        await fetch(feedbackUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(e),
        });
      } catch {
        /* ignore */
      }
    }
    startScan("refresh");
  });
})();
