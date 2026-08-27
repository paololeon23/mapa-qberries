/** API + almacenamiento local offline · Q Berries */
(function () {
  const QUEUE_KEY = "qb-api-queue";
  const LOCAL_KEY = "qb-labores";
  const HISTORY_KEY = "qb-mobile-history";

  function apiUrl() {
    return (window.QB_CONFIG && QB_CONFIG.API_URL) || "";
  }

  function getQueue() {
    try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]"); } catch { return []; }
  }

  function saveQueue(q) {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  }

  function getLocalRecords() {
    try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || "{}"); } catch { return {}; }
  }

  function saveLocalRecords(all) {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(all));
  }

  function getHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); } catch { return []; }
  }

  function saveHistory(list) {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 300)));
  }

  function roundHa(v) {
    const n = parseFloat(v);
    if (isNaN(n) || n < 0) return 0;
    return Math.round(n * 100) / 100;
  }

  function normalizeRecord(record) {
    let area = roundHa(record.area);
    let avance = roundHa(record.avance);
    if (area > 0 && avance > area) avance = area;
    return {
      posKey: record.posKey,
      sem: Number(record.sem) || "",
      fecha: record.fecha || "",
      laborPpto: String(record.laborPpto || "").toUpperCase(),
      laborReal: String(record.laborReal || "").toUpperCase(),
      modulo: String(record.modulo || "").toUpperCase(),
      turno: String(record.turno || "").toUpperCase(),
      lote: Number(record.lote),
      variedad: record.variedad || "SEKOYA POP",
      area,
      avance,
      totalJr: Number(record.totalJr) || 0,
      localId: record.localId || ("qb_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8))
    };
  }

  function saveLocal(record, synced) {
    const rec = normalizeRecord(record);
    const all = getLocalRecords();
    all[rec.posKey] = Object.assign({}, rec, {
      savedAt: Date.now(),
      synced: !!synced
    });
    saveLocalRecords(all);

    const history = getHistory();
    history.unshift(Object.assign({}, rec, {
      id: Date.now(),
      savedAt: Date.now(),
      synced: !!synced
    }));
    saveHistory(history);
    return rec;
  }

  function markHistorySynced(posKey, ts) {
    const history = getHistory().map(h => {
      if (h.posKey === posKey && (!ts || h.savedAt === ts)) {
        return Object.assign({}, h, { synced: true });
      }
      return h;
    });
    saveHistory(history);
    const all = getLocalRecords();
    if (all[posKey]) {
      all[posKey].synced = true;
      saveLocalRecords(all);
    }
  }

  async function postLabor(payload) {
    const url = apiUrl();
    if (!url) return { ok: true, local: true };

    const body = {
      action: "guardar",
      data: payload,
      token: (window.QB_CONFIG && QB_CONFIG.API_TOKEN) || ""
    };

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body)
    });
    return res.json();
  }

  async function getLabors(filters = {}) {
    const url = apiUrl();
    if (!url) return null;
    const params = new URLSearchParams({ action: "get" });
    if (filters.sem != null) params.set("sem", filters.sem);
    if (filters.laborReal) params.set("laborReal", filters.laborReal);
    if (filters.modulo) params.set("modulo", filters.modulo);
    const token = (window.QB_CONFIG && QB_CONFIG.API_TOKEN) || "";
    if (token) params.set("token", token);
    const res = await fetch(url + "?" + params.toString());
    return res.json();
  }

  async function saveLabor(record) {
    const payload = normalizeRecord(record);
    const savedAt = Date.now();

    // Siempre guardar local primero (funciona sin internet)
    saveLocal(payload, false);

    if (!apiUrl()) {
      return { ok: true, local: true, savedAt };
    }

    if (!navigator.onLine) {
      const q = getQueue();
      q.push({ ts: savedAt, payload });
      saveQueue(q);
      return { ok: true, queued: true, savedAt };
    }

    try {
      const res = await postLabor(payload);
      if (!res.ok) throw new Error(res.message || res.error || "Error al guardar");
      markHistorySynced(payload.posKey, savedAt);
      return Object.assign({ ok: true, synced: true, savedAt }, res);
    } catch (err) {
      const q = getQueue();
      q.push({ ts: savedAt, payload });
      saveQueue(q);
      return { ok: true, queued: true, savedAt, error: String(err.message || err) };
    }
  }

  async function flushQueue() {
    if (!apiUrl() || !navigator.onLine) return 0;
    const q = getQueue();
    if (!q.length) return 0;
    const pending = [];
    let sent = 0;
    for (const item of q) {
      try {
        const res = await postLabor(item.payload);
        if (res.ok) {
          sent++;
          markHistorySynced(item.payload.posKey, item.ts);
        } else {
          pending.push(item);
        }
      } catch {
        pending.push(item);
      }
    }
    saveQueue(pending);
    return sent;
  }

  function queueCount() {
    return getQueue().length;
  }

  function pendingHistoryCount() {
    return getHistory().filter(h => !h.synced).length;
  }

  window.QBApi = {
    postLabor,
    getLabors,
    saveLabor,
    flushQueue,
    queueCount,
    getHistory,
    getLocalRecords,
    saveLocal,
    pendingHistoryCount,
    hasApi: () => !!apiUrl()
  };

  window.addEventListener("online", () => {
    flushQueue().then(n => {
      if (n > 0 && window.QB_onQueueFlushed) window.QB_onQueueFlushed(n);
      if (window.QB_onStatusChange) window.QB_onStatusChange();
    });
  });
})();
