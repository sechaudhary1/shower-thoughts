const express = require('express');
const { getPool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.post('/log', async (req, res) => {
  const { type, duration_ms, transcript_word_count, num_outputs, processing_time_ms, had_error, error_message } = req.body;
  if (!type) return res.status(400).json({ error: 'type is required' });

  try {
    await getPool().query(
      `INSERT INTO recording_logs
         (user_id, type, duration_ms, transcript_word_count, num_outputs, processing_time_ms, had_error, error_message)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [req.user.id, type, duration_ms ?? null, transcript_word_count ?? null,
       num_outputs ?? null, processing_time_ms ?? null, had_error ?? false, error_message ?? null]
    );
    await getPool().query('UPDATE users SET last_active_at = NOW() WHERE id = $1', [req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Log error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
