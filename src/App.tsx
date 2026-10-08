import { useEffect, useState } from 'react';
import { TimerPage } from './features/timer/TimerPage';
import { RunningDock } from './features/timer/RunningDock';
import { CatalogPage } from './features/catalog/CatalogPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { HistoryPage } from './features/history/HistoryPage';
import { StatsPage } from './features/stats/StatsPage';
import { GoalsPage } from './features/goals/GoalsPage';
import { PomodoroPage } from './features/pomodoro/PomodoroPage';
import { PomodoroRunner } from './pomodoro/PomodoroRunner';
import { UpdatePrompt } from './ui/UpdatePrompt';
import { DiscardToast } from './ui/DiscardToast';
import { AutoSync, SyncBadge } from './sync/SyncBadge';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { tr } from './i18n';

const NAV = [
  { key: 'timer', label: tr("计时"), icon: '⏱️' },
  { key: 'pomodoro', label: 'Pomo', icon: '🍅' },
  { key: 'history', label: tr("历史"), icon: '🗂️' },
  { key: 'stats', label: tr("统计"), icon: '📊' },
  { key: 'goals', label: tr("目标"), icon: '🎯' },
  { key: 'catalog', label: tr("类型"), icon: '🏷️', wideOnly: true },
  { key: 'settings', label: tr("设置"), icon: '⚙️' },
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
      <nav className="nav" aria-label={tr("主导航")}>
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
          <ErrorBoundary area={tr("同步状态")}>
            <SyncBadge />
          </ErrorBoundary>
        </div>
      </nav>
      <ErrorBoundary area={tr("自动同步")}>
        <AutoSync />
      </ErrorBoundary>
      <ErrorBoundary area="Pomo">
        <PomodoroRunner baseTitle={baseTitle} />
      </ErrorBoundary>
      <ErrorBoundary area={tr("进行中")}>
        <RunningDock />
      </ErrorBoundary>
      {/* 所有提示放在同一个容器里依次排列，互不遮挡 */}
      <div className="toasts">
        <ErrorBoundary area={tr("更新提示")}>
          <UpdatePrompt />
        </ErrorBoundary>
        <ErrorBoundary area={tr("提示")}>
          <DiscardToast />
        </ErrorBoundary>
      </div>
      <main className="main">
        <ErrorBoundary key={route} area={tr("页面")}>
          <Page route={route} />
        </ErrorBoundary>
      </main>
    </div>
  );
}
