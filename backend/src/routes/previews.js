import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { pool } from '../db.js';
import { pyFetch } from '../python.js';
import { repairConversation, applyPatchPlan } from '../ollama.js';
import { isEnabled as ghEnabled, repoForApp, ghProxyPropose } from '../github-proxy.js';

const r = Router();

const PHP_ROOT = path.resolve(process.env.PHP_CODE_ROOT || 'C:/wamp64/www/backendstore');
const JS_ROOT  = path.resolve(process.env.JS_CODE_ROOT  || 'C:/Users/Lenovo/Desktop/HAM/Pagina web');
const rootFor = s => (s === 'js' ? JS_ROOT : PHP_ROOT);

// Mapeo APP_NAME (el que envía cliente-escucha en extra.app) -> carpeta en disco.
// Permite editar la página que está escuchando aunque el error no traiga `file`.
let APP_ROOTS = {
  avantservice: 'C:/Users/Lenovo/Desktop/HAM/avantservice',
  'pagina web': 'C:/Users/Lenovo/Desktop/HAM/Pagina web',
};
try {
  if (process.env.APP_ROOTS_JSON) {
    APP_ROOTS = { ...APP_ROOTS, ...JSON.parse(process.env.APP_ROOTS_JSON) };
  }
} catch {}

function appRootFor(app) {
  if (!app) return null;
  const key = String(app).toLowerCase().trim();
  const p = APP_ROOTS[key];
  return p ? path.resolve(p) : null;
}

// Heurística: ¿este snippet se puede usar como archivo completo de reemplazo?
// Si NO, hay que dejarlo como `pending` para revisión manual aunque la
// prioridad permita auto-apply, porque sobrescribir con un fragmento o
// con prosa de la IA destruye el archivo original.
function isSafeFullReplacement(code, targetPath) {
  if (!code || typeof code !== 'string') return { ok: false, reason: 'sin código' };
  const ext = (targetPath.match(/\.([a-z0-9]+)$/i) || [, ''])[1].toLowerCase();
  const head = code.trimStart().slice(0, 200).toLowerCase();
  const proseMarkers = /(explicaci[oó]n\s*:|snippet\s*:|análisis|aqu[ií] (te|tienes)|reporter:|fixer:)/i;
  if (proseMarkers.test(code.slice(0, 400))) {
    return { ok: false, reason: 'la IA devolvió prosa explicativa, no un archivo limpio' };
  }
  if (ext === 'html' || ext === 'htm') {
    if (!head.includes('<!doctype') && !head.includes('<html')) {
      return { ok: false, reason: 'snippet HTML incompleto (sin <!DOCTYPE/<html>)' };
    }
    if (!/charset\s*=\s*["']?utf-8/i.test(code)) {
      return { ok: false, reason: 'falta <meta charset="UTF-8"> — se rompería la codificación' };
    }
  }
  if (ext === 'js' || ext === 'mjs') {
    // los .js no deben contener líneas tipo "EXPLICACIÓN:" sueltas.
    if (/^\s*(explicaci[oó]n|snippet)\s*:/im.test(code)) {
      return { ok: false, reason: 'snippet JS contiene texto en prosa' };
    }
  }
  return { ok: true };
}

function safeResolve(source, rel) {
  if (!rel) return null;
  const root = rootFor(source);
  const full = path.resolve(root, rel);
  if (!full.startsWith(root)) return null;
  return full;
}

// Resuelve el archivo objetivo de una preview.
// 1) Si trae `file` -> safeResolve clásico (PHP_ROOT / JS_ROOT).
// 2) Si no -> usa extra.app + extra.page_path para apuntar al archivo
//    real de la web cliente que está escuchando.
function resolvePreviewTarget(p) {
  if (p.file) {
    const t = safeResolve(p.source, p.file);
    if (t) return { target: t, mode: 'file' };
  }
  let extra = p.extra;
  if (typeof extra === 'string') { try { extra = JSON.parse(extra); } catch { extra = {}; } }
  extra = extra || {};
  const root = appRootFor(extra.app);
  if (!root) return { target: null, mode: null, reason: `app desconocida: ${extra.app || '(none)'}` };
  let rel = String(extra.page_path || '').replace(/^[\/\\]+/, '');
  if (!rel || rel.endsWith('/') || rel.endsWith('\\')) rel = path.join(rel, 'index.html');
  const full = path.resolve(root, rel);
  if (!full.startsWith(root)) return { target: null, mode: null, reason: 'ruta fuera del root de la app' };
  return { target: full, mode: 'app', appRoot: root };
}

// --- Modo auto global (persistido en tabla settings k=autoMode) ---
async function ensureSettings() {
  await pool.execute(`CREATE TABLE IF NOT EXISTS settings (
    k VARCHAR(64) PRIMARY KEY,
    v TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`);
}
async function getAutoMode() {
  await ensureSettings();
  const [[row]] = await pool.execute('SELECT v FROM settings WHERE k = ?', ['autoMode']);
  return row?.v || 'priority'; // 'priority' | 'always' | 'never'
}
async function setAutoMode(mode) {
  await ensureSettings();
  await pool.execute(
    'INSERT INTO settings (k,v) VALUES (?,?) ON DUPLICATE KEY UPDATE v=VALUES(v)',
    ['autoMode', mode]
  );
}

r.get('/auto-mode', async (_req, res) => {
  res.json({ mode: await getAutoMode() });
});
r.post('/auto-mode', async (req, res) => {
  const m = String(req.body?.mode || '').trim();
  if (!['priority', 'always', 'never'].includes(m)) {
    return res.status(400).json({ error: 'mode debe ser priority|always|never' });
  }
  await setAutoMode(m);
  res.json({ ok: true, mode: m });
});

// Lista plana de TODOS los IDs (con estado y mensaje corto).
r.get('/ids', async (req, res) => {
  const status = req.query.status;
  let sql = 'SELECT id, status, priority, source, file, LEFT(message,120) AS message, created_at FROM previews';
  const params = [];
  if (status) { sql += ' WHERE status = ?'; params.push(status); }
  sql += ' ORDER BY created_at DESC';
  const [rows] = await pool.execute(sql, params);
  res.json({ count: rows.length, ids: rows });
});

r.get('/', async (req, res) => {
  const status = req.query.status;
  let sql = 'SELECT id, source, status, priority, file, line, message, extra, deployer, catalog_code, created_at FROM previews';
  const params = [];
  if (status) {
    const list = status.split(',').map(s => s.trim()).filter(Boolean);
    if (list.length === 1) { sql += ' WHERE status = ?'; params.push(list[0]); }
    else if (list.length > 1) {
      sql += ` WHERE status IN (${list.map(() => '?').join(',')})`;
      params.push(...list);
    }
  }
  sql += ' ORDER BY created_at DESC LIMIT 200';
  const [rows] = await pool.execute(sql, params);
  res.json(rows);
});

r.get('/:id', async (req, res) => {
  const [[row]] = await pool.execute('SELECT * FROM previews WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'no encontrado' });
  res.json(row);
});

r.post('/:id/approve', async (req, res) => {
  const [[p]] = await pool.execute('SELECT * FROM previews WHERE id = ?', [req.params.id]);
  if (!p) return res.status(404).json({ error: 'no encontrado' });
  if (p.status !== 'pending') return res.status(400).json({ error: `estado actual: ${p.status}` });

  const { target, reason } = resolvePreviewTarget(p);
  if (!target) return res.status(400).json({ error: `ruta inválida: ${reason || 'sin app/file'}` });
  if (!fs.existsSync(target)) return res.status(400).json({ error: `archivo destino no existe: ${target}` });

  // Intenta interpretar p.fixed como patchPlan JSON. Si lo es -> aplica parches
  // quirúrgicos. Si no, rechaza el approve (no sobrescribimos el archivo entero).
  let patchPlan = null;
  if (p.fixed) {
    try {
      const obj = JSON.parse(p.fixed);
      if (obj && Array.isArray(obj.patches)) patchPlan = obj;
    } catch {}
  }
  if (!patchPlan) {
    return res.status(400).json({ error: 'esta preview no tiene un plan de parches aplicable. Pulsa "Arreglar con IA" primero.' });
  }

  const current = fs.readFileSync(target, 'utf8');
  const result = applyPatchPlan(current, patchPlan);
  if (!result.ok) {
    return res.status(409).json({ error: `parche no aplicable: ${result.reason}` });
  }

  // ¿Mandar a GitHub o escribir local?
  let extraObj = p.extra;
  if (typeof extraObj === 'string') { try { extraObj = JSON.parse(extraObj); } catch { extraObj = {}; } }
  const repoMap = repoForApp(extraObj?.app);
  if (ghEnabled() && repoMap) {
    try {
      let repoPath = String(extraObj?.page_path || '').replace(/^[\/\\]+/, '');
      if (!repoPath || repoPath.endsWith('/') || repoPath.endsWith('\\')) repoPath = (repoPath || '') + 'index.html';
      const proposal = await ghProxyPropose({
        owner: repoMap.owner, repo: repoMap.repo, baseBranch: repoMap.branch || 'main',
        files: [{ path: repoPath, content: result.content }],
        message: `fix(avantdef): ${(p.message || 'cambio aprobado').slice(0, 100)}`,
        priority: p.priority,
        previewId: p.id,
      });
      await pool.execute(
        `UPDATE previews SET status = ?, pr_url = ?, pr_branch = ?, pr_critical = ? WHERE id = ?`,
        ['applied', proposal.pr?.url || null, proposal.branch || null, proposal.critical ? 1 : 0, p.id]
      );
      return res.json({ ok: true, applied: result.applied, pr: { url: proposal.pr?.url, branch: proposal.branch, critical: proposal.critical, merged: proposal.merged } });
    } catch (e) {
      return res.status(502).json({ error: `github-proxy falló: ${e.message}` });
    }
  }

  const backup = `${target}.${Date.now()}.bak`;
  fs.copyFileSync(target, backup);
  fs.writeFileSync(target, result.content, 'utf8');

  await pool.execute(
    'UPDATE previews SET status = ?, backup_path = ? WHERE id = ?',
    ['applied', backup, p.id]
  );
  res.json({ ok: true, backup, applied: result.applied });
});

r.post('/:id/reject', async (req, res) => {
  await pool.execute('UPDATE previews SET status = ? WHERE id = ?', ['rejected', req.params.id]);
  res.json({ ok: true });
});

// Resolver una preview "ignored" -> vuelve a pasar por el pipeline IA (Python)
// Marca processing y responde 202 inmediato; el pipeline corre en background
// para que sobreviva a recargas del navegador.
r.post('/:id/resolve', async (req, res, next) => {
  try {
    const [[p]] = await pool.execute('SELECT * FROM previews WHERE id = ?', [req.params.id]);
    if (!p) return res.status(404).json({ error: 'no encontrado' });
    if (p.status === 'processing') return res.status(202).json({ ok: true, already: true });
    if (p.status !== 'ignored') return res.status(400).json({ error: `estado: ${p.status}` });

    await pool.execute('UPDATE previews SET status = ? WHERE id = ?', ['processing', p.id]);
    res.status(202).json({ ok: true, status: 'processing' });

    (async () => {
      try {
        const result = await pyFetch('/report', {
          method: 'POST',
          body: JSON.stringify({
            source: p.source, message: p.message,
            file: p.file, line: p.line, stack: p.stack,
          }),
        });
        await pool.execute(
          `UPDATE previews SET status = 'pending', diagnosis = ?, fixed = ?, diff = ?, validation = ?
           WHERE id = ?`,
          [result?.diagnosis || null, result?.fixed || null, result?.diff || null, result?.validation || null, p.id]
        );
      } catch (err) {
        console.error('[resolve background]', p.id, err.message);
        await pool.execute('UPDATE previews SET status = ? WHERE id = ?', ['ignored', p.id]).catch(() => {});
      }
    })();
  } catch (e) { next(e); }
});

// Genera reparación con Ollama (REPORTER + FIXER) y la guarda.
// Auto-aplica si la prioridad es 'low' o 'medium' Y el fichero resuelve a un root conocido.
// Si es 'high'/'urgent' deja el fix como pending para revisión manual (Aprobar / Rechazar).
r.post('/:id/repair', async (req, res, next) => {
  try {
    const [[p]] = await pool.execute('SELECT * FROM previews WHERE id = ?', [req.params.id]);
    if (!p) return res.status(404).json({ error: 'no encontrado' });

    // Recupera info de catálogo si existe (mejora el prompt)
    let catalogInfo = null;
    if (p.catalog_code) {
      const [[c]] = await pool.execute(
        'SELECT cause, solution FROM error_catalog WHERE code = ? AND platform = ? LIMIT 1',
        [p.catalog_code, p.deployer || '']
      );
      catalogInfo = c || null;
    }

    // Resuelve antes de llamar a la IA para poder mandarle el contenido actual.
    const resolvedPre = resolvePreviewTarget(p);
    let currentContent = null;
    if (resolvedPre.target && fs.existsSync(resolvedPre.target)) {
      try { currentContent = fs.readFileSync(resolvedPre.target, 'utf8'); } catch {}
    }

    let convo;
    try {
      convo = await repairConversation({
        message: p.message, file: p.file, line: p.line, stack: p.stack,
        source: p.source, deployer: p.deployer, catalogCode: p.catalog_code, catalogInfo,
        targetPath: resolvedPre.target, currentContent,
      });
    } catch (e) {
      return res.status(503).json({ error: 'Ollama no disponible', detail: e.message });
    }

    const diagnosis = convo.conversation[0].content;
    const fixerOutput = convo.conversation[1].content;
    const patchPlan = convo.patchPlan;

    // Decisión de auto-aplicado.
    // Override por petición: body.auto = true|false (gana sobre el modo global).
    // Modo global (settings.autoMode):
    //   'priority' -> auto solo si priority es low/medium (default)
    //   'always'   -> auto siempre que haya target + fixedCode
    //   'never'    -> nunca auto, siempre pending
    const reqAuto = (req.body && typeof req.body.auto === 'boolean') ? req.body.auto : null;
    const mode = await getAutoMode();
    let autoEligible;
    if (reqAuto !== null) autoEligible = reqAuto;
    else if (mode === 'always') autoEligible = true;
    else if (mode === 'never')  autoEligible = false;
    else                        autoEligible = (p.priority === 'low' || p.priority === 'medium');

    const target = resolvedPre.target;
    // Pre-aplica el plan en memoria para validar que cuadra con el archivo actual.
    const AI_INCAPABLE = `Esta IA (${convo.model}) no tiene el potencial como para resolver este problema. Prueba un modelo más grande (qwen2.5:7b, llama3.1:8b) o resuélvelo manualmente.`;
    let dryRun = { ok: false, reason: AI_INCAPABLE, aiIncapable: true };
    if (!target) {
      dryRun = { ok: false, reason: 'no se pudo resolver archivo destino' };
    } else if (currentContent == null) {
      dryRun = { ok: false, reason: 'no se pudo leer el archivo destino' };
    } else if (!patchPlan) {
      dryRun = { ok: false, reason: AI_INCAPABLE, aiIncapable: true };
    } else if (!patchPlan.patches || patchPlan.patches.length === 0) {
      dryRun = { ok: false, reason: AI_INCAPABLE, aiIncapable: true };
    } else {
      const r = applyPatchPlan(currentContent, patchPlan);
      // Si el plan existe pero no encaja con el archivo (find no encontrado o
      // ambiguo), es porque la IA inventó/citó mal -> es un fallo de potencial.
      dryRun = r.ok ? r : { ...r, aiIncapable: true, reason: AI_INCAPABLE };
    }
    const canAutoApply = autoEligible && dryRun.ok;

    let backup = null;
    let applied = false;
    let appliedReason = null;
    let prInfo = null; // { url, branch, critical }

    // ¿Esta preview está mapeada a un repo de GitHub? (extra.app -> APP_REPOS_JSON)
    let extraObj = p.extra;
    if (typeof extraObj === 'string') { try { extraObj = JSON.parse(extraObj); } catch { extraObj = {}; } }
    const repoMap = repoForApp(extraObj?.app);
    const useGitHub = ghEnabled() && repoMap && dryRun.ok;

    if (canAutoApply && useGitHub) {
      try {
        // Path relativo dentro del repo: usamos extra.page_path (o index.html) sin la raíz local.
        let repoPath = String(extraObj?.page_path || '').replace(/^[\/\\]+/, '');
        if (!repoPath || repoPath.endsWith('/') || repoPath.endsWith('\\')) repoPath = (repoPath || '') + 'index.html';
        const proposal = await ghProxyPropose({
          owner: repoMap.owner, repo: repoMap.repo, baseBranch: repoMap.branch || 'main',
          files: [{ path: repoPath, content: dryRun.content }],
          message: `fix(avantdef): ${(p.message || 'cambio automático').slice(0, 100)}`,
          priority: p.priority,
          previewId: p.id,
        });
        applied = true;
        prInfo = { url: proposal.pr?.url || null, branch: proposal.branch, critical: !!proposal.critical, merged: !!proposal.merged };
        appliedReason = proposal.merged
          ? `GitHub: rama ${proposal.branch} mergeada en ${repoMap.branch}`
          : (proposal.critical
              ? `GitHub: PR crítico abierto, requiere revisión humana — ${proposal.pr?.url || ''}`
              : `GitHub: PR abierto — ${proposal.pr?.url || ''}`);
      } catch (e) {
        appliedReason = `github-proxy falló: ${e.message}`;
      }
    } else if (canAutoApply) {
      // Fallback: escribir en disco local como antes.
      try {
        backup = `${target}.${Date.now()}.bak`;
        fs.copyFileSync(target, backup);
        fs.writeFileSync(target, dryRun.content, 'utf8');
        applied = true;
        appliedReason = `local · ${dryRun.applied} parche(s) aplicados`;
      } catch (e) {
        appliedReason = `auto-apply falló: ${e.message}`;
      }
    }
    if (!applied && !appliedReason) {
      if (!autoEligible)        appliedReason = `requiere revisión manual (mode=${reqAuto !== null ? 'override-off' : mode}, priority=${p.priority})`;
      else if (!target)         appliedReason = `no se pudo resolver archivo destino (${resolvedPre.reason || 'sin file ni app conocida'})`;
      else                      appliedReason = dryRun.reason;
    }

    // Para revisión manual, persistimos el plan para que el endpoint /approve
    // pueda re-aplicarlo cuando el operador lo decida.
    const patchPlanJson = patchPlan ? JSON.stringify(patchPlan) : null;

    await pool.execute(
      `UPDATE previews SET
         diagnosis = ?, fixed = ?, status = ?,
         backup_path = COALESCE(?, backup_path),
         pr_url = COALESCE(?, pr_url),
         pr_branch = COALESCE(?, pr_branch),
         pr_critical = COALESCE(?, pr_critical)
       WHERE id = ?`,
      [
        diagnosis,
        patchPlanJson || fixerOutput,
        applied ? 'applied' : 'pending',
        backup,
        prInfo?.url || null,
        prInfo?.branch || null,
        prInfo ? (prInfo.critical ? 1 : 0) : null,
        p.id,
      ]
    );

    res.json({
      ok: true,
      model: convo.model,
      conversation: convo.conversation,
      patchPlan,
      dryRun: { ok: dryRun.ok, reason: dryRun.reason || null, applied: dryRun.applied || 0, aiIncapable: !!dryRun.aiIncapable },
      applied,
      backup,
      pr: prInfo,
      reason: appliedReason,
      priority: p.priority,
      target,
    });
  } catch (e) { next(e); }
});

export default r;
