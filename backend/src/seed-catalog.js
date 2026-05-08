// Seed inicial: 8+ desplegadores y los códigos de error públicos más conocidos
// de cada uno. Idempotente vía INSERT IGNORE.

export const DEPLOYERS = [
  { name: 'vercel',        display_name: 'Vercel',                color: '#000000', docs_url: 'https://vercel.com/docs/errors',
    url_patterns: ['.vercel.app', '.now.sh', 'vercel-storage.com'],
    header_hints: ['x-vercel-id', 'server: vercel'] },
  { name: 'netlify',       display_name: 'Netlify',               color: '#00C7B7', docs_url: 'https://docs.netlify.com/troubleshooting-tips/error-messages/',
    url_patterns: ['.netlify.app', '.netlify.com'],
    header_hints: ['x-nf-request-id', 'server: netlify'] },
  { name: 'cloudflare',    display_name: 'Cloudflare Pages',      color: '#F38020', docs_url: 'https://developers.cloudflare.com/workers/observability/errors/',
    url_patterns: ['.pages.dev', '.workers.dev'],
    header_hints: ['cf-ray', 'server: cloudflare'] },
  { name: 'github',        display_name: 'GitHub Pages',          color: '#181717', docs_url: 'https://docs.github.com/en/pages/getting-started-with-github-pages/troubleshooting-jekyll-build-errors-for-github-pages-sites',
    url_patterns: ['.github.io'],
    header_hints: ['server: github.com'] },
  { name: 'render',        display_name: 'Render',                color: '#46E3B7', docs_url: 'https://render.com/docs/troubleshooting-deploys',
    url_patterns: ['.onrender.com'],
    header_hints: [] },
  { name: 'railway',       display_name: 'Railway',               color: '#0B0D0E', docs_url: 'https://docs.railway.app/troubleshoot/errors',
    url_patterns: ['.up.railway.app', '.railway.app'],
    header_hints: [] },
  { name: 'fly',           display_name: 'Fly.io',                color: '#7B3FE4', docs_url: 'https://fly.io/docs/reference/troubleshooting/',
    url_patterns: ['.fly.dev'],
    header_hints: ['fly-request-id'] },
  { name: 'heroku',        display_name: 'Heroku',                color: '#430098', docs_url: 'https://devcenter.heroku.com/articles/error-codes',
    url_patterns: ['.herokuapp.com'],
    header_hints: ['via: 1.1 vegur'] },
  { name: 'aws-amplify',   display_name: 'AWS Amplify',           color: '#FF9900', docs_url: 'https://docs.aws.amazon.com/amplify/latest/userguide/troubleshooting.html',
    url_patterns: ['.amplifyapp.com'],
    header_hints: [] },
  { name: 'firebase',      display_name: 'Firebase Hosting',      color: '#FFCA28', docs_url: 'https://firebase.google.com/docs/hosting/troubleshooting',
    url_patterns: ['.web.app', '.firebaseapp.com'],
    header_hints: ['x-firebase-instance'] },
  { name: 'azure-swa',     display_name: 'Azure Static Web Apps', color: '#0078D4', docs_url: 'https://learn.microsoft.com/en-us/azure/static-web-apps/troubleshooting',
    url_patterns: ['.azurestaticapps.net'],
    header_hints: [] },
  { name: 'google-analytics', display_name: 'Google Analytics (Measurement Protocol)', color: '#E37400', docs_url: 'https://developers.google.com/analytics/devguides/collection/protocol/ga4/sending-events',
    url_patterns: ['google-analytics.com', 'analytics.google.com'],
    header_hints: [] },
];

export const CATALOG = [
  // ================= VERCEL =================
  { code: 'FUNCTION_INVOCATION_TIMEOUT', platform: 'vercel', pattern_regex: 'FUNCTION_INVOCATION_TIMEOUT', category: 'function', severity: 'high', cause: 'La Serverless Function superó el límite de tiempo de ejecución (10s en Hobby, 60s/300s en planes superiores).', solution: 'Optimiza la función o aumenta maxDuration en vercel.json. Considera streaming o background tasks.', docs_url: 'https://vercel.com/docs/errors/FUNCTION_INVOCATION_TIMEOUT' },
  { code: 'FUNCTION_INVOCATION_FAILED', platform: 'vercel', pattern_regex: 'FUNCTION_INVOCATION_FAILED', category: 'function', severity: 'urgent', cause: 'La función lanzó una excepción sin gestionar.', solution: 'Revisa los logs (vercel logs) y añade try/catch con respuestas adecuadas.', docs_url: 'https://vercel.com/docs/errors/FUNCTION_INVOCATION_FAILED' },
  { code: 'NO_RESPONSE_FROM_FUNCTION', platform: 'vercel', pattern_regex: 'NO_RESPONSE_FROM_FUNCTION', category: 'function', severity: 'high', cause: 'La función terminó sin enviar respuesta HTTP.', solution: 'Asegúrate de llamar a res.send/res.end o devolver un Response en todas las rutas posibles.', docs_url: 'https://vercel.com/docs/errors/NO_RESPONSE_FROM_FUNCTION' },
  { code: 'BODY_NOT_A_STRING_FROM_FUNCTION', platform: 'vercel', pattern_regex: 'BODY_NOT_A_STRING_FROM_FUNCTION', category: 'function', severity: 'medium', cause: 'La función devolvió un body que no es string ni Buffer.', solution: 'Serializa con JSON.stringify y usa Content-Type adecuado.' },
  { code: 'FUNCTION_PAYLOAD_TOO_LARGE', platform: 'vercel', pattern_regex: 'FUNCTION_PAYLOAD_TOO_LARGE', category: 'function', severity: 'medium', cause: 'El request supera 4.5MB.', solution: 'Sube en chunks, usa signed URLs o redirige a almacenamiento (Blob, S3).' },
  { code: 'FUNCTION_RESPONSE_PAYLOAD_TOO_LARGE', platform: 'vercel', pattern_regex: 'FUNCTION_RESPONSE_PAYLOAD_TOO_LARGE', category: 'function', severity: 'medium', cause: 'La respuesta supera 4.5MB.', solution: 'Pagina los resultados o usa streaming.' },
  { code: 'EDGE_FUNCTION_INVOCATION_TIMEOUT', platform: 'vercel', pattern_regex: 'EDGE_FUNCTION_INVOCATION_TIMEOUT', category: 'edge', severity: 'high', cause: 'Edge Function excedió el tiempo permitido.', solution: 'Reduce trabajo en el edge o muévelo a una Serverless Function.' },
  { code: 'EDGE_FUNCTION_INVOCATION_FAILED', platform: 'vercel', pattern_regex: 'EDGE_FUNCTION_INVOCATION_FAILED', category: 'edge', severity: 'urgent', cause: 'Edge Function lanzó error.', solution: 'Revisa logs y maneja los casos de fallo.' },
  { code: 'MIDDLEWARE_INVOCATION_FAILED', platform: 'vercel', pattern_regex: 'MIDDLEWARE_INVOCATION_FAILED', category: 'middleware', severity: 'urgent', cause: 'Middleware lanzó excepción.', solution: 'Revisa middleware.ts/js, añade fallback NextResponse.next().' },
  { code: 'MIDDLEWARE_INVOCATION_TIMEOUT', platform: 'vercel', pattern_regex: 'MIDDLEWARE_INVOCATION_TIMEOUT', category: 'middleware', severity: 'high', cause: 'Middleware tardó demasiado.', solution: 'Mantén el middleware ligero, evita llamadas externas síncronas.' },
  { code: 'DEPLOYMENT_NOT_FOUND', platform: 'vercel', pattern_regex: 'DEPLOYMENT_NOT_FOUND', category: 'deploy', severity: 'urgent', cause: 'El deployment no existe o fue borrado.', solution: 'Vuelve a desplegar o restaura el alias.' },
  { code: 'DEPLOYMENT_BLOCKED', platform: 'vercel', pattern_regex: 'DEPLOYMENT_BLOCKED', category: 'deploy', severity: 'urgent', cause: 'El proyecto está pausado o bloqueado por límites.', solution: 'Revisa facturación y límites de plan.' },
  { code: 'DNS_HOSTNAME_NOT_FOUND', platform: 'vercel', pattern_regex: 'DNS_HOSTNAME_NOT_FOUND', category: 'dns', severity: 'high', cause: 'DNS del dominio no resuelve a Vercel.', solution: 'Configura los registros A/CNAME indicados en el panel de Vercel.' },
  { code: 'TOO_MANY_FILESYSTEM_CHECKS', platform: 'vercel', pattern_regex: 'TOO_MANY_FILESYSTEM_CHECKS', category: 'routing', severity: 'medium', cause: 'Demasiadas comprobaciones de fichero en routing.', solution: 'Simplifica vercel.json o las rutas dinámicas.' },
  { code: 'ROUTER_CANNOT_MATCH', platform: 'vercel', pattern_regex: 'ROUTER_CANNOT_MATCH', category: 'routing', severity: 'medium', cause: 'No hay regla que case con la URL.', solution: 'Añade fallback o rewrite en vercel.json.' },

  // ================= NETLIFY =================
  { code: 'NETLIFY_BUILD_FAILED', platform: 'netlify', pattern_regex: '(?i)build (failed|error)', category: 'build', severity: 'urgent', cause: 'El build de Netlify terminó con código distinto de 0.', solution: 'Revisa el log del deploy. Verifica versión de Node, comando de build y dependencias.' },
  { code: 'NETLIFY_FUNCTION_TIMEOUT', platform: 'netlify', pattern_regex: '(Task timed out after|Function execution took too long)', category: 'function', severity: 'high', cause: 'La función excedió 10s (sync) o 15min (background).', solution: 'Optimiza o convierte a Background/Edge Function.' },
  { code: 'NETLIFY_FUNCTION_MEMORY', platform: 'netlify', pattern_regex: '(Process exited|JavaScript heap out of memory)', category: 'function', severity: 'high', cause: 'Función excedió memoria (1024MB).', solution: 'Reduce uso, libera buffers, considera streaming.' },
  { code: 'NETLIFY_FORM_SPAM', platform: 'netlify', pattern_regex: 'form submission.*(spam|blocked)', category: 'forms', severity: 'low', cause: 'Envío detectado como spam.', solution: 'Activa Akismet o reCAPTCHA en la config del form.' },
  { code: 'NETLIFY_BANDWIDTH_LIMIT', platform: 'netlify', pattern_regex: '(bandwidth|quota).*(exceeded|limit)', category: 'limits', severity: 'urgent', cause: 'Cuota mensual de ancho de banda agotada.', solution: 'Sube de plan o reduce assets.' },
  { code: 'NETLIFY_REDIRECT_LOOP', platform: 'netlify', pattern_regex: '(too many redirects|redirect loop)', category: 'routing', severity: 'high', cause: 'Bucle infinito en _redirects o netlify.toml.', solution: 'Revisa reglas y añade condiciones de salida.' },

  // ================= CLOUDFLARE =================
  { code: 'CF_1101', platform: 'cloudflare', pattern_regex: '\\b1101\\b|Worker threw exception', category: 'worker', severity: 'urgent', cause: 'El Worker lanzó una excepción no controlada.', solution: 'Envuelve el handler en try/catch y devuelve Response 500 con detalle.' },
  { code: 'CF_1102', platform: 'cloudflare', pattern_regex: '\\b1102\\b|Worker exceeded CPU', category: 'worker', severity: 'high', cause: 'El Worker superó el límite de CPU (10ms en Free, 50ms en Bundled).', solution: 'Optimiza, mueve trabajo a backend o usa Unbound.' },
  { code: 'CF_1015', platform: 'cloudflare', pattern_regex: '\\b1015\\b|rate limited', category: 'security', severity: 'medium', cause: 'Rate limit de Cloudflare activado.', solution: 'Revisa reglas de Rate Limiting o añade excepciones.' },
  { code: 'CF_521', platform: 'cloudflare', pattern_regex: '\\b521\\b|Web server is down', category: 'origin', severity: 'urgent', cause: 'El servidor de origen rechazó la conexión.', solution: 'Comprueba que el origin está vivo y permite IPs de Cloudflare.' },
  { code: 'CF_522', platform: 'cloudflare', pattern_regex: '\\b522\\b|Connection timed out', category: 'origin', severity: 'urgent', cause: 'Timeout al conectar con el origin.', solution: 'Revisa firewall del origin y latencia.' },
  { code: 'CF_524', platform: 'cloudflare', pattern_regex: '\\b524\\b|A timeout occurred', category: 'origin', severity: 'high', cause: 'El origin no respondió en 100s.', solution: 'Optimiza el endpoint o usa cf-fetch con timeout mayor.' },

  // ================= GITHUB PAGES =================
  { code: 'GHP_BUILD_FAILED', platform: 'github', pattern_regex: '(?i)page build failed', category: 'build', severity: 'urgent', cause: 'Jekyll u otro builder falló.', solution: 'Revisa el log en Settings → Pages, comprueba _config.yml y plugins.' },
  { code: 'GHP_SIZE_LIMIT', platform: 'github', pattern_regex: '(exceeds|over).*(1.?GB|size limit)', category: 'limits', severity: 'high', cause: 'El sitio supera 1GB.', solution: 'Reduce binarios, usa Git LFS para activos grandes.' },
  { code: 'GHP_SUBMODULE_ERROR', platform: 'github', pattern_regex: 'submodule', category: 'build', severity: 'medium', cause: 'Submódulos no accesibles públicamente.', solution: 'Usa submódulos públicos o desactívalos.' },

  // ================= RENDER =================
  { code: 'RENDER_DEPLOY_FAILED', platform: 'render', pattern_regex: '(?i)deploy (failed|error)', category: 'deploy', severity: 'urgent', cause: 'El despliegue terminó con error.', solution: 'Revisa logs en el dashboard, build command y env vars.' },
  { code: 'RENDER_SERVICE_UNHEALTHY', platform: 'render', pattern_regex: 'health check.*(failed|unhealthy)', category: 'health', severity: 'high', cause: 'El health check del servicio falla.', solution: 'Verifica que el endpoint responda 200 en el path configurado.' },
  { code: 'RENDER_OUT_OF_MEMORY', platform: 'render', pattern_regex: '(out of memory|OOMKilled)', category: 'limits', severity: 'high', cause: 'Servicio excedió memoria del plan.', solution: 'Sube de plan o optimiza uso de memoria.' },

  // ================= RAILWAY =================
  { code: 'RAILWAY_BUILD_FAILED', platform: 'railway', pattern_regex: '(?i)build (failed|error)', category: 'build', severity: 'urgent', cause: 'Nixpacks o Dockerfile falló.', solution: 'Revisa logs, fija versiones de runtime, comprueba railway.json.' },
  { code: 'RAILWAY_CRASHED', platform: 'railway', pattern_regex: '(?i)crashed|exited with code', category: 'runtime', severity: 'urgent', cause: 'El proceso terminó inesperadamente.', solution: 'Revisa logs runtime, valida variables de entorno requeridas.' },
  { code: 'RAILWAY_USAGE_LIMIT', platform: 'railway', pattern_regex: 'usage limit', category: 'limits', severity: 'high', cause: 'Límite de uso del plan alcanzado.', solution: 'Sube plan o suspende servicios no críticos.' },

  // ================= FLY.IO =================
  { code: 'FLY_VM_FAILED', platform: 'fly', pattern_regex: '(?i)vm.*(failed|crashed)|machine.*failed', category: 'runtime', severity: 'urgent', cause: 'La VM no pudo iniciar o cayó.', solution: 'Revisa fly logs, comprueba fly.toml y health checks.' },
  { code: 'FLY_OUT_OF_MEMORY', platform: 'fly', pattern_regex: '(out of memory|oom)', category: 'limits', severity: 'high', cause: 'OOM kill en la VM.', solution: 'Aumenta memory en fly.toml.' },
  { code: 'FLY_DEPLOY_FAILED', platform: 'fly', pattern_regex: '(?i)deploy.*(failed|error)', category: 'deploy', severity: 'urgent', cause: 'fly deploy terminó con error.', solution: 'Revisa el Dockerfile y release_command.' },

  // ================= HEROKU =================
  { code: 'H10', platform: 'heroku', pattern_regex: '\\bH10\\b|App crashed', category: 'runtime', severity: 'urgent', cause: 'La app crasheó.', solution: 'Revisa logs (heroku logs --tail), valida Procfile y dependencias.', docs_url: 'https://devcenter.heroku.com/articles/error-codes#h10-app-crashed' },
  { code: 'H12', platform: 'heroku', pattern_regex: '\\bH12\\b|Request timeout', category: 'runtime', severity: 'high', cause: 'Request superó 30s.', solution: 'Convierte trabajo largo a worker dyno o usa background jobs.' },
  { code: 'H13', platform: 'heroku', pattern_regex: '\\bH13\\b|Connection closed without response', category: 'runtime', severity: 'high', cause: 'El proceso cerró sin enviar respuesta.', solution: 'Revisa cierre prematuro de socket o keep-alive.' },
  { code: 'H14', platform: 'heroku', pattern_regex: '\\bH14\\b|No web processes running', category: 'runtime', severity: 'urgent', cause: 'No hay dynos web corriendo.', solution: 'heroku ps:scale web=1' },
  { code: 'H18', platform: 'heroku', pattern_regex: '\\bH18\\b|Server Request Interrupted', category: 'runtime', severity: 'medium', cause: 'El cliente cerró la conexión antes de respuesta.', solution: 'Investiga si es timeout cliente o lentitud servidor.' },
  { code: 'R14', platform: 'heroku', pattern_regex: '\\bR14\\b|Memory quota exceeded', category: 'limits', severity: 'high', cause: 'Dyno excedió memoria.', solution: 'Sube tipo de dyno o reduce uso.' },
  { code: 'R15', platform: 'heroku', pattern_regex: '\\bR15\\b|Memory quota vastly exceeded', category: 'limits', severity: 'urgent', cause: 'OOM forzado.', solution: 'Sube tipo de dyno urgentemente.' },

  // ================= AWS AMPLIFY =================
  { code: 'AMP_BUILD_FAILED', platform: 'aws-amplify', pattern_regex: '(?i)build.*(failed|error)', category: 'build', severity: 'urgent', cause: 'Build de Amplify falló.', solution: 'Revisa amplify.yml y logs de CodeBuild.' },
  { code: 'AMP_TIMEOUT', platform: 'aws-amplify', pattern_regex: '(?i)build.*timed? out', category: 'build', severity: 'high', cause: 'Build superó 30 minutos.', solution: 'Optimiza pasos o cachea node_modules.' },

  // ================= FIREBASE =================
  { code: 'FB_HOSTING_DEPLOY_FAILED', platform: 'firebase', pattern_regex: '(?i)deploy.*failed.*hosting', category: 'deploy', severity: 'urgent', cause: 'firebase deploy --only hosting falló.', solution: 'Revisa firebase.json, autenticación y cuota.' },
  { code: 'FB_FUNCTION_TIMEOUT', platform: 'firebase', pattern_regex: 'function execution took.*timeout', category: 'function', severity: 'high', cause: 'Cloud Function timeout (60s default, 540s max).', solution: 'Aumenta timeoutSeconds en runWith({}) o reestructura.' },
  { code: 'FB_QUOTA_EXCEEDED', platform: 'firebase', pattern_regex: 'quota.*exceeded', category: 'limits', severity: 'urgent', cause: 'Cuota Spark agotada.', solution: 'Sube a Blaze o reduce uso.' },

  // ================= AZURE SWA =================
  { code: 'SWA_BUILD_FAILED', platform: 'azure-swa', pattern_regex: '(?i)build.*(failed|error)', category: 'build', severity: 'urgent', cause: 'Build de Static Web App falló.', solution: 'Revisa workflow de GitHub Actions y staticwebapp.config.json.' },
  { code: 'SWA_CONFIG_INVALID', platform: 'azure-swa', pattern_regex: 'staticwebapp.*config.*(invalid|error)', category: 'config', severity: 'high', cause: 'staticwebapp.config.json mal formado.', solution: 'Valida JSON y la estructura de routes/responseOverrides.' },

  // ================= GOOGLE ANALYTICS =================
  { code: 'GA_400', platform: 'google-analytics', pattern_regex: '(?i)measurement.*protocol.*400|invalid.*measurement.*id', category: 'api', severity: 'medium', cause: 'Measurement ID inválido o payload mal formado.', solution: 'Verifica G-XXXX y campos requeridos (client_id, events).' },
  { code: 'GA_401', platform: 'google-analytics', pattern_regex: '(?i)analytics.*(401|unauthorized)', category: 'api', severity: 'high', cause: 'API secret inválido o caducado.', solution: 'Regenera el API secret en Admin → Data Streams.' },
  { code: 'GA_429', platform: 'google-analytics', pattern_regex: '(?i)analytics.*(429|too many requests|quota)', category: 'limits', severity: 'medium', cause: 'Rate limit del Measurement Protocol.', solution: 'Bachea eventos (hasta 25 por request) o reduce frecuencia.' },
  { code: 'GA_BLOCKED_AD_BLOCKER', platform: 'google-analytics', pattern_regex: '(net::ERR_BLOCKED_BY_CLIENT|analytics.*blocked)', category: 'client', severity: 'low', cause: 'Bloqueador de anuncios impide el envío.', solution: 'Servidor proxy de eventos o usar server-side tagging.' },
];
