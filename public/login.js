let mode = 'login'; // 'login' | 'signup'

// ── Redirect if already logged in ────────────────────────────────────────────
if (localStorage.getItem('st_token')) {
  window.location.href = '/';
}

// ── Tab switching ─────────────────────────────────────────────────────────────
document.querySelectorAll('.auth-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    mode = tab.dataset.tab;
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.toggle('active', t === tab));
    document.getElementById('name-field').hidden = mode !== 'signup';
    document.getElementById('submit-btn').textContent = mode === 'signup' ? 'Create Account' : 'Sign In';
    document.getElementById('input-password').autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
    hideError();
  });
});

// ── Error display ─────────────────────────────────────────────────────────────
function showError(msg) {
  const el = document.getElementById('auth-error');
  el.textContent = msg;
  el.hidden = false;
}
function hideError() {
  document.getElementById('auth-error').hidden = true;
}

// ── Save token and redirect ───────────────────────────────────────────────────
function onAuth(data) {
  localStorage.setItem('st_token', data.token);
  localStorage.setItem('st_user', JSON.stringify(data.user));
  window.location.href = '/';
}

// ── Email/password form ───────────────────────────────────────────────────────
document.getElementById('auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  hideError();
  const btn = document.getElementById('submit-btn');
  btn.disabled = true;
  btn.textContent = '…';

  const body = {
    email:    document.getElementById('input-email').value.trim(),
    password: document.getElementById('input-password').value,
  };
  if (mode === 'signup') body.name = document.getElementById('input-name').value.trim();

  try {
    const res = await fetch(`/auth/${mode}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Something went wrong');
    onAuth(data);
  } catch (err) {
    showError(err.message);
    btn.disabled = false;
    btn.textContent = mode === 'signup' ? 'Create Account' : 'Sign In';
  }
});

// ── Google Sign-In ────────────────────────────────────────────────────────────
async function initGoogle() {
  try {
    const { googleClientId } = await fetch('/auth/config').then(r => r.json());
    if (!googleClientId) return;

    // Load Google GSI script
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });

    window.handleGoogleCredential = async ({ credential }) => {
      hideError();
      try {
        const res = await fetch('/auth/google', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credential }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Google sign-in failed');
        onAuth(data);
      } catch (err) {
        showError(err.message);
      }
    };

    google.accounts.id.initialize({
      client_id: googleClientId,
      callback: handleGoogleCredential,
    });
    google.accounts.id.renderButton(
      document.getElementById('google-btn-wrap'),
      { theme: 'filled_black', size: 'large', width: 320, text: 'continue_with' }
    );
  } catch {
    // Google login unavailable — silently skip
  }
}

initGoogle();
