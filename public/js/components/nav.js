const NAV_ITEMS = [
  { id: 'flow',         icon: '↯', label: 'Flow' },
  { id: 'overview',     icon: '⬡', label: 'Overview' },
  { id: 'tasks',        icon: '✓', label: 'Tasks' },
  { id: 'board',        icon: '⊞', label: 'Board' },
  { id: 'runs',         icon: '▶', label: 'Runs' },
  { id: 'workshop',     icon: '⚗', label: 'Workshop' },
  { id: 'specs',        icon: '※', label: 'Specs' },
  { id: 'costs',        icon: '◇', label: 'Costs', hiddenWhenPhase2Off: true },
  { id: 'performance',  icon: '◎', label: 'Performance', hiddenWhenPhase2Off: true },
  { id: 'queue',        icon: '⧖', label: 'Queue' },
  { id: 'creatives',   icon: '◈', label: 'Creatives', hiddenWhenPhase2Off: true },
];

const PHASE2_ITEMS = [
  { id: 'memory',      icon: '◈', label: 'Memory' },
  { id: 'team',        icon: '◉', label: 'Team' },
  { id: 'requests',    icon: '⇄', label: 'Requests' },
  { id: 'settings',    icon: '⚙', label: 'Settings',     disabled: true },
];

export function renderNav(activeId) {
  const el = document.getElementById('nav');
  const flags = window.BATON_UI_FLAGS || {};
  const showPhase2 = Boolean(flags.showPhase2Nav);
  const visibleNavItems = showPhase2
    ? NAV_ITEMS
    : NAV_ITEMS.filter(item => !item.hiddenWhenPhase2Off);
  el.innerHTML = `
    <div class="nav-brand">
      <div>
        <div class="nav-brand-name">BATON</div>
        <div class="nav-brand-sub">Flow Ops</div>
      </div>
    </div>
    <div class="nav-section">
      ${visibleNavItems.map(item => `
        <a class="nav-item${item.id === activeId ? ' active' : ''}"
           href="#/${item.id}" data-screen="${item.id}">
          <span class="nav-icon">${item.icon}</span>
          ${item.label}
        </a>`).join('')}
    </div>
    ${showPhase2 ? `<div class="nav-section" style="margin-top:16px">
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
    </div>` : ''}`;
}

export function isRouteVisible(routeId) {
  const flags = window.BATON_UI_FLAGS || {};
  if (NAV_ITEMS.some(item => item.id === routeId && item.hiddenWhenPhase2Off && !flags.showPhase2Nav)) return false;
  if (PHASE2_ITEMS.some(item => item.id === routeId) && !flags.showPhase2Nav) return false;
  return true;
}
