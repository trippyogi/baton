import { get, patch } from '../api.js';

const COLUMNS = ['inbox','ready','in_progress','waiting','review','done'];
const COL_LABELS = { inbox:'Inbox', ready:'Ready', in_progress:'In Progress', waiting:'Waiting', review:'Review', done:'Done' };

export async function renderBoard() {
  const el = document.getElementById('screen-board');
  el.innerHTML = `<div class="loading">Loading board…</div>`;
  try {
    const tasks = await get('/api/tasks');
    const byStatus = {};
    for (const col of COLUMNS) byStatus[col] = tasks.filter(t => t.status === col);

    el.innerHTML = `
      <div class="screen-header">
        <div class="screen-title">Board</div>
        <div class="screen-subtitle">Drag to reorder coming Phase 2 — click to move status</div>
      </div>
      <div class="board">
        ${COLUMNS.map(col => `
          <div class="board-col" data-col="${col}">
            <div class="board-col-header">
              <span class="board-col-name">${COL_LABELS[col]}</span>
              <span class="board-col-count">${byStatus[col].length}</span>
            </div>
            ${byStatus[col].map(t => boardCard(t)).join('')}
          </div>`).join('')}
      </div>`;

    // Click to advance status
    el.querySelectorAll('.board-card').forEach(card => {
      card.onclick = () => showMoveModal(card.dataset.id, card.dataset.status, tasks);
    });
  } catch(err) {
    el.innerHTML = `<div class="loading" style="color:var(--color-red)">Error: ${err.message}</div>`;
  }
}

function boardCard(t) {
  return `
    <div class="board-card" data-id="${t.id}" data-status="${t.status}">
      <div class="board-card-title">${t.title}</div>
      <div class="board-card-meta">
        <span class="badge badge-${t.priority}" style="font-size:10px">${t.priority}</span>
        <span style="font-size:11px;color:var(--text-secondary)">${t.owner}</span>
      </div>
    </div>`;
}

function showMoveModal(id, currentStatus, tasks) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.innerHTML = `
    <div class="modal" onclick="event.stopPropagation()">
      <div class="modal-title" style="font-size:14px">${task.title}</div>
      <div class="form-field" style="margin-top:12px">
        <label class="form-label">Move to</label>
        <select class="form-select" id="move-status">
          ${COLUMNS.map(s => `<option value="${s}"${s === currentStatus ? ' selected' : ''}>${COL_LABELS[s]}</option>`).join('')}
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
