import mysql from 'mysql2/promise';
import 'dotenv/config';

// Soporta dos modos:
//   1) DATABASE_URL (Railway / cualquier hosting MySQL en cloud).
//      Ej: mysql://usuario:password@host.railway.internal:3306/dbname
//   2) Variables sueltas DB_HOST / DB_USER / ... (modo local con WAMP).
function buildPoolConfig() {
  if (process.env.DATABASE_URL) {
    const u = new URL(process.env.DATABASE_URL);
    const cfg = {
      host: u.hostname,
      port: Number(u.port || 3306),
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password || ''),
      database: u.pathname.replace(/^\//, '') || 'paginaauto',
    };
    // Railway/PlanetScale/etc suelen requerir SSL. Si DB_DISABLE_SSL=1 lo saltas.
    if (process.env.DB_DISABLE_SSL !== '1') {
      cfg.ssl = { rejectUnauthorized: false };
    }
    return cfg;
  }
  return {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'paginaauto',
  };
}

export const pool = mysql.createPool({
  ...buildPoolConfig(),
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: true,
  dateStrings: true,
});

export async function q(sql, params = {}) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}
