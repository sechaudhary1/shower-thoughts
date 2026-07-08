// ── Auth guard ────────────────────────────────────────────────────────────────
const authToken = localStorage.getItem('st_token');
if (!authToken) {
  window.location.href = '/login.html';
  throw new Error('redirect'); // stop execution
}

const currentUser = JSON.parse(localStorage.getItem('st_user') || '{}');

// Show user info in header
if (currentUser.name) document.getElementById('user-name').textContent = currentUser.name;
if (currentUser.avatar_url) {
  const img = document.getElementById('user-avatar');
  img.src = currentUser.avatar_url;
  img.hidden = false;
}
document.getElementById('logout-btn').addEventListener('click', () => {
  localStorage.removeItem('st_token');
  localStorage.removeItem('st_user');
  window.location.href = '/login.html';
});

function authHeaders() {
  return { Authorization: `Bearer ${authToken}` };
}

// ── State ─────────────────────────────────────────────────────────────────────
const state = {
  recordings: [],        // { id, type, blobUrl, blob, timestamp, duration, transcript, processed }
  isRecording: false,
  recordingType: null,   // 'thoughts' | 'tasks'
  recordingStart: null,
  timerInterval: null,
  commandCooldown: false,
};

// ── DOM refs ──────────────────────────────────────────────────────────────────
const els = {
  listenStatus:    document.getElementById('listen-status'),
  listenLabel:     document.querySelector('#listen-status .label'),
  statusCard:      document.getElementById('status-card'),
  statusIcon:      document.getElementById('status-icon'),
  statusTitle:     document.getElementById('status-title'),
  statusSub:       document.getElementById('status-sub'),
  recordingTimer:  document.getElementById('recording-timer'),
  recordingsList:  document.getElementById('recordings-list'),
  countBadge:      document.getElementById('count-badge'),
  toast:           document.getElementById('toast'),
};

// ── Toast ─────────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg) {
  clearTimeout(toastTimer);
  els.toast.textContent = msg;
  els.toast.classList.add('show');
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2800);
}

// ── UI helpers ────────────────────────────────────────────────────────────────
function setListenStatus(mode) {
  // mode: 'listening' | 'recording' | 'inactive'
  els.listenStatus.className = `listen-badge ${mode === 'listening' ? 'active' : mode === 'recording' ? 'recording' : 'inactive'}`;
  els.listenLabel.textContent = mode === 'listening' ? 'Listening' : mode === 'recording' ? 'Recording' : 'Inactive';
}

function setStatusCard(icon, title, sub, mode = '') {
  els.statusCard.className = `status-card${mode ? ' ' + mode : ''}`;
  els.statusIcon.textContent = icon;
  els.statusTitle.textContent = title;
  els.statusSub.textContent = sub;
}

function startTimer() {
  els.recordingTimer.hidden = false;
  const update = () => {
    const secs = Math.floor((Date.now() - state.recordingStart) / 1000);
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    els.recordingTimer.textContent = `${m}:${s.toString().padStart(2, '0')}`;
  };
  update();
  state.timerInterval = setInterval(update, 500);
}

function stopTimer() {
  clearInterval(state.timerInterval);
  state.timerInterval = null;
  els.recordingTimer.hidden = true;
}

function updateCount() {
  els.countBadge.textContent = state.recordings.length;
}

// ── Voice Commander ───────────────────────────────────────────────────────────
class VoiceCommander {
  constructor(onCommand) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      showToast('⚠️ Voice commands need Chrome or Edge');
      setListenStatus('inactive');
      setStatusCard('🎙️', 'Voice commands unsupported', 'Use Chrome or Edge for voice control');
      return;
    }
    this.recognition = new SR();
    this.recognition.continuous = true;
    this.recognition.interimResults = false;
    this.recognition.lang = 'en-US';
    this.onCommand = onCommand;
    this._bind();
    this.start();
  }

  _bind() {
    this.recognition.onstart = () => {
      if (!state.isRecording) setListenStatus('listening');
      setStatusCard('🎙️', 'Listening for commands', 'Say "shower thoughts" or "shower tasks" to begin');
    };

    this.recognition.onresult = (e) => {
      const transcript = e.results[e.results.length - 1][0].transcript.trim().toLowerCase();
      console.log('[voice]', transcript);
      this._detect(transcript);
    };

    this.recognition.onend = () => {
      // Auto-restart unless manually stopped
      if (!this._stopped) setTimeout(() => this.start(), 300);
    };

    this.recognition.onerror = (e) => {
      if (e.error === 'not-allowed') {
        setListenStatus('inactive');
        setStatusCard('🚫', 'Microphone access denied', 'Allow mic access in your browser settings');
        return;
      }
      if (e.error !== 'no-speech') console.warn('[speech error]', e.error);
    };
  }

  _detect(transcript) {
    const isStart  = !this._cd_start && (
                       /\bshower thoughts?\b/i.test(transcript)
                    || /\b(record|start)\b.*(thoughts?|general|mind|idea)/i.test(transcript)
                    || transcript.includes('record thoughts')
                    || transcript.includes('start recording thoughts'));
    const isTask   = !this._cd_start && (
                       /\bshower tasks?\b/i.test(transcript)
                    || /\b(record|start)\b.*(task|todo|to-do|to do|list)/i.test(transcript)
                    || transcript.includes('record tasks')
                    || transcript.includes('start recording tasks'));
    // Stop uses a separate cooldown so the start cooldown can't block it
    const isStop   = !this._cd_stop && (
                       /\bstop recording\b/i.test(transcript)
                    || /^\s*stop\s*$/i.test(transcript)
                    || /\bstop now\b/i.test(transcript));
    const isDelete = !this._cd_start && /\b(delete|erase|discard|remove)\b/i.test(transcript);

    if (isStart && !state.isRecording) {
      this._cooldown('start');
      this.onCommand('start-thoughts');
    } else if (isTask && !state.isRecording) {
      this._cooldown('start');
      this.onCommand('start-tasks');
    } else if (isStop && state.isRecording) {
      this._cooldown('stop');
      this.onCommand('stop');
    } else if (isDelete && !state.isRecording) {
      this._cooldown('start');
      this.onCommand('delete');
    }
  }

  _cooldown(type) {
    this[`_cd_${type}`] = true;
    setTimeout(() => { this[`_cd_${type}`] = false; }, 2000);
  }

  start() {
    this._stopped = false;
    try { this.recognition.start(); } catch {}
  }

  stop() {
    this._stopped = true;
    try { this.recognition.stop(); } catch {}
  }
}

// ── Audio Recorder ────────────────────────────────────────────────────────────
class AudioRecorder {
  constructor() {
    this.mediaRecorder = null;
    this.chunks = [];
    this.stream = null;
  }

  async start() {
    this.chunks = [];
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.mediaRecorder = new MediaRecorder(this.stream, { mimeType: this._mimeType() });
    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.mediaRecorder.start(250);
  }

  stop() {
    return new Promise((resolve) => {
      this.mediaRecorder.onstop = () => {
        const mimeType = this._mimeType();
        const blob = new Blob(this.chunks, { type: mimeType });
        this.stream.getTracks().forEach(t => t.stop());
        resolve(blob);
      };
      this.mediaRecorder.stop();
    });
  }

  _mimeType() {
    for (const type of ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg', 'audio/mp4']) {
      if (MediaRecorder.isTypeSupported(type)) return type;
    }
    return 'audio/webm';
  }
}

// ── API calls ─────────────────────────────────────────────────────────────────
async function transcribeAudio(blob) {
  const form = new FormData();
  const ext = blob.type.includes('ogg') ? 'ogg' : blob.type.includes('mp4') ? 'mp4' : 'webm';
  form.append('audio', blob, `recording.${ext}`);
  const res = await fetch('/transcribe', { method: 'POST', headers: authHeaders(), body: form });
  if (!res.ok) throw new Error((await res.json()).error || 'Transcription failed');
  return (await res.json()).transcript;
}

async function processTranscript(transcript, type) {
  const res = await fetch('/process', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ transcript, type }),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Processing failed');
  return res.json();
}

async function saveRecording(data) {
  try {
    const res = await fetch('/recordings/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(data),
    });
    if (res.ok) return (await res.json()).id; // server-assigned UUID
  } catch { /* non-critical */ }
  return null;
}

async function deleteRecordingFromServer(id) {
  try {
    await fetch(`/recordings/${id}`, { method: 'DELETE', headers: authHeaders() });
  } catch { /* non-critical */ }
}

async function loadRecordings() {
  try {
    const res = await fetch('/recordings', { headers: authHeaders() });
    if (!res.ok) return;
    const rows = await res.json();
    // Map DB rows to the same shape the UI expects (no blob/blobUrl for persisted ones)
    rows.forEach(row => {
      state.recordings.push({
        id: row.id,
        type: row.type,
        blobUrl: null,
        duration: row.duration_ms,
        timestamp: new Date(row.created_at),
        processing: false,
        transcript: row.transcript,
        processed: row.result,
        persisted: true,
      });
    });
    renderRecordings();
  } catch (err) {
    console.error('Failed to load recordings:', err.message);
  }
}

async function logRecording(data) {
  try {
    await fetch('/recordings/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(data),
    });
  } catch { /* non-critical */ }
}

// ── Recording card rendering ──────────────────────────────────────────────────
function renderRecordings() {
  if (state.recordings.length === 0) {
    els.recordingsList.innerHTML = '<div class="empty-state">No recordings yet. Say <strong>"record thoughts"</strong> or <strong>"record tasks"</strong> to start.</div>';
    return;
  }
  els.recordingsList.innerHTML = '';
  // Show newest first, numbered oldest=1 to newest=N
  const total = state.recordings.length;
  [...state.recordings].reverse().forEach((rec, i) => {
    els.recordingsList.appendChild(buildCard(rec, total - i));
  });
  updateCount();
}

function buildCard(rec, num) {
  const card = document.createElement('div');
  card.className = `recording-card${rec.processing ? ' processing' : ''}`;
  card.id = `card-${rec.id}`;

  const label = rec.type === 'tasks' ? 'Tasks' : 'Thoughts';
  const ts = new Date(rec.timestamp);
  const date = ts.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  const time = ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dur = rec.duration ? formatDuration(rec.duration) : '';

  card.innerHTML = `
    <div class="card-header">
      <span class="card-number">#${num}</span>
      <span class="type-badge ${rec.type}">${label}</span>
      ${dur ? `<span class="card-duration">${dur}</span>` : ''}
      <span class="card-timestamp">${date} · ${time}</span>
      <button class="card-delete-btn" data-id="${rec.id}" title="Delete recording">✕</button>
    </div>
    ${rec.blobUrl ? `<div class="card-audio"><audio controls src="${rec.blobUrl}"></audio></div>` : ''}
    <div class="card-body">
      ${rec.processing
        ? `<div class="card-processing"><div class="spinner"></div> Transcribing &amp; processing…</div>`
        : buildCardBody(rec)}
    </div>
  `;

  card.querySelector('.card-delete-btn').addEventListener('click', () => deleteRecording(rec.id));
  return card;
}

function buildCardBody(rec) {
  if (!rec.transcript) return '';
  let html = `
    <div>
      <div class="section-label">Transcript</div>
      <div class="transcript-text">${escHtml(rec.transcript)}</div>
    </div>
  `;

  if (rec.processed) {
    if (rec.type === 'thoughts') {
      html += `
        <div>
          <div class="section-label">Summary</div>
          <div class="summary-text">${escHtml(rec.processed.summary || '')}</div>
        </div>
      `;
      if (rec.processed.keyPoints?.length) {
        html += `
          <div>
            <div class="section-label">Key Points</div>
            <ul class="key-points">
              ${rec.processed.keyPoints.map(p => `<li>${escHtml(p)}</li>`).join('')}
            </ul>
          </div>
        `;
      }
    } else {
      html += `
        <div>
          <div class="section-label">Overview</div>
          <div class="summary-text">${escHtml(rec.processed.summary || '')}</div>
        </div>
      `;
      if (rec.processed.tasks?.length) {
        html += `
          <div>
            <div class="section-label">To-Do List</div>
            <ul class="task-list">
              ${rec.processed.tasks.map((t, i) => `
                <li>
                  <input type="checkbox" class="task-checkbox" id="task-${rec.id}-${i}" />
                  <label class="task-label" for="task-${rec.id}-${i}">${escHtml(t)}</label>
                </li>`).join('')}
            </ul>
          </div>
        `;
      }
    }
  }
  return html;
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatDuration(ms) {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s/60)}m ${s%60}s`;
}

// ── Task checkbox persistence (in-card) ───────────────────────────────────────
document.addEventListener('change', (e) => {
  if (e.target.classList.contains('task-checkbox')) {
    const label = e.target.nextElementSibling;
    if (label) label.classList.toggle('done', e.target.checked);
  }
});

// ── Core actions ──────────────────────────────────────────────────────────────
const recorder = new AudioRecorder();

async function startRecording(type) {
  if (state.isRecording) return;
  try {
    await recorder.start();
    state.isRecording = true;
    state.recordingType = type;
    state.recordingStart = Date.now();
    setListenStatus('recording');
    setStatusCard(
      type === 'tasks' ? '📋' : '💭',
      type === 'tasks' ? 'Recording tasks…' : 'Recording thoughts…',
      'Say "stop recording" when you\'re done',
      'is-recording'
    );
    startTimer();
    showToast(`🔴 Recording ${type === 'tasks' ? 'tasks' : 'thoughts'}…`);
  } catch (err) {
    console.error(err);
    showToast('⚠️ Could not access microphone');
  }
}

async function stopRecording() {
  if (!state.isRecording) return;
  const duration = Date.now() - state.recordingStart;
  state.isRecording = false;
  stopTimer();

  setListenStatus('listening');
  setStatusCard('⏳', 'Processing…', 'Transcribing your recording', 'is-processing');

  const blob = await recorder.stop();
  const blobUrl = URL.createObjectURL(blob);
  const id = Date.now();

  const rec = {
    id,
    type: state.recordingType,
    blob,
    blobUrl,
    duration,
    timestamp: new Date(),
    processing: true,
    transcript: null,
    processed: null,
  };
  state.recordings.push(rec);
  renderRecordings();

  showToast('⚙️ Transcribing…');

  const processingStart = Date.now();
  let hadError = false;
  let errorMessage = null;
  let wordCount = 0;
  let numOutputs = 0;

  try {
    const transcript = await transcribeAudio(blob);
    rec.transcript = transcript;
    wordCount = transcript.trim().split(/\s+/).filter(Boolean).length;
    const processed = await processTranscript(transcript, rec.type);
    rec.processed = processed;
    numOutputs = processed.tasks?.length ?? processed.keyPoints?.length ?? 0;
  } catch (err) {
    console.error(err);
    rec.transcript = '⚠️ Processing failed: ' + err.message;
    hadError = true;
    errorMessage = err.message;
  }

  const processingTime = Date.now() - processingStart;

  // Save to DB and swap the temp id for the server UUID
  if (!hadError) {
    const serverId = await saveRecording({
      type: rec.type,
      duration_ms: duration,
      transcript: rec.transcript,
      result: rec.processed,
    });
    if (serverId) rec.id = serverId;
    rec.persisted = true;
  }

  logRecording({
    type: rec.type,
    duration_ms: duration,
    transcript_word_count: wordCount || null,
    num_outputs: numOutputs || null,
    processing_time_ms: processingTime,
    had_error: hadError,
    error_message: errorMessage,
  });

  rec.processing = false;
  renderRecordings();
  showToast('✅ Done! Recording processed.');
  setStatusCard('🎙️', 'Listening for commands', 'Say "shower thoughts" or "shower tasks" to begin');
}

function deleteRecording(id) {
  const idx = state.recordings.findIndex(r => r.id === id);
  if (idx === -1) return;
  const rec = state.recordings[idx];
  if (rec.blobUrl) URL.revokeObjectURL(rec.blobUrl);
  if (rec.persisted) deleteRecordingFromServer(id);
  state.recordings.splice(idx, 1);
  renderRecordings();
  updateCount();
  showToast('🗑️ Recording deleted');
}

function deleteLastRecording() {
  if (state.recordings.length === 0) {
    showToast('Nothing to delete');
    return;
  }
  deleteRecording(state.recordings[state.recordings.length - 1].id);
}

// ── Command handler ───────────────────────────────────────────────────────────
function handleCommand(cmd) {
  console.log('[cmd]', cmd);
  switch (cmd) {
    case 'start-thoughts': startRecording('thoughts'); break;
    case 'start-tasks':    startRecording('tasks');    break;
    case 'stop':           stopRecording();            break;
    case 'delete':         deleteLastRecording();      break;
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
updateCount();
loadRecordings();
const commander = new VoiceCommander(handleCommand);
