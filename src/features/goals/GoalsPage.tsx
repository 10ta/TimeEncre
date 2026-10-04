import { useState, type CSSProperties } from 'react';
import { useFirstRecordMs, useGoals, useRecordsInRange, useSettings, useTagMap, useTypeMap } from '../../db/hooks';
import { useNow } from '../../ui/hooks';
import { formatHm } from '../../lib/time';
import { rangeLabel } from '../../lib/range';
import { HISTORY_PERIODS, goalProgressMs, goalStatus, recentPeriods } from '../../lib/stats';
import { CreateGoalForm, LiveGoalForm } from './GoalForms';
import { Drawer } from '../../ui/Drawer';
import { CURRENT_WORD, DIRECTION_LABEL, PERIOD_LABEL, STATUS_TEXT, viewGoal } from './goalView';

export function GoalsPage() {
  const goals = useGoals();
  const settings = useSettings();
  const typeMap = useTypeMap();
  const tagMap = useTagMap();
  useNow(60_000);
  const now = Date.now();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const toggle = (k: string) => setOpenKey((cur) => (cur === k ? null : k));

  // 一次取出所有目标历史需要的最早时间之后的记录
  const ws = settings?.weekStart ?? 1;
  const earliest = Math.min(
    ...(['day', 'week', 'month'] as const).map((m) => recentPeriods(m, now, ws, HISTORY_PERIODS[m]).at(-1)!.from),
  );
  const records = useRecordsInRange(earliest, now + 1);
  const firstMs = useFirstRecordMs();

  if (!goals || !settings || !typeMap || !tagMap || !records || firstMs === undefined) return null;

  return (
    <div className="page goals">
      <header className="page-head">
        <h1>目标</h1>
      </header>

      {goals.length === 0 && (
        <p className="empty">
          还没有目标。可以给类型或标签设定每天、每周、每月的时长，比如“每周至少学习 10 小时”“每天娱乐至多 1.5 小时”。
        </p>
      )}

      <ul className="goal-list">
        {goals.map((g) => {
          const periods = recentPeriods(g.period, now, ws, HISTORY_PERIODS[g.period]);
          const v = viewGoal(g, records, now, ws, typeMap, tagMap);
          const { ms, target, status, pct, elapsed, items, color, title } = v;

          return (
            <li key={g.id} className={`goal-item${openKey === g.id ? ' is-open' : ''}`}>
              <div className={`goal is-${status} is-${g.direction}`} style={{ '--c': color } as CSSProperties}>
              <button type="button" className="goal-main" aria-expanded={openKey === g.id} onClick={() => toggle(g.id)}>
                <span className="goal-head">
                  <span className="goal-title">{title}</span>
                  <span className={`goal-status is-${status}`}>{STATUS_TEXT[status]}</span>
                </span>
                <span className="goal-scope">
                  {items.map((x) => `${x.emoji}${x.name}`).join('、') || '（引用的类型或标签已删除）'}
                  {g.name && ` · ${PERIOD_LABEL[g.period]}${DIRECTION_LABEL[g.direction]} ${formatHm(target)}`}
                </span>
                <span className="goal-progress">
                  <span className="goal-bar" aria-hidden="true">
                    <span className="goal-fill" style={{ width: `${pct}%` }} />
                    {g.direction === 'atLeast' && <span className="goal-pace" style={{ left: `${elapsed * 100}%` }} title="按时间进度应到达的位置" />}
                  </span>
                  <span className="goal-numbers">
                    {CURRENT_WORD[g.period]} {formatHm(ms)} / {formatHm(target)}
                    <span className="goal-remain">
                        {v.remainText}
                    </span>
                  </span>
                </span>
              </button>
              <ol className="goal-history" aria-label="最近几个周期">
                {[...periods].reverse().map((p, i, arr) => {
                  const isCur = i === arr.length - 1;
                  // 开始记录之前的周期没有数据，不算未达成
                  if (!isCur && (firstMs === null || p.to <= firstMs))
                    return <li key={p.from} className="dot is-none" title={`${rangeLabel(p, now)}：还没开始记录`} />;
                  const pms = goalProgressMs(g, records, p.from, p.to, now);
                  const st = goalStatus(g, pms, !isCur);
                  return (
                    <li key={p.from} className={`dot is-${st}${isCur ? ' is-current' : ''}`} title={`${rangeLabel(p, now)}：${formatHm(pms)}，${STATUS_TEXT[st]}`} />
                  );
                })}
              </ol>
              </div>
              <Drawer open={openKey === g.id} onClose={() => setOpenKey(null)}>
                <div className="drawer-edge" style={{ '--c': color } as CSSProperties}>
                  <LiveGoalForm goal={g} onClose={() => setOpenKey(null)} />
                </div>
              </Drawer>
            </li>
          );
        })}
        <li>
          <button type="button" className={`add-card${openKey === 'new' ? ' is-active' : ''}`} aria-expanded={openKey === 'new'} onClick={() => toggle('new')}>
            ＋ 新建目标
          </button>
          <Drawer open={openKey === 'new'} onClose={() => setOpenKey(null)}>
            <div className="drawer-card">
              <CreateGoalForm onDone={() => setOpenKey(null)} />
            </div>
          </Drawer>
        </li>
      </ul>
      {goals.length > 0 && <p className="hint">右侧小方块是最近几个周期的达成情况，最右边是当前周期；鼠标悬停可看具体时长。“至少”型目标的竖线表示按时间进度此刻应到达的位置。</p>}

    </div>
  );
}
