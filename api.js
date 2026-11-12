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

  function normFundoId(v) {
    const s = String(v || "").toUpperCase().replace(/\s+/g, " ").trim();
    if (!s) return "licapa1";
    if (s.includes("II") || s === "LICAPA2" || s === "2" || /\b2\b/.test(s)) return "licapa2";
    return "licapa1";
  }

  function laborAllow(fundo) {
    const cfg = window.QB_CONFIG && QB_CONFIG.LABOR_OPTS;
    const id = normFundoId(fundo);
    const by = cfg && cfg.byFundo && cfg.byFundo[id];
    const list = (Array.isArray(by) && by.length)
      ? by
      : ((cfg && cfg.labor_real) || []);
    return list.map(x => String(x).toUpperCase().trim()).filter(Boolean);
  }

  function getQueue() {
    try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]"); } catch { return []; }
  }

  function saveQueue(q) {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(0, 200)));
    armBackgroundSync();
  }

  function askNotifyPermission() {
    try {
      if (!("Notification" in window)) return;
      if (Notification.permission !== "default") return;
      Notification.requestPermission().catch(() => {});
    } catch (e) { /* ok */ }
  }

  function armBackgroundSync() {
    try {
      if (!("serviceWorker" in navigator)) return;
      navigator.serviceWorker.ready.then(reg => {
        if (reg.sync && typeof reg.sync.register === "function") {
          return reg.sync.register("qb-flush-queue");
        }
      }).catch(() => {});
    } catch (e) { /* ok */ }
  }

  function notifyAndroidUploaded(n) {
    n = Number(n) || 0;
    if (!(n > 0) || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.ready.then(reg => {
      const msg = { type: "NOTIFY_UPLOADED", count: n };
      if (reg.active) {
        reg.active.postMessage(msg);
        return;
      }
      if (typeof reg.showNotification === "function" && Notification.permission === "granted") {
        const title = n === 1 ? "Pendiente subido" : n + " pendientes subidos";
        return reg.showNotification(title, {
          body: n === 1 ? "El reporte ya está en la hoja." : n + " reportes ya están en la hoja.",
          icon: "./assets/icon-192.png",
          badge: "./assets/icon-192.png",
          tag: "qb-uploaded",
          renotify: true
        });
      }
    }).catch(() => {});
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

  function lotKey(rec) {
    return [
      String(rec.sem || ""),
      String(rec.fecha || ""),
      String(rec.turno || "").toUpperCase(),
      String(rec.lote || ""),
      String(rec.laborReal || "").toUpperCase(),
      String(rec.modulo || "").toUpperCase()
    ].join("|");
  }

  function fingerprint(rec) {
    return lotKey(rec) + "|" + String(roundHa(rec.avance));
  }

  function stableLocalId(rec) {
    const raw = "qb_" + lotKey(rec).replace(/[^A-Za-z0-9]/g, "");
    return (raw || newClientId()).slice(0, 80);
  }

  function colorPalette() {
    return (window.QB_CONFIG && window.QB_CONFIG.COLOR_PALETTE) || {
      "#64B5F6": "Lunes",
      "#81C784": "Martes",
      "#FFD54F": "Miercoles",
      "#FF8A65": "Jueves",
      "#CE93D8": "Viernes"
    };
  }

  const COLOR_ALIASES = {
    LUNES: "#64B5F6", AZUL: "#64B5F6",
    MARTES: "#81C784", VERDE: "#81C784",
    MIERCOLES: "#FFD54F", MIÉRCOLES: "#FFD54F", AMARILLO: "#FFD54F",
    JUEVES: "#FF8A65", NARANJA: "#FF8A65",
    VIERNES: "#CE93D8", MORADO: "#CE93D8", VIOLETA: "#CE93D8"
  };

  const COLOR_HEX_LEGACY = {
    "#1E88E5": "#64B5F6",
    "#43A047": "#81C784",
    "#F9A825": "#FFD54F",
    "#E64A19": "#FF8A65",
    "#8E24AA": "#CE93D8"
  };

  function normalizeColor(color) {
    const raw = String(color || "").trim();
    if (!raw) return "";
    const up = raw.toUpperCase();
    if (COLOR_HEX_LEGACY[up]) return COLOR_HEX_LEGACY[up];
    if (/^#[0-9A-F]{6}$/.test(up)) return up;
    return colorNameToHex(raw);
  }

  function colorHexToName(hex) {
    const h = normalizeColor(hex);
    if (!h) return "";
    return colorPalette()[h] || "";
  }

  function colorNameToHex(name) {
    const norm = String(name || "").trim().toUpperCase().replace(/\s+/g, " ").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (!norm) return "";
    if (COLOR_ALIASES[norm]) return COLOR_ALIASES[norm];
    const pal = colorPalette();
    for (const [hex, label] of Object.entries(pal)) {
      const lab = String(label).toUpperCase().replace(/\s+/g, " ").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (lab === norm) return hex.toUpperCase();
    }
    return /^#[0-9A-F]{6}$/.test(norm) ? norm : "";
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
    const isCercos = laborReal === "CERCOS VIVOS" || laborReal === "CERCO VIVOS";
    if (isCercos && area > 0) {
      if (avance <= 0) avance = area;
      if (avance > area) avance = area;
    }
    const laborPpto = safeText(record.laborPpto, 80);
    let turno = safeText(record.turno || record.tunel, 20);
    const tNum = turno.replace(/\D/g, "");
    if (!tNum) errors.push("Falta túnel");
    else turno = "T" + tNum;

    // Licapa I: número. Licapa II: también "208A" / "328B" (sin mezclar datasets; solo aceptar el formato).
    let loteNorm = null;
    if (typeof record.lote === "number" && Number.isFinite(record.lote)) {
      const n = Math.round(record.lote);
      if (n >= 1 && n <= 99999) loteNorm = n;
    } else {
      const s = String(record.lote == null ? "" : record.lote).trim().replace(/\s+/g, "").toUpperCase();
      if (/^\d{1,5}$/.test(s)) {
        const n = parseInt(s, 10);
        if (n >= 1 && n <= 99999) loteNorm = n;
      } else if (/^\d{1,5}[A-Z]$/.test(s)) {
        loteNorm = s;
      }
    }
    if (loteNorm == null) errors.push("Lote inválido");

    const sem = Number(record.sem) || "";
    if (sem !== "" && (sem < 1 || sem > 53)) errors.push("Semana inválida");

    let fecha = String(record.fecha || "").trim();
    if (fecha && !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) errors.push("Fecha inválida");

    let variedad = safeText(record.variedad || "SEKOYA POP", 40);
    if (variedad.includes("MAGICA")) variedad = "MAGICA";
    else variedad = "SEKOYA POP";

    const allow = laborAllow(record.fundo || record.etapa);
    if (laborReal && allow.length && !allow.includes(laborReal)) {
      errors.push("Labor no permitida");
    }
    if (!laborReal) errors.push("Falta labor real");

    const totalJrNum = Math.min(100000, Math.max(0, Math.round(Number(record.totalJr) || 0)));
    if (totalJrNum < 1) errors.push("Ingresa los jornales (JR)");

    const base = {
      posKey: record.posKey ? String(record.posKey).slice(0, 40) : undefined,
      sem: sem || "",
      fecha,
      laborPpto,
      laborReal,
      modulo: safeText(record.modulo, 12),
      turno,
      lote: loteNorm == null ? 0 : loteNorm,
      variedad,
      area,
      avance,
      totalJr: totalJrNum,
      ml: isCercos
        ? Math.min(1000000, Math.max(0, Math.round(Number(record.ml != null ? record.ml : record.metrosLineales) || 0)))
        : 0,
      lotesTrabajados: isCercos
        ? Math.min(999, Math.max(0, Math.round(Number(record.lotesTrabajados != null ? record.lotesTrabajados : record.cercosLotes) || 0)))
        : 0,
      color: normalizeColor(record.color)
    };
    if (record.fundo) base.fundo = safeText(record.fundo, 40);
    if (record.etapa) base.etapa = safeText(record.etapa, 12);
    if (isCercos && base.ml <= 0 && base.lotesTrabajados > 0) {
      const per = Number((window.QB_CONFIG && QB_CONFIG.CERCOS_ML_PER_LOT) || 80) || 80;
      base.ml = base.lotesTrabajados * per;
    }
    const idKey = lotKey(base);
    const fp = fingerprint(base);
    const rawId = record.localId ? String(record.localId) : stableLocalId(base);
    base.localId = safeText(rawId, 80).replace(/[^A-Z0-9_\-\.]/gi, "");
    if (!base.localId) base.localId = stableLocalId(base).replace(/[^A-Z0-9_\-\.]/gi, "");
    base._fp = idKey;
    base._sig = fp;
    if (record.editar === true || record.editar === 1 || record.editar === "1" || record.editar === "true") {
      base.editar = true;
    }

    return { ok: errors.length === 0, errors, record: base };
  }

  function normalizeRecord(record) {
    return validateRecord(record).record;
  }

  function sameLotPayload(a, b) {
    if (!a || !b) return false;
    if (a.localId && b.localId && a.localId === b.localId) return true;
    if (a._fp && b._fp && a._fp === b._fp) return true;
    return lotKey(a) === lotKey(b);
  }

  function enqueue(payload, ts) {
    const q = getQueue();
    const idx = q.findIndex(item => sameLotPayload(item.payload, payload));
    if (idx >= 0) {
      q[idx] = { ts: ts || Date.now(), payload };
      saveQueue(q);
      askNotifyPermission();
      return q.length;
    }
    q.push({ ts: ts || Date.now(), payload });
    saveQueue(q);
    askNotifyPermission();
    return q.length;
  }

  function dequeueMatching(payload) {
    if (!payload) return;
    const q = getQueue().filter(item => !sameLotPayload(item.payload, payload));
    saveQueue(q);
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

  async function postJson(body, opts) {
    const url = apiUrl();
    if (!url) return { ok: false, local: true, message: "Sin URL de API" };
    const waitMs = Math.max(20000, Number(opts && opts.timeoutMs) || 90000);
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const t = ctrl ? setTimeout(() => ctrl.abort(), waitMs) : null;
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(body),
        redirect: "follow",
        cache: "no-store",
        signal: ctrl ? ctrl.signal : undefined
      });
    } catch (err) {
      const msg = String(err && (err.message || err)) || "Sin conexión al servidor";
      const aborted = /abort/i.test(msg);
      return { ok: false, message: aborted ? "El servidor tardó demasiado" : msg, timeout: aborted };
    } finally {
      if (t) clearTimeout(t);
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
    return postJson(apiBody("guardar", checked.record), { timeoutMs: 70000 });
  }

  async function postLaborBatch(items, shared) {
    const max = MAX_BATCH();
    if (!items.length) return { ok: false, message: "Sin lotes" };
    if (items.length > max) {
      return { ok: false, message: "Máximo " + max + " lotes por grupo", code: "BATCH_TOO_LARGE" };
    }
    const sharedColor = shared && normalizeColor(shared.color);
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
      const rec = Object.assign({}, checked.record);
      if (sharedColor) rec.color = sharedColor;
      else if (items[i].color) rec.color = normalizeColor(items[i].color);
      cleaned.push(rec);
    }
    return postJson(apiBody("guardar_grupo", {
      laborReal: shared && shared.laborReal,
      laborPpto: shared && shared.laborPpto,
      fecha: shared && shared.fecha,
      sem: shared && shared.sem,
      variedad: shared && shared.variedad,
      totalJr: shared && shared.totalJr,
      ml: shared && shared.ml,
      lotesTrabajados: shared && (shared.lotesTrabajados != null ? shared.lotesTrabajados : shared.cercosLotes),
      color: shared && (sharedColor || normalizeColor(shared.color) || shared.color),
      fundo: shared && shared.fundo,
      etapa: shared && shared.etapa,
      items: cleaned
    }), { timeoutMs: 100000 });
  }

  async function getLabors(filters = {}) {
    const url = apiUrl();
    if (!url) return null;
    const params = new URLSearchParams({ action: "get" });
    if (filters.sem != null && filters.sem !== "") params.set("sem", String(filters.sem).slice(0, 4));
    params.set("laborReal", safeText(filters.laborReal || "DESHIERBO", 80));
    if (filters.laborPpto) params.set("laborPpto", safeText(filters.laborPpto, 80));
    if (filters.modulo) params.set("modulo", safeText(filters.modulo, 12));
    if (filters.variedad) params.set("variedad", safeText(filters.variedad, 40));
    if (filters.fecha) params.set("fecha", String(filters.fecha).trim().slice(0, 10));
    if (filters.fundo) params.set("fundo", safeText(filters.fundo, 40));
    if (filters.etapa) params.set("etapa", safeText(filters.etapa, 12));
    if (filters.nocache || filters.force) params.set("nocache", "1");
    const token = apiToken();
    if (token) params.set("token", token);
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const t = ctrl ? setTimeout(() => ctrl.abort(), 40000) : null;
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

  async function getResumen(sem, laborReal, opts) {
    const url = apiUrl();
    if (!url) return null;
    const o = opts && typeof opts === "object" ? opts : {};
    const params = new URLSearchParams({ action: "resumen" });
    if (sem != null && sem !== "") params.set("sem", String(sem).slice(0, 4));
    if (laborReal) params.set("laborReal", safeText(laborReal, 80));
    if (o.fundo) params.set("fundo", safeText(o.fundo, 40));
    if (o.etapa) params.set("etapa", safeText(o.etapa, 12));
    const token = apiToken();
    if (token) params.set("token", token);
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const t = ctrl ? setTimeout(() => ctrl.abort(), 18000) : null;
    try {
      const res = await fetch(url + "?" + params.toString(), {
        method: "GET",
        cache: "no-store",
        signal: ctrl ? ctrl.signal : undefined
      });
      return await res.json();
    } catch (err) {
      return { ok: false, message: String(err.message || err) || "Resumen falló" };
    } finally {
      if (t) clearTimeout(t);
    }
  }

  async function getFiltros(opts) {
    const url = apiUrl();
    if (!url) return null;
    const o = opts && typeof opts === "object" ? opts : {};
    const params = new URLSearchParams({ action: "filtros" });
    if (o.fundo) params.set("fundo", safeText(o.fundo, 40));
    if (o.etapa) params.set("etapa", safeText(o.etapa, 12));
    const token = apiToken();
    if (token) params.set("token", token);
    const res = await fetch(url + "?" + params.toString());
    try { return await res.json(); } catch { return { ok: false, message: "Filtros inválidos" }; }
  }

  async function deleteLabor(record) {
    const url = apiUrl();
    if (!url) return { ok: false, message: "Sin API" };
    const payload = {
      action: "eliminar",
      data: {
        lote: record && record.lote,
        turno: record && (record.turno || record.tunel),
        modulo: record && (record.modulo || record.md),
        sem: record && record.sem,
        laborReal: record && record.laborReal,
        fecha: record && record.fecha,
        fundo: record && record.fundo,
        etapa: record && record.etapa
      }
    };
    const token = apiToken();
    if (token) payload.token = token;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload)
      });
      return await res.json();
    } catch (err) {
      return { ok: false, message: String(err.message || err) || "No se pudo eliminar" };
    }
  }

  async function saveLabor(record) {
    askNotifyPermission();
    const checked = validateRecord(record);
    if (!checked.ok) {
      return { ok: false, queued: false, synced: false, message: checked.errors.join(" · "), errors: checked.errors };
    }
    const payload = checked.record;
    const savedAt = Date.now();
    const lockKey = payload._fp || payload.localId;

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
        return { ok: true, queued: true, offline: true, savedAt, pending: n, payload };
      }

      try {
        const res = await postLabor(payload);
        if (isRateLimitedResponse(res)) {
          if (window.QB_onRateLimit) window.QB_onRateLimit();
          const n = enqueue(payload, savedAt);
          if (window.QB_onStatusChange) window.QB_onStatusChange();
          return { ok: true, queued: true, synced: false, savedAt, pending: n, payload, rateLimited: true };
        }
        if (!serverConfirmed(res)) {
          throw new Error((res && (res.message || res.error)) || "Servidor no confirmó el guardado");
        }
        dequeueMatching(payload);
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
          networkError: true,
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
    askNotifyPermission();
    if (!Array.isArray(records) || !records.length) {
      return { ok: false, message: "Sin lotes" };
    }
    const max = MAX_BATCH();
    if (records.length > max) {
      return { ok: false, message: "Máximo " + max + " lotes por grupo" };
    }

    const payloads = [];
    const seen = new Set();
    for (let i = 0; i < records.length; i++) {
      const src = Object.assign({}, shared || {}, records[i]);
      const checked = validateRecord(src);
      if (!checked.ok) {
        return { ok: false, message: "Lote " + (i + 1) + ": " + checked.errors.join(" · "), index: i };
      }
      const payload = Object.assign({}, checked.record, {
        color: normalizeColor(src.color) || checked.record.color
      });
      if (payload._fp && seen.has(payload._fp)) continue;
      if (payload._fp) seen.add(payload._fp);
      payloads.push(payload);
      saveLocal(Object.assign({}, payload, { color: src.color || payload.color }), false);
    }

    const apiItems = payloads;
    const lockKey = "batch:" + apiItems.map(p => p._fp || p.localId).sort().join(",");
    if (inflight.has(lockKey)) {
      return inflight.get(lockKey);
    }
    const anyBusy = apiItems.find(p => inflight.has(p._fp || p.localId));
    if (anyBusy) {
      return inflight.get(anyBusy._fp || anyBusy.localId);
    }

    const job = (async () => {
    if (!apiUrl()) {
      return { ok: true, local: true, count: apiItems.length, payloads };
    }

    if (!navigator.onLine) {
      apiItems.forEach(p => enqueue(p, Date.now()));
      if (window.QB_onStatusChange) window.QB_onStatusChange();
      return { ok: true, queued: true, offline: true, count: apiItems.length, payloads };
    }

    try {
      const res = await postLaborBatch(apiItems, shared);
      if (isRateLimitedResponse(res)) {
        if (window.QB_onRateLimit) window.QB_onRateLimit();
        apiItems.forEach(p => enqueue(p, Date.now()));
        if (window.QB_onStatusChange) window.QB_onStatusChange();
        return {
          ok: true,
          queued: true,
          synced: false,
          rateLimited: true,
          count: apiItems.length,
          payloads
        };
      }
      if (!serverConfirmed(res)) throw new Error((res && res.message) || "Servidor no confirmó el grupo");
      apiItems.forEach(p => dequeueMatching(p));
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
        networkError: true,
        count: apiItems.length,
        payloads,
        error: String(err.message || err)
      };
    }
    })();

    inflight.set(lockKey, job);
    apiItems.forEach(p => inflight.set(p._fp || p.localId, job));
    try {
      return await job;
    } finally {
      inflight.delete(lockKey);
      apiItems.forEach(p => inflight.delete(p._fp || p.localId));
    }
  }

  let flushing = false;
  async function flushQueue() {
    if (!apiUrl() || !navigator.onLine || flushing) return 0;
    flushing = true;
    try {
      const q = getQueue();
      if (!q.length) return 0;
      const unique = [];
      const seen = new Set();
      q.forEach(item => {
        const p = item.payload;
        if (!p) return;
        const id = p._fp || p.localId || String(item.ts);
        if (seen.has(id)) return;
        seen.add(id);
        unique.push(item);
      });
      if (!unique.length) {
        saveQueue([]);
        return 0;
      }

      const notify = n => {
        if (n > 0) notifyAndroidUploaded(n);
        if (n > 0 && window.QB_onQueueFlushed) {
          try { window.QB_onQueueFlushed(n); } catch (e) { /* ok */ }
        }
        if (window.QB_onStatusChange) window.QB_onStatusChange();
      };

      try {
        const payloads = unique.map(x => x.payload);
        const res = await postLaborBatch(payloads, {});
        if (isRateLimitedResponse(res)) {
          if (window.QB_onRateLimit) window.QB_onRateLimit();
          return 0;
        }
        if (serverConfirmed(res)) {
          payloads.forEach(p => {
            dequeueMatching(p);
            markHistorySynced(p.posKey, Date.now(), p.localId);
          });
          saveQueue([]);
          notify(payloads.length);
          return payloads.length;
        }
      } catch (e) { /* 3G: caer a uno por uno */ }

      const pending = [];
      let sent = 0;
      let hitRateLimit = false;
      for (const item of unique) {
        const id = item.payload?._fp || item.payload?.localId || String(item.ts);
        if (hitRateLimit) {
          pending.push(item);
          continue;
        }
        if (inflight.has(id)) {
          pending.push(item);
          continue;
        }
        try {
          const res = await postLabor(item.payload);
          if (isRateLimitedResponse(res)) {
            if (window.QB_onRateLimit) window.QB_onRateLimit();
            pending.push(item);
            hitRateLimit = true;
          } else if (serverConfirmed(res)) {
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
      notify(sent);
      return sent;
    } finally {
      flushing = false;
    }
  }

  function isRateLimitedResponse(res) {
    if (!res) return false;
    if (res.code === "RATE_LIMIT") return true;
    return /demasiadas solicitudes/i.test(String(res.message || res.error || ""));
  }

  function getPendingPosKeys() {
    return new Set(Object.keys(getPendingLaborByPos()));
  }

  function getPendingLaborByPos() {
    const map = {};
    getQueue().forEach(item => {
      const p = item.payload;
      if (!p) return;
      const labor = String(p.laborReal || "").toUpperCase().trim();
      if (p.posKey) map[String(p.posKey)] = labor;
      (p.items || []).forEach(it => {
        if (!it || !it.posKey) return;
        map[String(it.posKey)] = String(it.laborReal || p.laborReal || "").toUpperCase().trim();
      });
    });
    return map;
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
    getResumen,
    getFiltros,
    saveLabor,
    deleteLabor,
    saveLaborsBatch,
    validateRecord,
    flushQueue,
    queueCount,
    getPendingPosKeys,
    getPendingLaborByPos,
    getHistory,
    getLocalRecords,
    saveLocal,
    pendingHistoryCount,
    pingServer,
    serverConfirmed,
    hasApi: () => !!apiUrl(),
    normalizeColor,
    colorHexToName,
    colorNameToHex
  };

  window.addEventListener("online", () => {
    flushQueue().catch(() => 0);
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", e => {
      if (e.data && e.data.type === "FLUSH_QUEUE") flushQueue().catch(() => 0);
    });
  }
})();
