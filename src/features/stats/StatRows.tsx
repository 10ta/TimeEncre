// 统计页每一行的附加信息：平均、与上一期比较、趋势小折线、目标完成情况，以及点开后的详情。
import { useMemo, type CSSProperties } from 'react';
import type { DbRecord } from '../../db/db';
import type { Goal } from '../../schema';
import { addDays, formatHm, startOfDay } from '../../lib/time';
import type { Range, RangeMode } from '../../lib/range';
import { dailyUnion, sessionStats, streaks, type Change, type GoalMark } from '../../lib/insights';
import { daysIn, rangeLabel } from '../../lib/range';
import { dayOfMonth, monthShort, shortDate } from '../../i18n/dates';
import { STATUS_TEXT } from '../goals/goalView';
import { LineChart } from './charts';
import { tr } from '../../i18n';

/** 统计页需要的公共信息 */
export interface StatsCtx {
  mode: RangeMode;
  range: Range;
  prevWin: { from: number; to: number };
  trend: Range[];
  records: DbRecord[];
  now: number;
  firstMs: number | null;
  weekStart: number;
}

/** “平均”那一列的名字：周视图是日均，月视图是周均；日视图没有 */
export const avgLabel = (mode: RangeMode) => (mode === 'week' ? tr("日均") : mode === 'month' ? tr("周均") : '');
export const cmpLabel = (mode: RangeMode) => (mode === 'day' ? tr("较前 7 天日均") : mode === 'week' ? tr("较上周") : tr("较上月"));

/** 比较值的写法：日视图是当天时长，周视图是“每天”，月视图是“每周” */
export const valueText = (mode: RangeMode, v: number) =>
  mode === 'day' ? formatHm(v) : mode === 'week' ? tr("{0}/天", formatHm(v)) : tr("{0}/周", formatHm(v));

/** 趋势里每一期的短标签 */
export const periodLabel = (mode: RangeMode, r: Range) =>
  mode === 'day' ? String(dayOfMonth(r.from)) : mode === 'week' ? shortDate(r.from) : monthShort(r.from, r.from);

/**
 * 变化：↑ / ↓ 加差值和百分比。只有这一项设了目标时才分好坏上色：
 * “至少”型目标增加是好事（绿），“至多”型目标增加是坏事（红）；其余保持中性灰。
 */
export function ChangeBadge({ cmp, goodWhenUp, prevText }: { cmp: Change | null; goodWhenUp: boolean | null; prevText: string | null }) {
  if (!cmp) return <span className="chg is-none">—</span>;
  const flat = Math.abs(cmp.delta) < 60_000 || (cmp.pct != null && Math.abs(cmp.pct) < 0.03);
  const up = cmp.delta > 0;
  const tone = flat || goodWhenUp == null ? 'is-neutral' : up === goodWhenUp ? 'is-good' : 'is-bad';
  const title = prevText ? tr("上一期：{0}", prevText) : undefined;
  if (flat)
    return (
      <span className={`chg ${tone}`} title={title}>
        → {tr("持平")}
      </span>
    );
  return (
    <span className={`chg ${tone}`} title={title}>
      {up ? '↑' : '↓'} {formatHm(Math.abs(cmp.delta))}
      {cmp.pct != null && <span className="chg-pct"> {Math.round(Math.abs(cmp.pct) * 100)}%</span>}
    </span>
  );
}

const MARK_GLYPH: Record<GoalMark['status'], string> = { met: '✓', missed: '✗', ongoing: '', over: '!', none: '', future: '' };

/** 目标完成情况：每个周期一个小格（✓ / ✗ / 进行中 / 超了），后面是达成数 */
export function GoalMarksView({ goal, marks, now }: { goal: Goal; marks: GoalMark[]; now: number }) {
  const judged = marks.filter((m) => m.status === 'met' || m.status === 'missed');
  const met = judged.filter((m) => m.status === 'met').length;
  return (
    <span className="gmarks" title={goal.name || undefined}>
      {marks.map((m) => (
        <span
          key={m.from}
          className={`gmark is-${m.status}`}
          title={`${rangeLabel({ mode: goal.period, from: m.from, to: m.to }, now)} · ${
            m.status === 'none' ? tr("还没开始记录") : m.status === 'future' ? tr("还没到") : `${formatHm(m.ms)} · ${STATUS_TEXT[m.status]}`
          }`}
        >
          {MARK_GLYPH[m.status]}
        </span>
      ))}
      {judged.length > 0 && <span className="gmark-sum">{tr("{0}/{1} 达成", met, judged.length)}</span>}
    </span>
  );
}

/** 点开一行：大折线图 + 本期 / 上期 / 连续天数 / 分段 */
export function RowDetail({
  ctx,
  color,
  label,
  series,
  match,
  untracked,
  cur,
  prev,
}: {
  ctx: StatsCtx;
  color: string;
  label: string;
  series: Array<number | null>;
  /** 哪些记录算这一行（未记录这一行没有） */
  match: ((r: DbRecord) => boolean) | null;
  untracked?: boolean;
  cur: number | null;
  prev: number | null;
}) {
  const { mode, range, records, now, firstMs, trend } = ctx;
  const extra = useMemo(() => {
    if (!match) return null;
    const mine = records.filter(match);
    const today = startOfDay(now);
    const from = Math.max(addDays(today, -364), firstMs == null ? today : startOfDay(firstMs));
    const days = daysIn(from, addDays(today, 1));
    const st = streaks(dailyUnion(mine, from, addDays(today, 1), now), days);
    const ss = sessionStats(mine, range.from, range.to, now);
    return { st, ss };
  }, [match, records, now, firstMs, range.from, range.to]);

  return (
    <div className="row-detail" style={{ '--c': color } as CSSProperties}>
      <LineChart
        values={series}
        labels={trend.map((r) => periodLabel(mode, r))}
        color={color}
        format={(v) => formatHm(v)}
        label={tr("{0}：最近 {1} 期", label, trend.length)}
      />
      <dl className="detail-grid">
        <div>
          <dt>{mode === 'day' ? tr("当天") : avgLabel(mode)}</dt>
          <dd>{cur == null ? '—' : valueText(mode, cur)}</dd>
        </div>
        <div>
          <dt>{cmpLabel(mode)}</dt>
          <dd>{prev == null ? '—' : valueText(mode, prev)}</dd>
        </div>
        {extra && (
          <>
            <div>
              <dt>{tr("连续天数")}</dt>
              <dd>
                {tr("{0} 天", extra.st.current)}
                <small>{tr("近一年最长 {0} 天", extra.st.longest)}</small>
              </dd>
            </div>
            <div>
              <dt>{tr("本期分段")}</dt>
              <dd>
                {tr("{0} 段", extra.ss.count)}
                {extra.ss.count > 0 && <small>{tr("平均 {0} · 最长 {1}", formatHm(extra.ss.avgMs), formatHm(extra.ss.longestMs))}</small>}
              </dd>
            </div>
          </>
        )}
        {untracked && (
          <div>
            <dt>{tr("说明")}</dt>
            <dd>
              <small>{tr("实际流逝的时间里没被任何记录覆盖的部分，截止到现在。")}</small>
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}
