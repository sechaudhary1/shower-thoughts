const express = require('express');
const { getPool } = require('../db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAdmin);

router.get('/stats', async (req, res) => {
  try {
    const db = getPool();
    const [overview, byType, daily, users] = await Promise.all([
      db.query(`
        SELECT
          (SELECT COUNT(*)                                           FROM users)                                          AS total_users,
          (SELECT COUNT(*) FROM users WHERE created_at > NOW() - INTERVAL '7 days')                                     AS new_users_7d,
          (SELECT COUNT(*) FROM users WHERE last_active_at > NOW() - INTERVAL '7 days')                                 AS active_users_7d,
          (SELECT COUNT(*)                                           FROM recording_logs)                                AS total_recordings,
          (SELECT COUNT(*) FROM recording_logs WHERE created_at > NOW() - INTERVAL '24 hours')                          AS recordings_today,
          (SELECT ROUND(AVG(duration_ms)::NUMERIC / 1000, 1)        FROM recording_logs WHERE NOT had_error)            AS avg_duration_secs,
          (SELECT ROUND(AVG(transcript_word_count)::NUMERIC)        FROM recording_logs WHERE NOT had_error)            AS avg_word_count,
          (SELECT ROUND(AVG(processing_time_ms)::NUMERIC)           FROM recording_logs WHERE NOT had_error)            AS avg_processing_ms,
          (SELECT ROUND(AVG(num_outputs)::NUMERIC, 1)               FROM recording_logs WHERE NOT had_error)            AS avg_outputs,
          (SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE had_error) / NULLIF(COUNT(*),0), 1) FROM recording_logs)         AS error_rate_pct
      `),
      db.query(`
        SELECT
          type,
          COUNT(*)                                                AS count,
          ROUND(AVG(duration_ms)::NUMERIC / 1000, 1)             AS avg_duration_secs,
          ROUND(AVG(transcript_word_count)::NUMERIC)             AS avg_words,
          ROUND(AVG(num_outputs)::NUMERIC, 1)                    AS avg_outputs,
          ROUND(AVG(processing_time_ms)::NUMERIC)                AS avg_processing_ms
        FROM recording_logs WHERE NOT had_error
        GROUP BY type
      `),
      db.query(`
        SELECT
          DATE(created_at AT TIME ZONE 'UTC') AS date,
          COUNT(*)                            AS recordings,
          COUNT(DISTINCT user_id)             AS unique_users
        FROM recording_logs
        WHERE created_at > NOW() - INTERVAL '14 days'
        GROUP BY DATE(created_at AT TIME ZONE 'UTC')
        ORDER BY date
      `),
      db.query(`
        SELECT
          u.email,
          u.name,
          u.created_at,
          u.last_active_at,
          COUNT(r.id)                                                                       AS total_recordings,
          ROUND(AVG(r.duration_ms)::NUMERIC / 1000, 1)                                     AS avg_duration_secs,
          ROUND(AVG(r.transcript_word_count)::NUMERIC)                                     AS avg_word_count,
          ROUND(AVG(r.num_outputs)::NUMERIC, 1)                                            AS avg_outputs,
          ROUND(100.0 * COUNT(*) FILTER (WHERE r.had_error) / NULLIF(COUNT(r.id),0), 1)   AS error_rate_pct,
          COUNT(*) FILTER (WHERE r.type = 'thoughts')                                      AS thought_recordings,
          COUNT(*) FILTER (WHERE r.type = 'tasks')                                         AS task_recordings
        FROM users u
        LEFT JOIN recording_logs r ON r.user_id = u.id
        GROUP BY u.id, u.email, u.name, u.created_at, u.last_active_at
        ORDER BY total_recordings DESC, u.created_at DESC
        LIMIT 100
      `),
    ]);

    res.json({
      overview: overview.rows[0],
      byType: byType.rows,
      daily: daily.rows,
      users: users.rows,
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
