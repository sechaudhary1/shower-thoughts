const express = require('express');
const multer = require('multer');
const Groq = require('groq-sdk');
require('dotenv').config();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
app.use(express.json());
app.use(express.static('public'));

let _groq;
function getGroq() {
  if (!_groq) {
    if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY environment variable is not set');
    _groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return _groq;
}

// Debug: print all env vars on startup (values masked for secrets)
console.log('\n── Environment Variables ──');
for (const [key, val] of Object.entries(process.env).sort()) {
  const isSensitive = /key|secret|token|password|auth/i.test(key);
  console.log(`  ${key}=${isSensitive ? val?.slice(0, 6) + '…[masked]' : val}`);
}
console.log('───────────────────────────\n');

app.post('/transcribe', upload.single('audio'), async (req, res) => {
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

app.post('/process', async (req, res) => {
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
    res.json(JSON.parse(text));
  } catch (error) {
    console.error('Processing error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\nShower Thoughts running at http://localhost:${PORT}`);
  console.log('Open that URL in Chrome for voice command support.\n');
});
