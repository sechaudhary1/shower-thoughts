const express = require('express');
const multer = require('multer');
const Groq = require('groq-sdk');
require('dotenv').config();

// Explicit startup check — helps debug Railway env var injection
console.log('=== STARTUP ENV CHECK ===');
console.log('DATABASE_URL:', process.env.DATABASE_URL ? process.env.DATABASE_URL.slice(0, 30) + '…' : 'NOT SET ❌');
console.log('GROQ_API_KEY:', process.env.GROQ_API_KEY ? 'SET ✓' : 'NOT SET ❌');
console.log('JWT_SECRET:',   process.env.JWT_SECRET   ? `"${process.env.JWT_SECRET.slice(0, 8)}…" (len=${process.env.JWT_SECRET.length})` : 'NOT SET ❌');
console.log('=========================');

const { Resend } = require('resend');
const { init: initDb } = require('./db');
const { requireAuth } = require('./middleware/auth');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
app.use(express.json());

// API routes before static so they take priority
app.use('/auth',       require('./routes/auth'));
app.use('/recordings', require('./routes/recordings'));
app.use('/admin/api',  require('./routes/admin'));

app.use(express.static('public'));

// Debug: print env vars on startup (values masked for secrets)
console.log('\n── Environment Variables ──');
for (const [key, val] of Object.entries(process.env).sort()) {
  const isSensitive = /key|secret|token|password|auth/i.test(key);
  console.log(`  ${key}=${isSensitive ? (val?.slice(0, 6) + '…[masked]') : val}`);
}
console.log('───────────────────────────\n');

let _groq;
function getGroq() {
  if (!_groq) {
    if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY environment variable is not set');
    _groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return _groq;
}

app.post('/transcribe', requireAuth, upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No audio file received' });

  try {
    const transcription = await getGroq().audio.transcriptions.create({
      file: new File([req.file.buffer], 'recording.webm', { type: 'audio/webm' }),
      model: 'whisper-large-v3-turbo',
      language: 'en',
    });
    res.json({ transcript: transcription.text });
  } catch (error) {
    console.error('Transcription error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/process', requireAuth, async (req, res) => {
  const { transcript, type } = req.body;
  if (!transcript) return res.status(400).json({ error: 'No transcript provided' });

  const isTask = type === 'tasks';

  const systemPrompt = isTask
    ? 'You extract actionable to-do items from voice memos. Ignore filler words and recording commands like "stop" or "delete". Always respond with valid JSON only, no markdown.'
    : 'You summarize spoken thoughts and ideas from voice memos. Ignore recording commands like "stop". Always respond with valid JSON only, no markdown.';

  const userPrompt = isTask
    ? `Extract clear, actionable to-do items from this transcript. Group related tasks if helpful.

Return this exact JSON shape:
{"summary": "one sentence overview", "tasks": ["task 1", "task 2", "..."]}

Transcript: ${transcript}`
    : `Summarize these spoken thoughts clearly and concisely.

Return this exact JSON shape:
{"summary": "2-3 sentence summary capturing the main ideas", "keyPoints": ["point 1", "point 2", "..."]}

Transcript: ${transcript}`;

  try {
    const completion = await getGroq().chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 1024,
      response_format: { type: 'json_object' },
    });

    const text = completion.choices[0].message.content.trim();
    const result = JSON.parse(text);
    res.json(result);

    // Send email non-blocking — don't fail the request if email fails
    sendResultEmail(req.user.email, req.user.name, type, transcript, result).catch(
      err => console.error('Email error:', err.message)
    );
  } catch (error) {
    console.error('Processing error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

function sendResultEmail(email, name, type, transcript, result) {
  if (!process.env.RESEND_API_KEY) return Promise.resolve();
  const resend = new Resend(process.env.RESEND_API_KEY);
  const isTask = type === 'tasks';
  const title = isTask ? 'Your Tasks Recording' : 'Your Thoughts Recording';
  const time = new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });

  const outputsHtml = isTask
    ? (result.tasks?.length
        ? `<ul style="margin:0;padding-left:20px;">${result.tasks.map(t => `<li style="margin-bottom:6px;">${t}</li>`).join('')}</ul>`
        : '')
    : (result.keyPoints?.length
        ? `<ul style="margin:0;padding-left:20px;">${result.keyPoints.map(p => `<li style="margin-bottom:6px;">${p}</li>`).join('')}</ul>`
        : '');

  const outputsLabel = isTask ? 'To-Do List' : 'Key Points';

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#1a1a2e;">
      <div style="background:#7c6af7;padding:24px 32px;border-radius:12px 12px 0 0;">
        <h1 style="margin:0;color:white;font-size:22px;">💭 ${title}</h1>
        <p style="margin:6px 0 0;color:rgba(255,255,255,0.8);font-size:14px;">${time}</p>
      </div>
      <div style="background:#f8f8ff;padding:28px 32px;border-radius:0 0 12px 12px;border:1px solid #e8e8f0;border-top:none;">
        <h2 style="margin:0 0 10px;font-size:15px;color:#7c6af7;text-transform:uppercase;letter-spacing:0.5px;">Summary</h2>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.6;">${result.summary || ''}</p>

        ${outputsHtml ? `
        <h2 style="margin:0 0 10px;font-size:15px;color:#7c6af7;text-transform:uppercase;letter-spacing:0.5px;">${outputsLabel}</h2>
        <div style="margin-bottom:24px;font-size:15px;line-height:1.6;">${outputsHtml}</div>
        ` : ''}

        <h2 style="margin:0 0 10px;font-size:15px;color:#7c6af7;text-transform:uppercase;letter-spacing:0.5px;">Transcript</h2>
        <p style="margin:0;font-size:14px;line-height:1.6;color:#555;background:#fff;padding:14px 16px;border-radius:8px;border:1px solid #e0e0ee;">${transcript}</p>
      </div>
    </div>
  `;

  return resend.emails.send({
    from: 'Shower Thoughts <onboarding@resend.dev>',
    to: email,
    subject: `💭 ${title} — ${time}`,
    html,
  });
}

const PORT = process.env.PORT || 3000;

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`\nShower Thoughts running at http://localhost:${PORT}\n`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err.message);
    process.exit(1);
  });
