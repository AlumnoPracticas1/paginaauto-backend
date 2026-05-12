// Registro de "sitios conectados": carpetas locales que el agente arreglahtml.exe
// ha dado de alta. El backend usa este registro para (1) escanear su HTML contra
// el catálogo y crear previews, y (2) saber a qué carpeta escribir cuando se
// aplica un arreglo desde el panel.
//
// Se persiste en data/sites.json para que sobreviva a reinicios del backend.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'sites.json');

// SITES: { [name]: { name, root, added_at, last_scan, last_seen } }
let SITES = {};

function load() {
  try {
    if (fs.existsSync(FILE)) {
      const obj = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      if (obj && typeof obj === 'object') SITES = obj;
    }
  } catch (e) { console.warn('[sites] no se pudo leer sites.json:', e.message); }
}
function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(SITES, null, 2), 'utf8');
  } catch (e) { console.warn('[sites] no se pudo guardar sites.json:', e.message); }
}
load();

export function getSites() { return Object.values(SITES); }
export function getSite(name) { return SITES[String(name || '').toLowerCase().trim()] || null; }

// Devuelve la carpeta absoluta de un sitio (o null). Verifica que existe.
export function rootForApp(name) {
  const s = getSite(name);
  if (!s || !s.root) return null;
  try {
    const r = path.resolve(s.root);
    if (fs.existsSync(r) && fs.statSync(r).isDirectory()) return r;
  } catch {}
  return null;
}

export function registerSite(name, root) {
  const key = String(name || '').toLowerCase().trim();
  if (!key) throw new Error('name requerido');
  const abs = path.resolve(String(root || ''));
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw new Error('root no es una carpeta válida: ' + abs);
  const now = new Date().toISOString();
  const prev = SITES[key] || {};
  SITES[key] = { name: key, root: abs, added_at: prev.added_at || now, last_seen: now, last_scan: prev.last_scan || null };
  save();
  return SITES[key];
}

export function touchScan(name) {
  const key = String(name || '').toLowerCase().trim();
  if (SITES[key]) { SITES[key].last_scan = new Date().toISOString(); save(); }
}

export function removeSite(name) {
  const key = String(name || '').toLowerCase().trim();
  if (SITES[key]) { delete SITES[key]; save(); return true; }
  return false;
}
