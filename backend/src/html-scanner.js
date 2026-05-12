// Escáner de HTML estático: recorre los .html de una carpeta registrada y, por
// cada regla del catálogo con fix_type='replace', si su fix_search aparece en el
// archivo, crea una preview (status='pending', deployer='html') con el catalog_code
// correspondiente. Esas previews se ven en el panel y se aplican con "Arreglar sin IA"
// (que usa /previews/:id/autofix → escribe en la carpeta del sitio siguiendo la BD).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pool } from './db.js';
import { getCatalog } from './detector.js';
import { getSites, touchScan } from './sites.js';

const IGNORE_DIRS = new Set(['node_modules', '.git', '.svn', '.hg', 'vendor', 'dist', 'build', '.next', '.cache', '.idea', '.vscode']);
const HTML_RE = /\.(html?|xhtml)$/i;

// (?i)… inline no existe en JS: lo pasamos a flags reales y fusionamos fix_flags.
function fixRegex(c) {
  let body = String(c.fix_search || '');
  let flags = '';
  const m = body.match(/^\(\?([a-z]+)\)/i);
  if (m) {
    for (const f of m[1].toLowerCase()) if ('imsu'.includes(f) && !flags.includes(f)) flags += f;
    body = body.slice(m[0].length);
  }
  for (const f of String(c.fix_flags || '')) if (!flags.includes(f)) flags += f;
  try { return new RegExp(body, flags); } catch { return null; }
}

function listHtml(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (!IGNORE_DIRS.has(e.name.toLowerCase())) listHtml(full, out); }
    else if (HTML_RE.test(e.name) && !/\.bak$/i.test(e.name)) out.push(full);
  }
  return out;
}

// ¿Ya existe una preview 'pending' para este sitio+archivo+código?
async function alreadyReported(app, pagePath, code) {
  const [[row]] = await pool.execute(
    `SELECT id FROM previews
       WHERE status='pending' AND deployer='html' AND catalog_code=?
         AND JSON_UNQUOTE(JSON_EXTRACT(extra,'$.app'))=?
         AND JSON_UNQUOTE(JSON_EXTRACT(extra,'$.page_path'))=?
       LIMIT 1`,
    [code, app, pagePath]
  );
  return !!row;
}

export async function scanSite(site) {
  const root = site.root;
  let rootOk = false;
  try { rootOk = fs.existsSync(root) && fs.statSync(root).isDirectory(); } catch {}
  if (!rootOk) return { app: site.name, error: 'carpeta no encontrada: ' + root };

  const rules = getCatalog().filter(c => c.fix_type === 'replace' && c.fix_search);
  const files = listHtml(root);
  let created = 0;
  for (const file of files) {
    let content;
    try { content = fs.readFileSync(file, 'utf8'); } catch { continue; }
    const pagePath = path.relative(root, file).replace(/\\/g, '/');
    for (const c of rules) {
      const rx = fixRegex(c);
      if (!rx || !rx.test(content)) continue;
      if (await alreadyReported(site.name, pagePath, c.code)) continue;
      const id = crypto.randomBytes(8).toString('hex');
      const extra = { app: site.name, page_path: pagePath, local_root: root, kind: 'html-scan' };
      const txt = `[html/${c.code}] ${c.cause || ''}\n→ ${c.solution || ''}`;
      await pool.execute(
        `INSERT INTO previews (id, source, status, priority, file, line, message, extra, deployer, catalog_code, diagnosis)
         VALUES (?, 'html-scan', 'pending', ?, NULL, NULL, ?, ?, 'html', ?, ?)`,
        [id, c.severity || 'low',
         `${txt}\n✅ Arreglo automático disponible (sin IA) — pulsa "Arreglar sin IA" en el panel.`,
         JSON.stringify(extra), c.code, txt]
      );
      created++;
    }
  }
  touchScan(site.name);
  return { app: site.name, files: files.length, created };
}

export async function scanAllSites() {
  const results = [];
  for (const s of getSites()) {
    try { results.push(await scanSite(s)); }
    catch (e) { results.push({ app: s.name, error: e.message }); }
  }
  return results;
}
