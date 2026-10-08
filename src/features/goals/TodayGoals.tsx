import type { CSSProperties } from 'react';
import { useGoals, useRecordsInRange, useSettings, useTagMap, useTypeMap } from '../../db/hooks';
import { useNow } from '../../ui/hooks';
import { formatHm, startOfDay } from '../../lib/time';
import { rangeOf } from '../../lib/range';
import { CURRENT_WORD, STATUS_TEXT, viewGoal } from './goalView';
import { tr } from '../../i18n';

/** 首页（计时页）的目标进度：每天的目标在前，周、月目标随后 */
export function TodayGoals() {
  const goals = useGoals();
  const settings = useSettings();
  const typeMap = useTypeMap();
  const tagMap = useTagMap();
  useNow(30_000);
  const now = Date.now();
  const ws = settings?.weekStart ?? 1;
  // 覆盖本月和本周（本周可能跨到上个月）
  const from = Math.min(rangeOf('month', now, ws).from, rangeOf('week', now, ws).from, startOfDay(now));
  const records = useRecordsInRange(from, now + 1);

  if (!goals || !settings || !typeMap || !tagMap || !records || goals.length === 0) return null;
  const order = { day: 0, week: 1, month: 2 } as const;
  const views = goals
    .map((g) => viewGoal(g, records, now, ws, typeMap, tagMap))
    .sort((a, b) => order[a.goal.period] - order[b.goal.period]);

  return (
    <section className="today-goals" aria-labelledby="today-goals-title">
      <header className="today-head">
        <h2 id="today-goals-title">{tr("目标")}</h2>
        <a className="section-link" href="#/goals">{tr("查看全部 ›")}</a>
      </header>
      <ul>
        {views.map((v) => (
          <li key={v.goal.id} className={`tg is-${v.status}`} style={{ '--c': v.color } as CSSProperties}>
            <span className="tg-title">
              <span className="tg-when">{CURRENT_WORD[v.goal.period]}</span>
              {v.shortTitle}
            </span>
            <span className="tg-bar" aria-hidden="true">
              <span className="tg-fill" style={{ width: `${v.pct}%` }} />
              {v.goal.direction === 'atLeast' && v.goal.period !== 'day' && (
                <span className="goal-pace" style={{ left: `${v.elapsed * 100}%` }} />
              )}
            </span>
            <span className="tg-num">
              {formatHm(v.ms)} / {formatHm(v.target)}
            </span>
            <span className={`goal-status is-${v.status}`}>{v.status === 'ongoing' ? v.remainText : STATUS_TEXT[v.status]}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
