import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';
import { pyHealth, pyFetch } from './python.js';
import { ghProxyHealth, isEnabled as ghEnabled } from './github-proxy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import notesRouter from './routes/notes.js';
import previewsRouter from './routes/previews.js';
import reportRouter from './routes/report.js';
import chatRouter from './routes/chat.js';
import summaryRouter from './routes/summary.js';
import catalogRouter from './routes/catalog.js';
import githubRouter from './routes/github.js';
import { refreshCache, detectDeployer, getDeployers } from './detector.js';

const app = express();
// CORS: si pones ALLOWED_ORIGINS=url1,url2 en .env, restringe a ese listado.
const ALLOWED = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors(ALLOWED.length ? { origin: ALLOWED, credentials: false } : {}));
app.use(express.json({ limit: '5mb' }));

app.get('/health', async (_req, res) => {
  let db = false;
  try { await pool.query('SELECT 1'); db = true; } catch {}
  const py = await pyHealth();
  const gh = ghEnabled() ? await ghProxyHealth() : { ok: false, reason: 'no configurado' };
  res.json({ ok: db, db, python: py, github_proxy: gh });
});

// Servir el panel de vigilancia (index.html en la raiz de PaginaAuto)
const PANEL_DIR = path.resolve(__dirname, '..', '..');
app.get('/panel', (_req, res) => res.sendFile(path.join(PANEL_DIR, 'index.html')));
app.get('/', (_req, res) => res.redirect('/panel'));
// Sirve estáticos (logo, etc.) desde la raíz de PaginaAuto.
app.use('/', express.static(PANEL_DIR, { index: false, extensions: false }));

app.use('/notes', notesRouter);
app.use('/previews', previewsRouter);
app.use('/report', reportRouter);
app.use('/chat', chatRouter);
app.use('/summary', summaryRouter);
app.use('/catalog', catalogRouter);
app.use('/github', githubRouter);

app.get('/deployers', (_req, res) => res.json(getDeployers()));

// ---- Registro en memoria de clientes conectados ----
// Clave: app + url. Valor: { app, url, user_agent, first_seen, last_seen, hits }
const clients = new Map();

app.post('/hello', (req, res) => {
  const { app: appName, url, user_agent, release, deployer: deployerHint } = req.body || {};
  const key = `${appName || 'unknown'}::${url || ''}`;
  const now = new Date().toISOString();
  const prev = clients.get(key);
  const deployer = detectDeployer({ url, headers: req.headers, hint: deployerHint });
  clients.set(key, {
    app: appName || 'unknown',
    url: url || null,
    user_agent: user_agent || null,
    release: release || null,
    deployer: deployer || null,
    first_seen: prev?.first_seen || now,
    last_seen: now,
    hits: (prev?.hits || 0) + 1,
  });
  res.json({ ok: true, deployer });
});

app.get('/clients', (_req, res) => {
  const list = Array.from(clients.values()).sort((a, b) =>
    b.last_seen.localeCompare(a.last_seen)
  );
  res.json(list);
});

app.get('/notifications', async (_req, res) => {
  const rows = await pool.query(
    `SELECT id, priority, status, message, file, line, created_at
     FROM previews
     WHERE priority = 'urgent' AND status = 'pending'
     ORDER BY created_at DESC LIMIT 20`
  );
  res.json(rows[0]);
});

app.post('/inspect', async (_req, res, next) => {
  try {
    const r = await pyFetch('/inspect', { method: 'POST', body: '{}' });
    res.json({ ok: true, message: r?.message || 'Inspección iniciada', detail: r });
  } catch (e) { next(e); }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message, detail: err.data });
});

const PORT = Number(process.env.PORT || 4000);
app.listen(PORT, async () => {
  await refreshCache();
  console.log(`API http://localhost:${PORT}`);
});
