  /**
 * Q Berries — Reporte de Labores · Etapa I
 *
 * Columnas (fila 1 = encabezados, datos desde fila 2):
 *  SEM | FECHA | LABOR PPTO | LABOR REAL | MD | TURNO | LOTE | VARIEDAD |
 *  AREA LOTE | AVANCE | TOTAL (JR) | HORA GUARDADO
 *
 * Formatos:
 *  FECHA = dd/MM/yyyy · LOTE = número · VARIEDAD = SEKOYA POP · HORA = HH:mm:ss
 *
 * Acciones: ping · guardar · guardar_grupo · consultar · get · filtros · dashboard
 * Deploy: Web app · Execute as Me · Anyone
 * Seguridad: Script property API_TOKEN (obligatorio en producción)
 * Opcional: MAX_BATCH (default 40)
 */

var TZ = 'America/Lima';
var HOJA = ''; // vacío = hoja activa
var FILA_ENC = 1;
var FILA_INI = 2;

var COLUMNAS = [
  'SEM', 'FECHA', 'LABOR PPTO', 'LABOR REAL', 'MD', 'TURNO', 'LOTE',
  'VARIEDAD', 'AREA LOTE', 'AVANCE', 'TOTAL (JR)', 'HORA GUARDADO'
];

var COL = {
  SEM: 0,
  FECHA: 1,
  LABOR_PPTO: 2,
  LABOR_REAL: 3,
  MD: 4,
  TURNO: 5,
  LOTE: 6,
  VARIEDAD: 7,
  AREA: 8,
  AVANCE: 9,
  TOTAL_JR: 10,
  HORA_GUARDADO: 11
};

function doGet(e) {
  return responder_(procesar_(e, 'GET'));
}

function doPost(e) {
  return responder_(procesar_(e, 'POST'));
}

function procesar_(e, metodo) {
  try {
    if (!validarToken_(e)) {
      return { ok: false, code: 'UNAUTHORIZED', message: 'No autorizado' };
    }

    if (!rateLimitOk_(e)) {
      return { ok: false, code: 'RATE_LIMIT', message: 'Demasiadas solicitudes — espere unos segundos' };
    }

    var action = param_(e, 'action') || '';
    var body = {};

    if (metodo === 'POST' && e.postData && e.postData.contents) {
      var raw = String(e.postData.contents || '');
      if (raw.length > 120000) {
        return { ok: false, code: 'PAYLOAD_TOO_LARGE', message: 'Payload demasiado grande' };
      }
      try { body = JSON.parse(raw); } catch (err) { body = {}; }
      if (body.action) action = body.action;
    }

    action = String(action || 'get').toLowerCase().replace(/[^a-z_]/g, '');

    if (action === 'ping') {
      return {
        ok: true,
        message: 'pong',
        hoy: hoy_(),
        semana: semIso_(),
        tz: TZ,
        hoja: obtenerHoja_().getName()
      };
    }

    if (action === 'guardar' || action === 'save' || action === 'post') {
      return guardar_(body.data || body);
    }

    if (action === 'guardar_grupo' || action === 'guardar_lote' || action === 'save_batch') {
      return guardarGrupo_(body.data || body);
    }

    if (action === 'consultar') {
      return consultar_(body.data || body);
    }

    if (action === 'get' || action === 'list' || action === '') {
      return getMapa_(body.data || body, e);
    }

    if (action === 'filtros' || action === 'filters') {
      return filtrosOpciones_();
    }

    if (action === 'dashboard') {
      var semDash = body.sem || param_(e, 'sem') || semIso_();
      return dashboard_(semDash);
    }

    return { ok: false, code: 'BAD_ACTION', message: 'Acción no válida' };
  } catch (err) {
    return { ok: false, code: 'SERVER_ERROR', message: 'Error interno' };
  }
}

// ─── GUARDAR ────────────────────────────────────────────────────────────────

function guardar_(d) {
  d = d || {};
  var check = validarPayloadLabor_(d);
  if (!check.ok) return check;

  var localId = safeId_(d.localId);
  var editar = d.editar === true || d.editar === 'true' || d.editar === 1;

  if (!editar && localId && yaGuardado_(localId)) {
    return {
      ok: true,
      duplicate: true,
      message: 'Labor ya registrada (sin duplicar)'
    };
  }

  var laborReal = check.laborReal;
  var loteNum = check.lote;
  var turno = check.turno;

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    return { ok: false, code: 'BUSY', message: 'Servidor ocupado — reintente' };
  }

  try {
    if (!editar && localId && yaGuardado_(localId)) {
      return {
        ok: true,
        duplicate: true,
        message: 'Labor ya registrada (sin duplicar)'
      };
    }

    var hoja = obtenerHoja_();
    if (hoja.getLastRow() < FILA_INI) asegurarEncabezados_(hoja);

    var sem = check.sem;
    var modulo = check.modulo;
    var fechaIso = check.fecha;
    var areaHa = check.area;
    var avanceHa = check.avance;
    var laborPpto = check.laborPpto;
    var variedad = check.variedad;
    var totalJr = check.totalJr;

    var rows = leerFilas_(hoja);
    var actualizado = false;
    var previas = buscarEnFilas_(rows, turno, loteNum, sem, laborReal);
    if (previas.length) {
      borrarFilas_(hoja, previas);
      actualizado = true;
    }

    var fila = [
      sem,
      formatFechaSheet_(fechaIso),
      laborPpto,
      laborReal,
      modulo,
      turno,
      loteNum,
      variedad,
      areaHa,
      avanceHa,
      totalJr,
      horaGuardado_()
    ];

    var primera = hoja.getLastRow() + 1;
    hoja.getRange(primera, 1, 1, COLUMNAS.length).setValues([fila]);

    if (localId) marcarGuardado_(localId);
    invalidarCacheMapa_(sem);

    return {
      ok: true,
      updated: actualizado,
      row: primera,
      lote: loteNum,
      turno: turno,
      avance: avanceHa,
      horaGuardado: fila[COL.HORA_GUARDADO],
      message: (actualizado ? 'Actualizado' : 'Guardado') +
        ' — LOTE ' + loteNum + ' · ' + avanceHa + ' ha'
    };
  } finally {
    lock.releaseLock();
  }
}

/** Guardado grupal seguro: un solo lock, validación por ítem, tope de lote */
function guardarGrupo_(payload) {
  payload = payload || {};
  var items = payload.items || payload.lotes || payload.records || [];
  if (!Array.isArray(items) || !items.length) {
    return { ok: false, code: 'EMPTY', message: 'Sin lotes para guardar' };
  }

  var maxBatch = maxBatch_();
  if (items.length > maxBatch) {
    return {
      ok: false,
      code: 'BATCH_TOO_LARGE',
      message: 'Máximo ' + maxBatch + ' lotes por guardado grupal'
    };
  }

  var laborRealComun = texto_(payload.laborReal || '');
  var laborPptoComun = texto_(payload.laborPpto || '');
  var fechaComun = payload.fecha || '';
  var semComun = payload.sem;
  var variedadComun = payload.variedad;
  var totalJrComun = payload.totalJr;

  var validados = [];
  for (var i = 0; i < items.length; i++) {
    var raw = items[i] || {};
    var merged = {
      localId: raw.localId,
      sem: raw.sem != null ? raw.sem : semComun,
      fecha: raw.fecha || fechaComun,
      laborPpto: raw.laborPpto || laborPptoComun,
      laborReal: raw.laborReal || laborRealComun,
      modulo: raw.modulo,
      turno: raw.turno || raw.tunel,
      lote: raw.lote,
      variedad: raw.variedad || variedadComun,
      area: raw.area != null ? raw.area : raw.areaLote,
      avance: raw.avance,
      totalJr: raw.totalJr != null ? raw.totalJr : totalJrComun
    };
    var check = validarPayloadLabor_(merged);
    if (!check.ok) {
      return {
        ok: false,
        code: check.code || 'INVALID_ITEM',
        message: 'Lote ' + (i + 1) + ': ' + check.message,
        index: i
      };
    }
    check.localId = safeId_(merged.localId);
    validados.push(check);
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return { ok: false, code: 'BUSY', message: 'Servidor ocupado — reintente' };
  }

  try {
    var hoja = obtenerHoja_();
    if (hoja.getLastRow() < FILA_INI) asegurarEncabezados_(hoja);

    var rows = leerFilas_(hoja);
    var saved = [];
    var skipped = 0;
    var updated = 0;
    var deleteMap = {};
    var appendRows = [];
    var hora = horaGuardado_();

    for (var j = 0; j < validados.length; j++) {
      var v = validados[j];
      if (v.localId && yaGuardado_(v.localId)) {
        skipped++;
        saved.push({ ok: true, duplicate: true, lote: v.lote, turno: v.turno });
        continue;
      }

      var previas = buscarEnFilas_(rows, v.turno, v.lote, v.sem, v.laborReal);
      if (previas.length) {
        for (var p = 0; p < previas.length; p++) deleteMap[previas[p]] = true;
        updated++;
      }

      appendRows.push([
        v.sem,
        formatFechaSheet_(v.fecha),
        v.laborPpto,
        v.laborReal,
        v.modulo,
        v.turno,
        v.lote,
        v.variedad,
        v.area,
        v.avance,
        v.totalJr,
        hora
      ]);
      if (v.localId) marcarGuardado_(v.localId);
      saved.push({
        ok: true,
        lote: v.lote,
        turno: v.turno,
        avance: v.avance,
        updated: previas.length > 0
      });
    }

    var delIdx = [];
    for (var dk in deleteMap) {
      if (deleteMap.hasOwnProperty(dk)) delIdx.push(Number(dk));
    }
    if (delIdx.length) borrarFilas_(hoja, delIdx);

    if (appendRows.length) {
      var start = hoja.getLastRow() + 1;
      hoja.getRange(start, 1, appendRows.length, COLUMNAS.length).setValues(appendRows);
    }

    if (validados.length) invalidarCacheMapa_(validados[0].sem);

    return {
      ok: true,
      count: saved.length,
      updated: updated,
      skipped: skipped,
      items: saved,
      message: 'Grupo guardado — ' + (saved.length - skipped) + ' lote(s)'
    };
  } finally {
    lock.releaseLock();
  }
}

// ─── CONSULTAR (un lote) ────────────────────────────────────────────────────

function consultar_(d) {
  d = d || {};
  var sem = d.sem != null && d.sem !== '' ? num_(d.sem) : null;
  var lote = d.lote != null && d.lote !== '' ? numLote_(d.lote) : null;
  var turno = texto_(d.turno || d.tunel || '');

  if (!lote) {
    return { ok: false, message: 'Indique lote' };
  }

  var hoja = obtenerHoja_();
  asegurarEncabezados_(hoja);
  var rows = leerFilas_(hoja);
  var match = null;

  for (var i = rows.length - 1; i >= 0; i--) {
    var r = rows[i];
    if (sem != null && num_(r.sem) !== sem) continue;
    if (numLote_(r.loteNum) !== lote) continue;
    if (turno && norm_(r.turno) !== turno) continue;
    match = r;
    break;
  }

  if (!match) {
    return { ok: true, existe: false, lote: lote, turno: turno || null };
  }

  return {
    ok: true,
    existe: true,
    data: filaToCliente_(match)
  };
}

// ─── GET MAPA (pintar avances) ──────────────────────────────────────────────

function getMapa_(d, e) {
  d = d || {};
  var sem = d.sem != null && d.sem !== '' ? num_(d.sem) : (param_(e, 'sem') ? num_(param_(e, 'sem')) : null);
  var laborReal = norm_(d.laborReal || d.labor_real || param_(e, 'laborReal') || '');
  var laborPpto = norm_(d.laborPpto || d.labor_ppto || param_(e, 'laborPpto') || '');
  var modulo = normMod_(d.modulo || d.md || param_(e, 'modulo') || '');
  var variedad = formatVariedad_(d.variedad || param_(e, 'variedad') || '');
  if (!String(d.variedad || param_(e, 'variedad') || '').trim()) variedad = '';
  var fechaFiltro = String(d.fecha || param_(e, 'fecha') || '').trim();

  var cacheVer = mapaCacheVer_();
  var cacheKey = 'map_v7_' + cacheVer + '_' + [
    sem || 'all', laborReal || '-', laborPpto || '-', modulo || '-',
    variedad || '-', fechaFiltro || '-'
  ].join('_');
  try {
    var cached = CacheService.getScriptCache().get(cacheKey);
    if (cached) {
      var parsed = JSON.parse(cached);
      if (parsed && parsed.ok) {
        parsed.fromCache = true;
        return parsed;
      }
    }
  } catch (ex) { /* sin cache */ }

  var hoja = obtenerHoja_();
  var rows = leerFilas_(hoja);
  var latest = {};
  var list = [];
  var fechaIsoFiltro = fechaFiltro ? normalizarFecha_(fechaFiltro) : '';

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (sem != null && num_(r.sem) !== sem) continue;
    if (laborReal && norm_(r.laborReal) !== laborReal) continue;
    if (laborPpto && norm_(r.laborPpto) !== laborPpto) continue;
    if (modulo && normMod_(r.modulo) !== modulo) continue;
    if (variedad && formatVariedad_(r.variedad) !== variedad) continue;
    if (fechaFiltro) {
      var rIso = r.fechaIso || normalizarFecha_(r.fecha);
      var rRaw = String(r.fecha || '').trim();
      var rDisp = formatFechaSheet_(rIso);
      if (rIso !== fechaIsoFiltro && rRaw !== fechaFiltro && rDisp !== fechaFiltro) continue;
    }

    var key = claveLote_(r.turno, r.loteNum);
    if (!key) continue;
    if (!latest[key] || r.rowIndex >= latest[key].rowIndex) {
      latest[key] = r;
    }
  }

  for (var k in latest) {
    if (!latest.hasOwnProperty(k)) continue;
    list.push(filaToCliente_(latest[k]));
  }

  // Solo list (sin records duplicados) → respuesta más liviana
  var result = {
    ok: true,
    count: list.length,
    filters: {
      sem: sem,
      laborReal: laborReal || null,
      laborPpto: laborPpto || null,
      modulo: modulo || null,
      variedad: variedad || null,
      fecha: fechaFiltro || null
    },
    list: list,
    fromCache: false
  };

  try {
    CacheService.getScriptCache().put(cacheKey, JSON.stringify(result), 180);
  } catch (ex2) { /* payload grande */ }

  return result;
}

/** Valores únicos de la hoja para el panel de filtros */
function filtrosOpciones_() {
  var hoja = obtenerHoja_();
  asegurarEncabezados_(hoja);
  var rows = leerFilas_(hoja);
  var semMap = {};
  var fechaMap = {};
  var mdMap = {};
  var laborMap = {};

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var s = num_(r.sem);
    if (s) semMap[s] = true;

    var fDisp = formatFechaSheet_(r.fechaIso || r.fecha);
    var fRaw = String(r.fecha || '').trim();
    if (fDisp) fechaMap[fDisp] = true;
    else if (fRaw) fechaMap[fRaw] = true;

    var md = normMod_(r.modulo);
    if (md && md.indexOf('REF') < 0 && md !== 'M') mdMap[md] = true;

    var lab = norm_(r.laborReal);
    if (lab) laborMap[lab] = true;
  }

  var sem = Object.keys(semMap).map(function (x) { return parseInt(x, 10); });
  sem.sort(function (a, b) { return a - b; });

  var fecha = Object.keys(fechaMap);
  fecha.sort(function (a, b) {
    return String(normalizarFecha_(a)).localeCompare(String(normalizarFecha_(b)));
  });

  var md = Object.keys(mdMap);
  md.sort(function (a, b) {
    return num_(String(a).replace(/\D/g, '')) - num_(String(b).replace(/\D/g, ''));
  });

  var laborReal = Object.keys(laborMap);
  laborReal.sort();

  return {
    ok: true,
    sem: sem,
    fecha: fecha,
    md: md,
    laborReal: laborReal,
    count: rows.length
  };
}

// ─── DASHBOARD resumen por semana ───────────────────────────────────────────

function dashboard_(semFiltro) {
  var sem = semFiltro != null && semFiltro !== '' ? num_(semFiltro) : semIso_();
  var cacheKey = 'dash_lab_v2_' + sem;

  try {
    var cached = CacheService.getScriptCache().get(cacheKey);
    if (cached) {
      var parsed = JSON.parse(cached);
      if (parsed && parsed.ok) {
        parsed.fromCache = true;
        return parsed;
      }
    }
  } catch (e) { /* ok */ }

  var hoja = obtenerHoja_();
  asegurarEncabezados_(hoja);
  var rows = leerFilas_(hoja);

  var totales = {
    lotes: 0,
    avanceHa: 0,
    areaHa: 0,
    registros: 0,
    jr: 0
  };
  var byLabor = {};
  var byModulo = {};
  var ultimos = {};

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (num_(r.sem) !== sem) continue;

    var pk = claveLote_(r.turno, r.loteNum);
    if (!pk) continue;
    if (!ultimos[pk] || r.rowIndex >= ultimos[pk].rowIndex) {
      ultimos[pk] = r;
    }
  }

  for (var key in ultimos) {
    if (!ultimos.hasOwnProperty(key)) continue;
    var row = ultimos[key];
    totales.lotes += 1;
    totales.avanceHa += numDec_(row.avance);
    totales.areaHa += numDec_(row.area);
    totales.registros += 1;
    totales.jr += numDec_(row.totalJr);

    var lab = norm_(row.laborReal) || 'SIN LABOR';
    if (!byLabor[lab]) byLabor[lab] = { labor: lab, lotes: 0, avanceHa: 0 };
    byLabor[lab].lotes += 1;
    byLabor[lab].avanceHa += numDec_(row.avance);

    var mod = normMod_(row.modulo) || 'SIN MOD';
    if (!byModulo[mod]) byModulo[mod] = { modulo: mod, lotes: 0, avanceHa: 0 };
    byModulo[mod].lotes += 1;
    byModulo[mod].avanceHa += numDec_(row.avance);
  }

  var labores = [];
  for (var lb in byLabor) {
    if (byLabor.hasOwnProperty(lb)) labores.push(byLabor[lb]);
  }
  labores.sort(function (a, b) { return b.avanceHa - a.avanceHa; });

  var modulos = [];
  for (var md in byModulo) {
    if (byModulo.hasOwnProperty(md)) modulos.push(byModulo[md]);
  }
  modulos.sort(function (a, b) { return b.avanceHa - a.avanceHa; });

  var result = {
    ok: true,
    sem: sem,
    totales: totales,
    labores: labores,
    modulos: modulos,
    generatedAt: new Date().toISOString(),
    fromCache: false
  };

  try {
    CacheService.getScriptCache().put(cacheKey, JSON.stringify(result), 90);
  } catch (e3) { /* ok */ }

  return result;
}

// ─── Lectura hoja ───────────────────────────────────────────────────────────

function leerFilas_(hoja) {
  var last = hoja.getLastRow();
  if (last < FILA_INI) return [];

  var data = hoja.getRange(FILA_INI, 1, last - FILA_INI + 1, COLUMNAS.length).getValues();
  var out = [];

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var laborReal = String(row[COL.LABOR_REAL] || '').trim();
    var loteLabel = String(row[COL.LOTE] || '').trim();
    if (!laborReal && !loteLabel) continue;

    out.push({
      rowIndex: FILA_INI + i,
      sem: row[COL.SEM],
      fecha: row[COL.FECHA],
      fechaIso: normalizarFecha_(row[COL.FECHA]),
      laborPpto: String(row[COL.LABOR_PPTO] || '').trim(),
      laborReal: laborReal,
      modulo: String(row[COL.MD] || '').trim(),
      turno: String(row[COL.TURNO] || '').trim(),
      loteLabel: loteLabel,
      loteNum: parseLoteNum_(loteLabel),
      variedad: String(row[COL.VARIEDAD] || '').trim(),
      area: numDec_(row[COL.AREA]),
      avance: numDec_(row[COL.AVANCE]),
      totalJr: numDec_(row[COL.TOTAL_JR]),
      horaGuardado: String(row[COL.HORA_GUARDADO] || '').trim()
    });
  }
  return out;
}

function filaToCliente_(r) {
  return {
    sem: num_(r.sem),
    fecha: r.fechaIso || r.fecha,
    fechaIso: r.fechaIso || '',
    laborPpto: r.laborPpto,
    laborReal: r.laborReal,
    modulo: r.modulo,
    turno: r.turno,
    lote: r.loteNum,
    loteLabel: r.loteLabel,
    variedad: formatVariedad_(r.variedad),
    area: r.area,
    avance: r.avance,
    totalJr: r.totalJr,
    horaGuardado: r.horaGuardado
  };
}

function buscarEnFilas_(rows, turno, loteNum, sem, laborReal) {
  var idx = [];
  var turnoNorm = norm_(turno);
  var laborNorm = laborReal != null && laborReal !== '' ? norm_(laborReal) : '';
  var semN = num_(sem);
  var loteN = numLote_(loteNum);
  for (var i = 0; i < rows.length; i++) {
    if (num_(rows[i].sem) !== semN) continue;
    if (numLote_(rows[i].loteNum) !== loteN) continue;
    if (norm_(rows[i].turno) !== turnoNorm) continue;
    if (laborNorm && norm_(rows[i].laborReal) !== laborNorm) continue;
    idx.push(rows[i].rowIndex);
  }
  return idx;
}

function buscarFilasLoteSem_(hoja, turno, loteNum, sem) {
  return buscarEnFilas_(leerFilas_(hoja), turno, loteNum, sem, '');
}

function buscarFilasLoteSemLabor_(hoja, turno, loteNum, sem, laborReal) {
  return buscarEnFilas_(leerFilas_(hoja), turno, loteNum, sem, laborReal);
}

function claveLote_(turno, loteNum) {
  var t = norm_(turno);
  var n = numLote_(loteNum);
  if (!t || !n) return '';
  return t + '|' + n;
}

function borrarFilas_(hoja, indices) {
  indices = indices.slice().sort(function (a, b) { return b - a; });
  for (var i = 0; i < indices.length; i++) {
    hoja.deleteRow(indices[i]);
  }
}

function asegurarEncabezados_(hoja) {
  var lastRow = hoja.getLastRow();
  var lastCol = Math.max(hoja.getLastColumn(), COLUMNAS.length);

  if (lastRow === 0) {
    hoja.getRange(FILA_ENC, 1, 1, COLUMNAS.length).setValues([COLUMNAS]);
    estilizarEncabezados_(hoja);
    return;
  }

  var headers = limpiarHeaders_(hoja.getRange(FILA_ENC, 1, 1, lastCol).getValues()[0]);
  if (headers[0] === 'SEM' && headers.indexOf('HORA GUARDADO') >= 0) return;

  var cur = hoja.getRange(FILA_ENC, 1, 1, COLUMNAS.length).getValues()[0];
  var vacio = true;
  for (var i = 0; i < cur.length; i++) {
    if (String(cur[i] || '').trim()) { vacio = false; break; }
  }
  if (vacio) {
    hoja.getRange(FILA_ENC, 1, 1, COLUMNAS.length).setValues([COLUMNAS]);
  }
  estilizarEncabezados_(hoja);
}

function estilizarEncabezados_(hoja) {
  hoja.getRange(FILA_ENC, 1, 1, COLUMNAS.length)
    .setFontWeight('bold')
    .setBackground('#1a5c40')
    .setFontColor('#FFFFFF');
  hoja.setFrozenRows(FILA_ENC);
}

function obtenerHoja_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (HOJA) {
    var h = ss.getSheetByName(HOJA);
    if (!h) throw new Error('No existe la hoja: ' + HOJA);
    return h;
  }
  return ss.getActiveSheet();
}

// ─── Cache / dedup ──────────────────────────────────────────────────────────

/** Dedupe durable: Cache (rápido) + Script Properties (sobrevive >6h). Marcar SOLO tras escribir. */
function yaGuardado_(localId) {
  if (!localId) return false;
  var key = 'lid_' + localId;
  try {
    if (CacheService.getScriptCache().get(key) !== null) return true;
  } catch (e) { /* ok */ }
  try {
    var v = PropertiesService.getScriptProperties().getProperty(key);
    if (v) {
      try { CacheService.getScriptCache().put(key, '1', 21600); } catch (e2) { /* ok */ }
      return true;
    }
  } catch (e) { /* ok */ }
  return false;
}

function marcarGuardado_(localId) {
  if (!localId) return;
  var key = 'lid_' + localId;
  try {
    CacheService.getScriptCache().put(key, '1', 21600);
  } catch (e) { /* ok */ }
  try {
    PropertiesService.getScriptProperties().setProperty(key, String(Date.now()));
  } catch (e) { /* quota: cache sigue cubriendo ~6h */ }
}

function mapaCacheVer_() {
  try {
    return CacheService.getScriptCache().get('map_cache_ver') || '0';
  } catch (e) {
    return '0';
  }
}

function bumpMapaCache_() {
  try {
    CacheService.getScriptCache().put('map_cache_ver', String(Date.now()), 21600);
  } catch (e) { /* ok */ }
}

function invalidarCacheMapa_(sem) {
  try {
    var cache = CacheService.getScriptCache();
    cache.remove('dash_lab_v2_' + sem);
    cache.remove('dash_lab_v2_' + semIso_());
    bumpMapaCache_();
  } catch (e) { /* ok */ }
}

// ─── Auth / params / seguridad ──────────────────────────────────────────────

function validarToken_(e) {
  var esperado = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
  if (!esperado) {
    // Sin token configurado: permitir (dev). En producción configure API_TOKEN.
    return true;
  }
  var token = param_(e, 'token') || '';
  if (!token && e.postData && e.postData.contents) {
    try {
      var parsed = JSON.parse(e.postData.contents);
      token = parsed.token || (parsed.data && parsed.data.token) || '';
    } catch (err) {}
  }
  token = String(token || '');
  esperado = String(esperado);
  if (token.length !== esperado.length) return false;
  // Comparación en tiempo constante (aprox.)
  var diff = 0;
  for (var i = 0; i < esperado.length; i++) {
    diff |= token.charCodeAt(i) ^ esperado.charCodeAt(i);
  }
  return diff === 0;
}

function rateLimitOk_(e) {
  try {
    var cache = CacheService.getScriptCache();
    var tok = String(param_(e, 'token') || 'anon').replace(/[^a-zA-Z0-9_\-]/g, '').substring(0, 40);
    var key = 'rl_' + (tok || 'anon');
    var n = Number(cache.get(key) || '0');
    if (n >= 60) return false;
    cache.put(key, String(n + 1), 60);
    return true;
  } catch (err) {
    return true;
  }
}

function maxBatch_() {
  var n = Number(PropertiesService.getScriptProperties().getProperty('MAX_BATCH') || '40');
  if (!isFinite(n) || n < 1) n = 40;
  if (n > 80) n = 80;
  return Math.floor(n);
}

function safeId_(v) {
  var s = String(v || '').trim().substring(0, 80);
  return s.replace(/[^a-zA-Z0-9_\-\.]/g, '');
}

function safeSheetText_(s, maxLen) {
  maxLen = maxLen || 80;
  s = String(s || '').trim().toUpperCase();
  if (s.length > maxLen) s = s.substring(0, maxLen);
  // Anti formula-injection en Google Sheets
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  s = s.replace(/[\u0000-\u001f\u007f]/g, '');
  return s;
}

function validarPayloadLabor_(d) {
  d = d || {};
  var laborReal = safeSheetText_(d.laborReal || d.labor_real || '', 80);
  var laborPpto = safeSheetText_(d.laborPpto || d.labor_ppto || '', 80);
  var turno = safeSheetText_(d.turno || d.tunel || '', 20);
  var modulo = safeSheetText_(textoMod_(d.modulo || d.md || ''), 12);
  var loteNum = numLote_(d.lote);
  var sem = num_(d.sem) || semIso_();
  var areaHa = numDec_(d.area != null ? d.area : d.areaLote);
  var avanceHa = numDec_(d.avance);
  var totalJr = numDec_(d.totalJr != null ? d.totalJr : d.total_jr);
  var variedad = formatVariedad_(d.variedad);
  var fechaIso = normalizarFecha_(d.fecha || d.fechaIso || hoy_());

  if (!laborReal) return { ok: false, code: 'MISSING_LABOR', message: 'Falta labor real' };
  if (!loteNum || loteNum < 1 || loteNum > 99999) {
    return { ok: false, code: 'BAD_LOTE', message: 'Lote inválido' };
  }
  if (!turno || !/^T?\d{1,3}$/i.test(turno.replace(/\s/g, ''))) {
    // aceptar T1, T10, 1 → normalizar a T#
    var tNum = String(turno).replace(/\D/g, '');
    if (!tNum) return { ok: false, code: 'BAD_TURNO', message: 'Túnel / turno inválido' };
    turno = 'T' + tNum;
  } else {
    turno = norm_(turno);
    if (turno.charAt(0) !== 'T') turno = 'T' + turno.replace(/\D/g, '');
  }
  if (sem < 1 || sem > 53) return { ok: false, code: 'BAD_SEM', message: 'Semana inválida' };
  if (areaHa < 0 || areaHa > 500) return { ok: false, code: 'BAD_AREA', message: 'Área inválida' };
  if (avanceHa < 0 || avanceHa > 500) return { ok: false, code: 'BAD_AVANCE', message: 'Avance inválido' };
  if (areaHa > 0 && avanceHa > areaHa) avanceHa = areaHa;
  if (totalJr < 0 || totalJr > 100000) totalJr = 0;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fechaIso))) {
    return { ok: false, code: 'BAD_FECHA', message: 'Fecha inválida' };
  }
  if (variedad !== 'SEKOYA POP' && variedad !== 'MAGICA') {
    variedad = 'SEKOYA POP';
  }

  var allow = PropertiesService.getScriptProperties().getProperty('LABOR_ALLOWLIST');
  if (allow) {
    var okLabor = false;
    var parts = String(allow).split('|');
    for (var i = 0; i < parts.length; i++) {
      if (norm_(parts[i]) === laborReal) { okLabor = true; break; }
    }
    if (!okLabor) return { ok: false, code: 'LABOR_NOT_ALLOWED', message: 'Labor no permitida' };
  }

  return {
    ok: true,
    laborReal: laborReal,
    laborPpto: laborPpto,
    turno: turno,
    modulo: modulo,
    lote: loteNum,
    sem: sem,
    area: areaHa,
    avance: avanceHa,
    totalJr: totalJr,
    variedad: variedad,
    fecha: fechaIso
  };
}

function param_(e, key) {
  if (!e || !e.parameter) return '';
  return e.parameter[key] != null ? String(e.parameter[key]) : '';
}

function responder_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─── Formato ────────────────────────────────────────────────────────────────

function horaGuardado_() {
  return Utilities.formatDate(new Date(), TZ, 'HH:mm:ss');
}

function parseLoteNum_(label) {
  if (typeof label === 'number' && isFinite(label)) return Math.round(label);
  var s = String(label || '').trim();
  if (!s) return null;
  var m = s.match(/L(\d+)/i);
  if (m) return parseInt(m[1], 10);
  var n = parseInt(s.replace(/[^\d]/g, ''), 10);
  return isNaN(n) ? null : n;
}

function numLote_(v) {
  var n = parseLoteNum_(v);
  return n == null ? 0 : n;
}

function formatVariedad_(v) {
  var s = String(v || '').toUpperCase().trim();
  if (!s) return 'SEKOYA POP';
  if (s.indexOf('MAGICA') >= 0 || s.indexOf('MÁGICA') >= 0) return 'MAGICA';
  if (s.indexOf('SEKOYA') >= 0 || s.indexOf('SECOYA') >= 0) return 'SEKOYA POP';
  return s;
}

function formatFechaSheet_(iso) {
  var isoNorm = normalizarFecha_(iso);
  var m = String(isoNorm || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[3] + '/' + m[2] + '/' + m[1];
  return Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy');
}

function pad2_(n) {
  n = String(n);
  return n.length < 2 ? '0' + n : n;
}

function normalizarFecha_(v) {
  var ssTz = TZ;
  try {
    ssTz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone() || TZ;
  } catch (e) { /* ok */ }

  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) {
    return Utilities.formatDate(v, ssTz, 'yyyy-MM-dd');
  }
  if (typeof v === 'number' && isFinite(v) && v > 20000 && v < 80000) {
    var epoch = new Date(Date.UTC(1899, 11, 30));
    var asDate = new Date(epoch.getTime() + Math.round(v) * 86400000);
    return Utilities.formatDate(asDate, 'UTC', 'yyyy-MM-dd');
  }
  var s = String(v || '').trim();
  if (!s) return hoy_();
  var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3];
  var dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) return dmy[3] + '-' + pad2_(dmy[2]) + '-' + pad2_(dmy[1]);
  var eng = s.match(/^(\d{1,2})-([A-Za-z]{3})(?:-(\d{2,4}))?$/);
  if (eng) {
    var months = { JAN:0, FEB:1, MAR:2, APR:3, MAY:4, JUN:5, JUL:6, AUG:7, SEP:8, OCT:9, NOV:10, DEC:11 };
    var mi = months[String(eng[2]).toUpperCase()];
    if (mi != null) {
      var yy = eng[3] ? parseInt(eng[3], 10) : new Date().getFullYear();
      if (yy < 100) yy += 2000;
      var dd = new Date(yy, mi, parseInt(eng[1], 10));
      return Utilities.formatDate(dd, ssTz, 'yyyy-MM-dd');
    }
  }
  var parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    return Utilities.formatDate(parsed, ssTz, 'yyyy-MM-dd');
  }
  return s;
}

function norm_(s) {
  return String(s || '').trim().toUpperCase();
}

function normMod_(s) {
  s = norm_(s);
  if (!s) return '';
  if (s.charAt(0) === 'M') return s;
  return 'M' + s.replace(/\D/g, '');
}

function textoMod_(s) {
  return normMod_(s);
}

function texto_(s) {
  return safeSheetText_(s, 80);
}

function num_(v) {
  var n = parseInt(v, 10);
  return isNaN(n) ? 0 : n;
}

function numDec_(v) {
  var n = parseFloat(v);
  return isNaN(n) ? 0 : Math.round(n * 100) / 100;
}

function limpiarHeaders_(arr) {
  var out = [];
  for (var i = 0; i < arr.length; i++) {
    var v = String(arr[i] || '').trim();
    if (v) out.push(v);
  }
  return out;
}

function hoy_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
}

function semIso_(date) {
  var d = date ? new Date(date) : new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  var week1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
}

// ─── Pruebas ────────────────────────────────────────────────────────────────

function testGuardar() {
  Logger.log(JSON.stringify(guardar_({
    localId: 'test_' + Date.now(),
    sem: semIso_(),
    fecha: hoy_(),
    laborPpto: 'ARENADO DE MACETAS',
    laborReal: 'ARENADO DE MACETAS',
    modulo: 'M4',
    turno: 'T10',
    lote: 179,
    variedad: 'SEKOYA POP',
    area: 0.49,
    avance: 0.49,
    totalJr: 10
  })));
}

function testGetMapa() {
  Logger.log(JSON.stringify(getMapa_({ sem: semIso_() }, {})));
}

function testDashboard() {
  Logger.log(JSON.stringify(dashboard_(semIso_())));
}
