// AvantDefw1 — GitHub App intermediario
//
// Recibe peticiones de tu backend cuando un fix se aprueba (manual o auto)
// y, en lugar de tocar disco local, crea una rama en el repo cliente
// con los cambios y abre un PR. Si el cambio es "crítico" exige revisión;
// si no, hace auto-merge.

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { App } from '@octokit/app';
import { Webhooks, createNodeMiddleware } from '@octokit/webhooks';

const PORT = Number(process.env.PORT || 4100);
const APP_ID = process.env.GH_APP_ID;
const KEY_PATH = process.env.GH_PRIVATE_KEY_PATH;
const KEY_INLINE = process.env.GH_PRIVATE_KEY; // alternativa para Railway/Vercel
const WEBHOOK_SECRET = process.env.GH_WEBHOOK_SECRET || '';
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN || '';

if (!APP_ID) {
  console.error('[avantdef-github-app] Falta GH_APP_ID en .env');
  process.exit(1);
}

let privateKey = '';
if (KEY_INLINE) {
  // En cloud: pega la .pem entera en GH_PRIVATE_KEY (con saltos como \n literales).
  privateKey = KEY_INLINE.replace(/\\n/g, '\n');
} else if (KEY_PATH) {
  if (!fs.existsSync(KEY_PATH)) {
    console.error(`[avantdef-github-app] No encuentro la private key en ${path.resolve(KEY_PATH)}`);
    process.exit(1);
  }
  privateKey = fs.readFileSync(KEY_PATH, 'utf8');
} else {
  console.error('[avantdef-github-app] Falta GH_PRIVATE_KEY_PATH (local) o GH_PRIVATE_KEY (cloud)');
  process.exit(1);
}

const app = new App({ appId: APP_ID, privateKey });

// Webhooks solo se inicializan si has configurado un secret. Sin secret no
// podemos verificar firmas, así que el endpoint queda desactivado.
let webhooks = null;
if (WEBHOOK_SECRET) {
  webhooks = new Webhooks({ secret: WEBHOOK_SECRET });
  webhooks.onAny(({ name, payload }) => {
    console.log(`[webhook] ${name} repo=${payload?.repository?.full_name}`);
  });
}

// --- Clasificador "crítico vs auto" --------------------------------
// Decide si un cambio necesita revisión humana o se puede auto-mergear.
function isCritical({ files, message, priority }) {
  if (priority === 'urgent' || priority === 'high') return true;
  const sensitive = /(package\.json|package-lock\.json|migrations\/|\.env|auth|payment|payments|secret|credentials|\.github\/workflows\/)/i;
  if ((files || []).some(p => sensitive.test(p))) return true;
  if (/breaking|drop|delete table|truncate/i.test(message || '')) return true;
  return false;
}

// --- Helpers -------------------------------------------------------
async function findInstallationId(octokitApp, owner, repo) {
  const installs = await octokitApp.octokit.request('GET /app/installations');
  for (const inst of installs.data) {
    const acc = inst.account?.login || inst.account?.name;
    if (!acc) continue;
    if (acc.toLowerCase() === owner.toLowerCase()) return inst.id;
  }
  // fallback: pregunta a la instalación por sus repos
  for (const inst of installs.data) {
    try {
      const ok = await octokitApp.getInstallationOctokit(inst.id);
      const repos = await ok.request('GET /installation/repositories');
      if (repos.data.repositories.some(r => r.full_name.toLowerCase() === `${owner}/${repo}`.toLowerCase())) {
        return inst.id;
      }
    } catch {}
  }
  return null;
}

async function commitFiles({ octokit, owner, repo, branch, baseSha, files, message }) {
  // 1) crear (o reutilizar) la rama
  try {
    await octokit.request('POST /repos/{owner}/{repo}/git/refs', {
      owner, repo, ref: `refs/heads/${branch}`, sha: baseSha,
    });
  } catch (e) {
    if (e.status !== 422) throw e; // 422 = already exists
  }

  // 2) construir tree con cada archivo
  const blobs = await Promise.all(files.map(async f => {
    const { data } = await octokit.request('POST /repos/{owner}/{repo}/git/blobs', {
      owner, repo,
      content: Buffer.from(f.content, 'utf8').toString('base64'),
      encoding: 'base64',
    });
    return { path: f.path.replace(/^[\/\\]+/, ''), mode: '100644', type: 'blob', sha: data.sha };
  }));

  const baseCommit = await octokit.request('GET /repos/{owner}/{repo}/git/commits/{sha}', {
    owner, repo, sha: baseSha,
  });

  const newTree = await octokit.request('POST /repos/{owner}/{repo}/git/trees', {
    owner, repo, base_tree: baseCommit.data.tree.sha, tree: blobs,
  });

  const newCommit = await octokit.request('POST /repos/{owner}/{repo}/git/commits', {
    owner, repo, message, tree: newTree.data.sha, parents: [baseSha],
  });

  await octokit.request('PATCH /repos/{owner}/{repo}/git/refs/heads/{branch}', {
    owner, repo, branch, sha: newCommit.data.sha, force: false,
  });

  return newCommit.data.sha;
}

// --- Rutas HTTP ----------------------------------------------------
const server = express();

// Webhook de GitHub (firma HMAC verificada por @octokit/webhooks). Solo se
// monta si has configurado GH_WEBHOOK_SECRET.
if (webhooks) {
  server.use('/github/webhook', createNodeMiddleware(webhooks, { path: '/' }));
} else {
  server.post('/github/webhook', (_req, res) => res.status(503).json({ error: 'webhooks deshabilitados (falta GH_WEBHOOK_SECRET)' }));
}

// Middleware de autenticación interna para /propose
function requireInternal(req, res, next) {
  if (!INTERNAL_TOKEN) return next();
  if (req.get('X-Internal-Token') === INTERNAL_TOKEN) return next();
  return res.status(401).json({ error: 'invalid internal token' });
}

server.use(express.json({ limit: '10mb' }));

server.get('/health', async (_req, res) => {
  try {
    const r = await app.octokit.request('GET /app');
    res.json({ ok: true, app: r.data.slug, id: r.data.id });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

server.get('/installations/:id/repos', async (req, res) => {
  try {
    const oct = await app.getInstallationOctokit(Number(req.params.id));
    const r = await oct.request('GET /installation/repositories', { per_page: 100 });
    res.json(r.data.repositories.map(x => ({ full_name: x.full_name, default_branch: x.default_branch, private: x.private })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

server.get('/installations', async (_req, res) => {
  try {
    const r = await app.octokit.request('GET /app/installations');
    res.json(r.data.map(i => ({
      id: i.id,
      account: i.account?.login,
      type: i.account?.type,
      repository_selection: i.repository_selection,
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Cuerpo: { owner, repo, baseBranch?, files:[{path,content}], message, priority, previewId? }
server.post('/propose', requireInternal, async (req, res) => {
  const {
    owner, repo, baseBranch = 'main',
    files, message,
    priority = 'medium',
    previewId,
  } = req.body || {};

  if (!owner || !repo || !Array.isArray(files) || files.length === 0 || !message) {
    return res.status(400).json({ error: 'owner, repo, files[], message son obligatorios' });
  }

  try {
    const installationId = await findInstallationId(app, owner, repo);
    if (!installationId) {
      return res.status(404).json({ error: `la app no está instalada en ${owner}/${repo}` });
    }
    const octokit = await app.getInstallationOctokit(installationId);

    // sha del baseBranch
    const baseRef = await octokit.request('GET /repos/{owner}/{repo}/git/refs/heads/{branch}', {
      owner, repo, branch: baseBranch,
    });
    const baseSha = baseRef.data.object.sha;

    const critical = isCritical({ files: files.map(f => f.path), message, priority });
    const tag = critical ? 'review' : 'auto';
    const branch = `avantdef/${tag}-${previewId || Date.now()}`;

    await commitFiles({ octokit, owner, repo, branch, baseSha, files, message });

    const pr = await octokit.request('POST /repos/{owner}/{repo}/pulls', {
      owner, repo, head: branch, base: baseBranch,
      title: message,
      body: critical
        ? `⚠️ **Cambio CRÍTICO** generado por AvantDefw1.\n\nPriority: \`${priority}\`\nPreview: \`${previewId || '-'}\`\n\nRequiere revisión humana antes de merge.`
        : `✅ Cambio rutinario generado por AvantDefw1.\n\nPriority: \`${priority}\`\nPreview: \`${previewId || '-'}\``,
    });

    let merged = false;
    if (critical) {
      try {
        await octokit.request('POST /repos/{owner}/{repo}/issues/{issue_number}/labels', {
          owner, repo, issue_number: pr.data.number, labels: ['avantdef', 'needs-review', 'critical'],
        });
      } catch {}
    } else {
      try {
        await octokit.request('PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge', {
          owner, repo, pull_number: pr.data.number, merge_method: 'squash',
        });
        merged = true;
      } catch (e) {
        // Si el repo no permite auto-merge directo, lo dejamos abierto.
        console.warn(`[propose] auto-merge falló: ${e.message}`);
      }
    }

    res.json({
      ok: true,
      critical,
      branch,
      pr: { number: pr.data.number, url: pr.data.html_url },
      merged,
    });
  } catch (e) {
    console.error('[propose] error:', e);
    res.status(500).json({ error: e.message, status: e.status || null });
  }
});

server.listen(PORT, () => {
  console.log(`[avantdef-github-app] escuchando en http://localhost:${PORT}`);
  console.log(`  - Health    : GET  /health`);
  console.log(`  - Webhook   : POST /github/webhook`);
  console.log(`  - Propose   : POST /propose`);
  console.log(`  - Installs  : GET  /installations`);
});
