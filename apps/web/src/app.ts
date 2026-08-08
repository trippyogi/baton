// @ts-nocheck
import { renderNav } from './components/nav';
import { renderTopbar } from './components/topbar';
import { renderOverview } from './screens/overview';
import { renderFlow, destroyFlow } from './screens/flow';
import { renderTasks } from './screens/tasks';
import { renderBoard, showBoardAddTaskModal, destroyBoard } from './screens/board';
import { renderRuns } from './screens/runs';
import { renderWorkshop } from './screens/workshop';
import { renderCosts } from './screens/costs';
import { renderPerformance } from './screens/performance';
import { renderMemory } from './screens/memory';
import { renderTeam } from './screens/team';
import { renderQueue, destroyQueue } from './screens/queue';
import { renderRequests } from './screens/requests';
import { renderCreatives, destroyCreatives } from './screens/creatives';

const SCREENS = {
  flow: { el: 'screen-flow', render: renderFlow },
  overview: { el: 'screen-overview', render: renderOverview },
  tasks: { el: 'screen-tasks', render: renderTasks },
  board: { el: 'screen-board', render: renderBoard },
  runs: { el: 'screen-runs', render: renderRuns },
  workshop: { el: 'screen-workshop', render: renderWorkshop },
  costs: { el: 'screen-costs', render: renderCosts },
  performance: { el: 'screen-performance', render: renderPerformance },
  memory: { el: 'screen-memory', render: renderMemory },
  team: { el: 'screen-team', render: renderTeam },
  queue: { el: 'screen-queue', render: renderQueue },
  requests: { el: 'screen-requests', render: renderRequests },
  creatives: { el: 'screen-creatives', render: renderCreatives },
};

function getRoute() {
  const hash = location.hash.replace('#/', '') || 'flow';
  return SCREENS[hash] ? hash : 'flow';
}

function navigate(route) {
  Object.values(SCREENS).forEach((s) => {
    document.getElementById(s.el).classList.remove('active');
  });
  const screen = SCREENS[route];
  document.getElementById(screen.el).classList.add('active');
  renderNav(route);
  if (typeof destroyFlow === 'function' && route !== 'flow') destroyFlow();
  if (typeof destroyBoard === 'function' && route !== 'board') destroyBoard();
  if (typeof destroyQueue === 'function' && route !== 'queue') destroyQueue();
  if (typeof destroyCreatives === 'function' && route !== 'creatives') destroyCreatives();
  screen.render();
  const btn = document.getElementById('btn-create-task');
  if (btn) {
    btn.onclick = () => {
      if (route === 'board') showBoardAddTaskModal('inbox');
      else location.hash = '#/tasks';
    };
  }
}

export function initApp() {
  renderTopbar('loading');
  navigate(getRoute());
  window.addEventListener('hashchange', () => navigate(getRoute()));
}
