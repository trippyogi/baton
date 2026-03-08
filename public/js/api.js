// api.js — fetch wrapper + SSE helper

const BASE = '';

export async function get(path) {
  const r = await fetch(BASE + path);
  if (!r.ok) throw new Error(`GET ${path} → ${r.status}`);
  return r.json();
}

export async function post(path, body) {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`POST ${path} → ${r.status}`);
  return r.json();
}

export async function patch(path, body) {
  const r = await fetch(BASE + path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`PATCH ${path} → ${r.status}`);
  return r.json();
}

export async function del(path) {
  const r = await fetch(BASE + path, { method: 'DELETE' });
  if (!r.ok) throw new Error(`DELETE ${path} → ${r.status}`);
  return r.json();
}

// SSE helper with auto-reconnect
export function createSSE(path, handlers = {}) {
  let es;
  let retryMs = 1000;

  function connect() {
    es = new EventSource(path);
    es.onopen = () => { retryMs = 1000; };
    es.onerror = () => {
      es.close();
      setTimeout(connect, retryMs);
      retryMs = Math.min(retryMs * 2, 30000);
    };
    for (const [event, fn] of Object.entries(handlers)) {
      es.addEventListener(event, (e) => fn(JSON.parse(e.data)));
    }
    es.onmessage = (e) => {
      if (handlers.message) handlers.message(JSON.parse(e.data));
    };
  }

  connect();
  return { close: () => es && es.close() };
}

// Time formatting (legacy — seconds precision)
export function timeAgo(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60)  return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  return `${Math.floor(h/24)}d ago`;
}

// Human-readable time: "just now / 4m ago / 3h ago / Yesterday / 2d ago"
export function humanTime(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 45)  return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  if (h < 48)  return 'Yesterday';
  return `${Math.floor(h / 24)}d ago`;
}

export function fmtCost(n) {
  if (n == null) return '—';
  return n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`;
}

export function fmtTokens(n) {
  if (n == null) return '—';
  return n >= 1000 ? `${(n/1000).toFixed(1)}k` : `${n}`;
}
