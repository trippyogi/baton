import { get, patch, post } from '../api.js';
import { escapeHtml, escapeAttr } from '../lib/html.js';

const COLUMNS = ['inbox','ready','in_progress','waiting','review','done'];
const COL_LABELS = { inbox:'Inbox', ready:'Ready to Pass', in_progress:'Airborne', waiting:'Needs Touch', review:'Review', done:'Landed' };

export async function renderBoard() {
  const el = document.getElementById('screen-board');
  el.innerHTML = `<div class="loading">Loading board…</div>`;
  try {
    const tasks = await get('/api/tasks');
    const byStatus = {};
    for (const col of COLUMNS) byStatus[col] = tasks.filter(t => t.status === col);

    el.innerHTML = `
      <div class="screen-header">
        <div class="screen-title">Airspace Map</div>
        <div class="screen-subtitle">Secondary map of work states — click to move status</div>
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

    // Click to advance status
    el.querySelectorAll('.board-card').forEach(card => {
      card.onclick = () => showMoveModal(card.dataset.id, card.dataset.status, tasks);
    });
  } catch(err) {
    el.innerHTML = `<div class="loading" style="color:var(--color-red)">Error: ${escapeHtml(err.message)}</div>`;
  }
}

function boardCard(t) {
  return `
    <div class="board-card" data-id="${escapeAttr(t.id)}" data-status="${escapeAttr(t.status)}">
      <div class="board-card-title">${escapeHtml(t.title)}</div>
      <div class="board-card-meta">
        <span class="badge badge-${escapeAttr(t.priority)}" style="font-size:10px">${escapeHtml(t.priority)}</span>
        <span style="font-size:11px;color:var(--text-secondary)">${escapeHtml(t.owner)}</span>
      </div>
    </div>`;
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

function showMoveModal(id, currentStatus, tasks) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.innerHTML = `
    <div class="modal" onclick="event.stopPropagation()">
      <div class="modal-title" style="font-size:14px">${escapeHtml(task.title)}</div>
      <div class="form-field" style="margin-top:12px">
        <label class="form-label">Move to</label>
        <select class="form-select" id="move-status">
          ${COLUMNS.map(s => `<option value="${escapeAttr(s)}"${s === currentStatus ? ' selected' : ''}>${escapeHtml(COL_LABELS[s])}</option>`).join('')}
        </select>
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="move-cancel">Cancel</button>
        <button class="btn btn-primary" id="move-save">Move</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.onclick = () => modal.remove();
  document.getElementById('move-cancel').onclick = () => modal.remove();
  document.getElementById('move-save').onclick = async () => {
    const status = document.getElementById('move-status').value;
    await patch(`/api/tasks/${id}`, { status });
    modal.remove();
    renderBoard();
  };
}
