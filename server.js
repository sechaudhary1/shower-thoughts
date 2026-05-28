const express = require('express');
const multer = require('multer');
const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
require('dotenv').config();

const app = express();
// Use memory storage so no disk writes are needed (works on any cloud host)
const upload = multer({ storage: multer.memoryStorage() });
app.use(express.json());
app.use(express.static('public'));

// Groq is used for Whisper transcription (free tier)
const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.post('/transcribe', upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No audio file received' });

  try {
    const { toFile } = require('openai');
    const audioFile = await toFile(
      req.file.buffer,
      'recording.webm',
      { type: 'audio/webm' }
    );
    const transcription = await groq.audio.transcriptions.create({
      file: audioFile,
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
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const text = message.content[0].text.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      res.json(JSON.parse(jsonMatch[0]));
    } else {
      res.json(isTask ? { summary: text, tasks: [] } : { summary: text, keyPoints: [] });
    }
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
