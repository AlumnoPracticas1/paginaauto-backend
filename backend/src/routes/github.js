// Endpoints de GitHub (antes vivían en el servicio github-app independiente).
// Ahora viven dentro del backend Node para no necesitar un segundo servicio
// en Railway. La GitHub App actúa con la private key configurada por env.
//
// Variables necesarias:
//   GH_APP_ID                — App ID numérico (3631823)
//   GH_PRIVATE_KEY           — contenido completo del .pem (multiline) [cloud]
//   GH_PRIVATE_KEY_PATH      — ruta al .pem en disco                  [local]
//
// Si ninguna está, los endpoints devuelven 503.

import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';

const r = Router();

let app = null;
let appInitError = null;

async function ensureApp() {
  if (app || appInitError) return;
  const APP_ID = process.env.GH_APP_ID;
  const KEY_INLINE = process.env.GH_PRIVATE_KEY;
  const KEY_PATH = process.env.GH_PRIVATE_KEY_PATH;

  if (!APP_ID) { appInitError = 'GH_APP_ID no configurado'; return; }

  let privateKey = '';
  if (KEY_INLINE) {
    privateKey = KEY_INLINE.replace(/\\n/g, '\n');
  } else if (KEY_PATH) {
    const abs = path.resolve(KEY_PATH);
    if (!fs.existsSync(abs)) { appInitError = `private key no encontrada: ${abs}`; return; }
    privateKey = fs.readFileSync(abs, 'utf8');
  } else {
    appInitError = 'falta GH_PRIVATE_KEY (cloud) o GH_PRIVATE_KEY_PATH (local)';
    return;
  }

  try {
    const { App } = await import('@octokit/app');
    app = new App({ appId: APP_ID, privateKey });
  } catch (e) {
    appInitError = `init falló: ${e.message}`;
  }
}

function isCritical({ files, message, priority }) {
  if (priority === 'urgent' || priority === 'high') return true;
  const sensitive = /(package\.json|package-lock\.json|migrations\/|\.env|auth|payment|payments|secret|credentials|\.github\/workflows\/)/i;
  if ((files || []).some(p => sensitive.test(p))) return true;
  if (/breaking|drop|delete table|truncate/i.test(message || '')) return true;
  return false;
}

async function findInstallationId(octoApp, owner, repo) {
  const installs = await octoApp.octokit.request('GET /app/installations');
  for (const inst of installs.data) {
    const acc = inst.account?.login || inst.account?.name;
    if (acc && acc.toLowerCase() === owner.toLowerCase()) return inst.id;
  }
  for (const inst of installs.data) {
    try {
      const ok = await octoApp.getInstallationOctokit(inst.id);
      const repos = await ok.request('GET /installation/repositories');
      if (repos.data.repositories.some(rp => rp.full_name.toLowerCase() === `${owner}/${repo}`.toLowerCase())) {
        return inst.id;
      }
    } catch {}
  }
  return null;
}

async function commitFiles({ octokit, owner, repo, branch, baseSha, files, message }) {
  try {
    await octokit.request('POST /repos/{owner}/{repo}/git/refs', {
      owner, repo, ref: `refs/heads/${branch}`, sha: baseSha,
    });
  } catch (e) { if (e.status !== 422) throw e; }

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

r.get('/health', async (_req, res) => {
  await ensureApp();
  if (!app) return res.json({ ok: false, reason: appInitError });
  try {
    const r2 = await app.octokit.request('GET /app');
    res.json({ ok: true, app: r2.data.slug, id: r2.data.id });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

r.get('/installations', async (_req, res) => {
  await ensureApp();
  if (!app) return res.status(503).json({ error: appInitError });
  try {
    const r2 = await app.octokit.request('GET /app/installations');
    res.json(r2.data.map(i => ({
      id: i.id,
      account: i.account?.login,
      type: i.account?.type,
      repository_selection: i.repository_selection,
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

r.post('/propose', async (req, res) => {
  await ensureApp();
  if (!app) return res.status(503).json({ error: appInitError });

  const internalToken = process.env.INTERNAL_TOKEN || '';
  if (internalToken && req.get('X-Internal-Token') !== internalToken) {
    return res.status(401).json({ error: 'invalid internal token' });
  }

  const {
    owner, repo, baseBranch = 'main',
    files, message, priority = 'medium', previewId,
  } = req.body || {};
  if (!owner || !repo || !Array.isArray(files) || files.length === 0 || !message) {
    return res.status(400).json({ error: 'owner, repo, files[], message son obligatorios' });
  }

  try {
    const installationId = await findInstallationId(app, owner, repo);
    if (!installationId) return res.status(404).json({ error: `app no instalada en ${owner}/${repo}` });

    const octokit = await app.getInstallationOctokit(installationId);
    const baseRef = await octokit.request('GET /repos/{owner}/{repo}/git/refs/heads/{branch}', { owner, repo, branch: baseBranch });
    const baseSha = baseRef.data.object.sha;

    const critical = isCritical({ files: files.map(f => f.path), message, priority });
    const tag = critical ? 'review' : 'auto';
    const branch = `avantdef/${tag}-${previewId || Date.now()}`;

    await commitFiles({ octokit, owner, repo, branch, baseSha, files, message });

    const pr = await octokit.request('POST /repos/{owner}/{repo}/pulls', {
      owner, repo, head: branch, base: baseBranch,
      title: message,
      body: critical
        ? `⚠️ **Cambio CRÍTICO** generado por AvantDefw1.\n\nPriority: \`${priority}\`\nPreview: \`${previewId || '-'}\``
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
      } catch (e) { console.warn('[github/propose] auto-merge falló:', e.message); }
    }

    res.json({
      ok: true, critical, branch,
      pr: { number: pr.data.number, url: pr.data.html_url },
      merged,
    });
  } catch (e) {
    console.error('[github/propose]', e);
    res.status(500).json({ error: e.message, status: e.status || null });
  }
});

export default r;
