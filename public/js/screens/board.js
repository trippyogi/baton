import { get, patch, post } from '../api.js';
import { escapeHtml, escapeAttr } from '../lib/html.js';

const COLUMNS = ['inbox','ready','in_progress','waiting','review','done'];
const EDIT_STATUSES = [...COLUMNS, 'backlog'];
const COL_LABELS = { inbox:'Inbox', ready:'Ready to Pass', in_progress:'Airborne', waiting:'Needs Touch', review:'Review', done:'Landed', backlog:'Backlog' };
let boardDrag = null;
let boardPollTimer = null;

export async function renderBoard(options = {}) {
  const el = document.getElementById('screen-board');
  if (!options.silent) el.innerHTML = `<div class="loading">Loading board…</div>`;
  try {
    const tasks = await get('/api/tasks');
    const byStatus = {};
    for (const col of COLUMNS) byStatus[col] = tasks.filter(t => t.status === col);

    el.innerHTML = `
      <div class="screen-header">
        <div class="screen-title">Airspace Map</div>
        <div class="screen-subtitle">Secondary map of work states — click a card to view, edit, or move it</div>
      </div>
      <div class="board">
        ${COLUMNS.map(col => `
          <div class="board-col" data-col="${col}">
            <div class="board-col-header">
              <div class="board-col-title">
                <span class="board-col-name">${escapeHtml(COL_LABELS[col])}</span>
                <span class="board-col-count">${byStatus[col].length}</span>
              </div>
              <button class="board-col-add" type="button" data-status="${escapeAttr(col)}" aria-label="Add task to ${escapeAttr(COL_LABELS[col])}" title="Add task to ${escapeAttr(COL_LABELS[col])}">+</button>
            </div>
            ${byStatus[col].map(t => boardCard(t)).join('')}
          </div>`).join('')}
      </div>`;

    // Add directly into a column without leaving Airspace Map
    el.querySelectorAll('.board-col-add').forEach(btn => {
      btn.onclick = (event) => {
        event.stopPropagation();
        showBoardAddTaskModal(btn.dataset.status);
      };
    });

    wireBoardDragAndDrop(el);
    resetBoardPoll();

    // Click to inspect/edit task without leaving Airspace Map
    el.querySelectorAll('.board-card').forEach(card => {
      card.onclick = () => {
        if (card.dataset.dragSuppressClick === 'true') {
          delete card.dataset.dragSuppressClick;
          return;
        }
        showTaskDetailModal(card.dataset.id, tasks);
      };
    });
  } catch(err) {
    el.innerHTML = `<div class="loading" style="color:var(--color-red)">Error: ${escapeHtml(err.message)}</div>`;
  }
}

export function destroyBoard() {
  if (boardPollTimer) clearInterval(boardPollTimer);
  boardPollTimer = null;
  boardDrag = null;
}

function resetBoardPoll() {
  if (boardPollTimer) clearInterval(boardPollTimer);
  boardPollTimer = setInterval(() => {
    const board = document.getElementById('screen-board');
    const boardIsActive = board?.classList.contains('active');
    const modalOpen = Boolean(document.querySelector('.modal-backdrop'));
    if (!boardIsActive || modalOpen || boardDrag) return;
    renderBoard({ silent: true });
  }, 5000);
}

function boardCard(t) {
  const description = (t.description || '').trim();
  return `
    <div class="board-card" draggable="true" data-id="${escapeAttr(t.id)}" data-status="${escapeAttr(t.status)}" title="Click to edit, drag to move">
      <div class="board-card-title">${escapeHtml(t.title)}</div>
      ${description ? `<div class="board-card-desc">${escapeHtml(description.length > 110 ? `${description.slice(0, 107)}…` : description)}</div>` : ''}
      <div class="board-card-meta">
        <span class="badge badge-${escapeAttr(t.priority)}" style="font-size:10px">${escapeHtml(t.priority)}</span>
        <span style="font-size:11px;color:var(--text-secondary)">${escapeHtml(t.owner || 'operator')}</span>
      </div>
    </div>`;
}

function wireBoardDragAndDrop(el) {
  el.querySelectorAll('.board-card').forEach(card => {
    card.addEventListener('dragstart', event => {
      boardDrag = { id: card.dataset.id, from: card.dataset.status };
      card.classList.add('dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', card.dataset.id);
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      card.dataset.dragSuppressClick = 'true';
      setTimeout(() => { delete card.dataset.dragSuppressClick; }, 0);
      boardDrag = null;
      clearDropTargets(el);
    });
  });

  el.querySelectorAll('.board-col').forEach(col => {
    col.addEventListener('dragenter', () => {
      if (boardDrag) col.classList.add('drop-target');
    });
    col.addEventListener('dragover', event => {
      if (!boardDrag) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      col.classList.add('drop-target');
    });
    col.addEventListener('dragleave', event => {
      if (!col.contains(event.relatedTarget)) col.classList.remove('drop-target');
    });
    col.addEventListener('drop', async event => {
      if (!boardDrag) return;
      event.preventDefault();
      const status = col.dataset.col;
      const { id, from } = boardDrag;
      clearDropTargets(el);
      if (!id || !status || status === from) return;
      col.classList.add('drop-saving');
      try {
        await patch(`/api/tasks/${id}`, { status });
        renderBoard();
      } catch (err) {
        col.classList.remove('drop-saving');
        alert(`Could not move task: ${err.message}`);
      }
    });
  });
}

function clearDropTargets(el) {
  el.querySelectorAll('.board-col.drop-target, .board-col.drop-saving').forEach(col => {
    col.classList.remove('drop-target', 'drop-saving');
  });
}

export function showBoardAddTaskModal(status = 'inbox') {
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.innerHTML = `
    <div class="modal" onclick="event.stopPropagation()">
      <div class="modal-title">New ${escapeHtml(COL_LABELS[status] || 'Task')} Task</div>
      <div class="form-field">
        <label class="form-label">Title</label>
        <input class="form-input" id="board-task-title" placeholder="What needs to move?">
      </div>
      <div class="form-field">
        <label class="form-label">Description</label>
        <textarea class="form-textarea" id="board-task-desc" placeholder="Optional context for you or an agent"></textarea>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-field">
          <label class="form-label">Status</label>
          <select class="form-select" id="board-task-status">
            ${COLUMNS.map(s => `<option value="${escapeAttr(s)}"${s === status ? ' selected' : ''}>${escapeHtml(COL_LABELS[s])}</option>`).join('')}
          </select>
        </div>
        <div class="form-field">
          <label class="form-label">Priority</label>
          <select class="form-select" id="board-task-priority">
            ${['low','medium','high','critical'].map(p => `<option value="${escapeAttr(p)}"${p === 'medium' ? ' selected' : ''}>${escapeHtml(p)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-field">
        <label class="form-label">Owner</label>
        <input class="form-input" id="board-task-owner" value="operator">
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="board-task-cancel">Cancel</button>
        <button class="btn btn-primary" id="board-task-create">Create in ${escapeHtml(COL_LABELS[status] || 'Column')}</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.onclick = () => modal.remove();
  document.getElementById('board-task-title').focus();
  document.getElementById('board-task-cancel').onclick = () => modal.remove();
  document.getElementById('board-task-create').onclick = async () => {
    const body = {
      title: document.getElementById('board-task-title').value.trim(),
      description: document.getElementById('board-task-desc').value.trim(),
      status: document.getElementById('board-task-status').value,
      priority: document.getElementById('board-task-priority').value,
      owner: document.getElementById('board-task-owner').value.trim() || 'operator',
    };
    if (!body.title) return alert('Title is required');
    await post('/api/tasks', body);
    modal.remove();
    renderBoard();
  };
}

function showTaskDetailModal(id, tasks) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.innerHTML = `
    <div class="modal board-task-modal" onclick="event.stopPropagation()">
      <div class="modal-title">Task details</div>
      <div class="board-task-meta">
        <span>${escapeHtml(COL_LABELS[task.status] || task.status || 'Unknown')}</span>
        <span>${escapeHtml(task.priority || 'medium')}</span>
        <span>${escapeHtml(task.owner || 'operator')}</span>
      </div>
      <div class="form-field">
        <label class="form-label">Title</label>
        <input class="form-input" id="board-edit-title" value="${escapeAttr(task.title || '')}">
      </div>
      <div class="form-field">
        <label class="form-label">Description</label>
        <textarea class="form-textarea board-task-description" id="board-edit-desc" placeholder="Add context, instructions, acceptance criteria, or links">${escapeHtml(task.description || '')}</textarea>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-field">
          <label class="form-label">Status</label>
          <select class="form-select" id="board-edit-status">
            ${EDIT_STATUSES.map(s => `<option value="${escapeAttr(s)}"${s === task.status ? ' selected' : ''}>${escapeHtml(COL_LABELS[s] || s)}</option>`).join('')}
          </select>
        </div>
        <div class="form-field">
          <label class="form-label">Priority</label>
          <select class="form-select" id="board-edit-priority">
            ${['low','medium','high','critical'].map(p => `<option value="${escapeAttr(p)}"${p === task.priority ? ' selected' : ''}>${escapeHtml(p)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-field">
          <label class="form-label">Owner</label>
          <input class="form-input" id="board-edit-owner" value="${escapeAttr(task.owner || 'operator')}">
        </div>
        <div class="form-field">
          <label class="form-label">Tags</label>
          <input class="form-input" id="board-edit-tags" value="${escapeAttr((task.tags || []).join(', '))}" placeholder="comma, separated">
        </div>
      </div>
      <div class="board-task-readonly">
        <div><span>ID</span><code>${escapeHtml(task.id)}</code></div>
        ${task.created_at ? `<div><span>Created</span><code>${escapeHtml(task.created_at)}</code></div>` : ''}
        ${task.updated_at ? `<div><span>Updated</span><code>${escapeHtml(task.updated_at)}</code></div>` : ''}
        ${task.domain ? `<div><span>Domain</span><code>${escapeHtml(task.domain)}</code></div>` : ''}
        ${task.risk_level ? `<div><span>Risk</span><code>${escapeHtml(task.risk_level)}</code></div>` : ''}
      </div>
      <div class="board-dispatch-panel">
        <div class="board-dispatch-header">
          <div>
            <div class="board-dispatch-title">Dispatch prep</div>
            <div class="board-dispatch-subtitle">Prepare a run envelope without launching an agent.</div>
          </div>
          <button class="btn btn-ghost btn-sm" id="board-dispatch-prepare">Prepare</button>
        </div>
        <div id="board-dispatch-result" class="board-dispatch-result" hidden></div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="board-edit-cancel">Cancel</button>
        <button class="btn btn-primary" id="board-edit-save">Save</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.onclick = () => modal.remove();
  document.getElementById('board-edit-title').focus();
  document.getElementById('board-edit-cancel').onclick = () => modal.remove();
  document.getElementById('board-dispatch-prepare').onclick = () => prepareDispatchFromModal(id);
  document.getElementById('board-edit-save').onclick = async () => {
    const body = {
      title: document.getElementById('board-edit-title').value.trim(),
      description: document.getElementById('board-edit-desc').value.trim(),
      status: document.getElementById('board-edit-status').value,
      priority: document.getElementById('board-edit-priority').value,
      owner: document.getElementById('board-edit-owner').value.trim() || 'operator',
      tags: document.getElementById('board-edit-tags').value.split(',').map(t => t.trim()).filter(Boolean),
    };
    if (!body.title) return alert('Title is required');
    await patch(`/api/tasks/${id}`, body);
    modal.remove();
    renderBoard();
  };
}

async function prepareDispatchFromModal(id) {
  const button = document.getElementById('board-dispatch-prepare');
  const resultEl = document.getElementById('board-dispatch-result');
  if (!button || !resultEl) return;
  button.disabled = true;
  button.textContent = 'Preparing…';
  resultEl.hidden = false;
  resultEl.textContent = 'Preparing dispatch envelope…';
  try {
    const result = await post(`/api/tasks/${id}/dispatch/prepare`, {});
    const envelope = result.envelope || {};
    resultEl.innerHTML = `
      <div class="board-dispatch-summary">
        <div><span>Run</span><code>${escapeHtml(result.run?.id || 'unknown')}</code></div>
        <div><span>Agent</span><code>${escapeHtml(envelope.agent_id || result.run?.agent_name || 'manual')}</code></div>
        <div><span>Status</span><code>${escapeHtml(result.run?.dispatch_status || 'prepared')}</code></div>
      </div>
      <label class="form-label" for="board-dispatch-envelope">Envelope</label>
      <textarea class="form-textarea board-dispatch-envelope" id="board-dispatch-envelope" readonly>${escapeHtml(JSON.stringify(envelope, null, 2))}</textarea>
      <div class="board-dispatch-actions">
        <button class="btn btn-ghost btn-sm" id="board-dispatch-copy">Copy envelope</button>
      </div>`;
    document.getElementById('board-dispatch-copy').onclick = async () => {
      await navigator.clipboard?.writeText(JSON.stringify(envelope, null, 2));
      document.getElementById('board-dispatch-copy').textContent = 'Copied';
    };
  } catch (err) {
    resultEl.textContent = `Could not prepare dispatch: ${err.message}`;
  } finally {
    button.disabled = false;
    button.textContent = 'Prepare';
  }
}
