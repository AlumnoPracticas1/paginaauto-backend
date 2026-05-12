import { Router } from 'express';
import { getSites, getSite, registerSite, removeSite } from '../sites.js';
import { scanSite } from '../html-scanner.js';

const r = Router();

// Listar sitios conectados
r.get('/', (_req, res) => res.json(getSites()));

// Registrar / actualizar un sitio (lo llama arreglahtml.exe al instalarse).
// body: { name, root }   root = ruta absoluta de la carpeta de la web
r.post('/', async (req, res, next) => {
  try {
    const { name, root } = req.body || {};
    if (!name || !root) return res.status(400).json({ error: 'name y root requeridos' });
    const site = registerSite(name, root);
    // Escanea de inmediato para que aparezcan los errores en el panel.
    let scan = null;
    try { scan = await scanSite(site); } catch (e) { scan = { error: e.message }; }
    res.json({ ok: true, site, scan });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Re-escanear un sitio bajo demanda (botón en el panel, o el agente al detectar cambios)
r.post('/:name/scan', async (req, res, next) => {
  try {
    const s = getSite(req.params.name);
    if (!s) return res.status(404).json({ error: 'sitio no registrado' });
    const scan = await scanSite(s);
    res.json({ ok: true, scan });
  } catch (e) { next(e); }
});

// Quitar un sitio del registro
r.delete('/:name', (req, res) => {
  res.json({ ok: removeSite(req.params.name) });
});

export default r;
