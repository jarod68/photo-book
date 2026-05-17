'use strict';

const express  = require('express');

const { requireAdmin } = require('../../services/auth');
const database = require('../../services/database');

const router = express.Router();

// GET /api/admin/logs
router.get('/', requireAdmin, async (req, res) => {
  if (!database.dbReady) return res.json({ logs: [], total: 0, page: 1, pages: 0 });
  const page   = Math.max(1, parseInt(req.query.page)  || 1);
  const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
  const action = req.query.action || null;
  const offset = (page - 1) * limit;
  try {
    const cond  = action ? 'WHERE action = $3' : '';
    const args  = action ? [limit, offset, action] : [limit, offset];
    const cArgs = action ? [action] : [];
    const [{ rows }, { rows: cnt }] = await Promise.all([
      database.db.query(
        `SELECT id, action, username, ip, details, created_at FROM activity_log ${cond} ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
        args,
      ),
      database.db.query(`SELECT COUNT(*) FROM activity_log ${cond}`, cArgs),
    ]);
    const total = parseInt(cnt[0].count);
    res.json({ logs: rows, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/admin/logs
router.delete('/', requireAdmin, async (req, res) => {
  if (!database.dbReady) return res.json({ ok: true });
  try {
    await database.db.query('TRUNCATE activity_log RESTART IDENTITY');
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
