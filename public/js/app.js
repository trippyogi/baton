import { renderNav }      from './components/nav.js';
import { renderTopbar }   from './components/topbar.js';
import { renderOverview } from './screens/overview.js';
import { renderTasks }    from './screens/tasks.js';
import { renderBoard }    from './screens/board.js';
import { renderRuns }     from './screens/runs.js';
import { renderWorkshop }    from './screens/workshop.js';
import { renderCosts }       from './screens/costs.js';
import { renderPerformance } from './screens/performance.js';
import { renderMemory }      from './screens/memory.js';
import { renderTeam }        from './screens/team.js';
import { renderQueue, destroyQueue } from './screens/queue.js';
import { renderRequests }           from './screens/requests.js';
import { renderCreatives, destroyCreatives } from './screens/creatives.js';

const SCREENS = {
  overview:    { el: 'screen-overview',    render: renderOverview },
  tasks:       { el: 'screen-tasks',       render: renderTasks },
  board:       { el: 'screen-board',       render: renderBoard },
  runs:        { el: 'screen-runs',        render: renderRuns },
  workshop:    { el: 'screen-workshop',    render: renderWorkshop },
  costs:       { el: 'screen-costs',       render: renderCosts },
  performance: { el: 'screen-performance', render: renderPerformance },
  memory:      { el: 'screen-memory',      render: renderMemory },
  team:        { el: 'screen-team',        render: renderTeam },
  queue:       { el: 'screen-queue',       render: renderQueue },
  requests:    { el: 'screen-requests',    render: renderRequests },
  creatives:   { el: 'screen-creatives',   render: renderCreatives },
};

function getRoute() {
  const hash = location.hash.replace('#/', '') || 'overview';
  return SCREENS[hash] ? hash : 'overview';
}

function navigate(route) {
  // Hide all screens
  Object.values(SCREENS).forEach(s => {
    document.getElementById(s.el).classList.remove('active');
  });
  // Show target
  const screen = SCREENS[route];
  document.getElementById(screen.el).classList.add('active');
  // Re-render nav
  renderNav(route);
  // Render screen
  if (typeof destroyQueue === 'function' && route !== 'queue') destroyQueue();
  if (typeof destroyCreatives === 'function' && route !== 'creatives') destroyCreatives();
  screen.render();
  // Wire create task button (if present after topbar render)
  const btn = document.getElementById('btn-create-task');
  if (btn) btn.onclick = () => location.hash = '#/tasks';
}

function init() {
  renderTopbar('loading');
  navigate(getRoute());
  window.addEventListener('hashchange', () => navigate(getRoute()));
}

document.addEventListener('DOMContentLoaded', init);
