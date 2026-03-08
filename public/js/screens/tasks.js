import { get, post, patch, del } from '../api.js';

let tasksAbort = null; // AbortController for event delegation

export async function renderTasks() {
  const el = document.getElementById('screen-tasks');
  el.innerHTML = `<div class="loading">Loading tasks…</div>`;
  try {
    const tasks  = await get('/api/tasks'); // archived excluded server-side
    const active = tasks.filter(t => t.status !== 'done');
    const done   = tasks.filter(t => t.status === 'done');

    el.innerHTML = `
      <div class="screen-header" style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <div class="screen-title">Tasks</div>
          <div class="screen-subtitle">${active.length} active${done.length ? ` — ${done.length} complete` : ''}</div>
        </div>
        <button class="btn btn-primary" id="btn-new-task">+ New Task</button>
      </div>

      <!-- Active tasks -->
      <div class="card" style="margin-bottom:var(--gap)">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Status</th>
                <th>Priority</th>
                <th>Owner</th>
                <th>Tags</th>
                <th>Due</th>
                <th></th>
              </tr>
            </thead>
            <tbody id="tasks-tbody">
              ${active.length
                ? active.map(t => taskRow(t, false)).join('')
                : `<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--text-secondary)">No active tasks</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Complete section — collapsed by default -->
      ${done.length ? `
      <details class="complete-section" id="complete-section">
        <summary class="complete-summary">
          <span class="complete-label">Complete — ${done.length}</span>
          <button class="btn btn-ghost btn-sm" id="btn-archive-all" style="margin-left:auto;font-size:11px;opacity:0.7">Archive All</button>
          <span class="complete-chevron">▾</span>
        </summary>
        <div class="card" style="margin-top:8px">
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Status</th>
                  <th>Priority</th>
                  <th>Owner</th>
                  <th>Tags</th>
                  <th>Due</th>
                  <th></th>
                </tr>
              </thead>
              <tbody id="done-tbody">
                ${done.map(t => taskRow(t, true)).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </details>` : ''}`;

    document.getElementById('btn-new-task').onclick = () => showTaskModal();

    // Event delegation — all task action buttons
    if (tasksAbort) tasksAbort.abort();
    tasksAbort = new AbortController();
    const sig = { signal: tasksAbort.signal };

    el.addEventListener('click', async (e) => {
      // Edit
      const editBtn = e.target.closest('.task-edit');
      if (editBtn) {
        const t = tasks.find(x => x.id === editBtn.dataset.id);
        if (t) showTaskModal(t);
        return;
      }
      // Delete
      const delBtn = e.target.closest('.task-del');
      if (delBtn) {
        if (!confirm('Delete this task?')) return;
        await del(`/api/tasks/${delBtn.dataset.id}`);
        renderTasks();
        return;
      }
      // Archive single
      const archBtn = e.target.closest('.task-archive');
      if (archBtn) {
        archBtn.disabled = true;
        archBtn.textContent = '…';
        await patch(`/api/tasks/${archBtn.dataset.id}`, { status: 'archived' });
        renderTasks();
        return;
      }
      // Archive All
      if (e.target.id === 'btn-archive-all' || e.target.closest('#btn-archive-all')) {
        const btn = document.getElementById('btn-archive-all');
        if (btn) { btn.disabled = true; btn.textContent = '…'; }
        await Promise.all(done.map(t => patch(`/api/tasks/${t.id}`, { status: 'archived' })));
        renderTasks();
        return;
      }
    }, sig);

  } catch(err) {
    el.innerHTML = `<div class="loading" style="color:var(--color-red)">Error: ${err.message}</div>`;
  }
}

// ── Row renderers ─────────────────────────────────────

function taskRow(t, isDone) {
  const tags = (t.tags || []).map(tag =>
    `<span class="badge badge-medium" style="font-size:10px">${tag}</span>`
  ).join(' ');

  const rowStyle = isDone ? ' class="task-done-row"' : '';

  return `<tr data-id="${t.id}"${rowStyle}>
    <td style="max-width:240px${isDone ? ';color:var(--text-secondary);text-decoration:line-through;opacity:0.7' : ''}">${t.title}</td>
    <td><span class="badge badge-${t.status}">${t.status.replace('_',' ')}</span></td>
    <td><span class="badge badge-${t.priority}">${t.priority}</span></td>
    <td style="color:var(--text-secondary)">${t.owner}</td>
    <td>${tags}</td>
    <td style="color:var(--text-secondary);font-size:12px">${t.due_at ? t.due_at.slice(0,10) : '—'}</td>
    <td style="white-space:nowrap">
      ${isDone
        ? `<button class="btn btn-ghost btn-sm task-archive" data-id="${t.id}" style="font-size:11px;opacity:0.7">Archive</button>`
        : `<button class="btn btn-ghost btn-sm task-edit" data-id="${t.id}">Edit</button>
           <button class="btn btn-ghost btn-sm task-del" data-id="${t.id}" style="color:var(--color-red)">Del</button>`}
    </td>
  </tr>`;
}

// ── Create / Edit modal ───────────────────────────────

function showTaskModal(task = null) {
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.innerHTML = `
    <div class="modal" onclick="event.stopPropagation()">
      <div class="modal-title">${task ? 'Edit Task' : 'New Task'}</div>
      <div class="form-field">
        <label class="form-label">Title</label>
        <input class="form-input" id="f-title" value="${task?.title || ''}">
      </div>
      <div class="form-field">
        <label class="form-label">Description</label>
        <textarea class="form-textarea" id="f-desc">${task?.description || ''}</textarea>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-field">
          <label class="form-label">Status</label>
          <select class="form-select" id="f-status">
            ${['inbox','ready','in_progress','waiting','review','done','backlog'].map(s =>
              `<option value="${s}"${task?.status === s ? ' selected' : ''}>${s.replace('_',' ')}</option>`).join('')}
          </select>
        </div>
        <div class="form-field">
          <label class="form-label">Priority</label>
          <select class="form-select" id="f-priority">
            ${['low','medium','high','critical'].map(p =>
              `<option value="${p}"${task?.priority === p ? ' selected' : ''}>${p}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-field">
        <label class="form-label">Owner</label>
        <input class="form-input" id="f-owner" value="${task?.owner || 'vector'}">
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="modal-cancel">Cancel</button>
        <button class="btn btn-primary" id="modal-save">${task ? 'Save' : 'Create'}</button>
      </div>
    </div>`;

  document.body.appendChild(modal);
  modal.onclick = () => modal.remove();
  document.getElementById('modal-cancel').onclick = () => modal.remove();
  document.getElementById('modal-save').onclick = async () => {
    const body = {
      title:       document.getElementById('f-title').value.trim(),
      description: document.getElementById('f-desc').value.trim(),
      status:      document.getElementById('f-status').value,
      priority:    document.getElementById('f-priority').value,
      owner:       document.getElementById('f-owner').value.trim(),
    };
    if (!body.title) return alert('Title is required');
    if (task) await patch(`/api/tasks/${task.id}`, body);
    else      await post('/api/tasks', body);
    modal.remove();
    renderTasks();
  };
}
