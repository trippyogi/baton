const NAV_ITEMS = [
  { id: 'overview',     icon: '⬡', label: 'Overview' },
  { id: 'tasks',        icon: '✓', label: 'Tasks' },
  { id: 'board',        icon: '⊞', label: 'Board' },
  { id: 'runs',         icon: '▶', label: 'Runs' },
  { id: 'workshop',     icon: '⚗', label: 'Workshop' },
  { id: 'costs',        icon: '◇', label: 'Costs' },
  { id: 'performance',  icon: '◎', label: 'Performance' },
  { id: 'queue',        icon: '⧖', label: 'Queue' },
  { id: 'creatives',   icon: '◈', label: 'Creatives' },
];

const PHASE2_ITEMS = [
  { id: 'memory',      icon: '◈', label: 'Memory' },
  { id: 'team',        icon: '◉', label: 'Team' },
  { id: 'requests',    icon: '⇄', label: 'Requests' },
  { id: 'settings',    icon: '⚙', label: 'Settings',     disabled: true },
];

export function renderNav(activeId) {
  const el = document.getElementById('nav');
  el.innerHTML = `
    <div class="nav-brand">
      <div>
        <div class="nav-brand-name">VECTOR MC</div>
        <div class="nav-brand-sub">Mission Control v1.2</div>
      </div>
    </div>
    <div class="nav-section">
      ${NAV_ITEMS.map(item => `
        <a class="nav-item${item.id === activeId ? ' active' : ''}"
           href="#/${item.id}" data-screen="${item.id}">
          <span class="nav-icon">${item.icon}</span>
          ${item.label}
        </a>`).join('')}
    </div>
    <div class="nav-section" style="margin-top:16px">
      <div class="nav-label">Phase 2</div>
      ${PHASE2_ITEMS.map(item => item.disabled
        ? `<span class="nav-item" style="opacity:0.35;cursor:default">
             <span class="nav-icon">${item.icon}</span>${item.label}
           </span>`
        : `<a class="nav-item${item.id === activeId ? ' active' : ''}"
              href="#/${item.id}" data-screen="${item.id}">
             <span class="nav-icon">${item.icon}</span>${item.label}
           </a>`
      ).join('')}
    </div>`;
}
