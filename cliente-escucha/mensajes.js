/* ================================================================
 * mensajes.js — diccionario de mensajes personalizados
 *
 * Cárgalo ANTES de error_capture.js. Cada regla compara el mensaje
 * de error original con `match` y si coincide, lo sustituye por
 * `replace`. Se aplica tanto al envío al orquestador como al texto
 * que verás en el dashboard "Bandeja".
 *
 *   match:   string (substring) | RegExp
 *   replace: string             (puede usar $1, $2... si match es RegExp)
 *
 * Edita libremente la lista de abajo con tus propias palabras.
 * ================================================================ */
window.MENSAJES_PERSONALIZADOS = [
  // --- Errores JS típicos -----------------------------------------
  { match: /Cannot read propert(y|ies) of undefined .*'([^']+)'/i,
    replace: 'Falta el dato "$2" cuando se intenta usar' },

  { match: /Cannot read propert(y|ies) of null/i,
    replace: 'Se esperaba un elemento del DOM y no existe' },

  { match: /is not defined/i,
    replace: 'Se llamó a algo que no está declarado' },

  { match: /is not a function/i,
    replace: 'Se está llamando como función algo que no lo es' },

  { match: /Unexpected token/i,
    replace: 'Sintaxis JS rota (revisa comas/llaves)' },

  // --- Red / fetch ------------------------------------------------
  { match: /NetworkError|Failed to fetch/i,
    replace: 'Sin conexión con el servidor' },

  { match: /fetch 401/i,
    replace: 'Sesión caducada o sin permisos' },

  { match: /fetch 403/i,
    replace: 'Acceso prohibido' },

  { match: /fetch 404/i,
    replace: 'Endpoint no encontrado' },

  { match: /fetch 5\d\d/i,
    replace: 'El servidor está fallando' },

  // --- Recursos ---------------------------------------------------
  { match: /Recurso no cargado:.*\.(png|jpg|jpeg|gif|svg|webp)/i,
    replace: 'Imagen rota' },

  { match: /Recurso no cargado:.*\.css/i,
    replace: 'Hoja de estilos no carga' },

  { match: /Recurso no cargado:.*\.js/i,
    replace: 'Script no carga' },

  // --- Añade aquí los tuyos ---------------------------------------
  // { match: 'fragmento que aparece en tu error', replace: 'lo que quieres ver' },
];
