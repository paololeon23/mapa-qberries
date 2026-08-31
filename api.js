/** API + almacenamiento local offline · Q Berries (capa segura) */
(function () {
  const QUEUE_KEY = "qb-api-queue";
  const LOCAL_KEY = "qb-labores";
  const HISTORY_KEY = "qb-mobile-history";
  const HISTORY_TTL_MS = 48 * 60 * 60 * 1000;
  const inflight = new Map();
  const MAX_BATCH = () => Math.min(80, Number((window.QB_CONFIG && QB_CONFIG.MAX_BATCH) || 40) || 40);

  function newClientId() {
    try {
      if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return "qb_" + crypto.randomUUID().replace(/-/g, "");
      }
    } catch (e) { /* fall through */ }
    return "qb_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 12);
  }

  function apiUrl() {
    return (window.QB_CONFIG && QB_CONFIG.API_URL) || "";
  }

  function apiToken() {
    return String((window.QB_CONFIG && QB_CONFIG.API_TOKEN) || "");
  }

  function laborAllow() {
    const cfg = window.QB_CONFIG && QB_CONFIG.LABOR_OPTS;
    const list = (cfg && cfg.labor_real) || [];
    return list.map(x => String(x).toUpperCase().trim());
  }

  function getQueue() {
    try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]"); } catch { return []; }
  }

  function saveQueue(q) {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(0, 200)));
  }

  function getLocalRecords() {
    try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || "{}"); } catch { return {}; }
  }

  function saveLocalRecords(all) {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(all));
  }

  function pruneHistory(list) {
    const now = Date.now();
    return (list || []).filter(h => {
      if (!h || !h.synced) return true;
      const t = Number(h.savedAt) || 0;
      return now - t < HISTORY_TTL_MS;
    }).slice(0, 300);
  }

  function getHistory() {
    try {
      const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
      const pruned = pruneHistory(raw);
      if (pruned.length !== raw.length) {
        try { localStorage.setItem(HISTORY_KEY, JSON.stringify(pruned)); } catch (e) { /* ok */ }
      }
      return pruned;
    } catch {
      return [];
    }
  }

  function saveHistory(list) {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(pruneHistory(list)));
  }

  function roundHa(v) {
    const n = parseFloat(String(v ?? "").replace(",", "."));
    if (isNaN(n) || n < 0) return 0;
    return Math.round(n * 100) / 100;
  }

  function safeText(v, max) {
    let s = String(v || "").trim().toUpperCase().slice(0, max || 80);
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    return s.replace(/[\u0000-\u001f\u007f]/g, "");
  }

  function fingerprint(rec) {
    return [
      String(rec.sem || ""),
      String(rec.turno || "").toUpperCase(),
      String(rec.lote || ""),
      String(rec.laborReal || "").toUpperCase(),
      String(roundHa(rec.avance))
    ].join("|");
  }

  /** Valida y limpia un registro antes de API / cola */
  function validateRecord(record) {
    const errors = [];
    let area = roundHa(record.area);
    let avance = roundHa(record.avance);
    if (area > 500) { area = 0; errors.push("Área inválida"); }
    if (avance > 500) { avance = 0; errors.push("Avance inválido"); }
    if (area > 0 && avance > area) avance = area;

    const laborReal = safeText(record.laborReal, 80);
    const laborPpto = safeText(record.laborPpto, 80);
    let turno = safeText(record.turno || record.tunel, 20);
    const tNum = turno.replace(/\D/g, "");
    if (!tNum) errors.push("Falta túnel");
    else turno = "T" + tNum;

    const lote = Number(record.lote);
    if (!lote || lote < 1 || lote > 99999 || !Number.isFinite(lote)) errors.push("Lote inválido");

    const sem = Number(record.sem) || "";
    if (sem !== "" && (sem < 1 || sem > 53)) errors.push("Semana inválida");

    let fecha = String(record.fecha || "").trim();
    if (fecha && !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) errors.push("Fecha inválida");

    let variedad = safeText(record.variedad || "SEKOYA POP", 40);
    if (variedad.includes("MAGICA")) variedad = "MAGICA";
    else variedad = "SEKOYA POP";

    const allow = laborAllow();
    if (laborReal && allow.length && !allow.includes(laborReal)) {
      errors.push("Labor no permitida");
    }
    if (!laborReal) errors.push("Falta labor real");

    const base = {
      posKey: record.posKey ? String(record.posKey).slice(0, 32) : undefined,
      sem: sem || "",
      fecha,
      laborPpto,
      laborReal,
      modulo: safeText(record.modulo, 12),
      turno,
      lote: Math.round(lote) || 0,
      variedad,
      area,
      avance,
      totalJr: Math.min(100000, Math.max(0, Number(record.totalJr) || 0))
    };
    const fp = fingerprint(base);
    const rawId = record.localId ? String(record.localId) : newClientId();
    base.localId = safeText(rawId, 80).replace(/[^A-Z0-9_\-\.]/gi, "");
    if (!base.localId) base.localId = newClientId().replace(/[^A-Z0-9_\-\.]/gi, "");
    base._fp = fp;

    return { ok: errors.length === 0, errors, record: base };
  }

  function normalizeRecord(record) {
    return validateRecord(record).record;
  }

  function enqueue(payload, ts) {
    const q = getQueue();
    const exists = q.some(item =>
      item.payload?.localId === payload.localId ||
      item.payload?._fp === payload._fp
    );
    if (exists) return q.length;
    q.push({ ts: ts || Date.now(), payload });
    saveQueue(q);
    return q.length;
  }

  function saveLocal(record, synced) {
    // No regenerar localId: usar el payload ya validado
    const rec = record && record.localId
      ? Object.assign({}, record)
      : normalizeRecord(record || {});
    const all = getLocalRecords();
    const key = rec.posKey || (String(rec.turno || "") + "|" + String(rec.lote || ""));
    if (!key) return rec;
    all[key] = Object.assign({}, rec, {
      savedAt: Number(record.savedAt) || Date.now(),
      synced: !!synced
    });
    if (record.color) all[key].color = String(record.color).slice(0, 20);
    saveLocalRecords(all);

    const history = getHistory();
    const dupIdx = history.findIndex(h =>
      (rec.localId && h.localId === rec.localId) ||
      (h.posKey === rec.posKey && h.laborReal === rec.laborReal && !h.synced)
    );
    if (dupIdx >= 0) history.splice(dupIdx, 1);
    history.unshift(Object.assign({}, rec, {
      id: Date.now(),
      savedAt: all[key].savedAt,
      synced: !!synced
    }));
    saveHistory(history);
    return rec;
  }

  function markHistorySynced(posKey, ts, localId) {
    if (!localId) return;
    const history = getHistory().map(h => {
      if (h.localId === localId) return Object.assign({}, h, { synced: true });
      return h;
    });
    saveHistory(history);
    const all = getLocalRecords();
    if (posKey && all[posKey] && all[posKey].localId === localId) {
      all[posKey].synced = true;
      saveLocalRecords(all);
    }
  }

  /** Confirmación real del Apps Script: ok===true y no es modo local. */
  function serverConfirmed(res) {
    return !!(res && res.ok === true && res.local !== true);
  }

  function apiBody(action, data) {
    return {
      action,
      data,
      token: apiToken()
    };
  }

  async function postJson(body) {
    const url = apiUrl();
    if (!url) return { ok: false, local: true, message: "Sin URL de API" };
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(body),
        redirect: "follow",
        cache: "no-store"
      });
    } catch (err) {
      return { ok: false, message: String(err.message || err) || "Sin conexión al servidor" };
    }
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return { ok: false, message: "Respuesta inválida del servidor", http: res.status };
    }
    if (!data || data.ok !== true) {
      return Object.assign({ ok: false }, data || {}, {
        message: (data && (data.message || data.error)) || ("Servidor no confirmó (HTTP " + res.status + ")")
      });
    }
    return data;
  }

  async function pingServer() {
    const url = apiUrl();
    if (!url) return { ok: false, message: "Sin API" };
    try {
      const params = new URLSearchParams({ action: "ping" });
      const token = apiToken();
      if (token) params.set("token", token);
      const res = await fetch(url + "?" + params.toString(), { method: "GET", cache: "no-store" });
      const data = await res.json();
      return data && data.ok === true ? data : { ok: false, message: "Ping falló" };
    } catch (err) {
      return { ok: false, message: String(err.message || err) };
    }
  }

  async function postLabor(payload) {
    const checked = validateRecord(payload);
    if (!checked.ok) {
      return { ok: false, message: checked.errors.join(" · "), code: "CLIENT_INVALID" };
    }
    return postJson(apiBody("guardar", checked.record));
  }

  async function postLaborBatch(items, shared) {
    const max = MAX_BATCH();
    if (!items.length) return { ok: false, message: "Sin lotes" };
    if (items.length > max) {
      return { ok: false, message: "Máximo " + max + " lotes por grupo", code: "BATCH_TOO_LARGE" };
    }
    const cleaned = [];
    for (let i = 0; i < items.length; i++) {
      const checked = validateRecord(Object.assign({}, shared || {}, items[i]));
      if (!checked.ok) {
        return {
          ok: false,
          message: "Lote " + (i + 1) + ": " + checked.errors.join(" · "),
          code: "CLIENT_INVALID",
          index: i
        };
      }
      cleaned.push(checked.record);
    }
    return postJson(apiBody("guardar_grupo", {
      laborReal: shared && shared.laborReal,
      laborPpto: shared && shared.laborPpto,
      fecha: shared && shared.fecha,
      sem: shared && shared.sem,
      variedad: shared && shared.variedad,
      totalJr: shared && shared.totalJr,
      items: cleaned
    }));
  }

  async function getLabors(filters = {}) {
    const url = apiUrl();
    if (!url) return null;
    const params = new URLSearchParams({ action: "get" });
    if (filters.sem != null && filters.sem !== "") params.set("sem", String(filters.sem).slice(0, 4));
    if (filters.laborReal) params.set("laborReal", safeText(filters.laborReal, 80));
    if (filters.laborPpto) params.set("laborPpto", safeText(filters.laborPpto, 80));
    if (filters.modulo) params.set("modulo", safeText(filters.modulo, 12));
    if (filters.variedad) params.set("variedad", safeText(filters.variedad, 40));
    if (filters.fecha) params.set("fecha", String(filters.fecha).slice(0, 10));
    const token = apiToken();
    if (token) params.set("token", token);
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const t = ctrl ? setTimeout(() => ctrl.abort(), 25000) : null;
    try {
      const res = await fetch(url + "?" + params.toString(), {
        method: "GET",
        cache: "no-store",
        signal: ctrl ? ctrl.signal : undefined
      });
      return await res.json();
    } catch (err) {
      return { ok: false, message: String(err.message || err) || "GET falló" };
    } finally {
      if (t) clearTimeout(t);
    }
  }

  async function getFiltros() {
    const url = apiUrl();
    if (!url) return null;
    const params = new URLSearchParams({ action: "filtros" });
    const token = apiToken();
    if (token) params.set("token", token);
    const res = await fetch(url + "?" + params.toString());
    try { return await res.json(); } catch { return { ok: false, message: "Filtros inválidos" }; }
  }

  async function saveLabor(record) {
    const checked = validateRecord(record);
    if (!checked.ok) {
      return { ok: false, queued: false, synced: false, message: checked.errors.join(" · "), errors: checked.errors };
    }
    const payload = checked.record;
    const savedAt = Date.now();
    const lockKey = payload.localId || payload._fp;

    if (inflight.has(lockKey)) {
      return inflight.get(lockKey);
    }

    const job = (async () => {
      // Siempre en el celular primero (sirve sin internet y si se cierra la app)
      saveLocal(Object.assign({}, payload, { color: record.color, savedAt }), false);

      if (!apiUrl()) {
        const n = enqueue(payload, savedAt);
        if (window.QB_onStatusChange) window.QB_onStatusChange();
        return { ok: true, local: true, queued: n > 0, savedAt, pending: n, payload };
      }

      if (!navigator.onLine) {
        const n = enqueue(payload, savedAt);
        if (window.QB_onStatusChange) window.QB_onStatusChange();
        return { ok: true, queued: true, savedAt, pending: n, payload };
      }

      try {
        const res = await postLabor(payload);
        if (!serverConfirmed(res)) {
          throw new Error((res && (res.message || res.error)) || "Servidor no confirmó el guardado");
        }
        markHistorySynced(payload.posKey, savedAt, payload.localId);
        if (window.QB_onStatusChange) window.QB_onStatusChange();
        return Object.assign({ ok: true, synced: true, savedAt, payload }, res);
      } catch (err) {
        const n = enqueue(payload, savedAt);
        if (window.QB_onStatusChange) window.QB_onStatusChange();
        return {
          ok: true,
          queued: true,
          synced: false,
          savedAt,
          pending: n,
          payload,
          error: String(err.message || err)
        };
      }
    })();

    inflight.set(lockKey, job);
    try {
      return await job;
    } finally {
      inflight.delete(lockKey);
    }
  }

  /** Guardado grupal seguro (1 request + validación) */
  async function saveLaborsBatch(records, shared) {
    if (!Array.isArray(records) || !records.length) {
      return { ok: false, message: "Sin lotes" };
    }
    const max = MAX_BATCH();
    if (records.length > max) {
      return { ok: false, message: "Máximo " + max + " lotes por grupo" };
    }

    const payloads = [];
    for (let i = 0; i < records.length; i++) {
      const checked = validateRecord(Object.assign({}, shared || {}, records[i]));
      if (!checked.ok) {
        return { ok: false, message: "Lote " + (i + 1) + ": " + checked.errors.join(" · "), index: i };
      }
      payloads.push(Object.assign({}, checked.record, {
        color: records[i].color
      }));
      saveLocal(payloads[i], false);
    }

    const apiItems = payloads.map(p => {
      const { color, ...rest } = p;
      return rest;
    });

    if (!apiUrl()) {
      return { ok: true, local: true, count: apiItems.length, payloads };
    }

    if (!navigator.onLine) {
      apiItems.forEach(p => enqueue(p, Date.now()));
      if (window.QB_onStatusChange) window.QB_onStatusChange();
      return { ok: true, queued: true, count: apiItems.length, payloads };
    }

    try {
      const res = await postLaborBatch(apiItems, shared);
      if (!serverConfirmed(res)) throw new Error((res && res.message) || "Servidor no confirmó el grupo");
      payloads.forEach(p => markHistorySynced(p.posKey, Date.now(), p.localId));
      if (window.QB_onStatusChange) window.QB_onStatusChange();
      return Object.assign({ ok: true, synced: true, count: apiItems.length, payloads }, res);
    } catch (err) {
      apiItems.forEach(p => enqueue(p, Date.now()));
      if (window.QB_onStatusChange) window.QB_onStatusChange();
      return {
        ok: true,
        queued: true,
        synced: false,
        count: apiItems.length,
        payloads,
        error: String(err.message || err)
      };
    }
  }

  let flushing = false;
  async function flushQueue() {
    if (!apiUrl() || !navigator.onLine || flushing) return 0;
    flushing = true;
    try {
      const q = getQueue();
      if (!q.length) return 0;
      const pending = [];
      let sent = 0;
      const seen = new Set();

      for (const item of q) {
        const id = item.payload?.localId || item.payload?._fp || String(item.ts);
        if (seen.has(id)) continue;
        seen.add(id);
        try {
          const res = await postLabor(item.payload);
          if (serverConfirmed(res)) {
            sent++;
            markHistorySynced(item.payload.posKey, item.ts, item.payload.localId);
          } else {
            pending.push(item);
          }
        } catch {
          pending.push(item);
        }
      }
      saveQueue(pending);
      if (window.QB_onStatusChange) window.QB_onStatusChange();
      return sent;
    } finally {
      flushing = false;
    }
  }

  function queueCount() {
    return getQueue().length;
  }

  function pendingHistoryCount() {
    return getHistory().filter(h => !h.synced).length;
  }

  window.QBApi = {
    postLabor,
    postLaborBatch,
    getLabors,
    getFiltros,
    saveLabor,
    saveLaborsBatch,
    validateRecord,
    flushQueue,
    queueCount,
    getHistory,
    getLocalRecords,
    saveLocal,
    pendingHistoryCount,
    pingServer,
    serverConfirmed,
    hasApi: () => !!apiUrl()
  };

  window.addEventListener("online", () => {
    flushQueue().then(n => {
      if (n > 0 && window.QB_onQueueFlushed) window.QB_onQueueFlushed(n);
      if (window.QB_onStatusChange) window.QB_onStatusChange();
    });
  });
})();
