# Despliegue de AvantDefw1

Resumen del plan:

| Pieza | Dónde |
|---|---|
| Frontend React (`frontend/`) | **Vercel** |
| Backend Node (`backend/`) | **Railway** (Web service) |
| MySQL | **Railway** (Database) |
| github-app (`github-app/`) | **Railway** (Web service) |
| main.py + Ollama | **NO se despliega** (sigue en local) |

## Por qué main.py + Ollama no van a la nube

Ollama necesita un modelo LLM grande (qwen2.5:3b ya pesa ~2 GB y requiere bastante RAM). Ni Railway free ni Vercel pueden ejecutar eso sin pagar mucho. Si quieres ir 100% cloud, hay que cambiar la integración a un proveedor cloud (Anthropic Claude API, OpenAI, etc.) — avísame y lo hago.

Mientras tanto: el flujo "error → preview → IA → PR en GitHub" sigue funcionando en local con Ollama. Solo el dashboard y la base de datos pasarán a la nube.

---

## 1) MySQL en Railway

1. https://railway.com/new/database → **MySQL** → **Deploy**.
2. Railway crea el servicio. Pulsa el bloque MySQL → **Variables**.
3. Copia el valor de `MYSQL_URL` (formato `mysql://usuario:pass@host:port/dbname`).
4. (Opcional) En **Settings → Networking** activa **TCP Proxy** si quieres conectarte desde tu PC local para inicializar la DB.

## 2) Inicializar el esquema

Necesitas ejecutar `init-db.js` apuntando a la DB de Railway. Dos opciones:

### Opción A — desde tu PC (más simple)
```
cd PaginaAuto/backend
$env:DATABASE_URL = "mysql://usuario:pass@host.proxy.rlwy.net:PUERTO/dbname"
npm run init-db
```
(usa la URL del **TCP Proxy**, no la interna)

### Opción B — desde Railway (después de desplegar el backend)
En el servicio backend, **Settings → Deploy → Pre-deploy command**:
```
node src/init-db.js
```
Railway lo ejecutará en cada deploy.

## 3) Backend Node en Railway

1. https://railway.com → **New Project → Deploy from GitHub repo** → elige `AlumnoPracticas1/PaginaAuto`.
2. Cuando te pregunte el directorio raíz del servicio, pon **`backend`**.
3. **Variables** (en el servicio):

   | Variable | Valor |
   |---|---|
   | `DATABASE_URL` | URL interna de Railway MySQL (`mysql://...railway.internal:3306/...`) |
   | `PORT` | (Railway lo inyecta solo) |
   | `ALLOWED_ORIGINS` | URL de tu frontend en Vercel, p.ej. `https://avantdefw1.vercel.app` |
   | `GITHUB_PROXY_URL` | URL del github-app desplegado, p.ej. `https://avantdef-gh.up.railway.app` |
   | `APP_REPOS_JSON` | `{"avantservice":{"owner":"AlumnoPracticas1","repo":"testdepagina","branch":"main"}}` |
   | `PYTHON_API` | (déjalo vacío o apunta a un main.py público; en cloud no lo tendrás) |

4. **Settings → Networking → Generate domain**. Copia la URL pública (ej. `https://avantdef-backend.up.railway.app`).

## 4) github-app en Railway

1. **New Service → Deploy from GitHub repo** → mismo repo, root directory **`github-app`**.
2. Variables:

   | Variable | Valor |
   |---|---|
   | `GH_APP_ID` | `3631823` |
   | `GH_PRIVATE_KEY` | **Pega el contenido completo del `.pem`** (con saltos de línea reales o sustituidos por `\n`) |
   | `GH_WEBHOOK_SECRET` | (deja vacío si no usas webhooks) |
   | `INTERNAL_TOKEN` | una cadena aleatoria larga que el backend mandará como `X-Internal-Token` |
   | `PORT` | (Railway lo inyecta solo) |

3. **Generate domain**. Copia la URL → ponla en `GITHUB_PROXY_URL` del backend.
4. En el backend, además, añade `GITHUB_PROXY_INTERNAL_TOKEN` = mismo valor que `INTERNAL_TOKEN`.

## 5) Frontend en Vercel

1. https://vercel.com/new → **Import** el repo `AlumnoPracticas1/PaginaAuto`.
2. **Root directory**: `frontend`.
3. **Framework preset**: Vite (lo detecta solo).
4. **Environment Variables**:

   | Variable | Valor |
   |---|---|
   | `VITE_API_BASE` | URL del backend en Railway, ej. `https://avantdef-backend.up.railway.app` |

5. **Deploy**.

Cuando termine, copia la URL pública (ej. `https://avantdefw1.vercel.app`) y vuelve al backend de Railway → añádela en `ALLOWED_ORIGINS`.

## 6) Cliente-escucha (las webs cliente)

Las webs cliente que envían errores tienen que apuntar a la URL pública del backend, no a `http://localhost:4000`. En el `<script>` de `error_capture.js`:

```html
<script src="error_capture.js"
        defer
        data-endpoint="https://avantdef-backend.up.railway.app"
        data-token="opcional"></script>
```

## 7) Verificación

```
curl https://avantdef-backend.up.railway.app/health
```
Debe devolver `{ ok: true, db: true, github_proxy: { ok: true, ... } }`.

Abre `https://avantdefw1.vercel.app` y deberías ver el dashboard cargar previews desde Railway.

---

## Limitaciones conocidas

- **Ollama / main.py**: locales. La opción "Arreglar con IA" solo funciona si el backend Node tiene acceso a un Ollama. Si despliegas el backend en Railway, esa función fallará a menos que:
  - Cambies el código a Anthropic/OpenAI (gestos: 2-3 archivos).
  - O dejes el backend en local y subas solo el frontend.
- **Webhooks de GitHub**: si quieres recibirlos en el github-app desplegado, configura la URL pública en https://github.com/settings/apps/avantelite-app y pon `GH_WEBHOOK_SECRET`.
- **Estado en memoria**: el backend mantiene un mapa de "clientes conectados" en RAM. En Railway con un solo replica está bien; con múltiples replicas se desincroniza.
