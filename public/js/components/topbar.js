export function renderTopbar(health = 'loading') {
  const el = document.getElementById('topbar');
  const label = health === 'loading' ? 'Connecting…'
              : health === 'healthy' ? 'Online'
              : 'Degraded';
  el.innerHTML = `
    <span class="topbar-logo">BATON</span>
    <input class="topbar-search" type="text" placeholder="Search touches, tasks, runs…" id="global-search">
    <div class="topbar-right">
      <div class="topbar-status">
        <span class="status-dot ${health} live-dot"></span>
        <span>BATON ${label}</span>
      </div>
      <button class="btn btn-primary btn-sm" id="btn-create-task">+ Task</button>
    </div>`;
}

export function updateHealthDot(health) {
  const dot = document.querySelector('.status-dot');
  if (!dot) return;
  dot.className = `status-dot ${health} live-dot`;
  const label = dot.nextElementSibling;
  if (label) label.textContent = `BATON ${health === 'healthy' ? 'Online' : 'Degraded'}`;
}
