/* AUTO-GENERADO por avisos-cli.js — palabras prohibidas en inputs. */
(function () {
  var REGLAS = [

  ];
  if (!REGLAS.length) return;
  var compiladas = REGLAS.map(function (r) {
    if (r.tipo === 'regex') {
      try { return { re: new RegExp(r.source, r.flags || 'i'), mensaje: r.mensaje, etiqueta: '/' + r.source + '/' + (r.flags || '') }; }
      catch (e) { return null; }
    }
    var v = String(r.valor || ''); if (!v) return null;
    var esc = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
