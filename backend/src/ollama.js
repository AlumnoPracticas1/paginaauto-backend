// Cliente minimal para Ollama local (http://localhost:11434).
// Modelo por defecto: qwen2.5:3b. Configurable vía env OLLAMA_MODEL / OLLAMA_URL.

const OLLAMA_URL = (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/$/, '');
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:3b';

export async function ollamaChat({ messages, system, model = OLLAMA_MODEL, temperature = 0.2, timeoutMs = 240000 }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const body = {
      model,
      stream: false,
      options: { temperature },
      messages: system
        ? [{ role: 'system', content: system }, ...messages]
        : messages,
    };
    const r = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      throw new Error(`Ollama HTTP ${r.status}: ${t.slice(0, 200)}`);
    }
    const j = await r.json();
    return j?.message?.content || '';
  } finally {
    clearTimeout(timer);
  }
}

// Conversación de 2 mensajes: REPORTER analiza el error y FIXER propone parches
// quirúrgicos en formato JSON {explanation, patches:[{find,replace}]}.
// Cada `find` debe ser texto LITERAL existente en el archivo objetivo, lo que
// permite hacer search/replace seguro en lugar de sobrescribir el archivo entero.
export async function repairConversation({
  message, file, line, stack, source, deployer, catalogCode, catalogInfo,
  targetPath, currentContent,
}) {
  const errBlock = [
    `Mensaje: ${message || '(sin mensaje)'}`,
    file ? `Archivo: ${file}${line ? ':' + line : ''}` : null,
    source ? `Tipo: ${source}` : null,
    deployer ? `Plataforma: ${deployer}` : null,
    catalogCode ? `Código catálogo: ${catalogCode}` : null,
    catalogInfo?.cause ? `Causa conocida: ${catalogInfo.cause}` : null,
    catalogInfo?.solution ? `Solución sugerida: ${catalogInfo.solution}` : null,
    stack ? `Stack:\n${String(stack).slice(0, 1500)}` : null,
  ].filter(Boolean).join('\n');

  // Recorta el contenido del archivo si es muy grande (modelos pequeños tienen
  // poco contexto). Mantenemos cabecera + cola para no romper el HTML.
  const MAX = 8000;
  let fileBlock = '';
  if (currentContent) {
    let snippet = currentContent;
    if (snippet.length > MAX) {
      snippet = snippet.slice(0, MAX / 2) + '\n... [contenido recortado] ...\n' + snippet.slice(-MAX / 2);
    }
    fileBlock = `\nContenido actual de ${targetPath || 'archivo'}:\n\`\`\`\n${snippet}\n\`\`\``;
  }

  // PASO 1 — REPORTER
  const reporterPrompt = `Eres REPORTER, un analista de errores web.
Recibes un error y describes en 3-5 líneas, en español, sin código:
1. Qué falló exactamente.
2. Causa más probable.
3. En qué fichero/línea se produce.
Sé conciso y técnico.`;

  const reporterReply = await ollamaChat({
    system: reporterPrompt,
    messages: [{ role: 'user', content: `Analiza este error:\n\n${errBlock}` }],
    temperature: 0.1,
  });

  // PASO 2 — FIXER: parches quirúrgicos en JSON.
  const fixerPrompt = `Eres FIXER, un programador senior. Devuelves SOLO un objeto JSON válido,
sin texto antes ni después, sin bloques de código, sin comentarios. Esquema EXACTO:

{
  "explanation": "una línea explicando el cambio",
  "patches": [
    { "find": "TEXTO LITERAL que aparece en el archivo actual", "replace": "TEXTO NUEVO que lo reemplaza" }
  ]
}

REGLAS DURAS:
- "find" debe ser una porción LITERAL del archivo actual mostrado abajo, copiada tal cual (mismos espacios, mismas comillas, mismo case). NO inventes código que no esté.
- "find" debe ser único en el archivo (suficientemente largo / con contexto) para que aparezca UNA sola vez.
- "replace" es la versión corregida de ese mismo fragmento.
- Si necesitas varios cambios, usa varios objetos en el array "patches".
- Si NO puedes proponer un parche fiable contra el archivo actual, devuelve "patches": [].
- NO devuelvas el archivo entero. NO uses triples backticks. NO uses prosa fuera del JSON.`;

  const fixerReply = await ollamaChat({
    system: fixerPrompt,
    messages: [
      {
        role: 'user',
        content: `Error original:\n${errBlock}\n\nAnálisis de REPORTER:\n${reporterReply}${fileBlock}\n\nDevuelve el JSON con los parches.`,
      },
    ],
    temperature: 0.1,
  });

  // Extrae el JSON aunque el modelo añada texto alrededor.
  const patchPlan = parsePatchJson(fixerReply);

  return {
    model: OLLAMA_MODEL,
    conversation: [
      { role: 'reporter', content: reporterReply },
      { role: 'fixer', content: fixerReply },
    ],
    patchPlan,
  };
}

function parsePatchJson(text) {
  if (!text) return null;
  // Quita posibles fences ```json ... ```
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fence ? fence[1] : text;
  // Busca el primer { y el último } que cierre.
  const start = candidate.indexOf('{');
  const end   = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  const slice = candidate.slice(start, end + 1);
  try {
    const obj = JSON.parse(slice);
    if (!obj || !Array.isArray(obj.patches)) return null;
    const patches = obj.patches.filter(p => p && typeof p.find === 'string' && typeof p.replace === 'string' && p.find.length > 0);
    return { explanation: String(obj.explanation || ''), patches };
  } catch { return null; }
}

// Aplica un patchPlan a un contenido. Devuelve {ok, content, applied, errors}.
// Cada parche exige que `find` aparezca EXACTAMENTE 1 vez en el contenido
// (acumulando lo aplicado por parches previos). Si no, se aborta sin escribir.
export function applyPatchPlan(originalContent, patchPlan) {
  if (!patchPlan || !Array.isArray(patchPlan.patches) || patchPlan.patches.length === 0) {
    return { ok: false, reason: 'sin parches', content: originalContent, applied: 0 };
  }
  let content = originalContent;
  let applied = 0;
  for (const p of patchPlan.patches) {
    const occurrences = countOccurrences(content, p.find);
    if (occurrences === 0) {
      return { ok: false, reason: `parche #${applied + 1}: "find" no encontrado en el archivo`, content, applied };
    }
    if (occurrences > 1) {
      return { ok: false, reason: `parche #${applied + 1}: "find" ambiguo (${occurrences} coincidencias)`, content, applied };
    }
    content = content.replace(p.find, p.replace);
    applied++;
  }
  return { ok: true, content, applied };
}

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0, idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) { count++; idx += needle.length; }
  return count;
}

export async function ollamaHealth() {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch { return false; }
}
