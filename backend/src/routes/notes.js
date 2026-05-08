import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { pool } from '../db.js';

const r = Router();

r.get('/', async (_req, res) => {
  const [rows] = await pool.query(
    'SELECT id, date, text, created_at FROM notes ORDER BY date ASC, created_at ASC'
  );
  res.json(rows);
});

r.post('/', async (req, res) => {
  const { date, text } = req.body || {};
  if (!date || !text) return res.status(400).json({ error: 'date y text requeridos' });
  const id = randomUUID().slice(0, 8);
  await pool.execute(
    'INSERT INTO notes (id, date, text) VALUES (?, ?, ?)',
    [id, date, text]
  );
  const [[row]] = await pool.query('SELECT id, date, text, created_at FROM notes WHERE id = ?', [id]);
  res.json(row);
});

r.delete('/:id', async (req, res) => {
  await pool.execute('DELETE FROM notes WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

export default r;
