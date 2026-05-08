#!/usr/bin/env node
/* ================================================================
 * avisos-cli — gestor de extensiones del cliente desde la terminal
 *
 * Tres tipos de configuracion, todos editables por linea de comando:
 *
 *   A) Reescritura de mensajes  (avisos-personalizados.json/.js)
 *   B) Palabras prohibidas       (palabras-prohibidas.json/.js)
 *   C) Extensiones varias        (extensiones.json -> extensiones-cliente.js)
 *      - obligatorios, longitudes, patrones, ignorados,
 *        consola, throttle, ui-checks, etiqueta
 *
 * Ejecuta `node avisos-cli.js help` para ver todos los comandos,
 * o `node avisos-cli.js` para entrar al menu interactivo.
 * ================================================================ */
'use strict';

const fs       = require('fs');
const path     = require('path');
const http     = require('http');
const https    = require('https');
const readline = require('readline');

const DIR = __dirname;
const RULES_JSON = path.join(DIR, 'avisos-personalizados.json');
const RULES_JS   = path.join(DIR, 'avisos-personalizados.js');
const BAN_JSON   = path.join(DIR, 'palabras-prohibidas.json');
const BAN_JS     = path.join(DIR, 'palabras-prohibidas.js');
const EXT_JSON   = path.join(DIR, 'extensiones.json');
const EXT_JS     = path.join(DIR, 'extensiones-cliente.js');

const DEFAULT_EXT = {
  obligatorios: [],
  longitudes:   [],
  patrones:     [],
  ignorados:    [],
  consola:      { error: false, warn: false },
  throttle:     { porMinuto: 0 },
  uiChecks:     { botonesDisabled: false, linksVacios: false },
  etiqueta:     null,
};

// =============== IO comun ===============
function loadJsonArray(file) {
  try {
    if (!fs.existsSync(file)) return [];
    const raw = fs.readFileSync(file, 'utf8').trim();
    if (!raw) return [];
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error(`[avisos] no se pudo leer ${path.basename(file)}:`, e.message);
    return [];
  }
}
function loadJsonObj(file, def) {
  try {
    if (!fs.existsSync(file)) return JSON.parse(JSON.stringify(def));
    const raw = fs.readFileSync(file, 'utf8').trim();
    if (!raw) return JSON.parse(JSON.stringify(def));
    const data = JSON.parse(raw);
    return Object.assign(JSON.parse(JSON.stringify(def)), data || {});
  } catch (e) {
    console.error(`[avisos] no se pudo leer ${path.basename(file)}:`, e.message);
    return JSON.parse(JSON.stringify(def));
  }
}
function writeJson(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8'); }

function parseMatch(input) {
  const s = String(input || '').trim();
  const m = s.match(/^\/(.+)\/([gimsuy]*)$/);
  if (m) return { isRegex: true, source: m[1], flags: m[2] || '' };
  return { isRegex: false, literal: s };
}
function describeMatch(rule) {
  if (rule.isRegex) return `/${rule.source}/${rule.flags || ''}`;
  return JSON.stringify(rule.literal || '');
}

// =============== A) Reescritura ===============
function ruleToJsLiteral(rule) {
  const replace = JSON.stringify(String(rule.replace || ''));
  if (rule.isRegex) {
    try { new RegExp(rule.source, rule.flags || ''); }
    catch (e) {
      return `  { match: ${JSON.stringify(`/${rule.source}/${rule.flags || ''}`)}, replace: ${replace} }`;
    }
    return `  { match: new RegExp(${JSON.stringify(rule.source)}, ${JSON.stringify(rule.flags || '')}), replace: ${replace} }`;
  }
  return `  { match: ${JSON.stringify(rule.literal || '')}, replace: ${replace} }`;
}
function writeRulesJs(rules) {
  const out =
    '/* AUTO-GENERADO por avisos-cli.js — no editar a mano. */\n' +
    '(function () {\n' +
    '  var base = (typeof window !== "undefined" && window.MENSAJES_PERSONALIZADOS) || [];\n' +
    '  var extra = [\n' +
    rules.map(ruleToJsLiteral).join(',\n') +
    '\n  ];\n' +
    '  window.MENSAJES_PERSONALIZADOS = base.concat(extra);\n' +
    '})();\n';
  fs.writeFileSync(RULES_JS, out, 'utf8');
}
const loadRules = () => loadJsonArray(RULES_JSON);
const saveRules = (r) => { writeJson(RULES_JSON, r); writeRulesJs(r); };

// =============== B) Palabras prohibidas ===============
function banToJsLiteral(rule) {
  const mensaje = JSON.stringify(String(rule.mensaje || ''));
  if (rule.isRegex) {
    try { new RegExp(rule.source, rule.flags || 'i'); }
    catch (e) {
      return `  { tipo: "literal", valor: ${JSON.stringify(`/${rule.source}/${rule.flags || ''}`)}, mensaje: ${mensaje} }`;
    }
    return `  { tipo: "regex", source: ${JSON.stringify(rule.source)}, flags: ${JSON.stringify(rule.flags || 'i')}, mensaje: ${mensaje} }`;
  }
  return `  { tipo: "literal", valor: ${JSON.stringify(rule.literal || '')}, mensaje: ${mensaje} }`;
}
function writeBanJs(rules) {
  const out =
`/* AUTO-GENERADO por avisos-cli.js — palabras prohibidas en inputs. */
(function () {
  var REGLAS = [
${rules.map(banToJsLiteral).join(',\n')}
  ];
  if (!REGLAS.length) return;
  var compiladas = REGLAS.map(function (r) {
    if (r.tipo === 'regex') {
      try { return { re: new RegExp(r.source, r.flags || 'i'), mensaje: r.mensaje, etiqueta: '/' + r.source + '/' + (r.flags || '') }; }
      catch (e) { return null; }
    }
    var v = String(r.valor || ''); if (!v) return null;
    var esc = v.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');
    return { re: new RegExp(esc, 'i'), mensaje: r.mensaje, etiqueta: v };
  }).filter(Boolean);
  var disparados = new Set();
  function disparar(regla, valor, campo) {
    var clave = regla.etiqueta + '|' + (campo || '') + '|' + valor;
    if (disparados.has(clave)) return; disparados.add(clave);
    var msg = regla.mensaje || ('palabra-prohibida: ' + regla.etiqueta);
    var detalle = msg + ' (campo "' + (campo || '?') + '", valor "' + String(valor).slice(0, 80) + '")';
    // Preferir POST silencioso via error_capture; throw solo si no esta cargado
    if (typeof window.AVISOS_REPORTAR === 'function') {
      try { window.AVISOS_REPORTAR(detalle, { kind: 'palabra-prohibida', regla: regla.etiqueta, campo: campo }); return; } catch (e) {}
    }
    setTimeout(function () { throw new Error(detalle); }, 0);
  }
  function inspeccionar(el) {
    if (!el || (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA')) return;
    var tipo = (el.type || '').toLowerCase();
    if (tipo === 'password' || tipo === 'file' || tipo === 'hidden') return;
    var v = el.value; if (v == null || v === '') return;
    var nombre = el.name || el.id || el.placeholder || el.tagName.toLowerCase();
    for (var i = 0; i < compiladas.length; i++) if (compiladas[i].re.test(v)) disparar(compiladas[i], v, nombre);
  }
  function enganchar() {
    document.addEventListener('input',  function (ev) { inspeccionar(ev.target); }, true);
    document.addEventListener('change', function (ev) { inspeccionar(ev.target); }, true);
    document.addEventListener('blur',   function (ev) { inspeccionar(ev.target); }, true);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', enganchar);
  else enganchar();
})();
`;
  fs.writeFileSync(BAN_JS, out, 'utf8');
}
const loadBans = () => loadJsonArray(BAN_JSON);
const saveBans = (r) => { writeJson(BAN_JSON, r); writeBanJs(r); };

// =============== C) Extensiones varias ===============
function writeExtJs(c) {
  const cfg = JSON.stringify(c);
  const out =
`/* AUTO-GENERADO por avisos-cli.js — extensiones del cliente.
 * Cargar DESPUES de error_capture.js. */
(function () {
  var CFG = ${cfg};

  // ---- resolver endpoint exacto del orquestador ----
  function resolveBase() {
    try {
      if (window.AVANTSERVICE_ENDPOINT) return String(window.AVANTSERVICE_ENDPOINT).replace(/\\/$/, '');
      var scripts = document.getElementsByTagName('script');
      for (var i = 0; i < scripts.length; i++) {
        var ds = scripts[i].getAttribute && scripts[i].getAttribute('data-endpoint');
        if (ds) return String(ds).replace(/\\/$/, '');
      }
    } catch (e) {}
    var p = (location.protocol === 'https:') ? 'https:' : 'http:';
    return p + '//' + (location.hostname || '127.0.0.1') + ':8000';
  }
  var BASE = resolveBase();
  var REPORT_URL = BASE + '/report';
  function esNuestroReport(u) {
    if (typeof u !== 'string') return false;
    var idx = u.indexOf('?');
    var clean = idx >= 0 ? u.slice(0, idx) : u;
    return clean === REPORT_URL;
  }

  // ---- throttle global ----
  var ventana = [];
  function permitido() {
    if (!CFG.throttle || !CFG.throttle.porMinuto) return true;
    var ahora = Date.now();
    ventana = ventana.filter(function (t) { return ahora - t < 60000; });
    if (ventana.length >= CFG.throttle.porMinuto) return false;
    ventana.push(ahora); return true;
  }

  // ---- ignorados ----
  function escapar(s) { return String(s).replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&'); }
  var ignorados = (CFG.ignorados || []).map(function (r) {
    if (r.isRegex) { try { return new RegExp(r.source, r.flags || 'i'); } catch (e) { return null; } }
    return r.literal ? new RegExp(escapar(r.literal), 'i') : null;
  }).filter(Boolean);
  function debeIgnorar(msg) {
    msg = String(msg || '');
    for (var i = 0; i < ignorados.length; i++) if (ignorados[i].test(msg)) return true;
    return false;
  }

  // Filtrado a la salida: monkey-patch fetch para inspeccionar lo que sale
  // a /report y descartarlo si esta en ignorados o pasa el throttle.
  if (typeof window !== 'undefined' && typeof window.fetch === 'function') {
    var orig = window.fetch.bind(window);
    window.fetch = function (input, init) {
      try {
        var u = (input && input.url) || input;
        if (esNuestroReport(u) && init && init.body) {
          var body = init.body;
          if (typeof body === 'string') {
            var p = JSON.parse(body);
            var msg = p && p.message;
            if (msg && debeIgnorar(msg)) return Promise.resolve(new Response('', { status: 204 }));
            if (!permitido())             return Promise.resolve(new Response('', { status: 204 }));
            if (CFG.etiqueta) {
              p.extra = Object.assign({}, p.extra || {}, { entorno: CFG.etiqueta });
              init = Object.assign({}, init, { body: JSON.stringify(p) });
            }
          }
        }
      } catch (e) {}
      return orig(input, init);
    };
  }

  function reportar(msg) {
    if (debeIgnorar(msg) || !permitido()) return;
    var s = String(msg);
    // Preferir el helper limpio de error_capture.js (POST silencioso, no
    // ensucia la consola del cliente ni dispara su window.onerror)
    var helper = window.__AVISOS_REPORTAR_NATIVE;
    if (typeof helper === 'function') { try { helper(s, { kind: 'extension' }); return; } catch (e) {} }
    setTimeout(function () { throw new Error(s); }, 0);
  }
  // Guardamos la version "limpia" de error_capture antes de exponer la nuestra,
  // para que sea esa la que usemos por debajo y no entrar en recursion.
  if (typeof window.AVISOS_REPORTAR === 'function' && !window.__AVISOS_REPORTAR_NATIVE) {
    window.__AVISOS_REPORTAR_NATIVE = window.AVISOS_REPORTAR;
  }
  window.AVISOS_REPORTAR = reportar;

  // ---- consola ----
  if (CFG.consola && CFG.consola.error && typeof console !== 'undefined' && console.error) {
    var oe = console.error.bind(console);
    console.error = function () {
      try { reportar('console.error: ' + Array.prototype.map.call(arguments, String).join(' ')); } catch (e) {}
      return oe.apply(null, arguments);
    };
  }
  if (CFG.consola && CFG.consola.warn && typeof console !== 'undefined' && console.warn) {
    var ow = console.warn.bind(console);
    console.warn = function () {
      try { reportar('console.warn: ' + Array.prototype.map.call(arguments, String).join(' ')); } catch (e) {}
      return ow.apply(null, arguments);
    };
  }

  // ---- validaciones de formularios ----
  function validarForm(form) {
    (CFG.obligatorios || []).forEach(function (r) {
      try { form.querySelectorAll(r.selector).forEach(function (el) {
        if (!String(el.value || '').trim()) reportar(r.mensaje || ('campo obligatorio vacio: ' + r.selector));
      }); } catch (e) {}
    });
    (CFG.longitudes || []).forEach(function (r) {
      try { form.querySelectorAll(r.selector).forEach(function (el) {
        var v = String(el.value || '');
        if (typeof r.min === 'number' && v.length < r.min) reportar(r.mensaje || ('longitud minima ' + r.min + ' en ' + r.selector));
        if (typeof r.max === 'number' && v.length > r.max) reportar(r.mensaje || ('longitud maxima ' + r.max + ' en ' + r.selector));
      }); } catch (e) {}
    });
    (CFG.patrones || []).forEach(function (r) {
      try {
        var re = new RegExp(r.source, r.flags || '');
        form.querySelectorAll(r.selector).forEach(function (el) {
          var v = String(el.value || '');
          if (v && !re.test(v)) reportar(r.mensaje || ('formato invalido en ' + r.selector));
        });
      } catch (e) {}
    });
  }

  function init() {
    document.addEventListener('submit', function (ev) {
      if (ev.target && ev.target.tagName === 'FORM') validarForm(ev.target);
    }, true);
    if (CFG.uiChecks && CFG.uiChecks.botonesDisabled) {
      document.addEventListener('click', function (ev) {
        var b = ev.target && ev.target.closest && ev.target.closest('button,[role=button],input[type=submit],input[type=button]');
        if (b && (b.disabled || b.getAttribute('aria-disabled') === 'true')) {
          reportar('click en boton desactivado: ' + (b.id || b.name || (b.textContent || '').trim().slice(0,40) || 'sin-id'));
        }
      }, true);
    }
    if (CFG.uiChecks && CFG.uiChecks.linksVacios) {
      document.addEventListener('click', function (ev) {
        var a = ev.target && ev.target.closest && ev.target.closest('a');
        if (!a) return;
        var h = (a.getAttribute('href') || '').trim();
        if (!h || h === '#' || /^javascript:\\s*void/i.test(h)) {
          reportar('link sin destino real: ' + (a.id || (a.textContent || '').trim().slice(0,40) || 'sin-id'));
        }
      }, true);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
`;
  fs.writeFileSync(EXT_JS, out, 'utf8');
}
const loadExt = () => loadJsonObj(EXT_JSON, DEFAULT_EXT);
const saveExt = (c) => { writeJson(EXT_JSON, c); writeExtJs(c); };

// =============== comandos: reescritura ===============
function cmdList() {
  const r = loadRules();
  if (!r.length) return console.log('(no hay reglas de reescritura)');
  console.log(`Reescritura de mensajes (${r.length}):`);
  r.forEach((x, i) => console.log(`  [${i}] ${describeMatch(x)}  ->  ${JSON.stringify(x.replace)}`));
}
function cmdAddDirect(m, r) {
  if (!m || r == null) return errExit('Uso: add "texto o /regex/i" "mensaje"');
  const rule = Object.assign({}, parseMatch(m), { replace: String(r) });
  const arr = loadRules(); arr.push(rule); saveRules(arr);
  console.log(`Añadido [${arr.length - 1}]: ${describeMatch(rule)} -> ${JSON.stringify(rule.replace)}`);
}
function cmdRemove(idx) { genericRemove(loadRules, saveRules, idx, 'reescritura', describeMatch); }
function cmdClear() { saveRules([]); console.log('Lista de reescritura vaciada.'); }

// =============== comandos: bans ===============
function cmdListBans() {
  const r = loadBans();
  if (!r.length) return console.log('(no hay palabras prohibidas)');
  console.log(`Palabras prohibidas (${r.length}):`);
  r.forEach((x, i) => console.log(`  [${i}] ${describeMatch(x)}  ->  ${JSON.stringify(x.mensaje || '')}`));
}
function cmdAddBan(m, msg) {
  if (!m) return errExit('Uso: prohibir "palabra o /regex/i" "mensaje"');
  const rule = Object.assign({}, parseMatch(m),
    { mensaje: String(msg || `Valor no permitido: ${describeMatch(parseMatch(m))}`) });
  const arr = loadBans(); arr.push(rule); saveBans(arr);
  console.log(`Prohibido [${arr.length - 1}]: ${describeMatch(rule)} -> ${JSON.stringify(rule.mensaje)}`);
}
function cmdRemoveBan(idx) { genericRemove(loadBans, saveBans, idx, 'palabra prohibida', describeMatch); }
function cmdClearBans() { saveBans([]); console.log('Lista de palabras prohibidas vaciada.'); }

// =============== comandos: extensiones ===============
function cmdObligatorios() {
  const c = loadExt();
  if (!c.obligatorios.length) return console.log('(no hay campos obligatorios definidos)');
  c.obligatorios.forEach((r, i) => console.log(`  [${i}] ${r.selector}   ${r.mensaje ? '-> ' + JSON.stringify(r.mensaje) : ''}`));
}
function cmdAddObligatorio(sel, msg) {
  if (!sel) return errExit('Uso: obligatorio "<selector CSS>" [mensaje]');
  const c = loadExt();
  c.obligatorios.push({ selector: sel, mensaje: msg || '' });
  saveExt(c); console.log(`Obligatorio añadido [${c.obligatorios.length - 1}]: ${sel}`);
}
function cmdRmObligatorio(i) { rmExtArr('obligatorios', i, 'obligatorio'); }

function cmdLongitudes() {
  const c = loadExt();
  if (!c.longitudes.length) return console.log('(no hay reglas de longitud)');
  c.longitudes.forEach((r, i) => console.log(`  [${i}] ${r.selector}  min=${r.min ?? '-'} max=${r.max ?? '-'}  ${r.mensaje ? '-> ' + JSON.stringify(r.mensaje) : ''}`));
}
function cmdAddLongitud(sel, min, max, msg) {
  if (!sel || min == null || max == null) return errExit('Uso: longitud "<selector>" <min> <max> [mensaje]');
  const c = loadExt();
  c.longitudes.push({ selector: sel, min: Number(min), max: Number(max), mensaje: msg || '' });
  saveExt(c); console.log(`Longitud añadida [${c.longitudes.length - 1}]: ${sel} (${min}..${max})`);
}
function cmdRmLongitud(i) { rmExtArr('longitudes', i, 'longitud'); }

function cmdPatrones() {
  const c = loadExt();
  if (!c.patrones.length) return console.log('(no hay patrones de formato)');
  c.patrones.forEach((r, i) => console.log(`  [${i}] ${r.selector}  /${r.source}/${r.flags || ''}  ${r.mensaje ? '-> ' + JSON.stringify(r.mensaje) : ''}`));
}
function cmdAddPatron(sel, regexStr, msg) {
  if (!sel || !regexStr) return errExit('Uso: patron "<selector>" "/regex/flags" [mensaje]');
  const p = parseMatch(regexStr);
  const source = p.isRegex ? p.source : p.literal;
  const flags  = p.isRegex ? p.flags  : '';
  try { new RegExp(source, flags); } catch (e) { return errExit('regex invalida: ' + e.message); }
  const c = loadExt();
  c.patrones.push({ selector: sel, source, flags, mensaje: msg || '' });
  saveExt(c); console.log(`Patron añadido [${c.patrones.length - 1}]: ${sel} -> /${source}/${flags}`);
}
function cmdRmPatron(i) { rmExtArr('patrones', i, 'patron'); }

function cmdIgnorados() {
  const c = loadExt();
  if (!c.ignorados.length) return console.log('(no hay errores ignorados)');
  c.ignorados.forEach((r, i) => console.log(`  [${i}] ${describeMatch(r)}   ${r.razon ? '(' + r.razon + ')' : ''}`));
}
function cmdAddIgnorado(m, razon) {
  if (!m) return errExit('Uso: ignorar "texto o /regex/i" [razon]');
  const c = loadExt();
  c.ignorados.push(Object.assign({}, parseMatch(m), { razon: razon || '' }));
  saveExt(c); console.log(`Ignorado añadido [${c.ignorados.length - 1}]: ${describeMatch(c.ignorados[c.ignorados.length-1])}`);
}
function cmdRmIgnorado(i) { rmExtArr('ignorados', i, 'ignorado'); }

function cmdConsola(estado, sub) {
  const c = loadExt();
  if (!estado) {
    console.log(`consola.error = ${c.consola.error}, consola.warn = ${c.consola.warn}`);
    return;
  }
  const on = ['on', 'true', '1', 'si', 's'].includes(String(estado).toLowerCase());
  if (sub && /warn/i.test(sub)) c.consola.warn = on;
  else { c.consola.error = on; if (!sub) c.consola.warn = c.consola.warn; }
  saveExt(c);
  console.log(`consola.error = ${c.consola.error}, consola.warn = ${c.consola.warn}`);
}
function cmdThrottle(n) {
  const c = loadExt();
  if (n == null) return console.log(`throttle = ${c.throttle.porMinuto} errores/min (0 = sin limite)`);
  c.throttle.porMinuto = Math.max(0, Number(n) || 0);
  saveExt(c); console.log(`throttle.porMinuto = ${c.throttle.porMinuto}`);
}
function cmdUiChecks(estado, sub) {
  const c = loadExt();
  if (!estado) {
    console.log(`ui-checks: botonesDisabled=${c.uiChecks.botonesDisabled}, linksVacios=${c.uiChecks.linksVacios}`);
    return;
  }
  const on = ['on','true','1','si','s'].includes(String(estado).toLowerCase());
  if (!sub || sub === 'all' || sub === 'todo') {
    c.uiChecks.botonesDisabled = on; c.uiChecks.linksVacios = on;
  } else if (/boton/i.test(sub)) c.uiChecks.botonesDisabled = on;
  else if (/link/i.test(sub))    c.uiChecks.linksVacios   = on;
  saveExt(c);
  console.log(`ui-checks: botonesDisabled=${c.uiChecks.botonesDisabled}, linksVacios=${c.uiChecks.linksVacios}`);
}
function cmdEtiqueta(txt) {
  const c = loadExt();
  if (txt == null) return console.log(`etiqueta = ${c.etiqueta == null ? '(sin definir)' : JSON.stringify(c.etiqueta)}`);
  c.etiqueta = (txt === 'borrar' || txt === '-' || txt === '') ? null : String(txt);
  saveExt(c); console.log(`etiqueta = ${c.etiqueta == null ? '(borrada)' : JSON.stringify(c.etiqueta)}`);
}

// =============== utilidades extra ===============
function cmdTest(texto) {
  if (!texto) return errExit('Uso: test "texto a probar"');
  const t = String(texto);
  const rules = loadRules(), bans = loadBans(), ext = loadExt();
  console.log('Texto: ' + JSON.stringify(t));
  console.log('--- reescrituras que matchean ---');
  let any = false;
  rules.forEach((r, i) => {
    let ok = false;
    if (r.isRegex) { try { ok = new RegExp(r.source, r.flags || '').test(t); } catch (e) {} }
    else ok = t.indexOf(r.literal || '') !== -1;
    if (ok) { any = true; console.log(`  [${i}] ${describeMatch(r)} -> ${JSON.stringify(r.replace)}`); }
  });
  if (!any) console.log('  (ninguna)');
  console.log('--- palabras prohibidas que matchean ---');
  any = false;
  bans.forEach((r, i) => {
    let ok = false;
    if (r.isRegex) { try { ok = new RegExp(r.source, r.flags || 'i').test(t); } catch (e) {} }
    else ok = new RegExp(escapeRe(r.literal || ''), 'i').test(t);
    if (ok) { any = true; console.log(`  [${i}] ${describeMatch(r)} -> ${JSON.stringify(r.mensaje)}`); }
  });
  if (!any) console.log('  (ninguna)');
  console.log('--- ignorados que silenciarian este mensaje ---');
  any = false;
  ext.ignorados.forEach((r, i) => {
    let ok = false;
    if (r.isRegex) { try { ok = new RegExp(r.source, r.flags || 'i').test(t); } catch (e) {} }
    else ok = new RegExp(escapeRe(r.literal || ''), 'i').test(t);
    if (ok) { any = true; console.log(`  [${i}] ${describeMatch(r)}  (${r.razon || 'sin razon'})`); }
  });
  if (!any) console.log('  (ninguno)');
}

function cmdExportar(file) {
  const dest = file || path.join(DIR, `avisos-export-${new Date().toISOString().slice(0,10)}.json`);
  const dump = { rules: loadRules(), bans: loadBans(), ext: loadExt() };
  fs.writeFileSync(dest, JSON.stringify(dump, null, 2), 'utf8');
  console.log('Exportado a ' + dest);
}
function cmdImportar(file) {
  if (!file) return errExit('Uso: importar <archivo.json>');
  if (!fs.existsSync(file)) return errExit('archivo no existe: ' + file);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (Array.isArray(data.rules)) saveRules(data.rules);
  if (Array.isArray(data.bans))  saveBans(data.bans);
  if (data.ext)                  saveExt(Object.assign(JSON.parse(JSON.stringify(DEFAULT_EXT)), data.ext));
  console.log('Importado.');
  cmdEstado();
}
function cmdEstado() {
  const r = loadRules(), b = loadBans(), c = loadExt();
  console.log('--- Estado de la extension ---');
  console.log(`  Reescrituras           : ${r.length}`);
  console.log(`  Palabras prohibidas    : ${b.length}`);
  console.log(`  Campos obligatorios    : ${c.obligatorios.length}`);
  console.log(`  Reglas de longitud     : ${c.longitudes.length}`);
  console.log(`  Patrones de formato    : ${c.patrones.length}`);
  console.log(`  Errores ignorados      : ${c.ignorados.length}`);
  console.log(`  consola.error/warn     : ${c.consola.error} / ${c.consola.warn}`);
  console.log(`  throttle (errores/min) : ${c.throttle.porMinuto || 'sin limite'}`);
  console.log(`  ui-checks botones/links: ${c.uiChecks.botonesDisabled} / ${c.uiChecks.linksVacios}`);
  console.log(`  etiqueta entorno       : ${c.etiqueta || '(sin definir)'}`);
  console.log('Archivos:');
  console.log('  ' + RULES_JS);
  console.log('  ' + BAN_JS);
  console.log('  ' + EXT_JS);
}
function cmdPing(endpoint) {
  const ep = endpoint || process.env.AVANTSERVICE_ENDPOINT || 'http://127.0.0.1:8000';
  const target = ep.replace(/\/$/, '') + '/health';
  const lib = target.startsWith('https') ? https : http;
  console.log('GET ' + target);
  const req = lib.get(target, (res) => {
    let body = '';
    res.on('data', (d) => body += d);
    res.on('end', () => {
      console.log('  status:', res.statusCode);
      if (body) console.log('  body  :', body.slice(0, 300));
    });
  });
  req.on('error', (e) => console.log('  ERROR:', e.message));
  req.setTimeout(3000, () => { req.destroy(); console.log('  timeout (3s)'); });
}
function cmdBuild() {
  writeRulesJs(loadRules());
  writeBanJs(loadBans());
  writeExtJs(loadExt());
  console.log('Regenerados:');
  [RULES_JS, BAN_JS, EXT_JS].forEach(f => console.log('  ' + f));
}
function cmdInstalar() {
  console.log('IMPORTANTE: copia los .js a la raiz de la web cliente (auto-hospedar).');
  console.log('Si los sirves desde el orquestador y este cae, el navegador puede');
  console.log('bloquear el render de la pagina hasta agotar el timeout TCP.');
  console.log('');
  console.log('Pega esto en el <head> de cada HTML de la web cliente:');
  console.log('');
  console.log('  <script>');
  console.log("    window.APP_NAME    = 'mi-web';     // cambia esto");
  console.log("    window.APP_RELEASE = '1.0.0';      // opcional");
  console.log('  </script>');
  console.log('  <script src="mensajes.js"               defer></script>');
  console.log('  <script src="avisos-personalizados.js"  defer></script>');
  console.log('  <script src="error_capture.js"          defer');
  console.log('          data-endpoint="http://127.0.0.1:8000"></script>');
  console.log('  <script src="palabras-prohibidas.js"    defer></script>');
  console.log('  <script src="extensiones-cliente.js"    defer></script>');
  console.log('');
  console.log('Notas:');
  console.log('  - "defer" garantiza que NO bloquean el render aunque el host tarde.');
  console.log('  - El orden se respeta automaticamente con defer (ejecutan en orden).');
  console.log('  - extensiones y palabras prohibidas van DESPUES de error_capture.');
}

// =============== helpers de comando ===============
function errExit(msg) { console.error(msg); process.exit(1); }
function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function genericRemove(load, save, idx, label, describe) {
  const i = Number(idx); const arr = load();
  if (!Number.isInteger(i) || i < 0 || i >= arr.length) return errExit(`indice fuera de rango (0..${arr.length - 1})`);
  const [r] = arr.splice(i, 1); save(arr);
  console.log(`Borrado [${i}] (${label}): ${describe(r)}`);
}
function rmExtArr(key, idx, label) {
  const c = loadExt(); const i = Number(idx);
  if (!Number.isInteger(i) || i < 0 || i >= c[key].length) return errExit(`indice fuera de rango (0..${c[key].length - 1})`);
  const [r] = c[key].splice(i, 1); saveExt(c);
  console.log(`Borrado ${label} [${i}]: ${JSON.stringify(r)}`);
}

// =============== menu interactivo ===============
function ask(rl, q) { return new Promise(res => rl.question(q, ans => res(ans))); }
async function interactive() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const log = (...a) => console.log(...a);
  log('');
  log('================================================');
  log(' avisos-cli — extension de PaginaAuto');
  log('================================================');
  let on = true;
  while (on) {
    log('');
    log(' 1) Reescrituras (listar/añadir/borrar)');
    log(' 2) Palabras prohibidas');
    log(' 3) Campos obligatorios');
    log(' 4) Limites de longitud');
    log(' 5) Patrones de formato');
    log(' 6) Silenciar errores (ignorados)');
    log(' 7) Capturar consola.error / .warn');
    log(' 8) Throttle anti-spam');
    log(' 9) UI checks (botones/links)');
    log('10) Etiqueta de entorno');
    log('11) Test (probar texto contra reglas)');
    log('12) Exportar / Importar');
    log('13) Estado');
    log('14) Ping al orquestador');
    log('15) Regenerar JS (build)');
    log('16) Snippet de instalacion (<head>)');
    log(' 0) Salir');
    const op = (await ask(rl, '> Opcion: ')).trim();
    log('');
    try {
      if (op === '1')  await menuLista(rl, cmdList,    () => askAdd(rl, cmdAddDirect, 'match', 'mensaje'), cmdRemove,    cmdClear);
      else if (op === '2')  await menuLista(rl, cmdListBans, () => askAdd(rl, cmdAddBan,    'prohibir', 'mensaje'), cmdRemoveBan, cmdClearBans);
      else if (op === '3')  await menuLista(rl, cmdObligatorios, async () => {
        const s = (await ask(rl, '  selector CSS: ')).trim(); if (!s) return;
        const m = await ask(rl, '  mensaje (enter = generico): '); cmdAddObligatorio(s, m);
      }, cmdRmObligatorio);
      else if (op === '4')  await menuLista(rl, cmdLongitudes, async () => {
        const s = (await ask(rl, '  selector: ')).trim(); if (!s) return;
        const mn = (await ask(rl, '  min: ')).trim();
        const mx = (await ask(rl, '  max: ')).trim();
        const m  = await ask(rl, '  mensaje: '); cmdAddLongitud(s, mn, mx, m);
      }, cmdRmLongitud);
      else if (op === '5')  await menuLista(rl, cmdPatrones, async () => {
        const s = (await ask(rl, '  selector: ')).trim(); if (!s) return;
        const r = (await ask(rl, '  regex (ej /^\\d+$/): ')).trim(); if (!r) return;
        const m = await ask(rl, '  mensaje: '); cmdAddPatron(s, r, m);
      }, cmdRmPatron);
      else if (op === '6')  await menuLista(rl, cmdIgnorados, async () => {
        const m = (await ask(rl, '  match a ignorar: ')).trim(); if (!m) return;
        const r = await ask(rl, '  razon (opcional): '); cmdAddIgnorado(m, r);
      }, cmdRmIgnorado);
      else if (op === '7')  { const e = (await ask(rl, '  on/off (error): ')).trim(); cmdConsola(e); const w = (await ask(rl, '  on/off (warn): ')).trim(); if (w) cmdConsola(w, 'warn'); }
      else if (op === '8')  { const n = (await ask(rl, '  errores por minuto (0 = sin limite): ')).trim(); cmdThrottle(n || '0'); }
      else if (op === '9')  { const e = (await ask(rl, '  on/off: ')).trim(); cmdUiChecks(e); }
      else if (op === '10') { const t = await ask(rl, '  etiqueta (vacio o "borrar" para quitar): '); cmdEtiqueta(t); }
      else if (op === '11') { const t = await ask(rl, '  texto a probar: '); cmdTest(t); }
      else if (op === '12') {
        const sub = (await ask(rl, '  e=exportar, i=importar: ')).trim().toLowerCase();
        if (sub === 'e') { const f = (await ask(rl, '  archivo destino (enter=auto): ')).trim(); cmdExportar(f || null); }
        else if (sub === 'i') { const f = (await ask(rl, '  archivo origen: ')).trim(); cmdImportar(f); }
      }
      else if (op === '13') cmdEstado();
      else if (op === '14') { const e = (await ask(rl, '  endpoint (enter=http://127.0.0.1:8000): ')).trim(); cmdPing(e || null); }
      else if (op === '15') cmdBuild();
      else if (op === '16') cmdInstalar();
      else if (op === '0' || op === '' || op === 'q' || op === 'salir') on = false;
      else log('  opcion no reconocida.');
    } catch (e) { log('  error:', e.message); }
  }
  rl.close();
  console.log(''); console.log('Hasta luego.');
}
async function menuLista(rl, list, add, remove, clear) {
  list();
  const op = (await ask(rl, '  (a)ñadir / (b)orrar / (v)aciar / enter: ')).trim().toLowerCase();
  if (op === 'a') await add();
  else if (op === 'b') {
    const i = (await ask(rl, '  indice: ')).trim();
    if (i !== '') try { remove(i); } catch (e) { console.log('  error:', e.message); }
  } else if (op === 'v' && clear) {
    const c = (await ask(rl, '  ¿seguro? (s/N): ')).trim().toLowerCase();
    if (['s','si','y','yes'].includes(c)) clear();
  }
}
async function askAdd(rl, fn, k1, k2) {
  const a = (await ask(rl, `  ${k1}: `)).trim(); if (!a) return;
  const b = await ask(rl, `  ${k2}: `); fn(a, b);
}

// =============== entry point ===============
function main() {
  const [, , cmd, ...rest] = process.argv;
  if (!fs.existsSync(RULES_JS)) writeRulesJs(loadRules());
  if (!fs.existsSync(BAN_JS))   writeBanJs(loadBans());
  if (!fs.existsSync(EXT_JS))   writeExtJs(loadExt());

  switch ((cmd || '').toLowerCase()) {
    // reescritura
    case 'list': case 'ls':                       return cmdList();
    case 'add':
      if (rest.length >= 2) return cmdAddDirect(rest[0], rest.slice(1).join(' '));
      return interactive();
    case 'remove': case 'rm': case 'del':         return cmdRemove(rest[0]);
    case 'clear':                                 return cmdClear();
    // bans
    case 'prohibidas': case 'banned':             return cmdListBans();
    case 'prohibir': case 'ban':
      if (rest.length >= 1) return cmdAddBan(rest[0], rest.slice(1).join(' '));
      return interactive();
    case 'permitir': case 'unban':                return cmdRemoveBan(rest[0]);
    case 'limpiar-prohibidas': case 'clear-bans': return cmdClearBans();
    // obligatorios
    case 'obligatorios':                          return cmdObligatorios();
    case 'obligatorio':                           return cmdAddObligatorio(rest[0], rest.slice(1).join(' '));
    case 'quitar-obligatorio':                    return cmdRmObligatorio(rest[0]);
    // longitudes
    case 'longitudes':                            return cmdLongitudes();
    case 'longitud':                              return cmdAddLongitud(rest[0], rest[1], rest[2], rest.slice(3).join(' '));
    case 'quitar-longitud':                       return cmdRmLongitud(rest[0]);
    // patrones
    case 'patrones':                              return cmdPatrones();
    case 'patron':                                return cmdAddPatron(rest[0], rest[1], rest.slice(2).join(' '));
    case 'quitar-patron':                         return cmdRmPatron(rest[0]);
    // ignorados
    case 'ignorados':                             return cmdIgnorados();
    case 'ignorar':                               return cmdAddIgnorado(rest[0], rest.slice(1).join(' '));
    case 'quitar-ignorado':                       return cmdRmIgnorado(rest[0]);
    // toggles
    case 'consola':                               return cmdConsola(rest[0], rest[1]);
    case 'throttle':                              return cmdThrottle(rest[0]);
    case 'ui-checks': case 'ui':                  return cmdUiChecks(rest[0], rest[1]);
    case 'etiqueta':                              return cmdEtiqueta(rest.length ? rest.join(' ') : null);
    // utilidades
    case 'test':                                  return cmdTest(rest.join(' '));
    case 'exportar': case 'export':               return cmdExportar(rest[0]);
    case 'importar': case 'import':               return cmdImportar(rest[0]);
    case 'estado': case 'status':                 return cmdEstado();
    case 'ping':                                  return cmdPing(rest[0]);
    case 'build':                                 return cmdBuild();
    case 'instalar': case 'install':              return cmdInstalar();

    case 'help': case '-h': case '--help':
      console.log('avisos-cli — comandos disponibles:');
      console.log('  REESCRITURA       : list | add <m> <r> | remove <i> | clear');
      console.log('  PROHIBIDAS        : prohibidas | prohibir <m> [msg] | permitir <i> | limpiar-prohibidas');
      console.log('  OBLIGATORIOS      : obligatorios | obligatorio <sel> [msg] | quitar-obligatorio <i>');
      console.log('  LONGITUDES        : longitudes | longitud <sel> <min> <max> [msg] | quitar-longitud <i>');
      console.log('  PATRONES          : patrones | patron <sel> "/regex/flags" [msg] | quitar-patron <i>');
      console.log('  IGNORADOS         : ignorados | ignorar <m> [razon] | quitar-ignorado <i>');
      console.log('  TOGGLES           : consola on|off [warn] | throttle <n> | ui-checks on|off [boton|link] | etiqueta <txt>');
      console.log('  UTILIDADES        : test "<texto>" | exportar [f] | importar <f> | estado | ping [url] | build | instalar');
      return;
    default:
      return interactive();
  }
}

main();
