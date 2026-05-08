import { Router } from 'express';
import { pool } from '../db.js';
import { refreshCache, getCatalog, getDeployers } from '../detector.js';

const r = Router();

// Lista catálogo (opcionalmente filtrado por plataforma)
r.get('/', async (req, res) => {
  const platform = req.query.platform;
  let sql = 'SELECT id, code, platform, pattern_regex, category, severity, cause, solution, docs_url FROM error_catalog';
  const params = [];
  if (platform) { sql += ' WHERE platform = ?'; params.push(platform); }
  sql += ' ORDER BY platform, code';
  const [rows] = await pool.execute(sql, params);
  res.json(rows);
});

// Detalle por id
r.get('/:id', async (req, res) => {
  const [[row]] = await pool.execute('SELECT * FROM error_catalog WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'no encontrado' });
  res.json(row);
});

// Añadir / actualizar entrada
r.post('/', async (req, res) => {
  const b = req.body || {};
  if (!b.code || !b.platform) return res.status(400).json({ error: 'code y platform requeridos' });
  await pool.execute(
    `INSERT INTO error_catalog (code, platform, pattern_regex, category, severity, cause, solution, docs_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       pattern_regex = VALUES(pattern_regex),
       category      = VALUES(category),
       severity      = VALUES(severity),
       cause         = VALUES(cause),
       solution      = VALUES(solution),
       docs_url      = VALUES(docs_url)`,
    [b.code, b.platform, b.pattern_regex || null, b.category || null, b.severity || 'medium', b.cause || null, b.solution || null, b.docs_url || null]
  );
  await refreshCache();
  res.json({ ok: true });
});

r.delete('/:id', async (req, res) => {
  await pool.execute('DELETE FROM error_catalog WHERE id = ?', [req.params.id]);
  await refreshCache();
  res.json({ ok: true });
});

export default r;
