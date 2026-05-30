let adminPassword = sessionStorage.getItem('admin_password');

function show(id) { document.getElementById(id).hidden = false; }
function hide(id) { document.getElementById(id).hidden = true; }
function set(id, val) { document.getElementById(id).textContent = val ?? '–'; }

// ── Admin login ───────────────────────────────────────────────────────────────
document.getElementById('admin-login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = document.getElementById('admin-password-input').value;
  const errEl = document.getElementById('admin-login-error');
  errEl.hidden = true;

  try {
    // Verify password works before storing it
    const res = await fetch('/admin/api/stats', {
      headers: { 'x-admin-password': password },
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Invalid password');
    }
    adminPassword = password;
    sessionStorage.setItem('admin_password', adminPassword);
    showDashboard();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  }
});

document.getElementById('admin-logout').addEventListener('click', () => {
  sessionStorage.removeItem('admin_password');
  adminPassword = null;
  hide('dashboard');
  show('admin-login-wrap');
});

// ── Load dashboard ────────────────────────────────────────────────────────────
async function showDashboard() {
  hide('admin-login-wrap');
  show('dashboard');

  try {
    const res = await fetch('/admin/api/stats', {
      headers: { 'x-admin-password': adminPassword },
    });
    const data = await res.json();
    if (!res.ok) {
      // Show error inside dashboard rather than silently bouncing back
      document.querySelector('#stat-grid').innerHTML =
        `<div style="color:var(--red);padding:20px;grid-column:1/-1">
           Stats failed (${res.status}): ${data.error || 'Unknown error'}
         </div>`;
      return;
    }
    const { overview, byType, daily, users } = data;
    renderOverview(overview);
    renderByType(byType);
    renderDaily(daily);
    renderUsers(users);
  } catch (err) {
    document.querySelector('#stat-grid').innerHTML =
      `<div style="color:var(--red);padding:20px;grid-column:1/-1">Error: ${err.message}</div>`;
  }
}

function renderOverview(o) {
  set('s-total-users', o.total_users);
  set('s-new-users',   o.new_users_7d);
  set('s-active-users', o.active_users_7d);
  set('s-total-recs',  o.total_recordings);
  set('s-recs-today',  o.recordings_today);
  set('s-avg-dur',     o.avg_duration_secs);
  set('s-avg-words',   o.avg_word_count);
  set('s-avg-outputs', o.avg_outputs);
  set('s-error-rate',  o.error_rate_pct != null ? o.error_rate_pct + '%' : '0%');
  set('s-avg-proc',    o.avg_processing_ms);
}

function renderByType(rows) {
  const el = document.getElementById('type-breakdown');
  if (!rows.length) { el.innerHTML = '<p class="empty-note">No recordings yet</p>'; return; }
  el.innerHTML = rows.map(r => `
    <div class="type-stat-card">
      <span class="type-badge ${r.type}">${r.type === 'tasks' ? 'Tasks' : 'Thoughts'}</span>
      <div class="type-stats">
        <span><strong>${r.count}</strong> recordings</span>
        <span><strong>${r.avg_duration_secs ?? '–'}s</strong> avg duration</span>
        <span><strong>${r.avg_words ?? '–'}</strong> avg words</span>
        <span><strong>${r.avg_outputs ?? '–'}</strong> avg outputs</span>
        <span><strong>${r.avg_processing_ms ?? '–'}ms</strong> avg processing</span>
      </div>
    </div>
  `).join('');
}

function renderDaily(rows) {
  const el = document.getElementById('daily-chart');
  if (!rows.length) { el.innerHTML = '<p class="empty-note">No activity yet</p>'; return; }

  const maxRec = Math.max(...rows.map(r => Number(r.recordings)), 1);
  el.innerHTML = rows.map(r => {
    const pct = Math.max(4, Math.round((Number(r.recordings) / maxRec) * 100));
    const date = new Date(r.date).toLocaleDateString([], { month: 'short', day: 'numeric' });
    return `
      <div class="bar-col">
        <div class="bar-value">${r.recordings}</div>
        <div class="bar" style="height:${pct}%"></div>
        <div class="bar-label">${date}</div>
        <div class="bar-sub">${r.unique_users}u</div>
      </div>`;
  }).join('');
}

function renderUsers(rows) {
  set('user-count-badge', rows.length);
  const tbody = document.getElementById('users-tbody');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-note">No users yet</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(u => `
    <tr>
      <td>
        <div class="user-cell">
          <strong>${esc(u.name || '–')}</strong>
          <small>${esc(u.email)}</small>
        </div>
      </td>
      <td>${fmtDate(u.created_at)}</td>
      <td>${fmtDate(u.last_active_at)}</td>
      <td>${u.total_recordings}</td>
      <td>${u.thought_recordings ?? 0} / ${u.task_recordings ?? 0}</td>
      <td>${u.avg_duration_secs ?? '–'}</td>
      <td>${u.avg_word_count ?? '–'}</td>
      <td>${u.avg_outputs ?? '–'}</td>
      <td>${u.error_rate_pct != null ? u.error_rate_pct + '%' : '0%'}</td>
    </tr>
  `).join('');
}

function fmtDate(ts) {
  if (!ts) return '–';
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric', year: '2-digit' });
}
function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// Auto-show dashboard if token already in session
if (adminPassword) showDashboard();
