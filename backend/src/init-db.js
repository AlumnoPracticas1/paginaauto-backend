import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { DEPLOYERS, CATALOG } from './seed-catalog.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let sql = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

// En cloud (Railway/etc) no podemos crear DBs nuevas; usamos la que nos dan.
// Sustituimos `paginaauto` por el DB real extraído de DATABASE_URL.
let DB = process.env.DB_NAME || 'paginaauto';
if (process.env.DATABASE_URL) {
  try {
    const u = new URL(process.env.DATABASE_URL);
    const dbFromUrl = u.pathname.replace(/^\//, '');
    if (dbFromUrl) DB = dbFromUrl;
  } catch {}
  // Quita CREATE DATABASE/USE — no tenemos privilegios en cloud.
  sql = sql
    .replace(/\bCREATE\s+DATABASE\b[^;]*;/gi, '')
    .replace(/(^|[\r\n])\s*USE\s+[^;]+;/gi, '$1');
}

function connConfig() {
  if (process.env.DATABASE_URL) {
    const u = new URL(process.env.DATABASE_URL);
    const cfg = {
      host: u.hostname,
      port: Number(u.port || 3306),
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password || ''),
      multipleStatements: true,
    };
    if (process.env.DB_DISABLE_SSL !== '1') cfg.ssl = { rejectUnauthorized: false };
    return cfg;
  }
  return {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
  };
}
const cfg = connConfig();
if (process.env.DATABASE_URL) cfg.database = DB; // forzar la DB cloud
const conn = await mysql.createConnection(cfg);

// Ejecuta sentencia por sentencia para evitar problemas con multipleStatements
// y/o servidores que no lo permiten.
const stmts = sql.split(';').map(s => s.trim()).filter(Boolean);
for (const s of stmts) {
  await conn.query(s);
}

// Migraciones idempotentes (añade columnas si previews ya existía).
async function addColIfMissing(table, ddl) {
  try {
    await conn.query(`ALTER TABLE \`${DB}\`.${table} ADD COLUMN ${ddl}`);
    console.log(`Migración: ${table} → ${ddl}`);
  } catch (e) {
    if (e?.code !== 'ER_DUP_FIELDNAME') throw e;
  }
}
await addColIfMissing('previews', 'extra JSON NULL');
await addColIfMissing('previews', 'deployer VARCHAR(32) NULL');
await addColIfMissing('previews', 'catalog_code VARCHAR(64) NULL');
await addColIfMissing('previews', 'pr_url VARCHAR(512) NULL');
await addColIfMissing('previews', 'pr_branch VARCHAR(255) NULL');
await addColIfMissing('previews', 'pr_critical TINYINT(1) NULL');

await conn.query(`USE \`${DB}\``);

// Seed deployers (idempotente)
for (const d of DEPLOYERS) {
  await conn.execute(
    `INSERT INTO deployers (name, display_name, url_patterns, header_hints, color, docs_url)
     VALUES (?, ?, CAST(? AS JSON), CAST(? AS JSON), ?, ?)
     ON DUPLICATE KEY UPDATE
       display_name = VALUES(display_name),
       url_patterns = VALUES(url_patterns),
       header_hints = VALUES(header_hints),
       color        = VALUES(color),
       docs_url     = VALUES(docs_url)`,
    [d.name, d.display_name, JSON.stringify(d.url_patterns || []), JSON.stringify(d.header_hints || []), d.color || null, d.docs_url || null]
  );
}
console.log(`Seed: ${DEPLOYERS.length} desplegadores ✓`);

// Seed catálogo (idempotente — UPDATE si ya existe el code+platform)
for (const c of CATALOG) {
  await conn.execute(
    `INSERT INTO error_catalog (code, platform, pattern_regex, category, severity, cause, solution, docs_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       pattern_regex = VALUES(pattern_regex),
       category      = VALUES(category),
       severity      = VALUES(severity),
       cause         = VALUES(cause),
       solution      = VALUES(solution),
       docs_url      = VALUES(docs_url)`,
    [c.code, c.platform, c.pattern_regex || null, c.category || null, c.severity || 'medium', c.cause || null, c.solution || null, c.docs_url || null]
  );
}
console.log(`Seed: ${CATALOG.length} entradas de catálogo ✓`);

console.log('DB inicializada ✓');
await conn.end();
