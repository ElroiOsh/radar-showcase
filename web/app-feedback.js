(() => {
  const sheet = document.getElementById("tag-sheet");
  const backdrop = document.getElementById("sheet-backdrop");
  const chipsEl = document.getElementById("sheet-chips");
  const jobEl = document.getElementById("sheet-job");
  const noteEl = document.getElementById("sheet-note");
  const noteWrap = document.getElementById("sheet-note-wrap");
  const noteLabel = document.getElementById("sheet-note-label");
  const errEl = document.getElementById("sheet-error");
  const titleEl = document.getElementById("sheet-title");
  const saveBtn = document.getElementById("sheet-save");
  const clearBtn = document.getElementById("sheet-clear");
  const learnPanel = document.getElementById("learn-panel");
  const suggestionsEl = document.getElementById("suggestions");
  const approvedEl = document.getElementById("approved-filters");
  if (!sheet || !backdrop || !chipsEl || !saveBtn) return;

  const FALLBACK_REJECT = [
    { id: "location", label: "Location" },
    { id: "wrong_role", label: "Wrong role" },
    { id: "seniority", label: "Seniority" },
    { id: "missing_requirement", label: "Missing requirement" },
    { id: "company_industry", label: "Company / industry" },
    { id: "other", label: "Other" },
  ];

  let rejectReasons = FALLBACK_REJECT;
  let active = null;
  let selected = new Set();
  let returnFocus = null;
  let currentFilter = "untagged";

  async function loadReasons() {
    try {
      const res = await fetch("/api/meta/reasons");
      const data = await res.json();
      if (Array.isArray(data.reject) && data.reject.length) {
        rejectReasons = data.reject;
      } else if (Array.isArray(data.rejectGroups) && data.rejectGroups[0]?.reasons?.length) {
        rejectReasons = data.rejectGroups.flatMap((g) => g.reasons || []);
      }
    } catch {
      /* keep fallback */
    }
  }

  function fingerprint(company, title) {
    return `${company || ""} ${title || ""}`
      .toLowerCase()
      .replace(/[^a-z0-9\u0590-\u05ff]+/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function hasExistingTag(card) {
    const t = card?.dataset?.tag;
    return t === "relevant" || t === "not_relevant" || t === "applied" || t === "closed";
  }

  function setCardTag(card, verdict) {
    const tag =
      verdict === "relevant"
        ? "relevant"
        : verdict === "not_relevant"
          ? "not_relevant"
          : verdict === "applied"
            ? "applied"
            : verdict === "closed"
              ? "closed"
              : "untagged";
    card.dataset.tag = tag;
    card.querySelectorAll(".tag-btn").forEach((btn) => {
      const on = btn.dataset.verdict === verdict;
      btn.classList.toggle("is-on", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
    const state = card.querySelector(".tag-state");
    if (state) {
      if (verdict === "relevant") {
        state.textContent = "Tagged relevant";
        state.dataset.empty = "0";
      } else if (verdict === "not_relevant") {
        state.textContent = "Tagged not relevant";
        state.dataset.empty = "0";
      } else if (verdict === "applied") {
        state.textContent = "Tagged applied";
        state.dataset.empty = "0";
      } else if (verdict === "closed") {
        state.textContent = "Closed";
        state.dataset.empty = "0";
      } else {
        state.textContent = "";
        state.dataset.empty = "1";
      }
    }
  }

  function applyFilter(filter) {
    currentFilter = filter;
    document.querySelectorAll(".filter-btn").forEach((b) => {
      const on = b.dataset.filter === filter;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    document.querySelectorAll(".job").forEach((card) => {
      const tag = card.dataset.tag || "untagged";
      let show = tag === filter;
      if (filter === "blocked_strong") show = card.dataset.blockedStrong === "1";
      // Closed postings never appear in New (or any tab)
      if (tag === "closed") show = false;
      card.classList.toggle("is-filter-hidden", !show);
    });
    refreshCounts();
  }

  function refreshCounts() {
    const counts = { untagged: 0, relevant: 0, applied: 0, not_relevant: 0 };
    document.querySelectorAll(".job").forEach((card) => {
      const tag = card.dataset.tag || "untagged";
      if (tag === "closed") return;
      if (counts[tag] !== undefined) counts[tag] += 1;
    });
    document.querySelectorAll("[data-count-for]").forEach((el) => {
      const key = el.getAttribute("data-count-for");
      el.textContent = String(counts[key] ?? 0);
    });
  }

  function syncNoteVisibility() {
    const needNote = selected.has("other");
    if (noteWrap) noteWrap.hidden = !needNote;
    if (noteLabel) noteLabel.textContent = "Note (optional)";
    if (noteEl) {
      noteEl.required = false;
      noteEl.placeholder = "Optional detail";
    }
  }

  function renderChips() {
    chipsEl.innerHTML = rejectReasons
      .map((r) => {
        const on = selected.has(r.id);
        return `<button type="button" class="chip${on ? " is-on" : ""}" data-id="${r.id}" aria-pressed="${
          on ? "true" : "false"
        }" dir="auto">${r.label}</button>`;
      })
      .join("");
    syncNoteVisibility();
  }

  function openSheet(card) {
    active = { card, verdict: "not_relevant" };
    selected = new Set();
    returnFocus = document.activeElement;
    if (noteEl) noteEl.value = "";
    if (errEl) errEl.textContent = "";
    if (titleEl) titleEl.textContent = "Why not relevant?";
    if (jobEl) jobEl.textContent = `${card.dataset.title || ""} · ${card.dataset.company || ""}`;
    renderChips();
    if (clearBtn) clearBtn.hidden = !hasExistingTag(card);
    sheet.hidden = false;
    backdrop.hidden = false;
    requestAnimationFrame(() => {
      sheet.classList.add("is-open");
      backdrop.classList.add("is-open");
      const first = chipsEl.querySelector(".chip");
      (first || saveBtn)?.focus();
    });
  }

  function closeSheet() {
    sheet.classList.remove("is-open");
    backdrop.classList.remove("is-open");
    setTimeout(() => {
      sheet.hidden = true;
      backdrop.hidden = true;
      active = null;
      if (returnFocus && typeof returnFocus.focus === "function") returnFocus.focus();
      returnFocus = null;
    }, 200);
  }

  async function postTag(card, verdict, reasons, note) {
    const res = await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobId: card.dataset.id,
        verdict,
        reasons: reasons || [],
        note: note || undefined,
        title: card.dataset.title,
        company: card.dataset.company,
        location: card.dataset.location,
        source: card.dataset.source,
        url: card.dataset.url,
        fingerprint: fingerprint(card.dataset.company, card.dataset.title),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Save failed");
    return data;
  }

  async function saveQuick(card, verdict) {
    try {
      await postTag(card, verdict, []);
      setCardTag(card, verdict);
      inheritFingerprint(card, verdict);
      applyFilter(currentFilter);
      loadLearnPanel();
    } catch (err) {
      console.error(err);
      alert(err.message || "Could not save tag");
    }
  }

  function inheritFingerprint(sourceCard, verdict) {
    const fp = fingerprint(sourceCard.dataset.company, sourceCard.dataset.title);
    if (!fp) return;
    document.querySelectorAll(".job").forEach((card) => {
      if (card === sourceCard) return;
      if (fingerprint(card.dataset.company, card.dataset.title) === fp) {
        setCardTag(card, verdict);
      }
    });
  }

  async function saveTag() {
    if (!active) return;
    const { card, verdict } = active;
    if (verdict === "not_relevant" && selected.size === 0) {
      errEl.textContent = "Pick at least one reason";
      return;
    }
    errEl.textContent = "";
    saveBtn.disabled = true;
    try {
      const note = selected.has("other") ? noteEl?.value?.trim() : undefined;
      await postTag(card, verdict, [...selected], note);
      setCardTag(card, verdict);
      inheritFingerprint(card, verdict);
      closeSheet();
      applyFilter(currentFilter);
      loadLearnPanel();
    } catch (err) {
      console.error(err);
      errEl.textContent = err.message || "Save failed";
    } finally {
      saveBtn.disabled = false;
    }
  }

  async function clearTag() {
    if (!active) return;
    const { card } = active;
    try {
      const res = await fetch("/api/feedback", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: card.dataset.id }),
      });
      if (!res.ok) {
        errEl.textContent = "Could not remove tag";
        return;
      }
      setCardTag(card, null);
      closeSheet();
      applyFilter(currentFilter);
      loadLearnPanel();
    } catch (err) {
      console.error(err);
      errEl.textContent = "Network error";
    }
  }

  async function hydrateTags() {
    try {
      const res = await fetch("/api/feedback");
      const data = await res.json();
      const entries = Array.isArray(data?.entries) ? data.entries : [];
      const byId = new Map();
      const byFp = new Map();
      for (const e of entries) {
        if (!e?.jobId || !e.verdict) continue;
        byId.set(e.jobId, e);
        const fp = e.fingerprint || fingerprint(e.company, e.title);
        if (fp) byFp.set(fp, e);
      }
      document.querySelectorAll(".job").forEach((card) => {
        const e =
          byId.get(card.dataset.id) ||
          byFp.get(fingerprint(card.dataset.company, card.dataset.title));
        if (e) setCardTag(card, e.verdict);
      });
    } catch (err) {
      console.error("Hydrate tags failed", err);
    }
    applyFilter(currentFilter);
  }

  async function loadLearnPanel() {
    if (!learnPanel || !suggestionsEl || !approvedEl) return;
    try {
      const res = await fetch("/api/rules");
      const data = await res.json();
      const proposals = (data.proposals || []).filter((p) => p.status === "open");
      const rules = data.rules || [];
      const show = proposals.length > 0 || rules.length > 0;
      learnPanel.hidden = !show;

      suggestionsEl.innerHTML = proposals.length
        ? proposals
            .map(
              (p) => `<article class="suggestion" data-id="${escapeAttr(p.id)}">
            <strong>${p.type === "boost" ? "Boost jobs like this?" : "Hide jobs like this?"}</strong>
            <span>${escapeHtml(p.plainEnglish)}</span>
            <div class="row">
              <button type="button" class="primary" data-act="approve">Approve</button>
              <button type="button" data-act="reject">Dismiss</button>
            </div>
          </article>`
            )
            .join("")
        : `<p class="muted">No suggestions yet. Tag similar “not relevant” jobs 3+ times (missing requirement: 2).</p>`;

      approvedEl.innerHTML = rules.length
        ? rules
            .map(
              (r) => `<article class="suggestion" data-id="${escapeAttr(r.id)}">
            <strong>${escapeHtml(r.plainEnglish)}</strong>
            <div class="row">
              <label><input type="checkbox" class="rule-on" ${r.enabled ? "checked" : ""}/> On</label>
              <button type="button" data-act="delete">Remove</button>
            </div>
          </article>`
            )
            .join("")
        : `<p class="muted">No approved filters.</p>`;
    } catch (err) {
      console.error(err);
    }
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, "&#39;");
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && active) {
      e.preventDefault();
      closeSheet();
    }
  });

  document.addEventListener("click", (e) => {
    const filterBtn = e.target.closest(".filter-btn");
    if (filterBtn) {
      applyFilter(filterBtn.dataset.filter);
      return;
    }

    const chip = e.target.closest(".chip");
    if (chip && sheet.contains(chip)) {
      const id = chip.dataset.id;
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      const on = selected.has(id);
      chip.classList.toggle("is-on", on);
      chip.setAttribute("aria-pressed", on ? "true" : "false");
      if (selected.size > 0) errEl.textContent = "";
      syncNoteVisibility();
      return;
    }

    const tagBtn = e.target.closest(".tag-btn");
    if (tagBtn) {
      const card = tagBtn.closest(".job");
      if (!card) return;
      const verdict = tagBtn.dataset.verdict;
      if (card.dataset.tag === verdict) {
        fetch("/api/feedback", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId: card.dataset.id }),
        })
          .then((r) => {
            if (!r.ok) throw new Error("Could not remove tag");
            setCardTag(card, null);
            applyFilter(currentFilter);
            loadLearnPanel();
          })
          .catch((err) => alert(err.message || "Could not remove tag"));
        return;
      }
      if (verdict === "not_relevant") openSheet(card);
      else saveQuick(card, verdict); // relevant + applied: one tap
      return;
    }

    if (e.target.closest("#sheet-cancel") || e.target === backdrop) {
      closeSheet();
      return;
    }
    if (e.target.closest("#sheet-save")) {
      saveTag();
      return;
    }
    if (e.target.closest("#sheet-clear")) {
      clearTag();
      return;
    }

    const sug = e.target.closest(".suggestion");
    if (sug && learnPanel && learnPanel.contains(sug)) {
      const id = sug.dataset.id;
      const act = e.target.closest("[data-act]")?.dataset.act;
      const toggle = e.target.closest(".rule-on");
      if (toggle) {
        fetch("/api/rules/update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, enabled: toggle.checked }),
        }).then(loadLearnPanel);
        return;
      }
      if (act === "approve") {
        fetch("/api/rules/approve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ proposalId: id }),
        }).then(loadLearnPanel);
      } else if (act === "reject") {
        fetch("/api/rules/reject", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ proposalId: id }),
        }).then(loadLearnPanel);
      } else if (act === "delete") {
        fetch("/api/rules/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        }).then(loadLearnPanel);
      }
    }
  });

  loadReasons();
  hydrateTags();
  loadLearnPanel();
})();
