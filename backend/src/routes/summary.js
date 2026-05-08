import { Router } from 'express';
import { pool } from '../db.js';

const r = Router();

r.get('/weekly', async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT
        DATE(created_at) AS day,
        status,
        priority,
        COUNT(*) AS n
     FROM previews
     WHERE created_at >= (NOW() - INTERVAL 7 DAY)
     GROUP BY day, status, priority
     ORDER BY day DESC`
  );
  const [[totals]] = await pool.query(
    `SELECT
        SUM(status='applied')  AS applied,
        SUM(status='pending')  AS pending,
        SUM(status='ignored')  AS ignored,
        SUM(status='rejected') AS rejected,
        SUM(priority='urgent') AS urgent,
        COUNT(*)               AS total
     FROM previews
     WHERE created_at >= (NOW() - INTERVAL 7 DAY)`
  );
  res.json({ totals, rows });
});

export default r;
