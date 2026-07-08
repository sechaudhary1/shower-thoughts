const express = require('express');
const { getPool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// Save a completed recording
router.post('/save', async (req, res) => {
  const { type, duration_ms, transcript, result } = req.body;
  if (!type || !transcript) return res.status(400).json({ error: 'type and transcript are required' });

  try {
    const { rows } = await getPool().query(
      `INSERT INTO recordings (user_id, type, duration_ms, transcript, result)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, type, duration_ms, transcript, result, created_at`,
      [req.user.id, type, duration_ms ?? null, transcript, result ?? null]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('Save error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Fetch all recordings for the current user
router.get('/', async (req, res) => {
  try {
    const { rows } = await getPool().query(
      `SELECT id, type, duration_ms, transcript, result, created_at
       FROM recordings
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('Fetch error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Delete a recording
router.delete('/:id', async (req, res) => {
  try {
    await getPool().query(
      `DELETE FROM recordings WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Log analytics metadata
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
