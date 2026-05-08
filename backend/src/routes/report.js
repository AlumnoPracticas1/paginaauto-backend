import { Router } from 'express';
import crypto from 'node:crypto';
import { pool } from '../db.js';
import { pyFetch } from '../python.js';
import { detectDeployer, matchCatalog } from '../detector.js';

const r = Router();

/**
 * Recibe un error y SIEMPRE lo persiste, aunque main.py no responda
 * o lo clasifique como ruido. Estrategia:
 *   1) Insert inmediato con datos del cliente (status='pending', priority='low' por defecto).
 *   2) En background, llama al pipeline IA. Si responde, hace UPDATE con
 *      diagnóstico, fix, diff, prioridad real. Si falla, la fila se queda
 *      tal cual y es visible en el panel.
 */
r.post('/', async (req, res, next) => {
  try {
    const err = req.body || {};
    if (!err.message) {
      return res.status(400).json({ error: 'message requerido' });
    }

    const id = crypto.randomBytes(8).toString('hex');
    const source = err.source || 'js';
    const extraJson = err.extra ? JSON.stringify(err.extra) : null;

    // Detección de plataforma + match contra catálogo
    const pageUrl = err.extra?.page || err.extra?.url || '';
    const deployer = detectDeployer({ url: pageUrl, headers: req.headers, hint: err.extra?.deployer });
    const match = matchCatalog({ message: err.message, stack: err.stack, deployer });
    const initialPriority = match?.severity || 'low';

    await pool.execute(
      `INSERT INTO previews
         (id, source, status, priority, file, line, message, stack, extra, deployer, catalog_code, diagnosis)
       VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, source, initialPriority,
        err.file || null, err.line || null,
        String(err.message).slice(0, 4000),
        err.stack ? String(err.stack).slice(0, 8000) : null,
        extraJson,
        deployer || null,
        match?.code || null,
        match ? `[${match.platform}/${match.code}] ${match.cause || ''}\n→ ${match.solution || ''}` : null,
      ]
    );

    res.json({
      preview_id: id, status: 'pending', priority: initialPriority,
      deployer, catalog_code: match?.code || null, persisted: true,
    });

    // Enriquecer con IA en background (best-effort, no bloquea respuesta).
    (async () => {
      try {
        const py = await pyFetch('/report', { method: 'POST', body: JSON.stringify(err) });
        const full = py?.preview_id
          ? await pyFetch(`/previews/${py.preview_id}`).catch(() => null)
          : null;
        await pool.execute(
          `UPDATE previews SET
             priority   = COALESCE(?, priority),
             diagnosis  = COALESCE(?, diagnosis),
             original   = COALESCE(?, original),
             fixed      = COALESCE(?, fixed),
             diff       = COALESCE(?, diff),
             validation = COALESCE(?, validation)
           WHERE id = ?`,
          [
            py?.priority || null,
            full?.diagnosis || null,
            full?.original || null,
            full?.fixed || null,
            full?.diff || null,
            full?.validation || null,
            id,
          ]
        );
      } catch (e) {
        // Python caído u otro problema: la fila ya existe, no hay nada que reparar.
      }
    })();
  } catch (e) { next(e); }
});

export default r;
