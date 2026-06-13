export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  }[ch]));
}

export function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

export function safeUrl(value) {
  const raw = String(value || '').trim();
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) return '#';
    return url.href;
  } catch (_) {
    return '#';
  }
}
