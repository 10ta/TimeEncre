import { useEffect, useState } from 'react';
import { TimerPage } from './features/timer/TimerPage';
import { RunningPanel } from './features/timer/RunningPanel';
import { CatalogPage } from './features/catalog/CatalogPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { HistoryPage } from './features/history/HistoryPage';
import { StatsPage } from './features/stats/StatsPage';
import { GoalsPage } from './features/goals/GoalsPage';
import { PomodoroPage } from './features/pomodoro/PomodoroPage';
import { PomodoroRunner } from './pomodoro/PomodoroRunner';
import { UpdatePrompt } from './ui/UpdatePrompt';
import { AutoSync, SyncBadge } from './sync/SyncBadge';
import { ErrorBoundary } from './ui/ErrorBoundary';

const NAV = [
  { key: 'timer', label: '计时', icon: '⏱️' },
  { key: 'pomodoro', label: '番茄钟', icon: '🍅' },
  { key: 'history', label: '历史', icon: '🗂️' },
  { key: 'stats', label: '统计', icon: '📊' },
  { key: 'goals', label: '目标', icon: '🎯' },
  { key: 'catalog', label: '类型与标签', icon: '🏷️', wideOnly: true },
  { key: 'settings', label: '设置', icon: '⚙️' },
] as const;

type RouteKey = (typeof NAV)[number]['key'];

function readRoute(): RouteKey {
  const key = location.hash.replace(/^#\/?/, '').split(/[/?]/)[0];
  return (NAV.find((n) => n.key === key)?.key ?? 'timer') as RouteKey;
}

function useRoute(): RouteKey {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    const on = () => setRoute(readRoute());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

function Page({ route }: { route: RouteKey }) {
  switch (route) {
    case 'timer':
      return <TimerPage />;
    case 'catalog':
      return <CatalogPage />;
    case 'settings':
      return <SettingsPage />;
    case 'pomodoro':
      return <PomodoroPage />;
    case 'history':
      return <HistoryPage />;
    case 'stats':
      return <StatsPage />;
    case 'goals':
      return <GoalsPage />;
  }
}

export function App() {
  const route = useRoute();
  const label = NAV.find((n) => n.key === route)?.label;
  const baseTitle = label ? `${label} · TimeEncre` : 'TimeEncre';

  return (
    <div className="app">
      <nav className="nav" aria-label="主导航">
        <a className="brand" href="#/timer">
          Time<span>Encre</span>
        </a>
        <ul>
          {NAV.map((n) => (
            <li key={n.key} className={'wideOnly' in n ? 'wide-only' : undefined}>
              <a href={`#/${n.key}`} aria-current={route === n.key ? 'page' : undefined}>
                <span className="nav-icon" aria-hidden="true">{n.icon}</span>
                <span className="nav-label">{n.label}</span>
              </a>
            </li>
          ))}
        </ul>
        <div className="nav-foot">
          <ErrorBoundary area="同步状态">
            <SyncBadge />
          </ErrorBoundary>
        </div>
      </nav>
      <ErrorBoundary area="自动同步">
        <AutoSync />
      </ErrorBoundary>
      <ErrorBoundary area="番茄钟">
        <PomodoroRunner baseTitle={baseTitle} />
      </ErrorBoundary>
      <ErrorBoundary area="更新提示">
        <UpdatePrompt />
      </ErrorBoundary>
      <main className="main">
        <ErrorBoundary area="进行中面板">
          <RunningPanel variant="strip" />
        </ErrorBoundary>
        <ErrorBoundary key={route} area="页面">
          <Page route={route} />
        </ErrorBoundary>
      </main>
      <aside className="side">
        <ErrorBoundary area="进行中面板">
          <RunningPanel variant="side" />
        </ErrorBoundary>
      </aside>
    </div>
  );
}
