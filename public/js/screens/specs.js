import { post } from '../api.js';
import { escapeHtml, escapeAttr } from '../lib/html.js';

let lastParsed = null;

export async function renderSpecs() {
  const el = document.getElementById('screen-specs');
  el.innerHTML = `
    <div class="screen-header" style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px">
      <div>
        <div class="screen-title">Spec Intake</div>
        <div class="screen-subtitle">Paste a Markdown formal spec and convert roadmap deliverables into ready BATON tasks.</div>
      </div>
    </div>

    <div class="card" style="margin-bottom:var(--gap)">
      <div style="display:grid;grid-template-columns:minmax(0,1.2fr) minmax(280px,0.8fr);gap:16px">
        <div class="form-field">
          <label class="form-label">Markdown formal spec</label>
          <textarea class="form-textarea" id="spec-markdown" style="min-height:360px" placeholder="# Crucible Formal Specification\n\n**Project:** Crucible\n..."></textarea>
        </div>
        <div>
          <div class="form-field">
            <label class="form-label">Roadmap phase</label>
            <input class="form-input" id="spec-phase" placeholder="v0.1, v0.2, or blank for first phase">
          </div>
          <label style="display:flex;gap:8px;align-items:center;margin:8px 0 16px;color:var(--text-secondary);font-size:13px">
            <input type="checkbox" id="spec-all-phases">
            Include all roadmap phases
          </label>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-ghost" id="btn-parse-spec">Preview Tasks</button>
            <button class="btn btn-primary" id="btn-create-spec">Create Packet + Tasks</button>
          </div>
          <div id="spec-status" style="margin-top:12px;color:var(--text-secondary);font-size:13px"></div>
        </div>
      </div>
    </div>

    <div id="spec-preview"></div>
  `;

  document.getElementById('btn-parse-spec').onclick = () => parseSpec({ create: false });
  document.getElementById('btn-create-spec').onclick = () => parseSpec({ create: true });
}

async function parseSpec({ create }) {
  const status = document.getElementById('spec-status');
  const preview = document.getElementById('spec-preview');
  const markdown = document.getElementById('spec-markdown').value.trim();
  const phase = document.getElementById('spec-phase').value.trim();
  const includeAll = document.getElementById('spec-all-phases').checked;
  if (!markdown) {
    status.innerHTML = '<span style="color:var(--color-red)">Paste a Markdown spec first.</span>';
    return;
  }
  status.textContent = create ? 'Creating packet…' : 'Parsing spec…';
  try {
    const body = {
      markdown,
      ...(phase ? { phase } : {}),
      ...(includeAll ? { include_all_phases: true } : {}),
    };
    const result = await post(create ? '/api/formal-specs' : '/api/formal-specs/parse', body);
    lastParsed = result;
    status.innerHTML = create
      ? `Created strategy packet <code>${escapeHtml(result.packet?.id || '')}</code> with ${Number(result.tasks?.length || 0)} task${result.tasks?.length === 1 ? '' : 's'}.`
      : `Previewed ${Number(result.items?.length || 0)} task${result.items?.length === 1 ? '' : 's'}.`;
    preview.innerHTML = renderPreview(result, { created: create });
  } catch (err) {
    status.innerHTML = `<span style="color:var(--color-red)">${escapeHtml(err.message)}</span>`;
  }
}

function renderPreview(result, { created }) {
  const spec = result.spec || lastParsed?.spec || {};
  const tasks = created ? (result.tasks || []) : (result.items || []);
  return `
    <div class="card">
      <div style="display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:12px">
        <div>
          <div style="font-family:var(--font-display);font-size:18px;font-weight:700">${escapeHtml(spec.project || 'Formal Spec')}</div>
          <div style="color:var(--text-secondary);font-size:13px">${escapeHtml(spec.target_repository || 'No target repository detected')}</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
          ${spec.spec_version ? `<span class="badge badge-medium">${escapeHtml(spec.spec_version)}</span>` : ''}
          ${spec.roadmap?.length ? `<span class="badge badge-high">${spec.roadmap.length} phase${spec.roadmap.length === 1 ? '' : 's'}</span>` : ''}
        </div>
      </div>
      ${spec.one_sentence_definition ? `<p style="color:var(--text-secondary)">${escapeHtml(spec.one_sentence_definition)}</p>` : ''}
      <div class="table-wrap">
        <table>
          <thead><tr><th>Task</th><th>Owner</th><th>Priority</th><th>Domain</th><th>Tags</th></tr></thead>
          <tbody>
            ${tasks.length ? tasks.map(taskRow).join('') : `<tr><td colspan="5" style="text-align:center;color:var(--text-secondary);padding:24px">No roadmap tasks detected.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function taskRow(task) {
  const tags = (task.tags || []).map(tag => `<span class="badge badge-medium" style="font-size:10px">${escapeHtml(tag)}</span>`).join(' ');
  return `<tr>
    <td style="max-width:420px">${escapeHtml(task.title)}</td>
    <td>${escapeHtml(task.owner || '')}</td>
    <td><span class="badge badge-${escapeAttr(task.priority || 'medium')}">${escapeHtml(task.priority || 'medium')}</span></td>
    <td>${escapeHtml(task.domain || '')}</td>
    <td>${tags}</td>
  </tr>`;
}
