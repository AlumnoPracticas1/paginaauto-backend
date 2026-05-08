/* AUTO-GENERADO por avisos-cli.js — extensiones del cliente.
 * Cargar DESPUES de error_capture.js. */
(function () {
  var CFG = {"obligatorios":[],"longitudes":[],"patrones":[],"ignorados":[],"consola":{"error":false,"warn":false},"throttle":{"porMinuto":0},"uiChecks":{"botonesDisabled":false,"linksVacios":false},"etiqueta":null};

  // ---- resolver endpoint exacto del orquestador ----
  function resolveBase() {
    try {
      if (window.AVANTSERVICE_ENDPOINT) return String(window.AVANTSERVICE_ENDPOINT).replace(/\/$/, '');
      var scripts = document.getElementsByTagName('script');
      for (var i = 0; i < scripts.length; i++) {
        var ds = scripts[i].getAttribute && scripts[i].getAttribute('data-endpoint');
        if (ds) return String(ds).replace(/\/$/, '');
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
  function escapar(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
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
        if (!h || h === '#' || /^javascript:\s*void/i.test(h)) {
          reportar('link sin destino real: ' + (a.id || (a.textContent || '').trim().slice(0,40) || 'sin-id'));
        }
      }, true);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
