# Despliegue de PaginaAuto

Repos separados:
- Backend Node + MySQL → **Railway** (este repo: `paginaauto-backend`)
- Frontend React (Vite) → **Vercel** (repo `paginaauto-frontend`)
- `main.py` + Ollama → **NO se despliega** (sigue en local; necesita 2 GB+ RAM y un modelo LLM grande)

> Si quieres ir 100 % cloud, hay que migrar la integración a Anthropic / OpenAI (cambia 2-3 archivos). Avísame.

---

## 1) Railway — proyecto

URL: https://railway.com/project/e632fa75-ae44-4fc5-b067-acb26f333311

### 1.1 MySQL
1. **+ New → Database → MySQL** → Deploy.
2. Espera a que arranque. Servicio queda con la variable `MYSQL_URL`.

### 1.2 Backend Node
1. **+ New → GitHub Repo → `AlumnoPracticas1/paginaauto-backend`**.
2. Cuando pregunte el directorio raíz, **Root Directory = `backend`** (porque el `package.json` y `railway.json` viven en `backend/`).
3. **Variables** (en el servicio backend):

   | Variable | Valor |
   |---|---|
   | `DATABASE_URL` | Add Reference → `${{ MySQL.MYSQL_URL }}` |
   | `ALLOWED_ORIGINS` | URL del frontend en Vercel (paso 2). De momento déjalo vacío. |
   | `APP_REPOS_JSON` | `{"avantservice":{"owner":"AlumnoPracticas1","repo":"testdepagina","branch":"main"}}` |
   | `GITHUB_PROXY_URL` | (opcional) si despliegas el github-app aparte |
   | `GITHUB_PROXY_INTERNAL_TOKEN` | (opcional) mismo valor que `INTERNAL_TOKEN` del github-app |

   `PORT` lo inyecta Railway solo, no lo pongas.

4. **Settings → Networking → Generate Domain** → copia la URL pública (algo como `https://paginaauto-backend-production.up.railway.app`).

### 1.3 Inicializar la base de datos

Hay dos formas:

**Opción A — Pre-deploy command (recomendado):** en el servicio backend → **Settings → Deploy → Pre-deploy command**:
```
node src/init-db.js
```
Se ejecutará en cada deploy. Es idempotente.

**Opción B — desde tu PC** (con TCP Proxy activado en el servicio MySQL):
```powershell
cd c:\Users\Lenovo\Desktop\HAM\paginaauto-backend\backend
$env:DATABASE_URL = "mysql://...proxy.rlwy.net:PUERTO/railway"
npm run init-db
```

### 1.4 (Opcional) github-app
Solo si necesitas crear PRs desde el dashboard:
1. **+ New → GitHub Repo → `paginaauto-backend`**, Root Directory = `github-app`.
2. Variables: `GH_APP_ID=3631823`, `GH_PRIVATE_KEY` (contenido del `.pem`), `INTERNAL_TOKEN` (cadena aleatoria larga).
3. Generate Domain → copia la URL → ponla en `GITHUB_PROXY_URL` del backend, y `INTERNAL_TOKEN` en `GITHUB_PROXY_INTERNAL_TOKEN`.

---

## 2) Vercel — frontend

1. https://vercel.com/new → **Import** `AlumnoPracticas1/paginaauto-frontend`.
2. **Root Directory**: `frontend`.
3. **Framework Preset**: Vite (lo detecta solo).
4. **Environment Variables**:

   | Variable | Valor |
   |---|---|
   | `VITE_API_BASE` | URL del backend en Railway (paso 1.2.4) |

5. **Deploy**. Copia la URL pública (`https://paginaauto-frontend.vercel.app` o similar).

---

## 3) Cerrar el círculo (CORS)

Vuelve al backend en Railway → Variables → `ALLOWED_ORIGINS` = URL de Vercel del paso 2. Railway redepliega automáticamente.

---

## 4) Verificación

```powershell
curl https://TU-BACKEND.up.railway.app/health
```
Debe responder `{ ok: true, db: true, ... }`.

Abre la URL de Vercel → debería cargar el dashboard tirando datos de Railway.

---

## 5) Cliente-escucha (webs cliente que envían errores)

Edita el `<script>` de `error_capture.js` en cada web cliente:
```html
<script src="error_capture.js"
        defer
        data-endpoint="https://TU-BACKEND.up.railway.app"
        data-token="opcional"></script>
```

---

## Limitaciones

- **Ollama / `main.py`**: locales. La opción "Arreglar con IA" sólo funciona si el backend Node ve un Ollama (vía `PYTHON_API`). En cloud fallará a no ser que migres a Anthropic/OpenAI.
- **Estado en memoria** (`/clients`): el backend guarda el mapa de clientes en RAM. Con un solo replica está bien; si escalas a varios se desincroniza.
- **Webhooks de GitHub** al github-app: si lo despliegas, configura la URL pública en https://github.com/settings/apps/avantelite-app y un `GH_WEBHOOK_SECRET`.
