import { Router } from 'express';
import { pool } from '../db.js';
import { pyFetch } from '../python.js';

const r = Router();

r.get('/history', async (_req, res) => {
  const [rows] = await pool.query(
    'SELECT id, role, content, created_at FROM chat_messages ORDER BY id DESC LIMIT 100'
  );
  res.json(rows.reverse());
});

r.post('/', async (req, res, next) => {
  try {
    const { message } = req.body || {};
    if (!message) return res.status(400).json({ error: 'message requerido' });

    await pool.execute('INSERT INTO chat_messages (role, content) VALUES (?, ?)', ['user', message]);
    const result = await pyFetch('/chat', { method: 'POST', body: JSON.stringify({ message }) });
    const reply = result?.reply || result?.response || JSON.stringify(result);
    await pool.execute('INSERT INTO chat_messages (role, content) VALUES (?, ?)', ['assistant', reply]);

    res.json({ reply, raw: result });
  } catch (e) { next(e); }
});

export default r;
