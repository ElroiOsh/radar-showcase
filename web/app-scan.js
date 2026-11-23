(() => {
  const btnScan = document.getElementById("btn-scan");
  const btnAdd = document.getElementById("btn-add-job");
  const btnRescore = document.getElementById("btn-rescore");
  const statusEl = document.getElementById("scan-status");
  const extraWrap = document.getElementById("scan-extra");
  const extraInput = document.getElementById("extra-keywords");
  const addPanel = document.getElementById("add-panel");
  const addUrl = document.getElementById("add-url");
  const addText = document.getElementById("add-text");
  const addTitle = document.getElementById("add-title");
  const addCompany = document.getElementById("add-company");
  const addSave = document.getElementById("add-save");
  const addCancel = document.getElementById("add-cancel");
  const addError = document.getElementById("add-error");
  if (!btnScan || !statusEl) return;

  const pageLoadedAt = Date.now();
  let busy = false;
  let pollTimer = null;
  let watchingFinish = false;

  function setStatus(msg) {
    statusEl.textContent = msg || "";
  }

  function setBusy(on) {
    busy = on;
    btnScan.disabled = on;
    if (btnRescore) btnRescore.disabled = on;
  }

  function stopPoll() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function formatSourceResults(data) {
    const list = Array.isArray(data.sourceResults) ? data.sourceResults : [];
    if (!list.length) return "";
    const parts = list
      .filter((s) => s.name && !String(s.name).startsWith("Description"))
      .slice(0, 12)
      .map((s) => {
        const n = String(s.name).replace(/^Workday\//, "WD/").replace(/^Comeet\//, "C/");
        if (s.status === "ok") return `${n}:${s.count}`;
        return `${n}:${s.status}`;
      });
    return parts.length ? ` · ${parts.join(" · ")}` : "";
  }

  async function fetchStatus() {
    const res = await fetch("/api/scan/status", { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Status failed");
    return data;
  }

  function maybeReloadForNewResults(data) {
    const finishedAt = Number(data.lastFinishedAt || 0);
    if (finishedAt && finishedAt > pageLoadedAt - 2000) {
      const issues = (data.sourceResults || [])
        .filter((s) => s.status === "timeout" || s.status === "failed")
        .map((s) => s.name);
      setStatus(
        `Done — ${data.lastTotal ?? "?"} jobs${formatSourceResults(data)}${
          issues.length ? ` · issues: ${issues.slice(0, 4).join(", ")}` : ""
        }${data.timedOut ? " · hard limit" : ""}. Reloading…`
      );
      stopPoll();
      setTimeout(() => location.reload(), 600);
      return true;
    }
    return false;
  }

  function startWatching() {
    watchingFinish = true;
    stopPoll();
    pollTimer = setInterval(async () => {
      try {
        const data = await fetchStatus();
        if (data.running) {
          setBusy(true);
          setStatus(
            data.message ||
              (data.currentSource
                ? `Fetching ${data.currentSource}…`
                : "Searching boards…")
          );
          return;
        }
        if (watchingFinish && maybeReloadForNewResults(data)) return;
        watchingFinish = false;
        stopPoll();
        applyIdleStatus(data);
      } catch {
        setStatus("Lost connection to RADAR server");
      }
    }, 2500);
  }

  function applyIdleStatus(data) {
    if (data.running) {
      setBusy(true);
      setStatus(data.message || "Scan running…");
      startWatching();
      return;
    }
    setBusy(false);
    if (data.cooldownMs > 0) {
      const secs = Math.ceil(data.cooldownMs / 1000);
      setStatus(
        `Last scan ${data.lastFinishedLabel || ""} · ${data.lastTotal ?? "?"} jobs · cooldown ${secs}s`
      );
      return;
    }
    if (data.lastFinishedLabel) {
      setStatus(
        `Last scan ${data.lastFinishedLabel}${
          data.lastTotal != null ? ` · ${data.lastTotal} jobs` : ""
        }${formatSourceResults(data)}`
      );
    } else {
      setStatus("Ready to search");
    }
  }

  async function refreshScanMeta() {
    try {
      const data = await fetchStatus();
      if (data.running) {
        setBusy(true);
        setStatus(data.message || "Scan running…");
        startWatching();
        return;
      }
      if (maybeReloadForNewResults(data)) return;
      applyIdleStatus(data);
    } catch {
      // Cloud site: no scan server here — scans run on a schedule.
      setStatus("Cloud: new jobs are searched automatically 4 times a day");
      setBusy(true);
    }
  }

  async function runScan(opts) {
    if (busy && !opts.forceRescore) return;
    setBusy(true);
    setStatus("Starting search…");
    if (extraWrap) extraWrap.hidden = false;
    watchingFinish = true;
    try {
      const body = {
        forceRescore: false,
        wait: false,
        extraKeywords: String(extraInput?.value || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      };
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 429) {
        setStatus(data.error || "Cooldown active");
        setBusy(false);
        if (maybeReloadForNewResults(data)) return;
        startWatching();
        return;
      }
      if (!res.ok && res.status !== 202) {
        throw new Error(data.error || data.message || "Scan failed");
      }
      setStatus(
        data.alreadyRunning
          ? "Scan already running… waiting for results"
          : "Searching… hard limit 20 min. Status updates live."
      );
      startWatching();
    } catch (err) {
      setStatus(err && err.message ? err.message : String(err));
      setBusy(false);
      watchingFinish = false;
      refreshScanMeta();
    }
  }

  btnScan.addEventListener("click", () => {
    if (extraWrap) extraWrap.hidden = false;
    runScan({ forceRescore: false });
  });

  if (btnRescore) {
    btnRescore.hidden = true;
  }

  if (btnAdd && addPanel) {
    btnAdd.addEventListener("click", () => {
      addPanel.hidden = !addPanel.hidden;
      if (addError) addError.textContent = "";
    });
  }
  if (addCancel && addPanel) {
    addCancel.addEventListener("click", () => {
      addPanel.hidden = true;
    });
  }
  if (addSave) {
    addSave.addEventListener("click", async () => {
      if (addError) addError.textContent = "";
      addSave.disabled = true;
      try {
        const res = await fetch("/api/jobs/add", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: addUrl?.value?.trim() || undefined,
            text: addText?.value?.trim() || undefined,
            title: addTitle?.value?.trim() || undefined,
            company: addCompany?.value?.trim() || undefined,
          }),
          signal: AbortSignal.timeout(180_000),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Add failed");
        setStatus(`Added “${data.job?.title || "job"}” · reloading…`);
        setTimeout(() => location.reload(), 700);
      } catch (err) {
        if (addError) addError.textContent = err.message || String(err);
      } finally {
        addSave.disabled = false;
      }
    });
  }

  refreshScanMeta();
  setInterval(() => {
    if (watchingFinish || busy) return;
    refreshScanMeta();
  }, 20_000);
})();
