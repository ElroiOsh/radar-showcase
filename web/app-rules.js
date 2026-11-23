async function load() {
  const res = await fetch("/api/rules");
  const data = await res.json();
  renderProposals(data.proposals || []);
  renderRules(data.rules || []);
  renderHidden(data.hidden || []);
  renderInsights(data.insights || []);
}

function el(id) {
  return document.getElementById(id);
}

function renderProposals(list) {
  const root = el("proposals");
  if (!list.length) {
    root.innerHTML = `<div class="empty">No proposals yet. Tag at least 3 similar “not relevant” (or relevant) jobs with the same reason.</div>`;
    return;
  }
  root.innerHTML = list
    .map((p) => {
      const warn = p.highFitUntaggedWarning
        ? `<p class="warn-box">Warning: would also affect ${p.highFitUntaggedJobIds.length} untagged high-fit job(s).</p>`
        : "";
      const kw = (p.keywords || []).length
        ? `<p class="muted">Keywords: <code>${escapeHtml(p.keywords.join(" / "))}</code></p>`
        : "";
      return `<article class="card" data-id="${escapeHtml(p.id)}">
        <strong>${escapeHtml(p.plainEnglish)}</strong>
        <p class="muted">Reason: ${escapeHtml(p.reasonId)} · Evidence: ${p.evidenceCount} tagged jobs · Predicted effect: ${p.predictedAffect} current jobs</p>
        ${kw}${warn}
        <label class="muted" for="plain-${escapeAttr(p.id)}">Edit plain English</label>
        <input type="text" class="edit-plain" id="plain-${escapeAttr(p.id)}" value="${escapeAttr(p.plainEnglish)}" />
        <label class="muted" for="kw-${escapeAttr(p.id)}">Edit keywords (comma-separated)</label>
        <input type="text" class="edit-kw" id="kw-${escapeAttr(p.id)}" value="${escapeAttr((p.keywords || []).join(", "))}" />
        <div class="row">
          <button type="button" class="primary" data-act="approve">Approve</button>
          <button type="button" data-act="reject" class="warn">Reject</button>
        </div>
      </article>`;
    })
    .join("");
}

function renderRules(list) {
  const root = el("rules");
  if (!list.length) {
    root.innerHTML = `<div class="empty">No approved rules yet.</div>`;
    return;
  }
  root.innerHTML = list
    .map(
      (r) => `<article class="card" data-id="${escapeHtml(r.id)}">
      <strong>${escapeHtml(r.plainEnglish)}</strong>
      <p class="muted">${escapeHtml(r.type)} · ${escapeHtml(r.attribute)}=${escapeHtml(r.value)} · created ${escapeHtml(
        (r.createdAt || "").slice(0, 10)
      )}</p>
      <div class="row">
        <label class="toggle"><input type="checkbox" class="rule-on" aria-label="Enable rule" ${r.enabled ? "checked" : ""}/> On</label>
        <button type="button" data-act="delete" class="warn">Delete</button>
      </div>
    </article>`
    )
    .join("");
}

function renderHidden(list) {
  const root = el("hidden");
  if (!list.length) {
    root.innerHTML = `<div class="empty">Hidden by rules (0)</div>`;
    return;
  }
  root.innerHTML =
    `<p class="muted">Hidden by rules (${list.length})</p>` +
    list
      .map(
        (h) => `<article class="card" data-job="${escapeHtml(h.jobId)}">
      <strong dir="auto">${escapeHtml(h.title)}</strong>
      <p class="muted" dir="auto">${escapeHtml(h.company)}</p>
      <p class="muted">Hidden by: ${escapeHtml(h.ruleText)}</p>
      <div class="row">
        <a href="${escapeAttr(h.url)}" target="_blank" rel="noopener">Open posting</a>
        <button type="button" data-act="show">Show anyway</button>
      </div>
    </article>`
      )
      .join("");
}

function renderInsights(list) {
  const root = el("insights");
  if (!list.length) {
    root.innerHTML = `<div class="empty">No tags in the last 30 days.</div>`;
    return;
  }
  const max = Math.max(...list.map((x) => x.count), 1);
  root.innerHTML = list
    .map(
      (x) => `<div class="bar">
      <span>${escapeHtml(x.label)}</span>
      <span class="track"><span class="fill" style="width:${Math.round((x.count / max) * 100)}%"></span></span>
      <strong>${x.count}</strong>
    </div>`
    )
    .join("");
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

document.addEventListener("click", async (e) => {
  const approve = e.target.closest('[data-act="approve"]');
  if (approve) {
    const card = approve.closest(".card");
    const plain = card.querySelector(".edit-plain")?.value?.trim();
    const kw = (card.querySelector(".edit-kw")?.value || "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    await fetch("/api/rules/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proposalId: card.dataset.id, plainEnglish: plain, keywords: kw }),
    });
    load();
    return;
  }
  const reject = e.target.closest('[data-act="reject"]');
  if (reject) {
    const card = reject.closest(".card");
    await fetch("/api/rules/reject", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proposalId: card.dataset.id }),
    });
    load();
    return;
  }
  const del = e.target.closest('[data-act="delete"]');
  if (del) {
    const card = del.closest(".card");
    await fetch("/api/rules/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: card.dataset.id }),
    });
    load();
    return;
  }
  const show = e.target.closest('[data-act="show"]');
  if (show) {
    const card = show.closest(".card");
    await fetch("/api/rules/show-anyway", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: card.dataset.job }),
    });
    load();
  }
});

document.addEventListener("change", async (e) => {
  if (!e.target.classList.contains("rule-on")) return;
  const card = e.target.closest(".card");
  await fetch("/api/rules/update", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: card.dataset.id, enabled: e.target.checked }),
  });
});

load().catch(() => {
  el("proposals").innerHTML = `<div class="empty">Could not load rules — is the server running?</div>`;
});
