/**
 * Q Berries — Reporte de Labores · Etapa I
 *
 * Columnas (fila 1 = encabezados, datos desde fila 2):
 *  SEM | FECHA | LABOR PPTO | LABOR REAL | MD | TURNO | LOTE | VARIEDAD |
 *  AREA LOTE | AVANCE | TOTAL (JR) | HORA GUARDADO
 *
 * Acciones: ping · guardar · consultar · get · dashboard
 * Deploy: Web app · Execute as Me · Anyone
 * Opcional: Script property API_TOKEN
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
      return { ok: false, code: 'UNAUTHORIZED', message: 'Token inválido' };
    }

    var action = param_(e, 'action') || '';
    var body = {};

    if (metodo === 'POST' && e.postData && e.postData.contents) {
      try { body = JSON.parse(e.postData.contents); } catch (err) { body = {}; }
      if (body.action) action = body.action;
    }

    action = String(action || 'get').toLowerCase();

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

    if (action === 'consultar') {
      return consultar_(body.data || body);
    }

    if (action === 'get' || action === 'list' || action === '') {
      return getMapa_(body.data || body, e);
    }

    if (action === 'dashboard') {
      var semDash = body.sem || param_(e, 'sem') || semIso_();
      return dashboard_(semDash);
    }

    return { ok: false, message: 'Acción no válida. Use: ping, guardar, consultar, get o dashboard' };
  } catch (err) {
    return { ok: false, message: String(err.message || err) };
  }
}

// ─── GUARDAR ────────────────────────────────────────────────────────────────

function guardar_(d) {
  d = d || {};
  var localId = String(d.localId || '').trim();
  var editar = d.editar === true || d.editar === 'true' || d.editar === 1;

  if (!editar && localId && yaGuardado_(localId)) {
    return {
      ok: true,
      duplicate: true,
      message: 'Labor ya registrada (sin duplicar)'
    };
  }

  var laborReal = texto_(d.laborReal || d.labor_real || '');
  var loteNum = numLote_(d.lote);
  var turno = texto_(d.turno || d.tunel || '');
  if (!laborReal) return { ok: false, message: 'Falta labor real' };
  if (!loteNum) return { ok: false, message: 'Falta lote' };
  if (!turno) return { ok: false, message: 'Falta túnel / turno' };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    return { ok: false, message: 'Servidor ocupado — reintente' };
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
    asegurarEncabezados_(hoja);

    var sem = num_(d.sem) || semIso_();
    var modulo = textoMod_(d.modulo || d.md || '');
    var fechaIso = normalizarFecha_(d.fecha || d.fechaIso || hoy_());

    var areaHa = numDec_(d.area != null ? d.area : d.areaLote);
    var avanceHa = numDec_(d.avance);
    if (areaHa > 0 && avanceHa > areaHa) avanceHa = areaHa;

    var actualizado = false;
    if (editar) {
      var previas = buscarFilasLoteSem_(hoja, turno, loteNum, sem);
      if (previas.length) {
        borrarFilas_(hoja, previas);
        actualizado = true;
      }
    }

    var fila = [
      sem,
      formatFechaSheet_(fechaIso),
      titleCase_(d.laborPpto || d.labor_ppto || ''),
      titleCase_(laborReal),
      modulo,
      turno,
      formatLoteLabel_(turno, loteNum),
      formatVariedad_(d.variedad),
      areaHa,
      avanceHa,
      numDec_(d.totalJr != null ? d.totalJr : d.total_jr),
      horaGuardado_()
    ];

    var primera = hoja.getLastRow() + 1;
    hoja.appendRow(fila);

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

  var cacheKey = 'map_v3_' + [sem || 'all', laborReal || '-', laborPpto || '-', modulo || '-'].join('_');
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
  asegurarEncabezados_(hoja);
  var rows = leerFilas_(hoja);
  var records = {};
  var list = [];

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (sem != null && num_(r.sem) !== sem) continue;
    if (laborReal && norm_(r.laborReal) !== laborReal) continue;
    if (laborPpto && norm_(r.laborPpto) !== laborPpto) continue;
    if (modulo && normMod_(r.modulo) !== modulo) continue;

    var key = claveLote_(r.turno, r.loteNum);
    if (!key) continue;
    if (!records[key] || r.rowIndex >= records[key].rowIndex) {
      records[key] = r;
    }
  }

  for (var k in records) {
    if (!records.hasOwnProperty(k)) continue;
    list.push(filaToCliente_(records[k]));
  }

  var result = {
    ok: true,
    count: list.length,
    filters: { sem: sem, laborReal: laborReal || null, laborPpto: laborPpto || null, modulo: modulo || null },
    records: {},
    list: list,
    fromCache: false
  };

  for (var j = 0; j < list.length; j++) {
    var item = list[j];
    var pk = claveLote_(item.turno, item.lote);
    result.records[pk] = item;
  }

  try {
    CacheService.getScriptCache().put(cacheKey, JSON.stringify(result), 90);
  } catch (ex2) { /* payload grande */ }

  return result;
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
    laborPpto: r.laborPpto,
    laborReal: r.laborReal,
    modulo: r.modulo,
    turno: r.turno,
    lote: r.loteNum,
    loteLabel: r.loteLabel,
    variedad: r.variedad,
    area: r.area,
    avance: r.avance,
    totalJr: r.totalJr,
    horaGuardado: r.horaGuardado
  };
}

function buscarFilasLoteSem_(hoja, turno, loteNum, sem) {
  var rows = leerFilas_(hoja);
  var idx = [];
  var turnoNorm = norm_(turno);
  for (var i = 0; i < rows.length; i++) {
    if (num_(rows[i].sem) !== num_(sem)) continue;
    if (numLote_(rows[i].loteNum) !== numLote_(loteNum)) continue;
    if (norm_(rows[i].turno) !== turnoNorm) continue;
    idx.push(rows[i].rowIndex);
  }
  return idx;
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

function yaGuardado_(localId) {
  return CacheService.getScriptCache().get('lid_' + localId) !== null;
}

function marcarGuardado_(localId) {
  CacheService.getScriptCache().put('lid_' + localId, '1', 21600);
}

function invalidarCacheMapa_(sem) {
  try {
    var cache = CacheService.getScriptCache();
    cache.remove('dash_lab_v2_' + sem);
    cache.remove('dash_lab_v2_' + semIso_());
  } catch (e) { /* ok */ }
}

// ─── Auth / params ──────────────────────────────────────────────────────────

function validarToken_(e) {
  var esperado = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
  if (!esperado) return true;
  var token = param_(e, 'token') || '';
  if (!token && e.postData && e.postData.contents) {
    try { token = JSON.parse(e.postData.contents).token || ''; } catch (err) {}
  }
  return token === esperado;
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
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
}

function formatLoteLabel_(turno, loteNum) {
  var t = String(turno || '').toUpperCase().replace(/\s+/g, '');
  var n = String(loteNum).replace(/\D/g, '');
  while (n.length < 3) n = '0' + n;
  var turn = t.match(/T\d+/i);
  var turnStr = turn ? turn[0].toUpperCase() : (t || 'T00');
  return turnStr + 'L' + n + '-';
}

function parseLoteNum_(label) {
  var m = String(label || '').match(/L(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

function numLote_(v) {
  var n = parseInt(v, 10);
  return isNaN(n) ? 0 : n;
}

function formatVariedad_(v) {
  var s = String(v || '').toUpperCase();
  if (s.indexOf('MAGICA') >= 0) return 'Magica';
  if (s.indexOf('SEKOYA') >= 0 || s.indexOf('SECOYA') >= 0) return 'Secoya Pop';
  return titleCase_(v);
}

function titleCase_(s) {
  s = String(s || '').trim().toLowerCase();
  if (!s) return '';
  return s.replace(/\b([a-záéíóúñ])/gi, function (m) { return m.toUpperCase(); });
}

function formatFechaSheet_(iso) {
  if (!iso) return '';
  var d = iso;
  if (typeof iso === 'string' && iso.match(/^\d{4}-\d{2}-\d{2}/)) {
    d = new Date(iso + 'T12:00:00');
  }
  if (Object.prototype.toString.call(d) === '[object Date]' && !isNaN(d.getTime())) {
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return d.getDate() + '-' + months[d.getMonth()];
  }
  return String(iso);
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
  return norm_(s);
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
