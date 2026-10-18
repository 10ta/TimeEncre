import { useMemo, useState, type CSSProperties } from 'react';
import { useFirstRecordMs, useGoals, useRecordsInRange, useSettings, useTagMap, useTypeMap, useTypes } from '../../db/hooks';
import { useNow } from '../../ui/hooks';
import { addDays, formatHm, startOfDay } from '../../lib/time';
import { daysIn, rangeOf, shiftAnchor, type RangeMode } from '../../lib/range';
import { splitByDay, type DaySeg } from '../../lib/segments';
import type { DbRecord } from '../../db/db';
import {
  change, countedDays, goalForKey, goalMarks, periodValue, previousValue, previousWindow, totalsBy, trendRanges, untrackedIn,
} from '../../lib/insights';
import { RangeNav } from '../shared/RangeNav';
import { DailyBars, DayTimeline, Donut, Sparkline, type Slice } from './charts';
import { ChangeBadge, GoalMarksView, RowDetail, avgLabel, cmpLabel, valueText, type StatsCtx } from './StatRows';
import { MetricsPanel, PatternsPanel, PomoPanel, SleepPanel } from './Panels';
import { tr } from '../../i18n';

const UNTRACKED = '__untracked';
const NO_TAG = '';

export function StatsPage() {
  const settings = useSettings();
  const typeMap = useTypeMap();
  const tagMap = useTagMap();
  const types = useTypes();
  const goals = useGoals();
  const now = useNow(60_000);

  const [mode, setMode] = useState<RangeMode>('week');
  const [anchor, setAnchor] = useState(now);
  const [groupBy, setGroupBy] = useState<'type' | 'tag'>('type');
  const [showUntracked, setShowUntracked] = useState(false);
  const [openRow, setOpenRow] = useState<string | null>(null);

  const ws = settings?.weekStart ?? 1;
  const range = rangeOf(mode, anchor, ws);
  const trend = useMemo(() => trendRanges(mode, anchor, ws), [mode, anchor, ws]);
  const prevWin = useMemo(() => previousWindow(mode, range, ws), [mode, range.from, range.to, ws]); // eslint-disable-line react-hooks/exhaustive-deps
  // 一次取够：趋势的最早一期、上一期、目标所在的周 / 月、连续天数要看的近一年
  const today = startOfDay(now);
  const dataFrom = Math.min(trend[0].from, prevWin.from, rangeOf('week', range.from, ws).from, rangeOf('month', range.from, ws).from, addDays(today, -365));
  const dataTo = Math.max(range.to, addDays(today, 1), rangeOf('month', range.from, ws).to);
  const records = useRecordsInRange(dataFrom, dataTo);
  const firstMs = useFirstRecordMs();

  const keysOf = useMemo(
    () => (groupBy === 'type' ? (r: DbRecord) => [r.typeId] : (r: DbRecord) => (r.tagIds.length ? r.tagIds : [NO_TAG])),
    [groupBy],
  );

  const computed = useMemo(() => {
    if (!records || firstMs === undefined) return null;
    const fm = firstMs ?? null;
    const totals = totalsBy(records, range.from, range.to, now, keysOf);
    const byType = groupBy === 'type' ? totals : totalsBy(records, range.from, range.to, now, (r) => [r.typeId]);
    const tracked = [...byType.values()].reduce((a, b) => a + b, 0);
    const untracked = untrackedIn(records, range.from, range.to, now, fm);
    const days = countedDays(range, now, fm);
    const prevTotals = totalsBy(records, prevWin.from, prevWin.to, now, keysOf);
    const prevDays = countedDays(prevWin, now, fm);
    const prevUntracked = untrackedIn(records, prevWin.from, prevWin.to, now, fm);
    // 趋势：每一期各键的时长，再换成比较值
    const trendDays = trend.map((r) => countedDays(r, now, fm));
    const trendTotals = trend.map((r) => totalsBy(records, r.from, r.to, now, keysOf));
    const trendUntracked = trend.map((r) => untrackedIn(records, r.from, r.to, now, fm));
    const seriesOf = (key: string) =>
      key === UNTRACKED
        ? trend.map((_, i) => (trendDays[i] ? periodValue(trendUntracked[i], mode, trendDays[i]) : null))
        : trend.map((_, i) => (trendDays[i] ? periodValue(trendTotals[i].get(key) ?? 0, mode, trendDays[i]) : null));
    return { totals, byType, tracked, untracked, days, prevTotals, prevDays, prevUntracked, seriesOf };
  }, [records, firstMs, range.from, range.to, prevWin, trend, now, keysOf, groupBy, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // 趋势：周/月看每日堆叠柱，日看时间轴
  const visibleTo = Math.min(range.to, addDays(today, 1));
  const { byDay, daily } = useMemo(() => {
    const byDay: Map<number, DaySeg<DbRecord>[]> = records ? splitByDay(records, range.from, visibleTo, now) : new Map();
    const daily = new Map<number, Map<string, number>>();
    for (const [d, segs] of byDay) {
      const m = new Map<string, number>();
      for (const s of segs) m.set(s.rec.typeId, (m.get(s.rec.typeId) ?? 0) + s.ms);
      daily.set(d, m);
    }
    return { byDay, daily };
  }, [records, range.from, visibleTo, now]);

  if (!computed || !typeMap || !tagMap || !settings || !records || !goals || !types) return null;
  const { totals, byType, tracked, untracked, days: nDays, prevTotals, prevDays, prevUntracked, seriesOf } = computed;
  const fm = firstMs ?? null;
  const ctx: StatsCtx = { mode, range, prevWin, trend, records, now, firstMs: fm, weekStart: ws };

  const typeSlices: Slice[] = [...byType]
    .map(([id, ms]) => {
      const t = typeMap.get(id);
      return { key: id, label: t ? `${t.emoji} ${t.name}` : tr("❔ 未知活动"), color: t?.color ?? '#999', ms };
    })
    .sort((a, b) => b.ms - a.ms);
  const withUntracked = showUntracked && untracked > 0
    ? [...typeSlices, { key: UNTRACKED, label: tr("未记录"), color: 'var(--line)', ms: untracked }]
    : typeSlices;
  const donutTotal = withUntracked.reduce((a, s) => a + s.ms, 0);

  const tagRows: Slice[] = [...totals]
    .map(([id, ms]) => {
      if (id === NO_TAG) return { key: NO_TAG, label: tr("无标签"), color: 'var(--muted)', ms };
      const t = tagMap.get(id);
      return { key: id, label: t ? `${t.emoji} ${t.name}` : tr("🏷️ 已删除的标签"), color: t?.color ?? '#999', ms };
    })
    .sort((a, b) => (a.key === NO_TAG ? 1 : b.key === NO_TAG ? -1 : b.ms - a.ms));

  const rows = groupBy === 'type' ? withUntracked : tagRows;
  const base = groupBy === 'type' ? donutTotal : tracked;

  // 柱状图画满整个区间（未来的日子留空），保持每周 7 格、每月按天数排布
  const days = daysIn(range.from, range.to);

  const rowInfo = (key: string, ms: number) => {
    const isGap = key === UNTRACKED;
    const prevMs = isGap ? prevUntracked : prevTotals.get(key) ?? 0;
    const cur = periodValue(ms, mode, nDays);
    const prev = previousValue(prevMs, mode, prevDays);
    const goal = isGap || key === NO_TAG ? undefined : goalForKey(goals, key, groupBy);
    return {
      cur,
      prev,
      cmp: change(cur, prev),
      goal,
      marks: goal ? goalMarks(goal, records, range, now, fm, ws) : null,
      series: seriesOf(key),
      match: isGap ? null : groupBy === 'type' ? (r: DbRecord) => r.typeId === key : (r: DbRecord) => (key === NO_TAG ? r.tagIds.length === 0 : r.tagIds.includes(key)),
    };
  };

  return (
    <div className="page stats">
      <header className="page-head">
        <h1>{tr("统计")}</h1>
      </header>

      <RangeNav
        range={range}
        now={now}
        onMode={setMode}
        onShift={(dir) => setAnchor((a) => shiftAnchor(mode, a, dir))}
        onToday={() => setAnchor(Date.now())}
        summary={tracked > 0 ? tr("已记录 {0}", formatHm(tracked)) : tr("没有记录")}
      />

      <div className="history-tools">
        <div className="tabs" role="tablist" aria-label={tr("分组方式")}>
          {(
            [
              ['type', tr("按活动")],
              ['tag', tr("按标签")],
            ] as const
          ).map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={groupBy === k} className={groupBy === k ? 'is-on' : undefined} onClick={() => setGroupBy(k)}>
              {label}
            </button>
          ))}
        </div>
        {groupBy === 'type' && (
          <>
            <label className="toggle is-compact">
              <input type="checkbox" checked={showUntracked} onChange={(e) => setShowUntracked(e.target.checked)} />
              <span>{tr("显示未记录时间")}{untracked > 0 ? tr("（{0}）", formatHm(untracked)) : ''}</span>
            </label>
            {untracked > 0 && (
              <a className="section-link" href={`#/history?mode=${mode}&anchor=${anchor}&gaps=1`}>
                {tr("查看这些空白 ›")}
              </a>
            )}
          </>
        )}
      </div>

      {tracked === 0 ? (
        <p className="empty">{tr("这段时间没有记录。")}</p>
      ) : (
        <>
          <div className={`stats-main${groupBy === 'tag' ? ' is-tags' : ''}`}>
            {groupBy === 'type' && (
              <Donut
                slices={withUntracked}
                label={tr("各活动占比，共 {0}", formatHm(tracked))}
                center={
                  <>
                    <span className="donut-label">{tr("已记录")}</span>
                    <span className="donut-value">{formatHm(tracked)}</span>
                  </>
                }
              />
            )}
            <div className="legend-wrap">
              <div className={`legend-head is-${mode}`} aria-hidden="true">
                <span />
                <span>{tr("总计")}</span>
                {mode !== 'day' && <span>{avgLabel(mode)}</span>}
                <span>{cmpLabel(mode)}</span>
                <span>{tr("趋势")}</span>
                <span>%</span>
              </div>
              <ul className={`legend is-${mode}`}>
                {rows.map((s) => {
                  const info = rowInfo(s.key, s.ms);
                  const open = openRow === s.key;
                  const goodWhenUp = info.goal ? info.goal.direction === 'atLeast' : null;
                  return (
                    <li key={s.key} className={open ? 'is-open' : undefined} style={{ '--c': s.color, '--w': `${base ? (s.ms / base) * 100 : 0}%` } as CSSProperties}>
                      <button type="button" className="legend-row" aria-expanded={open} onClick={() => setOpenRow(open ? null : s.key)}>
                        <span className="legend-name">{s.key === UNTRACKED ? tr("未记录") : s.label}</span>
                        <span className="legend-ms">{formatHm(s.ms)}</span>
                        {mode !== 'day' && <span className="legend-avg" data-label={`${avgLabel(mode)} `}>{info.cur == null ? '—' : formatHm(info.cur)}</span>}
                        <span className="legend-chg">
                          <ChangeBadge cmp={info.cmp} goodWhenUp={goodWhenUp} prevText={info.prev == null ? null : valueText(mode, info.prev)} />
                        </span>
                        <span className="legend-spark">
                          <Sparkline values={info.series} color={s.key === UNTRACKED ? 'var(--muted)' : s.color} label={tr("{0} 的趋势", s.label)} />
                        </span>
                        <span className="legend-pct">{base ? ((s.ms / base) * 100).toFixed(1) : '0.0'}%</span>
                        <span className="legend-bar" aria-hidden="true">
                          <span />
                        </span>
                        {info.goal && info.marks && (
                          <span className="legend-goal">
                            <GoalMarksView goal={info.goal} marks={info.marks} now={now} />
                          </span>
                        )}
                      </button>
                      {open && (
                        <RowDetail
                          ctx={ctx}
                          color={s.key === UNTRACKED ? 'var(--muted)' : s.color}
                          label={s.label}
                          series={info.series}
                          match={info.match}
                          untracked={s.key === UNTRACKED}
                          cur={info.cur}
                          prev={info.prev}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
              {untrackedLink(groupBy, showUntracked, untracked, mode, anchor)}
            </div>
          </div>
          {groupBy === 'tag' && (
            <p className="hint">{tr("一条记录有多个标签时会分别计入每个标签，所以各行之和可能超过总时长；百分比相对于总记录时长。")}</p>
          )}
          {groupBy === 'type' && tracked > 0 && (
            <p className="hint">
              {showUntracked
                ? tr("百分比相对于“各活动时长 + 未记录时间”。未记录时间按实际流逝时间计算，截止到现在。")
                : tr("百分比相对于各活动时长之和；同时进行的记录会分别计入。")}
            </p>
          )}
          <p className="hint">
            {mode === 'day'
              ? tr("箭头和当天之前 7 天的日均比较；趋势是最近 14 天。")
              : mode === 'week'
                ? tr("日均按本周到今天为止的天数算（开始使用之前的日子不算）；箭头比较的是日均。趋势是最近 8 周的日均。")
                : tr("周均 = 日均 × 7，按本月到今天为止的天数算；箭头比较的是周均。趋势是最近 6 个月的周均。")}{' '}
            {tr("只有设了目标（只针对这一项）的活动，箭头才分红绿，并显示 ✓ / ✗。点一行看详情。")}
          </p>

          <section className="trend">
            <h2>{mode === 'day' ? tr("时间轴") : tr("每日分布")}</h2>
            {mode === 'day' ? (
              <DayTimeline
                day={range.from}
                items={(byDay.get(range.from) ?? []).map((s) => {
                  const t = typeMap.get(s.rec.typeId);
                  return { key: s.rec.id, spans: s.spans, color: t?.color ?? '#999', label: t?.name ?? tr("未知活动") };
                })}
              />
            ) : (
              <DailyBars
                days={days}
                data={daily}
                order={typeSlices.map((s) => s.key)}
                colorOf={(k) => typeMap.get(k)?.color ?? '#999'}
                labelOf={(k) => typeMap.get(k)?.name ?? tr("未知活动")}
              />
            )}
          </section>
        </>
      )}

      <SleepPanel ctx={ctx} settings={settings} types={types} />
      <MetricsPanel ctx={ctx} settings={settings} typeMap={typeMap} tagMap={tagMap} />
      <PatternsPanel ctx={ctx} typeMap={typeMap} topTypes={typeSlices.map((s) => s.key)} />
      <PomoPanel ctx={ctx} settings={settings} />
    </div>
  );
}

/** “未记录”这一行没有直接跳到历史的链接了（整行点开是详情），在列表下面补一个 */
function untrackedLink(groupBy: 'type' | 'tag', show: boolean, untracked: number, mode: RangeMode, anchor: number) {
  if (groupBy !== 'type' || !show || untracked <= 0) return null;
  return (
    <a className="section-link legend-gaplink" href={`#/history?mode=${mode}&anchor=${anchor}&gaps=1`}>
      {tr("到历史里查看这些空白 ›")}
    </a>
  );
}
