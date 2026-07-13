export function renderTopbar(health = 'connecting', meta = {}) {
  const el = document.getElementById('topbar');
  const label = statusLabel(health);
  el.innerHTML = `
    <span class="topbar-logo">BATON</span>
    <input class="topbar-search" type="text" placeholder="Search touches, tasks, runs…" id="global-search">
    <div class="topbar-right">
      <div class="topbar-status">
        <span class="status-dot ${health}"></span>
        <span>${label}</span>
      </div>
      ${meta.demoData ? '<span class="demo-data-chip">DEMO DATA · Demo Co</span>' : ''}
      <button class="btn btn-primary btn-sm" id="btn-create-task">+ Task</button>
    </div>`;
}

export function updateHealthDot(health, meta = {}) {
  const dot = document.querySelector('.topbar-status .status-dot');
  if (!dot) return;
  dot.className = `status-dot ${health}`;
  const label = dot.nextElementSibling;
  if (label) label.textContent = statusLabel(health);

  const right = document.querySelector('.topbar-right');
  const existingChip = right?.querySelector('.demo-data-chip');
  if (meta.demoData && !existingChip && right) {
    const chip = document.createElement('span');
    chip.className = 'demo-data-chip';
    chip.textContent = 'DEMO DATA · Demo Co';
    right.insertBefore(chip, document.getElementById('btn-create-task'));
  } else if (!meta.demoData && existingChip) {
    existingChip.remove();
  }
}

function statusLabel(health) {
  if (health === 'connecting') return 'Connecting…';
  if (health === 'healthy') return 'Local';
  return 'Degraded';
}
