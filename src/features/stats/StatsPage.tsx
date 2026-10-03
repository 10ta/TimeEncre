import { useMemo, useState, type CSSProperties } from 'react';
import { useRecordsInRange, useSettings, useTagMap, useTypeMap } from '../../db/hooks';
import { useNow } from '../../ui/hooks';
import { addDays, formatHm, startOfDay } from '../../lib/time';
import { daysIn, rangeOf, shiftAnchor, type RangeMode } from '../../lib/range';
import { splitByDay, type DaySeg } from '../../lib/segments';
import type { DbRecord } from '../../db/db';
import { sumByTag, sumByType, untrackedMs } from '../../lib/stats';
import { RangeNav } from '../shared/RangeNav';
import { DailyBars, DayTimeline, Donut, type Slice } from './charts';

const UNTRACKED = '__untracked';
const NO_TAG = '';

export function StatsPage() {
  const settings = useSettings();
  const typeMap = useTypeMap();
  const tagMap = useTagMap();
  useNow(60_000);
  const now = Date.now();

  const [mode, setMode] = useState<RangeMode>('week');
  const [anchor, setAnchor] = useState(now);
  const [groupBy, setGroupBy] = useState<'type' | 'tag'>('type');
  const [showUntracked, setShowUntracked] = useState(false);

  const range = rangeOf(mode, anchor, settings?.weekStart ?? 1);
  const records = useRecordsInRange(range.from, range.to);

  const computed = useMemo(() => {
    if (!records) return null;
    const byType = sumByType(records, range.from, range.to, now);
    const byTag = sumByTag(records, range.from, range.to, now);
    const tracked = [...byType.values()].reduce((a, b) => a + b, 0);
    const untracked = untrackedMs(records, range.from, range.to, now);
    return { byType, byTag, tracked, untracked };
    // now 每分钟变化一次，足够
  }, [records, range.from, range.to, Math.floor(now / 60_000)]);

  if (!computed || !typeMap || !tagMap || !settings) return null;
  const { byType, byTag, tracked, untracked } = computed;

  const typeSlices: Slice[] = [...byType]
    .map(([id, ms]) => {
      const t = typeMap.get(id);
      return { key: id, label: t ? `${t.emoji} ${t.name}` : '❔ 未知类型', color: t?.color ?? '#999', ms };
    })
    .sort((a, b) => b.ms - a.ms);
  const withUntracked = showUntracked && untracked > 0
    ? [...typeSlices, { key: UNTRACKED, label: '未记录', color: 'var(--line)', ms: untracked }]
    : typeSlices;
  const donutTotal = withUntracked.reduce((a, s) => a + s.ms, 0);

  const tagRows: Slice[] = [...byTag]
    .map(([id, ms]) => {
      if (id === NO_TAG) return { key: NO_TAG, label: '无标签', color: 'var(--muted)', ms };
      const t = tagMap.get(id);
      return { key: id, label: t ? `${t.emoji} ${t.name}` : '🏷️ 已删除的标签', color: t?.color ?? '#999', ms };
    })
    .sort((a, b) => (a.key === NO_TAG ? 1 : b.key === NO_TAG ? -1 : b.ms - a.ms));

  const rows = groupBy === 'type' ? withUntracked : tagRows;
  const base = groupBy === 'type' ? donutTotal : tracked;

  // 趋势：周/月看每日堆叠柱，日看时间轴
  const visibleTo = Math.min(range.to, addDays(startOfDay(now), 1));
  // 柱状图画满整个区间（未来的日子留空），保持每周 7 格、每月按天数排布
  const days = daysIn(range.from, range.to);
  const byDay: Map<number, DaySeg<DbRecord>[]> = records ? splitByDay(records, range.from, visibleTo, now) : new Map();
  const daily = new Map<number, Map<string, number>>();
  for (const [d, segs] of byDay) {
    const m = new Map<string, number>();
    for (const s of segs) m.set(s.rec.typeId, (m.get(s.rec.typeId) ?? 0) + s.ms);
    daily.set(d, m);
  }

  return (
    <div className="page stats">
      <header className="page-head">
        <h1>统计</h1>
      </header>

      <RangeNav
        range={range}
        now={now}
        onMode={setMode}
        onShift={(dir) => setAnchor((a) => shiftAnchor(mode, a, dir))}
        onToday={() => setAnchor(Date.now())}
        summary={tracked > 0 ? `已记录 ${formatHm(tracked)}` : '没有记录'}
      />

      <div className="history-tools">
        <div className="tabs" role="tablist" aria-label="分组方式">
          {(
            [
              ['type', '按类型'],
              ['tag', '按标签'],
            ] as const
          ).map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={groupBy === k} className={groupBy === k ? 'is-on' : undefined} onClick={() => setGroupBy(k)}>
              {label}
            </button>
          ))}
        </div>
        {groupBy === 'type' && (
          <label className="toggle is-compact">
            <input type="checkbox" checked={showUntracked} onChange={(e) => setShowUntracked(e.target.checked)} />
            <span>显示未记录时间{untracked > 0 ? `（${formatHm(untracked)}）` : ''}</span>
          </label>
        )}
      </div>

      {tracked === 0 ? (
        <p className="empty">这段时间没有记录。</p>
      ) : (
        <>
          <div className={`stats-main${groupBy === 'tag' ? ' is-tags' : ''}`}>
            {groupBy === 'type' && (
              <Donut
                slices={withUntracked}
                label={`各类型占比，共 ${formatHm(tracked)}`}
                center={
                  <>
                    <span className="donut-label">已记录</span>
                    <span className="donut-value">{formatHm(tracked)}</span>
                  </>
                }
              />
            )}
            <ul className="legend">
              {rows.map((s) => (
                <li key={s.key} style={{ '--c': s.color, '--w': `${base ? (s.ms / base) * 100 : 0}%` } as CSSProperties}>
                  <span className="legend-name">{s.label}</span>
                  <span className="legend-ms">{formatHm(s.ms)}</span>
                  <span className="legend-pct">{base ? ((s.ms / base) * 100).toFixed(1) : '0.0'}%</span>
                  <span className="legend-bar" aria-hidden="true">
                    <span />
                  </span>
                </li>
              ))}
            </ul>
          </div>
          {groupBy === 'tag' && (
            <p className="hint">一条记录有多个标签时会分别计入每个标签，所以各行之和可能超过总时长；百分比相对于总记录时长。</p>
          )}
          {groupBy === 'type' && tracked > 0 && (
            <p className="hint">
              {showUntracked
                ? '百分比相对于“各类型时长 + 未记录时间”。未记录时间按实际流逝时间计算，截止到现在。'
                : '百分比相对于各类型时长之和；同时进行的记录会分别计入。'}
            </p>
          )}

          <section className="trend">
            <h2>{mode === 'day' ? '时间轴' : '每日分布'}</h2>
            {mode === 'day' ? (
              <DayTimeline
                day={range.from}
                items={(byDay.get(range.from) ?? []).map((s) => {
                  const t = typeMap.get(s.rec.typeId);
                  return { key: s.rec.id, spans: s.spans, color: t?.color ?? '#999', label: t?.name ?? '未知类型' };
                })}
              />
            ) : (
              <DailyBars
                days={days}
                data={daily}
                order={typeSlices.map((s) => s.key)}
                colorOf={(k) => typeMap.get(k)?.color ?? '#999'}
                labelOf={(k) => typeMap.get(k)?.name ?? '未知类型'}
              />
            )}
          </section>
        </>
      )}
    </div>
  );
}
