// Cache de catálogo y deployers en memoria. Se rellena al arrancar y se
// puede refrescar invocando refreshCache().
import { pool } from './db.js';

let CATALOG = [];   // [{ id, code, platform, regex, severity, ... }]
let DEPLOYERS = []; // [{ name, display_name, url_patterns:[], header_hints:[], color }]

export async function refreshCache() {
  try {
    const [catRows] = await pool.execute('SELECT * FROM error_catalog');
    CATALOG = catRows.map(r => {
      let rx = null;
      if (r.pattern_regex) {
        try { rx = new RegExp(r.pattern_regex); } catch (e) { rx = null; }
      }
      return { ...r, _rx: rx };
    });
    const [depRows] = await pool.execute('SELECT * FROM deployers');
    DEPLOYERS = depRows.map(r => ({
      ...r,
      url_patterns: parseJson(r.url_patterns) || [],
      header_hints: parseJson(r.header_hints) || [],
    }));
  } catch (e) {
    console.warn('[detector] refreshCache failed:', e.message);
  }
}

function parseJson(x) {
  if (!x) return null;
  if (typeof x === 'object') return x;
  try { return JSON.parse(x); } catch (e) { return null; }
}

// Detecta plataforma a partir de la URL del cliente o de cabeceras.
export function detectDeployer({ url, headers, hint }) {
  if (hint) {
    const h = DEPLOYERS.find(d => d.name === hint);
    if (h) return h.name;
  }
  const u = String(url || '').toLowerCase();
  for (const d of DEPLOYERS) {
    for (const pat of d.url_patterns) {
      if (u.includes(String(pat).toLowerCase())) return d.name;
    }
  }
  if (headers && typeof headers === 'object') {
    const headerStr = Object.entries(headers).map(([k,v]) => `${k}: ${v}`).join('\n').toLowerCase();
    for (const d of DEPLOYERS) {
      for (const hint2 of d.header_hints) {
        if (headerStr.includes(String(hint2).toLowerCase())) return d.name;
      }
    }
  }
  return null;
}

// Busca match en catálogo. Si hay deployer detectado, prioriza esa plataforma;
// si no, prueba todas. Devuelve la entrada con regex que matchee primero.
export function matchCatalog({ message, stack, deployer }) {
  const text = [message, stack].filter(Boolean).join('\n');
  if (!text) return null;
  const ordered = deployer
    ? [...CATALOG.filter(c => c.platform === deployer), ...CATALOG.filter(c => c.platform !== deployer)]
    : CATALOG;
  for (const c of ordered) {
    if (c._rx && c._rx.test(text)) return c;
  }
  return null;
}

export function getCatalog() { return CATALOG; }
export function getDeployers() { return DEPLOYERS; }
