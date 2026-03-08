import { get } from '../api.js';

export async function renderMemory() {
  const el = document.getElementById('screen-memory');
  el.innerHTML = `<div class="loading">Loading memory…</div>`;

  try {
    const d = await get('/api/memory');

    el.innerHTML = `
<div class="canvas-inner">

  <div class="screen-header" style="padding-top:8px;margin-bottom:24px">
    <div class="screen-title" style="font-size:28px;font-weight:600;letter-spacing:-0.02em">Memory</div>
    <div class="screen-subtitle" style="margin-top:8px">Long-term context and session notes</div>
  </div>

  ${d.daily ? `
  <!-- Daily session note -->
  <div class="card" style="margin-bottom:24px;border-color:color-mix(in srgb,var(--color-teal) 25%,var(--border))">
    <div class="card-header">
      <span class="card-title">Session Notes</span>
      <span style="font-size:11px;color:var(--text-secondary)">${d.dailyDate}</span>
    </div>
    <div class="memory-prose">${mdToHtml(d.daily)}</div>
  </div>` : ''}

  <!-- Core long-term memory -->
  ${d.core ? `
  <div class="card">
    <div class="card-header">
      <span class="card-title">Long-Term Memory</span>
      <span style="font-size:11px;color:var(--text-secondary)">MEMORY.md</span>
    </div>
    <div class="memory-prose">${mdToHtml(d.core)}</div>
  </div>` : `
  <div class="card">
    <div class="empty-state"><span class="empty-state-icon">◈</span>No memory files found</div>
  </div>`}

</div>`;

  } catch (err) {
    el.innerHTML = `<div class="canvas-inner">
      <div class="screen-header" style="padding-top:8px;margin-bottom:24px">
        <div class="screen-title" style="font-size:28px;font-weight:600">Memory</div>
      </div>
      <div class="card" style="border-color:var(--color-red)">
        <div style="color:var(--color-red);font-weight:600;margin-bottom:8px">Error loading memory</div>
        <div style="font-size:13px;color:var(--text-secondary)">${err.message}</div>
      </div>
    </div>`;
  }
}

// ── Minimal markdown → HTML ───────────────────────────
// Handles: headings, bold, italic, code, tables, lists, hr, paragraphs

function mdToHtml(md) {
  const lines = md.split('\n');
  const out   = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Heading
    const hm = line.match(/^(#{1,6})\s+(.*)/);
    if (hm) {
      const level = hm[1].length;
      out.push(`<h${level} class="md-h${level}">${inline(hm[2])}</h${level}>`);
      i++; continue;
    }

    // HR
    if (/^[-*_]{3,}\s*$/.test(line)) {
      out.push('<hr class="md-hr">');
      i++; continue;
    }

    // Table (detect by | ... |)
    if (line.includes('|') && lines[i + 1] && /^\|?[-:| ]+\|?$/.test(lines[i + 1])) {
      const headers = parseTableRow(line);
      i += 2; // skip separator
      const rows = [];
      while (i < lines.length && lines[i].includes('|')) {
        rows.push(parseTableRow(lines[i]));
        i++;
      }
      out.push(`<div class="table-wrap"><table>
        <thead><tr>${headers.map(h => `<th>${inline(h)}</th>`).join('')}</tr></thead>
        <tbody>${rows.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>`);
      continue;
    }

    // Unordered list
    if (/^[-*+]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*+]\s+/.test(lines[i])) {
        items.push(`<li>${inline(lines[i].replace(/^[-*+]\s+/, ''))}</li>`);
        i++;
      }
      out.push(`<ul class="md-ul">${items.join('')}</ul>`);
      continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(`<li>${inline(lines[i].replace(/^\d+\.\s+/, ''))}</li>`);
        i++;
      }
      out.push(`<ol class="md-ol">${items.join('')}</ol>`);
      continue;
    }

    // Code block
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const code = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        code.push(esc(lines[i]));
        i++;
      }
      out.push(`<pre class="md-pre"><code>${code.join('\n')}</code></pre>`);
      i++; continue;
    }

    // Blank line → paragraph break
    if (line.trim() === '') {
      i++; continue;
    }

    // Paragraph — collect consecutive non-special lines
    const para = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].match(/^#{1,6}\s/) &&
      !lines[i].match(/^[-*+]\s/) &&
      !lines[i].match(/^\d+\.\s/) &&
      !lines[i].startsWith('```') &&
      !lines[i].includes('|') &&
      !/^[-*_]{3,}\s*$/.test(lines[i])
    ) {
      para.push(inline(lines[i]));
      i++;
    }
    if (para.length) out.push(`<p class="md-p">${para.join('<br>')}</p>`);
  }

  return out.join('\n');
}

function inline(s) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,     '<em>$1</em>')
    .replace(/`(.+?)`/g,       '<code class="md-code">$1</code>')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" class="md-link" target="_blank" rel="noopener">$1</a>');
}

function esc(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function parseTableRow(line) {
  return line.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
}
