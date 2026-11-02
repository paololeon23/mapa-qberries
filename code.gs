  /**
 * Q Berries — Reporte de Labores · Etapa I
 *
 * Columnas (fila 1 = encabezados, datos desde fila 2):
 *  SEM | FECHA | LABOR REAL | MD | TURNO | LOTE | VARIEDAD |
 *  AREA LOTE | AVANCE | ML | TOTAL (JR) | COLOR | HORA GUARDADO
 *
 * Hoja "RESUMEN DIA":
 *  FECHA | SEM | LABOR REAL | MD | AREA TOTAL | ML | JR | RATIO
 *  Un renglón por día + labor + módulo (DESHIERBO, ARENADO y CERCOS no se mezclan).
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
var HOJA = 'LABORES';
var HOJA_RESUMEN = 'RESUMEN DIA';
var FILA_ENC = 1;
var FILA_INI = 2;

var COLUMNAS = [
  'SEM', 'FECHA', 'LABOR REAL', 'MD', 'TURNO', 'LOTE',
  'VARIEDAD', 'AREA LOTE', 'AVANCE', 'ML', 'TOTAL (JR)', 'COLOR', 'HORA GUARDADO'
];

var COL = {
  SEM: 0,
  FECHA: 1,
  LABOR_REAL: 2,
  MD: 3,
  TURNO: 4,
  LOTE: 5,
  VARIEDAD: 6,
  AREA: 7,
  AVANCE: 8,
  ML: 9,
  TOTAL_JR: 10,
  COLOR: 11,
  HORA_GUARDADO: 12
};

function doGet(e) {
  return responder_(procesar_(e, 'GET'));
}

function doPost(e) {
  return responder_(procesar_(e, 'POST'));
}

function peekAction_(e, metodo) {
  var action = param_(e, 'action') || '';
  if (metodo === 'POST' && e.postData && e.postData.contents) {
    try {
      var body = JSON.parse(String(e.postData.contents || ''));
      if (body && body.action) action = body.action;
    } catch (err) { /* ok */ }
  }
  return String(action || 'get').toLowerCase().replace(/[^a-z_]/g, '');
}

function procesar_(e, metodo) {
  try {
    if (!validarToken_(e)) {
      return { ok: false, code: 'UNAUTHORIZED', message: 'No autorizado' };
    }

    var actionPeek = peekAction_(e, metodo);
    if (!rateLimitOk_(e, actionPeek)) {
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

    if (action === 'eliminar' || action === 'delete' || action === 'borrar') {
      return eliminar_(body.data || body);
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

    if (action === 'resumen') {
      var semRes = body.sem || param_(e, 'sem') || semIso_();
      var laborRes = norm_(body.laborReal || body.labor_real || param_(e, 'laborReal') || '');
      var listRes = [];
      if (laborRes) {
        var rowsRes = leerFilas_(obtenerHoja_());
        var sN = num_(semRes) || semIso_();
        for (var ri = 0; ri < rowsRes.length; ri++) {
          if (num_(rowsRes[ri].sem) !== sN) continue;
          if (norm_(rowsRes[ri].laborReal) !== laborRes) continue;
          listRes.push(filaToCliente_(rowsRes[ri]));
        }
      }
      return {
        ok: true,
        sem: num_(semRes) || semIso_(),
        laborReal: laborRes || null,
        resumen: laborRes ? armarResumenLista_(listRes, laborRes) : leerResumenSemana_(semRes)
      };
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
  var editar = check.editar === true;

  var laborReal = check.laborReal;
  var loteNum = check.lote;
  var turno = check.turno;

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    return { ok: false, code: 'BUSY', message: 'Servidor ocupado — reintente' };
  }

  try {
    var hoja = obtenerHoja_();
    asegurarEncabezados_(hoja);

    var sem = check.sem;
    var modulo = check.modulo;
    var fechaIso = check.fecha;
    var areaHa = check.area;
    var avanceHa = check.avance;
    var ml = check.ml;
    var variedad = check.variedad;
    var totalJr = check.totalJr;

    var rows = leerFilas_(hoja);
    var actualizado = false;
    var previas = buscarEnFilas_(rows, turno, loteNum, sem, laborReal, modulo);
    if (!editar && localId && yaGuardado_(localId) && previas.length) {
      return {
        ok: true,
        duplicate: true,
        lote: loteNum,
        turno: turno,
        avance: avanceHa,
        message: 'Labor ya registrada (sin duplicar)'
      };
    }
    if (previas.length) {
      borrarFilas_(hoja, previas);
      actualizado = true;
    }

    var fila = [
      sem,
      formatFechaSheet_(fechaIso),
      laborReal,
      modulo,
      turno,
      loteNum,
      variedad,
      areaHa,
      avanceHa,
      ml,
      totalJr,
      colorCanon_(check.color),
      horaGuardado_()
    ];

    var primera = hoja.getLastRow() + 1;
    hoja.getRange(primera, 1, 1, COLUMNAS.length).setValues([fila]);

    if (localId) marcarGuardado_(localId);
    invalidarCacheMapa_(sem);
    try { actualizarResumenDia_(fechaIso); } catch (eRes) { /* no bloquear el guardado */ }

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
  var fechaComun = payload.fecha || '';
  var semComun = payload.sem;
  var variedadComun = payload.variedad;
  var totalJrComun = payload.totalJr;
  var colorComun = payload.color;

  var validados = [];
  for (var i = 0; i < items.length; i++) {
    var raw = items[i] || {};
    var merged = {
      localId: raw.localId,
      sem: raw.sem != null ? raw.sem : semComun,
      fecha: raw.fecha || fechaComun,
      laborReal: raw.laborReal || laborRealComun,
      modulo: raw.modulo,
      turno: raw.turno || raw.tunel,
      lote: raw.lote,
      variedad: raw.variedad || variedadComun,
      area: raw.area != null ? raw.area : raw.areaLote,
      avance: raw.avance,
      totalJr: raw.totalJr != null ? raw.totalJr : totalJrComun,
      ml: raw.ml != null ? raw.ml : raw.metrosLineales,
      lotesTrabajados: raw.lotesTrabajados != null ? raw.lotesTrabajados : raw.cercosLotes,
      color: raw.color || colorComun,
      editar: raw.editar === true || raw.editar === 1 || raw.editar === '1' || payload.editar === true
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
    if (!check.color && colorComun) {
      check.color = normalizarColorNombre_(colorComun);
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
    asegurarEncabezados_(hoja);

    var rows = leerFilas_(hoja);
    var saved = [];
    var skipped = 0;
    var updated = 0;
    var deleteMap = {};
    var appendRows = [];
    var hora = horaGuardado_();
    var uniq = [];
    var seenKey = {};
    for (var j0 = validados.length - 1; j0 >= 0; j0--) {
      var kk = [validados[j0].sem, validados[j0].turno, validados[j0].lote, validados[j0].laborReal, validados[j0].modulo].join('|');
      if (seenKey[kk]) continue;
      seenKey[kk] = true;
      uniq.unshift(validados[j0]);
    }
    validados = uniq;

    for (var j = 0; j < validados.length; j++) {
      var v = validados[j];
      var previas = buscarEnFilas_(rows, v.turno, v.lote, v.sem, v.laborReal, v.modulo);
      if (!v.editar && v.localId && yaGuardado_(v.localId) && previas.length) {
        skipped++;
        saved.push({ ok: true, duplicate: true, lote: v.lote, turno: v.turno });
        continue;
      }

      if (previas.length) {
        for (var p = 0; p < previas.length; p++) deleteMap[previas[p]] = true;
        updated++;
      }

      appendRows.push([
        v.sem,
        formatFechaSheet_(v.fecha),
        v.laborReal,
        v.modulo,
        v.turno,
        v.lote,
        v.variedad,
        v.area,
        v.avance,
        v.ml,
        v.totalJr,
        colorCanon_(v.color),
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

    if (validados.length) {
      invalidarCacheMapa_(validados[0].sem);
      try { actualizarResumenDia_(validados[0].fecha); } catch (eRes) { /* no bloquear el guardado */ }
    }

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

var COLUMNAS_RESUMEN = ['FECHA', 'SEM', 'LABOR REAL', 'MD', 'AREA TOTAL', 'ML', 'JR', 'RATIO'];
var COL_RES = {
  FECHA: 0,
  SEM: 1,
  LABOR_REAL: 2,
  MD: 3,
  AREA: 4,
  ML: 5,
  JR: 6,
  RATIO: 7
};
var _resumenRebuildLock = false;

function laborOrden_(lab) {
  var n = norm_(lab);
  if (n === 'DESHIERBO') return 1;
  if (n === 'ARENADO DE MACETAS') return 2;
  if (n === 'CERCOS VIVOS' || n === 'CERCO VIVOS') return 3;
  return 9;
}

function ratioResumen_(labor, area, ml, jr) {
  if (esCercos_(labor)) return jr > 0 ? Math.round((ml / jr) * 100) / 100 : 0;
  return area > 0 ? Math.round((jr / area) * 100) / 100 : 0;
}

function estilizarEncabezadosResumen_(h) {
  h.getRange(FILA_ENC, 1, 1, COLUMNAS_RESUMEN.length)
    .setFontWeight('bold')
    .setBackground('#1a5c40')
    .setFontColor('#FFFFFF');
  h.setFrozenRows(FILA_ENC);
}

function resumenHeadersOk_(headers) {
  if (!headers || headers.length < COLUMNAS_RESUMEN.length) return false;
  for (var i = 0; i < COLUMNAS_RESUMEN.length; i++) {
    if (headerNorm_(headers[i]) !== headerNorm_(COLUMNAS_RESUMEN[i])) return false;
  }
  return true;
}

function asegurarEncabezadosResumen_(h) {
  var lastCol = Math.max(h.getLastColumn(), COLUMNAS_RESUMEN.length);
  var headers = [];
  if (h.getLastRow() >= FILA_ENC) {
    headers = h.getRange(FILA_ENC, 1, 1, lastCol).getValues()[0];
  }
  if (resumenHeadersOk_(headers)) return false;
  h.getRange(FILA_ENC, 1, 1, COLUMNAS_RESUMEN.length).setValues([COLUMNAS_RESUMEN]);
  estilizarEncabezadosResumen_(h);
  return true;
}

function obtenerHojaResumen_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var h = ss.getSheetByName(HOJA_RESUMEN);
  var created = false;
  if (!h) {
    var prev = ss.getActiveSheet();
    h = ss.insertSheet(HOJA_RESUMEN);
    h.getRange(FILA_ENC, 1, 1, COLUMNAS_RESUMEN.length).setValues([COLUMNAS_RESUMEN]);
    estilizarEncabezadosResumen_(h);
    created = true;
    try { if (prev) ss.setActiveSheet(prev); } catch (e) { /* ok */ }
  }
  if (!_resumenRebuildLock) {
    var needRebuild = created ? false : asegurarEncabezadosResumen_(h);
    if (needRebuild) {
      _resumenRebuildLock = true;
      try {
        actualizarResumenDia_('', h);
      } finally {
        _resumenRebuildLock = false;
      }
    }
  }
  return h;
}

/** Recalcula el resumen (un renglón por labor + módulo). Sin fecha = toda la hoja. */
function actualizarResumenDia_(fechaIso, hojaResumen) {
  fechaIso = fechaIso ? normalizarFecha_(fechaIso) : '';
  var hoja = obtenerHoja_();
  asegurarEncabezados_(hoja);
  var rows = leerFilas_(hoja);
  var latest = {};
  var i;

  for (i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (!r.fechaIso) continue;
    if (fechaIso && r.fechaIso !== fechaIso) continue;
    var lab = norm_(r.laborReal) || 'SIN LABOR';
    var lotKey = claveLote_(r.turno, r.loteNum) || ('X|' + String(r.loteNum || i));
    var uniq = r.fechaIso + '|' + lab + '|' + lotKey + '|' + (normMod_(r.modulo) || '');
    if (!latest[uniq] || r.rowIndex >= latest[uniq].rowIndex) latest[uniq] = r;
  }

  var groups = {};
  for (var uk in latest) {
    if (!latest.hasOwnProperty(uk)) continue;
    var row = latest[uk];
    var labor = norm_(row.laborReal) || 'SIN LABOR';
    var md = String(row.modulo || '').trim() || 'SIN MOD';
    var gk = row.fechaIso + '|' + labor + '|' + md;
    if (!groups[gk]) {
      groups[gk] = {
        fechaIso: row.fechaIso,
        sem: num_(row.sem) || 0,
        labor: labor,
        modulo: md,
        lots: {},
        jr: 0,
        ml: 0
      };
    }
    var lk = claveLote_(row.turno, row.loteNum) || String(row.loteNum);
    if (!groups[gk].lots.hasOwnProperty(lk)) groups[gk].lots[lk] = Number(row.area) || 0;
    groups[gk].jr += numInt_(row.totalJr);
    groups[gk].ml += numInt_(row.ml);
    if (!groups[gk].sem) groups[gk].sem = num_(row.sem) || 0;
  }

  var resumen = hojaResumen || obtenerHojaResumen_();
  var last = resumen.getLastRow();
  if (last >= FILA_INI) {
    if (!fechaIso) {
      resumen.deleteRows(FILA_INI, last - FILA_INI + 1);
    } else {
      var data = resumen.getRange(FILA_INI, 1, last - FILA_INI + 1, COLUMNAS_RESUMEN.length).getValues();
      var toDel = [];
      for (var d = 0; d < data.length; d++) {
        if (normalizarFecha_(data[d][COL_RES.FECHA]) === fechaIso) toDel.push(FILA_INI + d);
      }
      if (toDel.length) borrarFilas_(resumen, toDel);
    }
  }

  var keys = [];
  for (var k in groups) {
    if (groups.hasOwnProperty(k)) keys.push(k);
  }
  keys.sort(function (a, b) {
    var ga = groups[a];
    var gb = groups[b];
    var df = String(ga.fechaIso || '').localeCompare(String(gb.fechaIso || ''));
    if (df) return df;
    var lf = laborOrden_(ga.labor) - laborOrden_(gb.labor);
    if (lf) return lf;
    var ln = String(ga.labor || '').localeCompare(String(gb.labor || ''), 'es');
    if (ln) return ln;
    return String(ga.modulo || '').localeCompare(String(gb.modulo || ''), 'es', { numeric: true });
  });

  var append = [];
  for (var g = 0; g < keys.length; g++) {
    var grp = groups[keys[g]];
    var area = 0;
    for (var pk in grp.lots) {
      if (grp.lots.hasOwnProperty(pk)) area += Number(grp.lots[pk]) || 0;
    }
    area = Math.round(area * 100) / 100;
    var jr = numInt_(grp.jr);
    var ml = esCercos_(grp.labor) ? numInt_(grp.ml) : 0;
    var ratio = ratioResumen_(grp.labor, area, ml, jr);
    var semRow = grp.sem || semIso_();
    append.push([
      formatFechaSheet_(grp.fechaIso),
      semRow,
      grp.labor,
      grp.modulo,
      area,
      ml,
      jr,
      ratio
    ]);
  }
  if (append.length) {
    var start = resumen.getLastRow() + 1;
    resumen.getRange(start, 1, append.length, COLUMNAS_RESUMEN.length).setValues(append);
  }
}

/** Filas de resumen (FECHA · LABOR · MD · AREA/ML · JR · RATIO). */
function armarResumenLista_(list, laborReal) {
  var groups = {};
  var i;
  for (i = 0; i < (list || []).length; i++) {
    var r = list[i];
    if (!r) continue;
    var fechaIso = r.fechaIso || normalizarFecha_(r.fecha) || '';
    var lab = norm_(r.laborReal) || norm_(laborReal) || '';
    var md = String(r.modulo || '').trim() || '—';
    var k = fechaIso + '|' + lab + '|' + md;
    if (!groups[k]) groups[k] = { fechaIso: fechaIso, labor: lab, modulo: md, lots: {}, jr: 0, ml: 0 };
    var lotKey = norm_(r.turno) + '|' + String(r.lote != null ? r.lote : r.loteNum);
    if (!groups[k].lots.hasOwnProperty(lotKey)) {
      groups[k].lots[lotKey] = Number(r.area) || 0;
    }
    groups[k].jr += numInt_(r.totalJr);
    groups[k].ml += numInt_(r.ml);
  }
  var keys = [];
  for (var gk in groups) {
    if (groups.hasOwnProperty(gk)) keys.push(gk);
  }
  keys.sort();
  var out = [];
  for (i = 0; i < keys.length; i++) {
    var g = groups[keys[i]];
    var area = 0;
    for (var lk in g.lots) {
      if (g.lots.hasOwnProperty(lk)) area += Number(g.lots[lk]) || 0;
    }
    area = Math.round(area * 100) / 100;
    var jr = numInt_(g.jr);
    var ml = esCercos_(g.labor) ? numInt_(g.ml) : 0;
    out.push({
      fecha: formatFechaSheet_(g.fechaIso),
      fechaIso: g.fechaIso,
      modulo: g.modulo,
      laborReal: g.labor || laborReal || '',
      area: area,
      ml: ml,
      jr: jr,
      ratio: ratioResumen_(g.labor || laborReal, area, ml, jr)
    });
  }
  return out;
}

function leerResumenSemana_(sem, laborReal) {
  sem = num_(sem);
  if (!sem) sem = semIso_();
  var laborWant = norm_(laborReal);
  var h = obtenerHojaResumen_();
  var last = h.getLastRow();
  var out = [];
  if (last < FILA_INI) return out;
  var data = h.getRange(FILA_INI, 1, last - FILA_INI + 1, COLUMNAS_RESUMEN.length).getValues();
  for (var i = 0; i < data.length; i++) {
    if (num_(data[i][COL_RES.SEM]) !== sem) continue;
    var labor = texto_(data[i][COL_RES.LABOR_REAL]);
    if (laborWant && norm_(labor) !== laborWant) continue;
    var fechaIso = normalizarFecha_(data[i][COL_RES.FECHA]);
    var area = numDec_(data[i][COL_RES.AREA]);
    var ml = numInt_(data[i][COL_RES.ML]);
    var jr = numInt_(data[i][COL_RES.JR]);
    var ratio = numDec_(data[i][COL_RES.RATIO]);
    out.push({
      fecha: formatFechaSheet_(fechaIso),
      fechaIso: fechaIso,
      sem: sem,
      laborReal: labor,
      modulo: String(data[i][COL_RES.MD] || ''),
      area: area,
      ml: ml,
      jr: jr,
      ratio: ratio
    });
  }
  out.sort(function (a, b) {
    var df = String(a.fechaIso || '').localeCompare(String(b.fechaIso || ''));
    if (df) return df;
    var lf = laborOrden_(a.laborReal) - laborOrden_(b.laborReal);
    if (lf) return lf;
    return String(a.modulo || '').localeCompare(String(b.modulo || ''), 'es', { numeric: true });
  });
  return out;
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

/** Borra el registro de un lote (solo escritorio). */
function eliminar_(d) {
  d = d || {};
  var lote = numLote_(d.lote);
  var turno = texto_(d.turno || d.tunel || '');
  var modulo = normMod_(d.modulo || d.md || '');
  var sem = d.sem != null && d.sem !== '' ? num_(d.sem) : semIso_();
  var laborReal = norm_(d.laborReal || '');
  var fechaIso = normalizarFecha_(d.fecha || '');
  if (!lote || !turno) {
    return { ok: false, code: 'BAD_LOTE', message: 'Indique lote y turno' };
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    return { ok: false, code: 'BUSY', message: 'Servidor ocupado — reintente' };
  }
  try {
    var hoja = obtenerHoja_();
    asegurarEncabezados_(hoja);
    var rows = leerFilas_(hoja);
    var idx = [];
    var turnoNorm = norm_(turno);
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (num_(r.sem) !== sem) continue;
      if (numLote_(r.loteNum) !== lote) continue;
      if (norm_(r.turno) !== turnoNorm) continue;
      if (modulo && normMod_(r.modulo) !== modulo) continue;
      if (laborReal && norm_(r.laborReal) !== laborReal) continue;
      if (fechaIso) {
        var rIso = r.fechaIso || normalizarFecha_(r.fecha);
        if (rIso !== fechaIso) continue;
      }
      idx.push(r.rowIndex);
    }
    if (!idx.length) {
      return { ok: true, deleted: 0, message: 'No había registro' };
    }
    borrarFilas_(hoja, idx);
    invalidarCacheMapa_(sem);
    try { actualizarResumenDia_(fechaIso || hoy_()); } catch (eRes) { /* ok */ }
    return {
      ok: true,
      deleted: idx.length,
      lote: lote,
      turno: turno,
      modulo: modulo || null,
      message: 'Eliminado — LOTE ' + lote
    };
  } finally {
    lock.releaseLock();
  }
}

// ─── GET MAPA (pintar avances) ──────────────────────────────────────────────

function getMapa_(d, e) {
  d = d || {};
  var sem = d.sem != null && d.sem !== '' ? num_(d.sem) : (param_(e, 'sem') ? num_(param_(e, 'sem')) : null);
  var laborReal = norm_(d.laborReal || d.labor_real || param_(e, 'laborReal') || '');
  if (!laborReal) laborReal = 'DESHIERBO';
  var modulo = normMod_(d.modulo || d.md || param_(e, 'modulo') || '');
  var variedad = formatVariedad_(d.variedad || param_(e, 'variedad') || '');
  if (!String(d.variedad || param_(e, 'variedad') || '').trim()) variedad = '';
  var fechaFiltro = String(d.fecha || param_(e, 'fecha') || '').trim();
  var skipCache = d.nocache === true || d.nocache === 1 ||
    String(d.nocache || param_(e, 'nocache') || '').trim() === '1' ||
    String(d.force || param_(e, 'force') || '').trim() === '1';

  var cacheVer = mapaCacheVer_();
  var cacheKey = 'map_v13_' + cacheVer + '_' + [
    sem || 'all', laborReal || '-', modulo || '-',
    variedad || '-', fechaFiltro || '-'
  ].join('_');
  if (!skipCache) {
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
  }

  var hoja = obtenerHoja_();
  var rows = leerFilas_(hoja);
  var latest = {};
  var list = [];
  var fechaIsoFiltro = fechaFiltro ? normalizarFecha_(fechaFiltro) : '';

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (sem != null && num_(r.sem) !== sem) continue;
    if (laborReal && norm_(r.laborReal) !== laborReal) continue;
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
    key = key + '|' + (norm_(r.laborReal) || '-');
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
      laborPpto: null,
      modulo: modulo || null,
      variedad: variedad || null,
      fecha: fechaFiltro || null
    },
    list: list,
    resumen: armarResumenLista_(list, laborReal),
    fromCache: false
  };

  try {
    CacheService.getScriptCache().put(cacheKey, JSON.stringify(result), 360);
  } catch (ex2) { /* payload grande */ }

  return result;
}

/** Valores únicos de la hoja para el panel de filtros */
function filtrosOpciones_() {
  try { obtenerHojaResumen_(); } catch (eRes) { /* ok */ }
  var hoja = obtenerHoja_();
  asegurarEncabezados_(hoja);
  var rows = leerFilas_(hoja);
  var semMap = {};
  var fechaMap = {};
  var fechaBySemMap = {};
  var mdMap = {};
  var laborMap = {};

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var s = num_(r.sem);
    if (s) semMap[s] = true;

    var fDisp = formatFechaSheet_(r.fechaIso || r.fecha);
    var fRaw = String(r.fecha || '').trim();
    var fKey = fDisp || fRaw;
    if (fDisp) fechaMap[fDisp] = true;
    else if (fRaw) fechaMap[fRaw] = true;
    if (s && fKey) {
      if (!fechaBySemMap[s]) fechaBySemMap[s] = {};
      fechaBySemMap[s][fKey] = true;
    }

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

  var fechaBySem = {};
  for (var sk in fechaBySemMap) {
    if (!fechaBySemMap.hasOwnProperty(sk)) continue;
    var arrF = Object.keys(fechaBySemMap[sk]);
    arrF.sort(function (a, b) {
      return String(normalizarFecha_(a)).localeCompare(String(normalizarFecha_(b)));
    });
    fechaBySem[sk] = arrF;
  }

  var md = Object.keys(mdMap);
  md.sort(function (a, b) {
    return num_(String(a).replace(/\D/g, '')) - num_(String(b).replace(/\D/g, ''));
  });

  var canonLab = ['DESHIERBO', 'ARENADO DE MACETAS', 'CERCOS VIVOS'];
  for (var c = 0; c < canonLab.length; c++) laborMap[canonLab[c]] = true;

  var laborReal = Object.keys(laborMap);
  laborReal.sort();

  return {
    ok: true,
    sem: sem,
    fecha: fecha,
    fechaBySem: fechaBySem,
    md: md,
    laborReal: laborReal,
    laborPpto: [],
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
    resumen: leerResumenSemana_(sem),
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
  asegurarEncabezados_(hoja);
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
      laborReal: laborReal,
      modulo: String(row[COL.MD] || '').trim(),
      turno: String(row[COL.TURNO] || '').trim(),
      loteLabel: loteLabel,
      loteNum: parseLoteNum_(loteLabel),
      variedad: String(row[COL.VARIEDAD] || '').trim(),
      area: numDec_(row[COL.AREA]),
      avance: numDec_(row[COL.AVANCE]),
      ml: numInt_(row[COL.ML]),
      totalJr: numInt_(row[COL.TOTAL_JR]),
      color: normalizarColorNombre_(row[COL.COLOR]),
      horaGuardado: textoHora_(row[COL.HORA_GUARDADO])
    });
  }
  return out;
}

function filaToCliente_(r) {
  return {
    sem: num_(r.sem),
    fecha: r.fechaIso || r.fecha,
    fechaIso: r.fechaIso || '',
    laborReal: r.laborReal,
    modulo: r.modulo,
    turno: r.turno,
    lote: r.loteNum,
    loteLabel: r.loteLabel,
    variedad: formatVariedad_(r.variedad),
    area: r.area,
    avance: r.avance,
    ml: numInt_(r.ml),
    totalJr: numInt_(r.totalJr),
    color: r.color || '',
    horaGuardado: r.horaGuardado
  };
}

function buscarEnFilas_(rows, turno, loteNum, sem, laborReal, modulo) {
  var idx = [];
  var turnoNorm = norm_(turno);
  var laborNorm = laborReal != null && laborReal !== '' ? norm_(laborReal) : '';
  var modNorm = modulo ? normMod_(modulo) : '';
  var semN = num_(sem);
  var loteN = numLote_(loteNum);
  for (var i = 0; i < rows.length; i++) {
    if (num_(rows[i].sem) !== semN) continue;
    if (numLote_(rows[i].loteNum) !== loteN) continue;
    if (norm_(rows[i].turno) !== turnoNorm) continue;
    if (modNorm && normMod_(rows[i].modulo) !== modNorm) continue;
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
  if (migrarQuitarLaborPpto_(hoja, headers)) {
    headers = limpiarHeaders_(hoja.getRange(FILA_ENC, 1, 1, Math.max(hoja.getLastColumn(), COLUMNAS.length)).getValues()[0]);
  }
  migrarColumnaColor_(hoja, headers);
  headers = limpiarHeaders_(hoja.getRange(FILA_ENC, 1, 1, Math.max(hoja.getLastColumn(), COLUMNAS.length)).getValues()[0]);
  migrarColumnaMl_(hoja, headers);
  headers = limpiarHeaders_(hoja.getRange(FILA_ENC, 1, 1, Math.max(hoja.getLastColumn(), COLUMNAS.length)).getValues()[0]);
  if (headers[0] === 'SEM' &&
      headers.indexOf('HORA GUARDADO') >= 0 &&
      headers.indexOf('COLOR') >= 0 &&
      (headers.indexOf('ML') >= 0 || headers.indexOf('METROS LINEALES') >= 0) &&
      !tieneHeaderLaborPpto_(headers)) return;

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

function headerNorm_(h) {
  return String(h || '').replace(/\s+/g, ' ').trim().toUpperCase();
}

function tieneHeaderLaborPpto_(headers) {
  if (!headers) return false;
  for (var i = 0; i < headers.length; i++) {
    var h = headerNorm_(headers[i]).replace(/ /g, '');
    if (h === 'LABORPPTO') return true;
  }
  return false;
}

function migrarQuitarLaborPpto_(hoja, headers) {
  if (!headers) return false;
  var idx = -1;
  for (var i = 0; i < headers.length; i++) {
    var h = headerNorm_(headers[i]).replace(/ /g, '');
    if (h === 'LABORPPTO') {
      idx = i;
      break;
    }
  }
  if (idx < 0) return false;
  hoja.deleteColumn(idx + 1);
  bumpMapaCache_();
  return true;
}

function migrarColumnaMl_(hoja, headers) {
  if (!headers || headers[0] !== 'SEM') return;
  var i;
  for (i = 0; i < headers.length; i++) {
    var hn = headerNorm_(headers[i]);
    if (hn === 'ML' || hn === 'METROS LINEALES') return;
  }
  var jrIdx = -1;
  for (i = 0; i < headers.length; i++) {
    var h = headerNorm_(headers[i]);
    if (h === 'TOTAL (JR)' || h === 'TOTAL JR') {
      jrIdx = i;
      break;
    }
  }
  if (jrIdx < 0) return;
  hoja.insertColumnBefore(jrIdx + 1);
  hoja.getRange(FILA_ENC, jrIdx + 1).setValue('ML');
  bumpMapaCache_();
}

function migrarColumnaColor_(hoja, headers) {
  if (!headers || headers[0] !== 'SEM') return;
  if (headers.indexOf('COLOR') >= 0) return;
  var horaIdx = -1;
  for (var i = 0; i < headers.length; i++) {
    if (headerNorm_(headers[i]) === 'HORA GUARDADO') {
      horaIdx = i;
      break;
    }
  }
  if (horaIdx < 0) return;
  hoja.insertColumnBefore(horaIdx + 1);
  hoja.getRange(FILA_ENC, horaIdx + 1).setValue('COLOR');
}

var COLOR_PALETTE_ = {
  '#64B5F6': 'Lunes',
  '#81C784': 'Martes',
  '#FFD54F': 'Miercoles',
  '#FF8A65': 'Jueves',
  '#CE93D8': 'Viernes',
  '#1E88E5': 'Lunes',
  '#43A047': 'Martes',
  '#F9A825': 'Miercoles',
  '#E64A19': 'Jueves',
  '#8E24AA': 'Viernes'
};

var COLOR_NAME_ALIASES_ = {
  LUNES: 'Lunes',
  MARTES: 'Martes',
  MIERCOLES: 'Miercoles',
  JUEVES: 'Jueves',
  VIERNES: 'Viernes',
  AZUL: 'Lunes',
  VERDE: 'Martes',
  AMARILLO: 'Miercoles',
  NARANJA: 'Jueves',
  MORADO: 'Viernes',
  VIOLETA: 'Viernes'
};

function colorKey_(s) {
  return String(s || '')
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/Á/g, 'A').replace(/É/g, 'E').replace(/Í/g, 'I')
    .replace(/Ó/g, 'O').replace(/Ú/g, 'U');
}

function colorCanon_(name) {
  var n = String(name || '').trim();
  return n ? n.toUpperCase() : '';
}

function normalizarColorNombre_(v) {
  var s = String(v || '').trim();
  if (!s) return '';

  var up = s.toUpperCase();
  if (/^#[0-9A-F]{6}$/.test(up)) {
    return colorCanon_(COLOR_PALETTE_[up] || '');
  }

  var alias = COLOR_NAME_ALIASES_[colorKey_(s)];
  if (alias) return colorCanon_(alias);

  var key = colorKey_(s);
  for (var hex in COLOR_PALETTE_) {
    if (!COLOR_PALETTE_.hasOwnProperty(hex)) continue;
    if (colorKey_(COLOR_PALETTE_[hex]) === key) return colorCanon_(COLOR_PALETTE_[hex]);
  }

  return '';
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
  var names = [HOJA, 'LABORES', 'Hoja 1'];
  for (var i = 0; i < names.length; i++) {
    if (!names[i]) continue;
    var h = ss.getSheetByName(names[i]);
    if (h) return h;
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

function rateLimitOk_(e, action) {
  action = String(action || '').toLowerCase();
  if (action === 'ping') return true;
  try {
    var cache = CacheService.getScriptCache();
    var tok = String(param_(e, 'token') || 'anon').replace(/[^a-zA-Z0-9_\-]/g, '').substring(0, 40);
    var key = 'rl_' + (tok || 'anon');
    var n = Number(cache.get(key) || '0');
    if (n >= 90) return false;
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

function esCercos_(labor) {
  var s = norm_(labor);
  return s === 'CERCOS VIVOS' || s === 'CERCO VIVOS';
}

function validarPayloadLabor_(d) {
  d = d || {};
  var laborReal = safeSheetText_(d.laborReal || d.labor_real || '', 80);
  var turno = normalizarTurno_(d.turno || d.tunel || '');
  var modulo = safeSheetText_(textoMod_(d.modulo || d.md || ''), 12);
  var loteNum = numLote_(d.lote);
  var sem = num_(d.sem) || semIso_();
  var areaHa = numDec_(d.area != null ? d.area : d.areaLote);
  var avanceHa = numDec_(d.avance);
  var totalJr = numInt_(d.totalJr != null ? d.totalJr : d.total_jr);
  var ml = numInt_(d.ml != null ? d.ml : d.metrosLineales);
  var lotesTrab = numInt_(d.lotesTrabajados != null ? d.lotesTrabajados : d.cercosLotes);
  var variedad = formatVariedad_(d.variedad);
  var fechaIso = normalizarFecha_(d.fecha || d.fechaIso || hoy_());

  if (!laborReal) return { ok: false, code: 'MISSING_LABOR', message: 'Falta labor real' };
  if (!loteNum || loteNum < 1 || loteNum > 99999) {
    return { ok: false, code: 'BAD_LOTE', message: 'Lote inválido' };
  }
  if (!turno) return { ok: false, code: 'BAD_TURNO', message: 'Túnel / turno inválido' };
  if (sem < 1 || sem > 53) return { ok: false, code: 'BAD_SEM', message: 'Semana inválida' };
  if (areaHa < 0 || areaHa > 500) return { ok: false, code: 'BAD_AREA', message: 'Área inválida' };
  if (avanceHa < 0 || avanceHa > 500) return { ok: false, code: 'BAD_AVANCE', message: 'Avance inválido' };
  if (areaHa > 0 && avanceHa > areaHa) avanceHa = areaHa;
  if (esCercos_(laborReal) && areaHa > 0) {
    if (avanceHa <= 0) avanceHa = areaHa;
    if (avanceHa > areaHa) avanceHa = areaHa;
    if (ml <= 0 && lotesTrab > 0) ml = lotesTrab * 80;
  } else {
    ml = 0;
  }
  if (totalJr < 0 || totalJr > 100000) totalJr = 0;
  if (ml < 0 || ml > 1000000) ml = 0;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fechaIso))) {
    return { ok: false, code: 'BAD_FECHA', message: 'Fecha inválida' };
  }
  if (variedad !== 'SEKOYA POP' && variedad !== 'MAGICA') {
    variedad = 'SEKOYA POP';
  }

  var allow = PropertiesService.getScriptProperties().getProperty('LABOR_ALLOWLIST');
  if (allow) {
    var okLabor = false;
    var parts = String(allow).split('|').concat(['CERCOS VIVOS', 'CERCO VIVOS']);
    for (var i = 0; i < parts.length; i++) {
      if (norm_(parts[i]) === laborReal) { okLabor = true; break; }
    }
    if (!okLabor) return { ok: false, code: 'LABOR_NOT_ALLOWED', message: 'Labor no permitida' };
  }

  return {
    ok: true,
    laborReal: laborReal,
    turno: turno,
    modulo: modulo,
    lote: loteNum,
    sem: sem,
    area: areaHa,
    avance: avanceHa,
    ml: ml,
    totalJr: totalJr,
    variedad: variedad,
    fecha: fechaIso,
    color: colorCanon_(normalizarColorNombre_(d.color)),
    editar: d.editar === true || d.editar === 1 || d.editar === '1' || d.editar === 'true'
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

function textoHora_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) {
    return Utilities.formatDate(v, TZ, 'HH:mm:ss');
  }
  var s = String(v || '').trim();
  var m = s.match(/(\d{1,2}:\d{2}(?::\d{2})?)/);
  return m ? m[1] : s;
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

/** T1, T10, T8M, T10M, 10 → T# / T#M (no recortar la letra del túnel) */
function normalizarTurno_(raw) {
  var s = String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!s) return '';
  var m = s.match(/^T?(\d{1,3})([A-Z])?$/);
  if (m) return 'T' + m[1] + (m[2] || '');
  var tNum = s.replace(/\D/g, '');
  return tNum ? 'T' + tNum : '';
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

function numInt_(v) {
  var n = parseInt(v, 10);
  if (isNaN(n) || n < 0) return 0;
  return Math.round(n);
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
