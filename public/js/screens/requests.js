// requests.js — Shared Requests screen (Jeremy ↔ Marko)

const TOKEN_KEY = 'shared_requests_token';

function getToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

function setToken(tok) {
  localStorage.setItem(TOKEN_KEY, tok.trim());
}

async function apiReq(method, path, body = null) {
  const tok = getToken();
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(path, opts);
  if (r.status === 204) return null;
  const json = await r.json();
  if (!r.ok) throw new Error(json.error || `HTTP ${r.status}`);
  return json;
}

function fmt(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function statusBadge(status) {
  const map = {
    pending:   { bg: '#fbbf24', text: '#1a1200' },
    done:      { bg: 'var(--color-lime)', text: '#0a1a0a' },
    dismissed: { bg: '#444466', text: '#ccc' },
  };
  const s = map[status] || { bg: '#9898AC', text: '#fff' };
  return `<span style="font-size:10px;font-weight:600;padding:2px 8px;border-radius:999px;background:${s.bg};color:${s.text};text-transform:uppercase">${status}</span>`;
}

function requestCard(req, isInbox) {
  const artifactLink = req.artifact_url
    ? `<a href="${req.artifact_url}" target="_blank" style="color:var(--accent);font-size:12px;word-break:break-all">${req.artifact_url}</a>`
    : '';
  const actions = isInbox && req.status === 'pending'
    ? `<div style="margin-top:10px;display:flex;gap:8px">
         <button class="btn-action btn-done" data-id="${req.id}" style="font-size:11px;padding:4px 12px;border-radius:6px;border:none;background:var(--color-lime);color:#0a1a0a;cursor:pointer;font-weight:600">✓ Mark Done</button>
         <button class="btn-action btn-dismiss" data-id="${req.id}" style="font-size:11px;padding:4px 12px;border-radius:6px;border:1px solid #444;background:transparent;color:#aaa;cursor:pointer">Dismiss</button>
       </div>`
    : '';
  return `
    <div class="req-card" data-id="${req.id}" style="border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:10px;background:var(--card-bg)">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
        <p style="margin:0;font-size:14px;line-height:1.5;flex:1">${req.request}</p>
        ${statusBadge(req.status)}
      </div>
      ${artifactLink ? `<div style="margin-top:6px">${artifactLink}</div>` : ''}
      <div style="margin-top:8px;font-size:11px;color:var(--muted)">
        ${isInbox ? `From <strong>Marko</strong>` : `To <strong>Marko</strong>`} · ${fmt(req.created_at)}
        ${req.updated_at !== req.created_at ? ` · updated ${fmt(req.updated_at)}` : ''}
      </div>
      ${actions}
    </div>`;
}

function newRequestForm() {
  return `
    <div id="new-req-form" style="display:none;border:1px solid var(--accent);border-radius:10px;padding:16px;margin-bottom:16px;background:var(--card-bg)">
      <div style="font-size:13px;font-weight:600;margin-bottom:10px;color:var(--accent)">New Request → Marko</div>
      <textarea id="req-text" placeholder="Describe the request…" rows="3"
        style="width:100%;box-sizing:border-box;padding:8px;border-radius:6px;border:1px solid var(--border);background:var(--input-bg,#1a1a2e);color:var(--text);font-size:13px;resize:vertical;font-family:inherit"></textarea>
      <input id="req-url" type="url" placeholder="Artifact URL (optional)"
        style="width:100%;box-sizing:border-box;padding:8px;border-radius:6px;border:1px solid var(--border);background:var(--input-bg,#1a1a2e);color:var(--text);font-size:13px;margin-top:6px"/>
      <div style="display:flex;gap:8px;margin-top:10px">
        <button id="btn-submit-req" style="padding:6px 16px;border-radius:6px;border:none;background:var(--accent);color:#fff;font-weight:600;cursor:pointer;font-size:13px">Send</button>
        <button id="btn-cancel-req" style="padding:6px 16px;border-radius:6px;border:1px solid #444;background:transparent;color:#aaa;cursor:pointer;font-size:13px">Cancel</button>
      </div>
      <p id="req-err" style="color:var(--color-red);font-size:12px;margin:6px 0 0"></p>
    </div>`;
}

function tokenSetupBanner() {
  return `
    <div style="border:1px solid #fbbf24;border-radius:10px;padding:16px;margin-bottom:16px;background:rgba(251,191,36,0.07)">
      <div style="font-size:13px;font-weight:600;color:#fbbf24;margin-bottom:8px">⚠ Token not configured</div>
      <p style="margin:0 0 10px;font-size:13px;color:var(--muted)">Enter the SHARED_REQUESTS_TOKEN to authenticate API calls:</p>
      <input id="token-input" type="text" placeholder="Paste token here…"
        style="width:100%;box-sizing:border-box;padding:8px;border-radius:6px;border:1px solid #444;background:#1a1a2e;color:#fff;font-size:13px"/>
      <button id="btn-save-token" style="margin-top:8px;padding:6px 16px;border-radius:6px;border:none;background:#fbbf24;color:#1a1200;font-weight:600;cursor:pointer;font-size:13px">Save Token</button>
    </div>`;
}

export async function renderRequests() {
  const el = document.getElementById('screen-requests');
  const tok = getToken();

  if (!tok) {
    el.innerHTML = `
      <div class="screen-header">
        <div class="screen-title">Shared Requests</div>
        <div class="screen-subtitle">Jeremy ↔ Marko async task queue</div>
      </div>
      ${tokenSetupBanner()}`;

    document.getElementById('btn-save-token').onclick = () => {
      const val = document.getElementById('token-input').value.trim();
      if (val) { setToken(val); renderRequests(); }
    };
    return;
  }

  el.innerHTML = `<div class="loading">Loading requests…</div>`;

  try {
    const [inbox, outbox] = await Promise.all([
      apiReq('GET', '/api/shared-requests?to=jeremy'),
      apiReq('GET', '/api/shared-requests?from=jeremy'),
    ]);

    el.innerHTML = `
      <div class="screen-header">
        <div class="screen-title">Shared Requests</div>
        <div class="screen-subtitle">Jeremy ↔ Marko async task queue</div>
        <div style="display:flex;gap:8px;margin-top:12px">
          <button id="btn-new-req" style="padding:6px 14px;border-radius:6px;border:none;background:var(--accent);color:#fff;font-weight:600;cursor:pointer;font-size:13px">+ New Request</button>
          <button id="btn-reset-token" style="padding:6px 14px;border-radius:6px;border:1px solid #444;background:transparent;color:#aaa;cursor:pointer;font-size:12px">Reset Token</button>
        </div>
      </div>

      ${newRequestForm()}

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--gap)">
        <!-- Inbox -->
        <div class="card">
          <div class="card-header">
            <span class="card-title">📥 Inbox</span>
            <span style="font-size:11px;color:var(--muted)">${inbox.filter(r => r.status === 'pending').length} pending</span>
          </div>
          <div id="inbox-list">
            ${inbox.length === 0
              ? '<p style="color:var(--muted);font-size:13px;padding:8px 0">No requests from Marko yet.</p>'
              : inbox.map(r => requestCard(r, true)).join('')}
          </div>
        </div>

        <!-- Outbox -->
        <div class="card">
          <div class="card-header">
            <span class="card-title">📤 Outbox</span>
            <span style="font-size:11px;color:var(--muted)">${outbox.length} sent</span>
          </div>
          <div id="outbox-list">
            ${outbox.length === 0
              ? '<p style="color:var(--muted);font-size:13px;padding:8px 0">No outgoing requests yet.</p>'
              : outbox.map(r => requestCard(r, false)).join('')}
          </div>
        </div>
      </div>`;

    // Wire new request toggle
    const form = document.getElementById('new-req-form');
    document.getElementById('btn-new-req').onclick = () => {
      form.style.display = form.style.display === 'none' ? 'block' : 'none';
    };
    document.getElementById('btn-cancel-req').onclick = () => {
      form.style.display = 'none';
    };
    document.getElementById('btn-reset-token').onclick = () => {
      localStorage.removeItem(TOKEN_KEY);
      renderRequests();
    };

    // Submit new request
    document.getElementById('btn-submit-req').onclick = async () => {
      const text = document.getElementById('req-text').value.trim();
      const url  = document.getElementById('req-url').value.trim() || null;
      const errEl = document.getElementById('req-err');
      if (!text) { errEl.textContent = 'Request text is required.'; return; }
      errEl.textContent = '';
      try {
        await apiReq('POST', '/api/shared-requests', { from: 'jeremy', to: 'marko', request: text, artifact_url: url });
        form.style.display = 'none';
        document.getElementById('req-text').value = '';
        document.getElementById('req-url').value = '';
        renderRequests(); // reload
      } catch (e) {
        errEl.textContent = e.message;
      }
    };

    // Wire mark-done / dismiss buttons
    document.querySelectorAll('.btn-done').forEach(btn => {
      btn.onclick = async () => {
        const id = btn.dataset.id;
        try {
          await apiReq('PATCH', `/api/shared-requests/${id}`, { status: 'done' });
          renderRequests();
        } catch (e) { alert('Error: ' + e.message); }
      };
    });
    document.querySelectorAll('.btn-dismiss').forEach(btn => {
      btn.onclick = async () => {
        const id = btn.dataset.id;
        try {
          await apiReq('PATCH', `/api/shared-requests/${id}`, { status: 'dismissed' });
          renderRequests();
        } catch (e) { alert('Error: ' + e.message); }
      };
    });

  } catch (err) {
    el.innerHTML = `
      <div class="screen-header">
        <div class="screen-title">Shared Requests</div>
        <div class="screen-subtitle">Jeremy ↔ Marko async task queue</div>
      </div>
      <div style="color:var(--color-red);padding:16px">Error: ${err.message}</div>
      <button id="btn-reset-token-err" style="margin:8px 16px;padding:6px 14px;border-radius:6px;border:1px solid #444;background:transparent;color:#aaa;cursor:pointer;font-size:12px">Reset Token</button>`;
    const rb = document.getElementById('btn-reset-token-err');
    if (rb) rb.onclick = () => { localStorage.removeItem(TOKEN_KEY); renderRequests(); };
  }
}
