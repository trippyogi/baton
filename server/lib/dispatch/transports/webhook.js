'use strict';

async function sendWebhook({ url, token, envelope, timeoutMs = 10000 }) {
  if (!url) return { ok: false, dispatch_status: 'not_configured', error: 'Webhook URL is not configured.' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(envelope),
      signal: controller.signal,
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_) {}
    if (!res.ok) {
      return { ok: false, dispatch_status: res.status >= 500 ? 'failed' : 'rejected', status: res.status, error: text || res.statusText };
    }
    if (json?.ok && ['accepted', 'running'].includes(String(json.status || 'accepted'))) {
      return { ok: true, dispatch_status: 'accepted', ack: json };
    }
    return { ok: false, dispatch_status: 'rejected', ack: json, error: json?.message || 'Webhook did not accept dispatch.' };
  } catch (err) {
    return { ok: false, dispatch_status: 'failed', error: err.name === 'AbortError' ? `Webhook timed out after ${timeoutMs}ms` : err.message };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { sendWebhook };
