/**
 * Frecuencias · 3 flujos (solo escritorio):
 * 1) DATA  → cosechas llenadas
 * 2) CÁLCULO → N° / FECHA / DR (automático)
 * 3) MAPA → mismo plano, abajo = días avanzados
 */
(function () {
  "use strict";

  const LS_EXTRA = "qb-freq-extra-v1";
  const LS_PROD = "qb-freq-prod-v1";
  const LS_PROD_SEEDED = "qb-freq-prod-seeded-v2";
  let DATA = null;
  let PROD = null;
  let cutDate = "";
  let variedad = "SEKOYA POP";
  let byLotKey = new Map();
  let selectedKey = "";
  let tab = "mapa";
  let calcFilter = "";
  let calcMod = "";
  let calcTurno = "";
  const MES_ES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

  function $(id) {
    return document.getElementById(id);
  }

  function isoTodayLima() {
    try {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Lima",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).format(new Date());
    } catch (e) {
      return new Date().toISOString().slice(0, 10);
    }
  }

  function parseIso(s) {
    const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  function formatDMY(iso) {
    const d = parseIso(iso);
    if (!d) return "—";
    return String(d.getDate()).padStart(2, "0") + "/" +
      String(d.getMonth() + 1).padStart(2, "0") + "/" + d.getFullYear();
  }

  function daysBetween(aIso, bIso) {
    const a = parseIso(aIso);
    const b = parseIso(bIso);
    if (!a || !b) return null;
    const n = Math.round((b - a) / 86400000);
    // Evitar seriales Excel / fechas basura
    if (!Number.isFinite(n) || n < 0 || n > 4000) return null;
    return n;
  }

  function freqTone(dr) {
    if (dr == null || !Number.isFinite(dr) || dr < 0) return "sin";
    if (dr <= 8) return "verde";
    if (dr <= 11) return "amarillo";
    return "rojo";
  }

  function normTurn(t) {
    const s = String(t || "").toUpperCase().replace(/\s+/g, "");
    const m = s.match(/^T?(\d{1,3})([A-Z])?$/);
    if (m) return "T" + m[1] + (m[2] || "");
    const d = s.replace(/\D/g, "");
    return d ? "T" + d : "";
  }

  function normMod(m) {
    const s = String(m || "").toUpperCase().replace(/\s+/g, "");
    if (!s) return "";
    if (s.charAt(0) === "M") return s;
    const d = s.replace(/\D/g, "");
    return d ? "M" + d : s;
  }

  function lotKey(turno, lote) {
    return normTurn(turno) + "|" + Number(lote);
  }

  function buildEntries(dates) {
    const ordered = [...new Set(dates)].filter(Boolean).sort();
    const entries = [];
    let prev = null;
    ordered.forEach((ds, i) => {
      let dr = 1;
      if (prev) {
        const d = daysBetween(prev, ds);
        dr = d == null ? 1 : d;
      }
      entries.push({ n: i + 1, fecha: ds, dr });
      prev = ds;
    });
    return {
      entradas: entries,
      ultima: ordered.length ? ordered[ordered.length - 1] : "",
      nEntradas: ordered.length
    };
  }

  function readExtra() {
    try {
      return JSON.parse(localStorage.getItem(LS_EXTRA) || "[]");
    } catch (e) {
      return [];
    }
  }

  function writeExtra(list) {
    localStorage.setItem(LS_EXTRA, JSON.stringify(list || []));
  }

  function mergeLots(baseLots, extras) {
    const map = new Map();
    (baseLots || []).forEach(row => {
      const k = lotKey(row.turno, row.lote) + "|" + String(row.variedad || "").toUpperCase() + "|" + normMod(row.modulo);
      const dates = (row.entradas || []).map(e => e.fecha);
      map.set(k, {
        variedad: String(row.variedad || "SEKOYA POP").toUpperCase(),
        modulo: normMod(row.modulo),
        turno: normTurn(row.turno),
        lote: Number(row.lote),
        dates
      });
    });
    (extras || []).forEach(ev => {
      if (!ev || !ev.fecha || !ev.lote) return;
      const varU = String(ev.variedad || "SEKOYA POP").toUpperCase();
      const mod = normMod(ev.modulo);
      const turn = normTurn(ev.turno);
      const lote = Number(ev.lote);
      if (!turn || !lote) return;
      const k = turn + "|" + lote + "|" + varU + "|" + mod;
      if (!map.has(k)) {
        map.set(k, { variedad: varU, modulo: mod, turno: turn, lote, dates: [] });
      }
      map.get(k).dates.push(String(ev.fecha).slice(0, 10));
    });
    const out = [];
    map.forEach(v => {
      const built = buildEntries(v.dates);
      out.push({
        variedad: v.variedad,
        modulo: v.modulo,
        turno: v.turno,
        lote: v.lote,
        entradas: built.entradas,
        ultima: built.ultima,
        nEntradas: built.nEntradas
      });
    });
    out.sort((a, b) =>
      String(a.variedad).localeCompare(b.variedad) ||
      String(a.modulo).localeCompare(b.modulo, "es", { numeric: true }) ||
      String(a.turno).localeCompare(b.turno, "es", { numeric: true }) ||
      (a.lote - b.lote)
    );
    return out;
  }

  function recompute() {
    if (!DATA) return;
    // Extras + filas de producción alimentan el DR / mapa
    const fromProd = (readProd() || []).map(r => ({
      fecha: r.fecha,
      modulo: r.modulo,
      turno: r.turno,
      lote: r.lote,
      variedad: r.variedad
    }));
    DATA.lots = mergeLots(DATA._baseLots || [], readExtra().concat(fromProd));
    indexData(DATA);
    renderAll();
  }

  function readProd() {
    try {
      return JSON.parse(localStorage.getItem(LS_PROD) || "[]");
    } catch (e) {
      return [];
    }
  }

  function writeProd(list) {
    localStorage.setItem(LS_PROD, JSON.stringify(list || []));
  }

  function isoWeekNum(iso) {
    const d = parseIso(iso);
    if (!d) return "";
    const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = tmp.getUTCDay() || 7;
    tmp.setUTCDate(tmp.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
    return Math.ceil((((tmp - yearStart) / 86400000) + 1) / 7);
  }

  function round2(n) {
    return Math.round(Number(n) * 100) / 100;
  }

  function enrichProdRow(raw) {
    const cfg = (PROD && PROD.cfg) || {};
    const fecha = String(raw.fecha || "").slice(0, 10);
    const d = parseIso(fecha);
    const packing = String(raw.packing || cfg.packingDefault || "QPACK").toUpperCase();
    const varU = String(raw.variedad || variedad || "SEKOYA POP").toUpperCase();
    const modulo = normMod(raw.modulo);
    const turno = normTurn(raw.turno);
    const lote = Number(raw.lote) || 0;
    const mapLot = findMapLot(turno, lote);
    const ha = mapLot && mapLot.ha != null
      ? Number(mapLot.ha)
      : (raw.ha != null ? Number(raw.ha) : 0);
    const jabas = Number(raw.jabas) || 0;
    const jarrasPorJaba = Number(cfg.jarrasPorJaba) || 12;
    const jarras = raw.jarras != null && raw.jarras !== ""
      ? Number(raw.jarras)
      : jabas * jarrasPorJaba;
    const kgPerJarra = Number(cfg.kgPerJarra) || 1.0653;
    const kilosBruto = round2(jarras * kgPerJarra);
    const jorna = Number(raw.jorna) || 0;
    const descarteRate = Number(cfg.descarteRate) || 0.0046936;
    const descarte = round2(kilosBruto * descarteRate);
    const kilosNetos = round2(kilosBruto - descarte);
    const ref = String(cfg.refBase || "46130QBERRIES");
    const fundo = String(cfg.fundo || "QBERRIES");
    return {
      id: raw.id || (fecha + "|" + turno + "|" + lote + "|" + (raw.guia || "")),
      fecha,
      mes: d ? MES_ES[d.getMonth()] : "—",
      semana: d ? isoWeekNum(fecha) : "—",
      fundo,
      ref,
      packing,
      ref2: ref + varU + packing,
      etapa: String(cfg.etapa || "ETAPA 1"),
      variedad: varU,
      guia: String(raw.guia || ""),
      modulo: modulo || (mapLot ? normMod(mapLot.modulo) : ""),
      turno,
      lote,
      cod: lote ? String(lote).padStart(4, "0") : "—",
      ha: round2(ha),
      jorna,
      jabas,
      jarras,
      kilosBruto,
      kilosHa: ha > 0 ? round2(kilosBruto / ha) : 0,
      jabasJr: jorna > 0 ? round2(jabas / jorna) : 0,
      kgJr: jorna > 0 ? round2(kilosBruto / jorna) : 0,
      descarte,
      kilosNetos,
      mercado: String(raw.mercado || "")
    };
  }

  async function ensureProdSeed() {
    const ver = (window.QB_CONFIG && QB_CONFIG.APP_VERSION) || Date.now();
    const res = await fetch("./frecuencias-prod-seed.json?v=" + encodeURIComponent(ver), { cache: "no-store" });
    if (!res.ok) throw new Error("No se pudo cargar frecuencias-prod-seed.json");
    const seed = await res.json();
    PROD = PROD || {};
    PROD.cfg = {
      fundo: seed.fundo,
      refBase: seed.refBase,
      packingDefault: seed.packingDefault,
      etapa: seed.etapa,
      kgPerJarra: seed.kgPerJarra,
      descarteRate: seed.descarteRate,
      jarrasPorJaba: seed.jarrasPorJaba
    };
    const seedVer = String(seed.seedVersion || 1);
    const flagged = localStorage.getItem(LS_PROD_SEEDED);
    // Resiembra simulación si cambió la versión del seed (frontend only)
    if (flagged !== seedVer) {
      writeProd((seed.rows || []).map((r, i) => ({ ...r, id: "seed-" + i, at: Date.now() })));
      localStorage.setItem(LS_PROD_SEEDED, seedVer);
    } else if (!readProd().length) {
      writeProd((seed.rows || []).map((r, i) => ({ ...r, id: "seed-" + i, at: Date.now() })));
    }
    return readProd();
  }

  function prodRowsEnriched() {
    return readProd().map(enrichProdRow).sort((a, b) =>
      String(b.fecha).localeCompare(a.fecha) ||
      String(a.turno).localeCompare(b.turno, "es", { numeric: true }) ||
      (a.lote - b.lote)
    );
  }

  function indexData(data) {
    byLotKey = new Map();
    (data.lots || []).forEach(row => {
      if (!row) return;
      if (variedad && String(row.variedad || "").toUpperCase() !== variedad) return;
      const k = lotKey(row.turno, row.lote);
      const prev = byLotKey.get(k);
      if (!prev || (row.nEntradas || 0) >= (prev.nEntradas || 0)) byLotKey.set(k, row);
    });
  }

  function drActual(row) {
    if (!row || !row.ultima || !cutDate) return null;
    return daysBetween(row.ultima, cutDate);
  }

  function isDesktop() {
    return window.matchMedia && window.matchMedia("(min-width: 1024px)").matches;
  }

  async function loadData() {
    if (DATA && DATA._loaded) return DATA;
    const ver = (window.QB_CONFIG && QB_CONFIG.APP_VERSION) || Date.now();
    const res = await fetch("./frecuencias-data.json?v=" + encodeURIComponent(ver), { cache: "no-store" });
    if (!res.ok) throw new Error("No se pudo cargar frecuencias-data.json");
    const json = await res.json();
    await ensureProdSeed();
    DATA = {
      _loaded: true,
      _baseLots: JSON.parse(JSON.stringify(json.lots || [])),
      generatedAt: json.generatedAt,
      source: json.source,
      defaultCutDate: json.defaultCutDate,
      lots: []
    };
    cutDate = DATA.defaultCutDate || isoTodayLima();
    const fromProd = (readProd() || []).map(r => ({
      fecha: r.fecha,
      modulo: r.modulo,
      turno: r.turno,
      lote: r.lote,
      variedad: r.variedad
    }));
    DATA.lots = mergeLots(DATA._baseLots, readExtra().concat(fromProd));
    indexData(DATA);
    return DATA;
  }

  function mapLots() {
    return (window.MAP_DATA && MAP_DATA.lots) || [];
  }

  function findMapLot(turno, loteNum) {
    const lots = mapLots();
    const t = normTurn(turno);
    const n = Number(loteNum);
    let hits = lots.filter(l =>
      Number(l.lote) === n && normTurn(l.tunel) === t
    );
    if (!hits.length) hits = lots.filter(l => Number(l.lote) === n);
    return hits[0] || null;
  }

  const TAB_PATH = { data: "/data", calculo: "/calculo", mapa: "/mapa" };
  const PATH_TAB = { "/data": "data", "/calculo": "calculo", "/mapa": "mapa" };

  function pathOfTab(name) {
    return TAB_PATH[name] || "/mapa";
  }

  function tabFromHash() {
    const raw = String(location.hash || "").replace(/^#/, "");
    const path = raw.charAt(0) === "/" ? raw : "/" + raw.replace(/^\//, "");
    return PATH_TAB[path] || "";
  }

  function syncHash(name, replace) {
    const next = "#" + pathOfTab(name);
    if (location.hash === next) return;
    if (replace) history.replaceState(null, "", next);
    else history.pushState(null, "", next);
  }

  function clearHash() {
    if (!location.hash) return;
    history.replaceState(null, "", location.pathname + location.search);
  }

  function setTab(name, opts) {
    const o = opts || {};
    const valid = PATH_TAB[pathOfTab(name)] ? name : "mapa";
    tab = valid;
    const screen = $("freqScreen");
    document.querySelectorAll(".freq-tab").forEach(btn => {
      btn.classList.toggle("is-on", btn.dataset.tab === valid);
    });
    document.querySelectorAll(".freq-panel").forEach(p => {
      p.hidden = p.dataset.panel !== valid;
    });
    const legend = $("freqLegendBox");
    if (legend) legend.style.display = valid === "mapa" ? "" : "none";

    if (!o.skipHash) syncHash(valid, !!o.replaceHash);

    // Solo monta la vista activa (ligero)
    if (valid === "mapa") {
      if (screen) screen.classList.add("is-live-map");
      document.body.classList.add("freq-map-live");
      const bar = screen && screen.querySelector(".freq-top");
      if (bar) {
        document.body.style.setProperty("--freq-bar-h", Math.ceil(bar.getBoundingClientRect().height) + "px");
      }
      paintOnRealMap();
      requestAnimationFrame(() => {
        window.dispatchEvent(new Event("resize"));
      });
      return;
    }

    clearRealMapPaint();
    if (screen) screen.classList.remove("is-live-map");
    document.body.classList.remove("freq-map-live");
    document.body.style.removeProperty("--freq-bar-h");
    if (valid === "data") renderData();
    if (valid === "calculo") renderCalculo();
  }

  function clearRealMapPaint() {
    document.querySelectorAll("#grid .freq-days").forEach(el => el.remove());
    document.querySelectorAll("#grid .cell.is-freq-on").forEach(el => el.classList.remove("is-freq-on"));
  }

  /* ——— 1) DATA ——— */
  function fmtNum(n, d) {
    if (n == null || !Number.isFinite(Number(n))) return "—";
    return Number(n).toFixed(d == null ? 2 : d);
  }

  function renderData() {
    const body = $("freqDataBody");
    const meta = $("freqDataMeta");
    if (!body) return;
    fillCascadeModulo();
    const rows = prodRowsEnriched().filter(r =>
      !variedad || String(r.variedad).toUpperCase() === variedad
    );
    if (meta) {
      meta.textContent = rows.length + " registros · simulación frontend";
    }
    if (!rows.length) {
      body.innerHTML = `<tr class="is-empty"><td colspan="14">Sin data. Agrega una cosecha a la derecha.</td></tr>`;
      return;
    }
    body.innerHTML = rows.map(r => {
      const tip = [
        r.mes + " · SEM " + r.semana,
        r.fundo,
        r.packing,
        r.etapa,
        "COD " + r.cod,
        "Jabas/JR " + fmtNum(r.jabasJr),
        "Kg/JR " + fmtNum(r.kgJr)
      ].join(" · ");
      return `<tr title="${tip}">
        <td class="is-in">${formatDMY(r.fecha)}</td>
        <td class="is-in">${r.variedad}</td>
        <td class="is-in">${r.guia || "—"}</td>
        <td class="is-in">${r.modulo}</td>
        <td class="is-in">${r.turno}</td>
        <td class="is-in num">${r.lote}</td>
        <td class="is-auto num">${fmtNum(r.ha)}</td>
        <td class="is-in num">${r.jorna || "—"}</td>
        <td class="is-in num">${r.jabas}</td>
        <td class="is-in num">${r.jarras}</td>
        <td class="is-auto num">${fmtNum(r.kilosBruto)}</td>
        <td class="is-auto num">${fmtNum(r.kilosHa)}</td>
        <td class="is-auto num">${fmtNum(r.descarte)}</td>
        <td class="is-auto num">${fmtNum(r.kilosNetos)}</td>
      </tr>`;
    }).join("");
    previewAddCalc();
  }

  function mapModules() {
    const mods = (window.MAP_DATA && MAP_DATA.modules) || [];
    if (mods.length) return mods.map(m => ({ id: String(m.id), label: m.label || ("M" + m.id) }));
    const seen = new Set();
    mapLots().forEach(l => {
      if (l.modulo != null) seen.add(String(l.modulo));
    });
    return [...seen].sort((a, b) => Number(a) - Number(b)).map(id => ({ id, label: "M" + id }));
  }

  function fillCascadeModulo() {
    const sel = $("freqAddModulo");
    if (!sel || sel.dataset.ready === "1") return;
    const cur = sel.value;
    sel.innerHTML = `<option value="">Seleccionar</option>` +
      mapModules().map(m => `<option value="${m.id}">${m.label}</option>`).join("");
    if (cur) sel.value = cur;
    sel.dataset.ready = "1";
  }

  function fillCascadeTurno() {
    const mod = String(($("freqAddModulo") && $("freqAddModulo").value) || "");
    const sel = $("freqAddTurno");
    const loteSel = $("freqAddLote");
    if (!sel) return;
    const turns = [];
    const seen = new Set();
    mapLots().forEach(l => {
      if (String(l.modulo) !== mod) return;
      const t = normTurn(l.tunel);
      if (!t || seen.has(t)) return;
      seen.add(t);
      turns.push(t);
    });
    turns.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    sel.innerHTML = `<option value="">Seleccionar</option>` +
      turns.map(t => `<option value="${t}">${t}</option>`).join("");
    sel.disabled = !mod;
    if (loteSel) {
      loteSel.innerHTML = `<option value="">Seleccionar</option>`;
      loteSel.disabled = true;
    }
    previewAddCalc();
  }

  function fillCascadeLote() {
    const mod = String(($("freqAddModulo") && $("freqAddModulo").value) || "");
    const turn = normTurn(($("freqAddTurno") && $("freqAddTurno").value) || "");
    const sel = $("freqAddLote");
    if (!sel) return;
    const items = mapLots()
      .filter(l => String(l.modulo) === mod && normTurn(l.tunel) === turn)
      .sort((a, b) => Number(a.lote) - Number(b.lote));
    sel.innerHTML = `<option value="">Seleccionar</option>` +
      items.map(l =>
        `<option value="${l.lote}" data-ha="${l.ha != null ? l.ha : ""}">LOTE ${l.lote} · ${Number(l.ha || 0).toFixed(2)} ha</option>`
      ).join("");
    sel.disabled = !turn;
    previewAddCalc();
  }

  function previewAddCalc() {
    const jabas = Number(($("freqAddJabas") && $("freqAddJabas").value) || 0);
    let jarras = ($("freqAddJarras") && $("freqAddJarras").value) !== ""
      ? Number($("freqAddJarras").value)
      : null;
    const jorna = Number(($("freqAddJorna") && $("freqAddJorna").value) || 0);
    const lote = Number(($("freqAddLote") && $("freqAddLote").value) || 0);
    const turno = normTurn(($("freqAddTurno") && $("freqAddTurno").value) || "");
    const modulo = normMod(($("freqAddModulo") && $("freqAddModulo").value) || "");
    const packing = String(($("freqAddPacking") && $("freqAddPacking").value) || "QPACK");
    const varU = String(($("freqAddVariedad") && $("freqAddVariedad").value) || variedad || "SEKOYA POP");
    const guia = String(($("freqAddGuia") && $("freqAddGuia").value) || "");
    const fecha = String(($("freqAddFecha") && $("freqAddFecha").value) || "").slice(0, 10);
    const draft = enrichProdRow({
      fecha: fecha || isoTodayLima(),
      packing,
      variedad: varU,
      guia,
      modulo,
      turno,
      lote,
      jorna,
      jabas,
      jarras: jarras == null || !Number.isFinite(jarras) ? undefined : jarras
    });
    if ($("freqAddCod")) $("freqAddCod").textContent = lote ? draft.cod : "—";
    if ($("freqAddHa")) $("freqAddHa").textContent = lote ? fmtNum(draft.ha) : "—";
    if ($("freqAddKgBruto")) $("freqAddKgBruto").textContent = jabas || jarras ? fmtNum(draft.kilosBruto) : "—";
    if ($("freqAddKgNeto")) $("freqAddKgNeto").textContent = jabas || jarras ? fmtNum(draft.kilosNetos) : "—";
  }

  function addFromForm() {
    const fecha = String(($("freqAddFecha") && $("freqAddFecha").value) || "").slice(0, 10);
    const modulo = normMod(($("freqAddModulo") && $("freqAddModulo").value) || "");
    const turno = normTurn(($("freqAddTurno") && $("freqAddTurno").value) || "");
    const lote = Number(($("freqAddLote") && $("freqAddLote").value) || 0);
    const varU = String(($("freqAddVariedad") && $("freqAddVariedad").value) || variedad || "SEKOYA POP").toUpperCase();
    const packing = String(($("freqAddPacking") && $("freqAddPacking").value) || "QPACK").toUpperCase();
    const guia = String(($("freqAddGuia") && $("freqAddGuia").value) || "").trim();
    const jorna = Number(($("freqAddJorna") && $("freqAddJorna").value) || 0);
    const jabas = Number(($("freqAddJabas") && $("freqAddJabas").value) || 0);
    const jarrasRaw = $("freqAddJarras") && $("freqAddJarras").value;
    const jarras = jarrasRaw !== "" && jarrasRaw != null ? Number(jarrasRaw) : undefined;
    if (!fecha || !parseIso(fecha)) {
      alert("Fecha inválida");
      return;
    }
    if (!modulo || !turno || !lote) {
      alert("Completa módulo, turno y lote");
      return;
    }
    if (!(jabas > 0) && !(jarras > 0)) {
      alert("Ingresa jabas o jarras");
      return;
    }
    const list = readProd();
    const dup = list.some(x =>
      String(x.fecha).slice(0, 10) === fecha &&
      normTurn(x.turno) === turno &&
      Number(x.lote) === lote &&
      String(x.variedad || "").toUpperCase() === varU &&
      String(x.guia || "") === guia
    );
    if (dup) {
      alert("Ya existe esa cosecha (fecha + turno + lote + guía)");
      return;
    }
    list.push({
      id: "u-" + Date.now(),
      fecha,
      packing,
      variedad: varU,
      guia,
      modulo,
      turno,
      lote,
      jorna,
      jabas,
      jarras,
      at: Date.now()
    });
    writeProd(list);
    recompute();
    setTab("data");
    selectedKey = lotKey(turno, lote);
    if ($("freqAddJabas")) $("freqAddJabas").value = "";
    if ($("freqAddJarras")) $("freqAddJarras").value = "";
    if ($("freqAddGuia")) $("freqAddGuia").value = "";
    previewAddCalc();
  }

  /* ——— 2) CÁLCULO ——— */
  function modSortKey(m) {
    const n = Number(String(m || "").replace(/\D/g, ""));
    return Number.isFinite(n) ? n : 999;
  }

  function groupLotsByModulo(lots) {
    const map = new Map();
    lots.forEach(lot => {
      const mod = normMod(lot.modulo) || "—";
      if (!map.has(mod)) map.set(mod, []);
      map.get(mod).push(lot);
    });
    const mods = [...map.keys()].sort((a, b) => modSortKey(a) - modSortKey(b) || String(a).localeCompare(b));
    return mods.map(mod => {
      const list = map.get(mod).slice().sort((a, b) =>
        String(a.turno).localeCompare(String(b.turno), undefined, { numeric: true }) ||
        (Number(a.lote) - Number(b.lote))
      );
      const turns = new Map();
      list.forEach(lot => {
        const t = normTurn(lot.turno) || "—";
        if (!turns.has(t)) turns.set(t, []);
        turns.get(t).push(lot);
      });
      const turnList = [...turns.keys()]
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        .map(t => ({ turno: t, list: turns.get(t) }));
      return { mod, list, turnList };
    });
  }

  function closeDrModal() {
    const modal = $("freqDrModal");
    if (modal) {
      modal.hidden = true;
      modal.setAttribute("aria-hidden", "true");
    }
  }

  function openDrModal(lot) {
    if (!lot) return;
    const modal = $("freqDrModal");
    const title = $("freqDrTitle");
    const sub = $("freqDrSub");
    const kpis = $("freqDrKpis");
    const body = $("freqDrBody");
    if (!modal || !body) return;
    const drNow = drActual(lot);
    const tone = freqTone(drNow);
    selectedKey = lotKey(lot.turno, lot.lote);
    if (title) title.textContent = `${lot.turno} · LOTE ${lot.lote}`;
    if (sub) {
      sub.textContent = `${lot.modulo || "—"} · ${lot.variedad || "SEKOYA"} · corte ${formatDMY(cutDate)}`;
    }
    if (kpis) {
      kpis.innerHTML = `
        <div><span>Entradas</span><strong>${lot.nEntradas || 0}</strong></div>
        <div><span>Última</span><strong>${formatDMY(lot.ultima)}</strong></div>
        <div><span>DR actual</span><strong class="dr-${tone}">${drNow != null ? drNow : "—"}</strong></div>`;
    }
    const rows = (lot.entradas || []).map(e => {
      const t = freqTone(e.dr);
      return `<tr>
        <td>${e.n}</td>
        <td>${formatDMY(e.fecha)}</td>
        <td class="num dr-${t}">${e.dr}</td>
      </tr>`;
    }).join("");
    body.innerHTML = rows || `<tr><td colspan="3">Sin días de ingreso</td></tr>`;
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
  }

  function lotCardHtml(lot) {
    const k = lotKey(lot.turno, lot.lote);
    const drNow = drActual(lot);
    const tone = freqTone(drNow);
    const varShort = String(lot.variedad || "SEKOYA").replace(/\s+POP$/i, "");
    return `<button type="button" class="freq-lot-card" data-key="${k}">
      <div class="freq-lot-card-top">
        <strong>LOTE ${lot.lote}</strong>
        <span class="freq-lot-card-plant" aria-hidden="true" title="Cosecha">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 21v-8"/>
            <path d="M12 13c-4.5 0-7-2.5-7-7 4.5 0 7 2.5 7 7z"/>
            <path d="M12 13c4.5 0 7-2.5 7-7-4.5 0-7 2.5-7 7z"/>
          </svg>
        </span>
      </div>
      <div class="freq-lot-card-dr is-${tone}">${drNow != null ? drNow : "—"}</div>
      <p class="freq-lot-card-meta">${lot.nEntradas || 0} entradas · última ${formatDMY(lot.ultima)}</p>
      <p class="freq-lot-card-meta">${varShort} · ${lot.modulo}</p>
    </button>`;
  }

  function renderCalculo() {
    const host = $("freqCalcGrid");
    if (!host) return;
    const q = String(calcFilter || "").toUpperCase().replace(/\s+/g, "");
    const lots = (DATA.lots || []).filter(lot => {
      if (variedad && String(lot.variedad || "").toUpperCase() !== variedad) return false;
      if (!q) return true;
      const blob = (lot.turno + " LOTE " + lot.lote + " " + lot.modulo).toUpperCase().replace(/\s+/g, "");
      return blob.includes(q) || String(lot.lote).includes(q);
    });
    if (!lots.length) {
      host.innerHTML = `<aside class="freq-calc-nav"></aside><div class="freq-calc-main"><p class="freq-empty">Sin lotes para calcular</p></div>`;
      return;
    }

    const groups = groupLotsByModulo(lots);
    if (!calcMod || !groups.some(g => g.mod === calcMod)) {
      calcMod = groups[0].mod;
      calcTurno = "";
    }
    const activeGroup = groups.find(g => g.mod === calcMod) || groups[0];
    if (calcTurno && !activeGroup.turnList.some(t => t.turno === calcTurno)) {
      calcTurno = "";
    }

    const nav = `<aside class="freq-calc-nav freq-hide-scroll" aria-label="Módulos">
      <div class="freq-calc-nav-brand">
        <div class="mark">QB</div>
        <div>
          <strong>Frecuencias</strong>
          <span>Cálculo DR por módulo</span>
        </div>
      </div>
      <p class="freq-calc-nav-label">Módulos</p>
      ${groups.map(g => `
        <button type="button" class="freq-nav-mod-btn ${calcMod === g.mod ? "is-on" : ""}" data-mod="${g.mod}">
          <span class="ico">${g.mod}</span>
          <span class="txt">
            <b>Módulo ${String(g.mod).replace(/^M/i, "")}</b>
            <small>${g.turnList.length} turnos · ${g.list.length} lotes</small>
          </span>
          <span class="count">${g.list.length}</span>
        </button>`).join("")}
    </aside>`;

    const columns = activeGroup.turnList.map(t => {
      const on = calcTurno === t.turno;
      return `<section class="freq-turn-col ${on ? "is-on" : ""}" data-turno="${t.turno}">
        <button type="button" class="freq-turn-col-head" data-turno="${t.turno}">
          <b>${t.turno}</b>
          <span>${t.list.length}</span>
        </button>
        <div class="freq-turn-col-body freq-hide-scroll">
          ${t.list.map(lotCardHtml).join("")}
        </div>
      </section>`;
    }).join("");

    host.innerHTML = `${nav}
      <div class="freq-calc-main">
        <div class="freq-calc-main-head">
          <div>
            <h3>Turnos · ${calcMod}</h3>
            <p>${activeGroup.list.length} lotes en ${activeGroup.turnList.length} turnos · clic en un lote para ver días de ingreso</p>
          </div>
        </div>
        <div class="freq-turn-board freq-hide-scroll">
          ${columns || `<p class="freq-empty">Sin turnos en este módulo</p>`}
        </div>
      </div>`;

    host.querySelectorAll(".freq-nav-mod-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        calcMod = btn.dataset.mod || "";
        calcTurno = "";
        renderCalculo();
      });
    });
    host.querySelectorAll(".freq-turn-col-head").forEach(btn => {
      btn.addEventListener("click", () => {
        const t = btn.dataset.turno || "";
        calcTurno = calcTurno === t ? "" : t;
        renderCalculo();
      });
    });
    host.querySelectorAll(".freq-lot-card").forEach(card => {
      card.addEventListener("click", () => {
        const k = card.dataset.key || "";
        const lot = activeGroup.list.find(l => lotKey(l.turno, l.lote) === k);
        if (lot) openDrModal(lot);
      });
    });
  }

  /* ——— 3) MAPA = mismo #grid de deshierbo (ligero) ——— */
  function paintOnRealMap() {
    const grid = document.getElementById("grid");
    if (!grid) return;
    let stats = { verde: 0, amarillo: 0, rojo: 0, sin: 0 };

    grid.querySelectorAll(".cell:not(.empty)").forEach(cell => {
      const turn = cell.dataset.tunel;
      const lote = cell.dataset.lote;
      const k = lotKey(turn, lote);
      const row = byLotKey.get(k);
      const dr = row ? drActual(row) : null;
      const tone = row ? freqTone(dr) : "sin";
      stats[tone] = (stats[tone] || 0) + 1;

      let badge = cell.querySelector(".freq-days");
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "freq-days";
        cell.appendChild(badge);
      }
      badge.className = "freq-days is-" + tone;
      badge.textContent = row && dr != null ? String(dr) : "—";
      cell.classList.toggle("is-freq-on", selectedKey === k);
      cell.title = row
        ? `LT.${lote} · ${dr} días · ${row.nEntradas} entradas · última ${formatDMY(row.ultima)}`
        : `LT.${lote} · sin historial`;
    });

    const leg = $("freqLegendStats");
    if (leg) leg.textContent = `V ${stats.verde} · A ${stats.amarillo} · R ${stats.rojo} · Sin ${stats.sin}`;
    const cutLbl = $("freqCutLabel");
    if (cutLbl) cutLbl.textContent = formatDMY(cutDate);
  }

  function renderAll() {
    if (tab === "data") renderData();
    else if (tab === "calculo") renderCalculo();
    else paintOnRealMap();
  }

  function syncControls() {
    if ($("freqCutDate") && cutDate) $("freqCutDate").value = cutDate;
    if ($("freqVariedad")) $("freqVariedad").value = variedad;
    if ($("freqAddVariedad")) $("freqAddVariedad").value = variedad;
    if ($("freqCutLabel")) $("freqCutLabel").textContent = formatDMY(cutDate);
    if ($("freqAddFecha") && !$("freqAddFecha").value) $("freqAddFecha").value = isoTodayLima();
  }

  function open(startTab) {
    if (!isDesktop()) {
      if (window.showToast) window.showToast("Frecuencias solo en pantalla grande", true);
      return;
    }
    const screen = $("freqScreen");
    if (!screen) return;
    screen.hidden = false;
    screen.setAttribute("aria-hidden", "false");
    document.body.classList.add("freq-open");
    syncControls();
    const fromHash = tabFromHash();
    const initial = startTab || fromHash || "mapa";
    loadData()
      .then(() => {
        syncControls();
        setTab(initial, { replaceHash: true });
      })
      .catch(err => {
        console.warn("Frecuencias:", err);
        if (window.showToast) window.showToast("No se cargó frecuencias", true, String(err.message || err));
      });
  }

  function close() {
    closeDrModal();
    const screen = $("freqScreen");
    clearRealMapPaint();
    document.body.classList.remove("freq-map-live");
    document.body.style.removeProperty("--freq-bar-h");
    if (screen) {
      screen.classList.remove("is-live-map");
      screen.hidden = true;
      screen.setAttribute("aria-hidden", "true");
    }
    document.body.classList.remove("freq-open");
    clearHash();
    if (typeof window.QBRefreshLabors === "function") {
      try { window.QBRefreshLabors(); } catch (e) { /* ok */ }
    }
  }

  function onRoute() {
    const name = tabFromHash();
    if (!name) {
      if (document.body.classList.contains("freq-open")) close();
      return;
    }
    if (!document.body.classList.contains("freq-open")) {
      open(name);
      return;
    }
    if (name !== tab) setTab(name, { skipHash: true });
  }

  function wire() {
    $("deskFreqBtn")?.addEventListener("click", () => open("mapa"));
    $("freqCloseBtn")?.addEventListener("click", close);
    document.querySelectorAll(".freq-tab").forEach(btn => {
      btn.addEventListener("click", () => setTab(btn.dataset.tab || "mapa"));
    });
    $("freqCutDate")?.addEventListener("change", e => {
      cutDate = String(e.target.value || "").slice(0, 10);
      syncControls();
      renderAll();
    });
    $("freqVariedad")?.addEventListener("change", e => {
      variedad = String(e.target.value || "SEKOYA POP").toUpperCase();
      if (DATA) indexData(DATA);
      selectedKey = "";
      syncControls();
      renderAll();
    });
    $("freqAddBtn")?.addEventListener("click", addFromForm);
    $("freqAddModulo")?.addEventListener("change", fillCascadeTurno);
    $("freqAddTurno")?.addEventListener("change", fillCascadeLote);
    $("freqAddLote")?.addEventListener("change", previewAddCalc);
    ["freqAddJabas", "freqAddJarras", "freqAddJorna", "freqAddFecha", "freqAddPacking", "freqAddVariedad", "freqAddGuia"]
      .forEach(id => $(id)?.addEventListener("input", previewAddCalc));
    $("freqAddJabas")?.addEventListener("change", () => {
      const jabas = Number(($("freqAddJabas") && $("freqAddJabas").value) || 0);
      const jarrasEl = $("freqAddJarras");
      if (jarrasEl && !jarrasEl.value && jabas > 0) {
        const n = (PROD && PROD.cfg && PROD.cfg.jarrasPorJaba) || 12;
        jarrasEl.placeholder = "auto " + (jabas * n);
      }
      previewAddCalc();
    });
    $("freqCalcSearch")?.addEventListener("input", e => {
      calcFilter = String(e.target.value || "");
      renderCalculo();
    });
    $("freqDrClose")?.addEventListener("click", closeDrModal);
    $("freqDrBackdrop")?.addEventListener("click", closeDrModal);
    window.addEventListener("hashchange", onRoute);
    window.addEventListener("popstate", onRoute);
    window.addEventListener("keydown", e => {
      if (e.key !== "Escape") return;
      const modal = $("freqDrModal");
      if (modal && !modal.hidden) {
        closeDrModal();
        return;
      }
      if (document.body.classList.contains("freq-open")) close();
    });
    // Si entran directo con #/data|#/calculo|#/mapa
    if (tabFromHash() && isDesktop()) open(tabFromHash());
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();

  window.QBFreq = { open, close, recompute };
})();
