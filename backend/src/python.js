import 'dotenv/config';

const PY = process.env.PYTHON_API || 'http://localhost:8000';

export async function pyFetch(pathname, opts = {}) {
  const res = await fetch(`${PY}${pathname}`, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error(data?.detail || `Python API ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export async function pyHealth() {
  try { return await pyFetch('/health'); }
  catch (e) { return { ok: false, error: e.message }; }
}
