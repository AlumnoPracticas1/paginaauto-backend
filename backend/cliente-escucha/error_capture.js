/* ================================================================
 * cliente-escucha — captura de errores para cualquier web
 * Endpoint orquestador: http://<host>:8000  (main.py)
 *   /report → guarda preview
 *   /hello  → registra el cliente para "Clientes conectados"
 *
 * USO MÍNIMO (en el <head>):
 *   <script>window.APP_NAME = 'mi-web';</script>
 *   <script src="mensajes.js"></script>          (opcional, traducciones)
 *   <script src="error_capture.js"
 *           data-endpoint="http://127.0.0.1:8000"
 *           data-token="opcional-secreto"></script>
 *
 * Configuración disponible (todo opcional):
 *   window.APP_NAME              → nombre del cliente (default: hostname)
 *   window.APP_RELEASE           → versión (default: null)
 *   window.AVANTSERVICE_ENDPOINT → base del orquestador (default: http://<host>:8000)
 *   window.AVANTSERVICE_TOKEN    → token compartido (header X-Client-Token)
 *   window.MENSAJES_PERSONALIZADOS → array de { match, replace }
 *
 * Garantías de robustez:
 *   - Nunca lanza al host: todo handler va envuelto en try/catch.
 *   - Si el orquestador no responde, la página sigue viva.
 *   - Cola en sessionStorage con reintentos cuando vuelve la red.
 *   - Timeout explícito (5s) por request.
 *   - Sanitiza y trunca payloads antes de enviar.
 * ================================================================ */
(function () {
  'use strict';

  // ---- Config tunables --------------------------------------------------
  var REQUEST_TIMEOUT_MS = 5000;     // timeout duro por POST
  var MAX_QUEUE          = 50;       // errores en cola si no hay red
  var MAX_MSG_LEN        = 2000;     // truncado de mensaje
  var MAX_STACK_LEN      = 4000;     // truncado de stack
  var MAX_PAYLOAD_BYTES  = 32 * 1024;
  var QUEUE_KEY          = '__avantservice_queue__';
  var COUNT_KEY          = '__avantservice_counts__';
  var MAX_PER_ERROR      = 5;        // tope de envíos por mismo error (persistente)
  var RETRY_DELAYS       = [2000, 8000, 30000];

  // ---- Resolución de endpoint y token ----------------------------------
  function safeAttr(name) {
    try {
      var scripts = document.getElementsByTagName('script');
      for (var i = 0; i < scripts.length; i++) {
        var v = scripts[i].getAttribute && scripts[i].getAttribute(name);
        if (v) return String(v);
      }
    } catch (e) {}
    return null;
  }

  function resolveBase() {
    try {
      if (typeof window !== 'undefined' && window.AVANTSERVICE_ENDPOINT) {
        return String(window.AVANTSERVICE_ENDPOINT).replace(/\/$/, '');
      }
      var ds = safeAttr('data-endpoint');
      if (ds) return ds.replace(/\/$/, '');
    } catch (e) {}
    var proto = (location.protocol === 'https:') ? 'https:' : 'http:';
    var host = location.hostname || '127.0.0.1';
    return proto + '//' + host + ':8000';
  }

  var BASE           = resolveBase();
  var ENDPOINT       = BASE + '/report';
  var HELLO_ENDPOINT = BASE + '/hello';
  var TOKEN          = (typeof window !== 'undefined' && window.AVANTSERVICE_TOKEN) || safeAttr('data-token') || null;
  var APP_NAME       = (typeof window !== 'undefined' && window.APP_NAME) || (location.hostname || 'cliente');
  var APP_RELEASE    = (typeof window !== 'undefined' && window.APP_RELEASE) || null;
  var SOURCE         = 'js';

  // Snapshot del fetch original ANTES que cualquier wrapper externo lo toque.
  var origFetch = (typeof window !== 'undefined' && typeof window.fetch === 'function') ? window.fetch.bind(window) : null;

  // ---- Sanitización ----------------------------------------------------
  function truncate(s, max) {
    if (s == null) return s;
    s = String(s);
    return s.length > max ? s.slice(0, max) + '…[truncated]' : s;
  }

  // Quita query/hash de URLs (donde suelen viajar tokens) y limita longitud.
  function safeUrl(u) {
    if (!u) return u;
    try {
      var url = new URL(String(u), location.href);
      return truncate(url.origin + url.pathname, 500);
    } catch (e) {
      return truncate(String(u).split('?')[0].split('#')[0], 500);
    }
  }

  function relPath(url) {
    if (!url) return null;
    try {
      var u = new URL(url, location.href);
      return u.pathname.replace(/^\//, '');
    } catch (e) { return truncate(String(url), 300); }
  }

  function sanitize(payload) {
    if (!payload || typeof payload !== 'object') return { source: SOURCE, message: 'invalid payload' };
    var out = {
      source:  payload.source || SOURCE,
      message: truncate(payload.message || '', MAX_MSG_LEN),
      file:    truncate(payload.file || '', 500),
      line:    Number(payload.line) || 0,
      stack:   payload.stack ? truncate(payload.stack, MAX_STACK_LEN) : null,
      extra:   {}
    };
    var src = payload.extra || {};
    for (var k in src) {
      if (!Object.prototype.hasOwnProperty.call(src, k)) continue;
      var v = src[k];
      if (v == null) { out.extra[k] = v; continue; }
      var t = typeof v;
      if (t === 'string')      out.extra[k] = truncate(v, 500);
      else if (t === 'number' || t === 'boolean') out.extra[k] = v;
      else { try { out.extra[k] = truncate(JSON.stringify(v), 500); } catch (e) {} }
    }
    if (out.extra.url) out.extra.url = safeUrl(out.extra.url);
    return out;
  }

  // ---- Personalización de mensajes -------------------------------------
  function personalizar(msg) {
    if (!msg) return msg;
    try {
      var rules = (typeof window !== 'undefined' && window.MENSAJES_PERSONALIZADOS) || [];
      for (var i = 0; i < rules.length; i++) {
        var r = rules[i];
        if (!r || !r.match || typeof r.replace !== 'string') continue;
        if (r.match instanceof RegExp) {
          if (r.match.test(msg)) return msg.replace(r.match, r.replace);
        } else if (typeof r.match === 'string') {
          if (msg.indexOf(r.match) !== -1) return msg.split(r.match).join(r.replace);
        }
      }
    } catch (e) {}
    return msg;
  }

  // ---- Cola persistente (sessionStorage) -------------------------------
  function readQueue() {
    try {
      var raw = sessionStorage.getItem(QUEUE_KEY);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }
  function writeQueue(q) {
    try {
      if (q.length > MAX_QUEUE) q = q.slice(q.length - MAX_QUEUE);
      sessionStorage.setItem(QUEUE_KEY, JSON.stringify(q));
    } catch (e) {}
  }
  function enqueue(url, payload) {
    var q = readQueue();
    q.push({ url: url, payload: payload, ts: Date.now(), tries: 0 });
    writeQueue(q);
  }

  // ---- POST con timeout, retry y cola ----------------------------------
  function postOnce(url, payload) {
    return new Promise(function (resolve, reject) {
      var f = origFetch || (typeof fetch === 'function' ? fetch : null);
      if (!f) return reject(new Error('no fetch'));
      var body;
      try { body = JSON.stringify(payload); } catch (e) { return reject(e); }
      if (body.length > MAX_PAYLOAD_BYTES) {
        // Recorta más agresivamente y reintenta serializar.
        try {
          payload = sanitize(payload);
          payload.message = truncate(payload.message, 500);
          payload.stack = payload.stack ? truncate(payload.stack, 800) : null;
          body = JSON.stringify(payload);
        } catch (e) { return reject(e); }
        if (body.length > MAX_PAYLOAD_BYTES) return reject(new Error('payload too large'));
      }

      var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var timer = setTimeout(function () {
        if (ctrl) { try { ctrl.abort(); } catch (e) {} }
      }, REQUEST_TIMEOUT_MS);

      var headers = { 'Content-Type': 'application/json' };
      if (TOKEN) headers['X-Client-Token'] = TOKEN;

      try {
        f(url, {
          method: 'POST',
          headers: headers,
          body: body,
          keepalive: body.length < 60 * 1024,
          mode: 'cors',
          credentials: 'omit',
          signal: ctrl ? ctrl.signal : undefined
        }).then(function (r) {
          clearTimeout(timer);
          if (r && r.ok) resolve(r);
          else reject(new Error('HTTP ' + (r && r.status)));
        }).catch(function (e) { clearTimeout(timer); reject(e); });
      } catch (e) { clearTimeout(timer); reject(e); }
    });
  }

  var draining = false;
  function drain() {
    if (draining) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    var q = readQueue();
    if (!q.length) return;
    draining = true;
    var item = q.shift();
    writeQueue(q);
    postOnce(item.url, item.payload).then(function () {
      draining = false;
      // Sigue vaciando mientras quede algo.
      if (readQueue().length) setTimeout(drain, 50);
    }).catch(function () {
      draining = false;
      item.tries = (item.tries || 0) + 1;
      if (item.tries <= RETRY_DELAYS.length) {
        var qq = readQueue();
        qq.unshift(item);
        writeQueue(qq);
        setTimeout(drain, RETRY_DELAYS[item.tries - 1]);
      }
      // Si superó los reintentos, se descarta. Mejor perder un error
      // que llenar la cola eternamente con el mismo fallo.
    });
  }

  function post(url, payload) {
    try {
      // Intento directo; si falla, va a la cola.
      postOnce(url, payload).catch(function () {
        try { enqueue(url, payload); setTimeout(drain, 100); } catch (e) {}
      });
    } catch (e) {
      try { enqueue(url, payload); } catch (_) {}
    }
  }

  if (typeof window !== 'undefined' && window.addEventListener) {
    try { window.addEventListener('online', function () { setTimeout(drain, 200); }); } catch (e) {}
    try { window.addEventListener('load',   function () { setTimeout(drain, 1500); }); } catch (e) {}
  }

  // ---- Conteo persistente por error (localStorage, sobrevive recargas)
  function readCounts() {
    try {
      var raw = localStorage.getItem(COUNT_KEY);
      if (!raw) return {};
      var obj = JSON.parse(raw);
      return (obj && typeof obj === 'object') ? obj : {};
    } catch (e) { return {}; }
  }
  function writeCounts(c) {
    try { localStorage.setItem(COUNT_KEY, JSON.stringify(c)); } catch (e) {}
  }
  // true si supera el tope -> no enviar
  function bumpAndCheck(key) {
    try {
      var c = readCounts();
      var n = (c[key] || 0) + 1;
      if (n > MAX_PER_ERROR) return true;
      c[key] = n;
      writeCounts(c);
      return false;
    } catch (e) { return false; }
  }

  // ---- send() (cada ocurrencia se envía hasta MAX_PER_ERROR) -----------
  function send(payload) {
    try {
      payload.message = personalizar(payload.message);
      var key = (payload.message || '') + '|' + (payload.file || '') + ':' + (payload.line || 0);
      if (bumpAndCheck(key)) return;
      var here = '';
      try { here = safeUrl(location.href); } catch (e) {}
      payload.extra = Object.assign({ app: APP_NAME }, payload.extra || {});
      // Inyectar siempre la pagina origen si no la trae el handler.
      if (!payload.extra.page && here) payload.extra.page = here;
      if (!payload.extra.page_path) {
        try { payload.extra.page_path = relPath(location.href); } catch (e) {}
      }
      try { payload.extra.page_title = truncate(document.title || '', 200); } catch (e) {}
      if (APP_RELEASE) payload.extra.release = APP_RELEASE;
      post(ENDPOINT, sanitize(payload));
    } catch (e) { /* nunca propagar al host */ }
  }

  // ---- Helper público --------------------------------------------------
  try {
    window.AVISOS_REPORTAR = function (msg, extra) {
      try {
        send({
          source: SOURCE,
          message: String(msg == null ? '' : msg),
          file: relPath(location.href),
          line: 0,
          stack: null,
          extra: Object.assign({ kind: 'manual' }, extra || {})
        });
      } catch (e) {}
    };
  } catch (e) {}

  // ---- /hello (registro de cliente) ------------------------------------
  try {
    post(HELLO_ENDPOINT, {
      app: APP_NAME,
      release: APP_RELEASE,
      url: safeUrl(location.href),
      user_agent: truncate(navigator.userAgent, 300)
    });
  } catch (e) {}

  // ---- Errores JS y de recursos ----------------------------------------
  try {
    window.addEventListener('error', function (ev) {
      try {
        if (ev.target && ev.target !== window && (ev.target.src || ev.target.href)) {
          send({
            source: SOURCE,
            message: 'Recurso no cargado: ' + safeUrl(ev.target.src || ev.target.href),
            file: relPath(location.href),
            line: 0,
            stack: null,
            extra: { kind: 'resource', tag: ev.target.tagName }
          });
          return;
        }
        send({
          source: SOURCE,
          message: ev.message || 'Error JS',
          file: relPath(ev.filename) || relPath(location.href),
          line: ev.lineno || 0,
          stack: ev.error && ev.error.stack ? String(ev.error.stack) : null,
          extra: { col: ev.colno, page: safeUrl(location.href) }
        });
      } catch (e) {}
    }, true);
  } catch (e) {}

  // ---- Promesas rechazadas ---------------------------------------------
  try {
    window.addEventListener('unhandledrejection', function (ev) {
      try {
        var reason = ev.reason;
        var msg = (reason && reason.message) || String(reason);
        send({
          source: SOURCE,
          message: 'Promise rechazada: ' + msg,
          file: relPath(location.href),
          line: 0,
          stack: reason && reason.stack ? String(reason.stack) : null,
          extra: { kind: 'unhandledrejection' }
        });
      } catch (e) {}
    });
  } catch (e) {}

  // ---- Wrapper de fetch -------------------------------------------------
  // Crítico: si nuestro reporting falla, NUNCA debe romper el fetch del host.
  if (origFetch) {
    try {
      var wrapped = function () {
        var args = arguments;
        var url;
        try { url = (args[0] && args[0].url) || args[0]; } catch (e) { url = ''; }
        // No reportar nuestros propios POSTs al orquestador (evita bucles).
        var urlStr = '';
        try { urlStr = String(url || ''); } catch (e) {}
        var isOwn = urlStr.indexOf(BASE) === 0;

        var p;
        try { p = origFetch.apply(this, args); }
        catch (e) {
          if (!isOwn) {
            try {
              send({
                source: SOURCE,
                message: 'fetch lanzo: ' + (e && e.message || e),
                file: relPath(location.href), line: 0,
                stack: e && e.stack ? String(e.stack) : null,
                extra: { kind: 'fetch_throw', url: safeUrl(url) }
              });
            } catch (_) {}
          }
          throw e;
        }
        if (!p || typeof p.then !== 'function') return p;

        return p.then(function (resp) {
          if (!isOwn) {
            try {
              if (resp && !resp.ok && resp.status >= 400) {
                send({
                  source: SOURCE,
                  message: 'fetch ' + resp.status + ' ' + safeUrl(url),
                  file: relPath(location.href), line: 0, stack: null,
                  extra: { kind: 'fetch', status: resp.status, url: safeUrl(url) }
                });
              }
            } catch (_) {}
          }
          return resp;
        }, function (err) {
          if (!isOwn) {
            try {
              send({
                source: SOURCE,
                message: 'fetch fallo: ' + (err && err.message || err) + ' -> ' + safeUrl(url),
                file: relPath(location.href), line: 0,
                stack: err && err.stack ? String(err.stack) : null,
                extra: { kind: 'fetch_error', url: safeUrl(url) }
              });
            } catch (_) {}
          }
          throw err;
        });
      };
      window.fetch = wrapped;
    } catch (e) {}
  }

  // ---- Auditor de CSS (propiedades invalidas en hojas same-origin) -----
  function auditCssText(text, fileLabel) {
    if (!text || typeof CSS === 'undefined' || !CSS.supports) return;
    var clean = text.replace(/\/\*[\s\S]*?\*\//g, '');
    var blockRe = /([^{}]+)\{([^{}]*)\}/g, m;
    while ((m = blockRe.exec(clean)) !== null) {
      var selector = m[1].trim().slice(0, 120);
      var body = m[2];
      body.split(';').forEach(function (decl) {
        decl = decl.trim();
        if (!decl) return;
        var idx = decl.indexOf(':');
        if (idx < 0) return;
        var prop = decl.slice(0, idx).trim();
        var val  = decl.slice(idx + 1).trim();
        if (!prop || prop.charAt(0) === '-' || prop.charAt(0) === '@') return;
        try {
          if (!CSS.supports(prop, val)) {
            send({
              source: SOURCE,
              message: 'CSS invalido: "' + prop + ': ' + val.slice(0, 80) + '" en ' + selector,
              file: fileLabel, line: 0, stack: null,
              extra: { kind: 'css_invalid', prop: prop, value: val.slice(0, 200), selector: selector }
            });
          }
        } catch (e) {}
      });
    }
  }
  function auditCss() {
    try {
      document.querySelectorAll('style').forEach(function (s, i) {
        try { auditCssText(s.textContent, relPath(location.href) + '#style[' + i + ']'); } catch (e) {}
      });
      Array.prototype.slice.call(document.styleSheets).forEach(function (sheet) {
        var href = sheet.href;
        if (!href) return;
        var sameOrigin = false;
        try { sameOrigin = new URL(href).origin === location.origin; } catch (e) {}
        if (!sameOrigin) return;
        // Usamos origFetch para no entrar al wrapper.
        var f = origFetch || fetch;
        f(href).then(function (r) { return r.text(); }).then(function (t) {
          try { auditCssText(t, relPath(href)); } catch (e) {}
        }).catch(function () {});
      });
    } catch (e) {}
  }
  try {
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      setTimeout(auditCss, 300);
    } else {
      window.addEventListener('DOMContentLoaded', function () { setTimeout(auditCss, 300); });
    }
  } catch (e) {}
})();
