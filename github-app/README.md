# AvantDefw1 — GitHub App intermediario

Servicio Node que recibe parches aprobados por AvantDefw1 y, en lugar de
escribir en disco local, **crea una rama + PR en el repo cliente en GitHub**.
Si el cambio es crítico, deja el PR para revisión humana; si no, hace
auto-merge.

## 1. Crear la GitHub App en github.com

Ve a https://github.com/settings/apps/new (cuenta `AlumnoPracticas1`) y rellena:

| Campo | Valor |
|---|---|
| **GitHub App name** | `avantdef-w1` (o el que quieras, único en GitHub) |
| **Homepage URL** | `http://localhost:4100` |
| **Callback URL** | *(vacío)* |
| **Webhook → Active** | ✅ |
| **Webhook URL** | `https://<tu-tunel>/github/webhook` (ver paso 4) |
| **Webhook secret** | una cadena larga aleatoria — guárdala |
| **Where can this GitHub App be installed?** | Only on this account |

**Repository permissions** (los demás déjalos en *No access*):

| Permiso | Acceso |
|---|---|
| Contents | Read & write |
| Pull requests | Read & write |
| Metadata | Read-only (forzado) |
| Checks | Read & write *(opcional)* |

**Subscribe to events**: `Push`, `Pull request`.

Al guardar, GitHub te muestra el **App ID** y un botón **Generate a private
key** — descarga el `.pem`.

## 2. Instalar la app en tus repos cliente

En la página de la app → **Install App** → elige los repos que AvantDefw1 va
a tocar (p.ej. `AlumnoPracticas1/avantservice`).

## 3. Configurar el servicio local

```
cd PaginaAuto/github-app
mkdir secrets
move <tu-archivo.pem> secrets/avantdef.private-key.pem
copy .env.example .env
```

Edita `.env`:

```
GH_APP_ID=123456                    # el App ID que te dio GitHub
GH_PRIVATE_KEY_PATH=./secrets/avantdef.private-key.pem
GH_WEBHOOK_SECRET=la-misma-cadena-que-pusiste-en-github
PORT=4100
INTERNAL_TOKEN=     # (opcional) para que solo tu backend pueda llamar a /propose
```

Asegúrate de que `secrets/` y `.env` están en `.gitignore`.

## 4. Exponer el webhook al exterior (solo para recibir eventos)

GitHub necesita poder llegar a tu webhook URL. En desarrollo:

```
ngrok http 4100
```

Pega la URL `https://xxxx.ngrok-free.app/github/webhook` en el campo
**Webhook URL** de la app. Si solo vas a usar `/propose` (saliente, tu
backend → GitHub) y no necesitas reaccionar a eventos entrantes, puedes
desactivar el webhook y omitir ngrok.

## 5. Arrancar

```
npm install
npm run dev
```

Verifica:

```
curl http://localhost:4100/health
curl http://localhost:4100/installations
```

## 6. Cómo lo llama AvantDefw1

Cuando una preview se aprueba (manual o auto), el backend Node hace:

```
POST http://localhost:4100/propose
Content-Type: application/json
X-Internal-Token: <si configuraste INTERNAL_TOKEN>

{
  "owner":  "AlumnoPracticas1",
  "repo":   "avantservice",
  "baseBranch": "main",
  "files": [
    { "path": "index.html", "content": "<!doctype html>...contenido completo del archivo tras aplicar parches..." }
  ],
  "message": "fix: corregir fetch fallido en /api/track",
  "priority": "low",
  "previewId": "edd15eb78197ff8b"
}
```

Respuesta:

```
{
  "ok": true,
  "critical": false,
  "branch": "avantdef/auto-edd15eb78197ff8b",
  "pr": { "number": 42, "url": "https://github.com/AlumnoPracticas1/avantservice/pull/42" },
  "merged": true
}
```

## 7. Reglas "crítico vs auto"

`isCritical()` en `server.js`. Marca como crítico si:
- `priority` es `urgent` o `high`.
- Algún archivo toca: `package.json`, `migrations/`, `.env`, rutas con
  `auth`/`payment`/`secret`/`credentials`, o workflows de GitHub Actions.
- El mensaje contiene `breaking`, `drop`, `delete table`, `truncate`.

Tunea esa función a tu gusto.

## 8. Endpoints

| Método | Ruta | Descripción |
|---|---|---|
| GET  | `/health` | Estado de la app (consulta `/app` en GitHub) |
| GET  | `/installations` | Lista instalaciones y cuentas |
| POST | `/propose` | Crea rama + commit + PR (auto-merge si no crítico) |
| POST | `/github/webhook` | Eventos entrantes de GitHub (firma HMAC verificada) |

## 9. Pendiente / posibles extensiones

- Guardar `pr.url` en la tabla `previews` para mostrar el enlace en el dashboard.
- Si auto-merge falla por *branch protection*, marcar la preview como
  `needs-review` automáticamente.
- Reaccionar a `pull_request.closed` (merge/rechazo) en el webhook para
  actualizar el estado de la preview en MySQL.
