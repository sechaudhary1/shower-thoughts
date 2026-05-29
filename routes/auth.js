const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const { getPool } = require('../db');

const router = express.Router();

function makeToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name, avatar: user.avatar_url },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );
}

// Public config for the frontend (Google Client ID is not secret)
router.get('/config', (req, res) => {
  res.json({ googleClientId: process.env.GOOGLE_CLIENT_ID || null });
});

router.post('/signup', async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  try {
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await getPool().query(
      'INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id, email, name, avatar_url',
      [email.toLowerCase().trim(), name || email.split('@')[0], hash]
    );
    res.json({ token: makeToken(rows[0]), user: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already registered' });
    console.error('Signup error:', err.message);
    res.status(500).json({ error: err.message }); // return real error for debugging
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  try {
    const { rows } = await getPool().query(
      'SELECT * FROM users WHERE email = $1',
      [email.toLowerCase().trim()]
    );
    const user = rows[0];
    if (!user || !user.password_hash) return res.status(401).json({ error: 'Invalid email or password' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

    await getPool().query('UPDATE users SET last_active_at = NOW() WHERE id = $1', [user.id]);
    res.json({ token: makeToken(user), user: { id: user.id, email: user.email, name: user.name, avatar_url: user.avatar_url } });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/google', async (req, res) => {
  const { credential } = req.body;
  if (!credential) return res.status(400).json({ error: 'No credential provided' });
  if (!process.env.GOOGLE_CLIENT_ID) return res.status(500).json({ error: 'Google login not configured' });

  try {
    const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
    const ticket = await client.verifyIdToken({ idToken: credential, audience: process.env.GOOGLE_CLIENT_ID });
    const { sub: googleId, email, name, picture } = ticket.getPayload();

    const { rows } = await getPool().query(`
      INSERT INTO users (email, name, google_id, avatar_url)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (email) DO UPDATE SET
        google_id    = COALESCE(users.google_id, EXCLUDED.google_id),
        name         = COALESCE(users.name, EXCLUDED.name),
        avatar_url   = COALESCE(users.avatar_url, EXCLUDED.avatar_url),
        last_active_at = NOW()
      RETURNING id, email, name, avatar_url
    `, [email, name, googleId, picture]);

    res.json({ token: makeToken(rows[0]), user: rows[0] });
  } catch (err) {
    console.error('Google auth error:', err.message);
    res.status(401).json({ error: 'Google authentication failed' });
  }
});

router.post('/admin-login', (req, res) => {
  const { password } = req.body;
  if (!process.env.ADMIN_PASSWORD || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid admin password' });
  }
  const token = jwt.sign({ role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '8h' });
  res.json({ token });
});

module.exports = router;
