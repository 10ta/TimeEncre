// 统计页每一行的附加信息：平均、与上一期比较、趋势小折线、目标完成情况，以及点开后的详情。
import { useMemo, type CSSProperties } from 'react';
import type { DbRecord } from '../../db/db';
import type { Goal } from '../../schema';
import { addDays, formatHm, startOfDay } from '../../lib/time';
import type { Range, RangeMode } from '../../lib/range';
import { MIN_BASELINE, dailyUnion, lastIsPartial, sessionStats, streaks, type Baseline, type Change, type GoalMark } from '../../lib/insights';
import { daysIn, rangeLabel } from '../../lib/range';
import { dayOfMonth, monthShort, shortDate } from '../../i18n/dates';
import { STATUS_TEXT, evalText } from '../goals/goalView';
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

/** “平均”那一列的名字：周 / 月视图是日均（只算已经过完的日子）；日视图没有 */
export const avgLabel = (mode: RangeMode) => (mode === 'day' ? '' : tr("日均"));
/** 比较那一列的名字 */
export const cmpLabel = (mode: RangeMode) =>
  mode === 'day' ? tr("较近 4 周同一天") : mode === 'week' ? tr("较近 4 周同期") : tr("较近 3 月同期");

/** 比较值的写法：到现在为止的是总时长，其余是“每天” */
export const valueText = (v: number, partial: boolean) => (partial ? formatHm(v) : tr("{0}/天", formatHm(v)));

/** 趋势里每一期的短标签 */
export const periodLabel = (mode: RangeMode, r: Range) =>
  mode === 'day' ? String(dayOfMonth(r.from)) : mode === 'week' ? shortDate(r.from) : monthShort(r.from, r.from);

/** 悬停提示：往常是多少、范围多少、比的是哪一段 */
export function baselineTitle(b: Baseline): string {
  if (b.median == null) return tr("往前还没有可比较的同期数据");
  const what = b.partial ? tr("到现在为止") : tr("已经过完的日子");
  return tr("本期（{0}）：{1}；往常（{2} 期同期中位数）：{3}，范围 {4}–{5}", what, valueText(b.cur, b.partial), b.n, valueText(b.median, b.partial), formatHm(b.min!), formatHm(b.max!));
}

/**
 * 和往常（往前几期同一段的中位数）比较。
 * 落在往常范围（往期最小–最大）里就是“≈ 常态”，不标箭头；超出范围才标 ↑ / ↓：
 * 这一项设了目标时分好坏上色（“至少”型多了是好事），否则用强调色、不分好坏。
 * 差得很少（5 分钟或往常的 10% 以内）也算常态。往期不足 3 期时只显示差值，灰色。
 */
export function BaselineBadge({ b, goodWhenUp }: { b: Baseline | null; goodWhenUp: boolean | null }) {
  if (!b || b.median == null) return <span className="chg is-none" title={b ? baselineTitle(b) : undefined}>—</span>;
  const title = baselineTitle(b);
  const delta = b.cur - b.median;
  const pct = b.median > 0 ? delta / b.median : null;
  // 差得很少（5 分钟或往常的 10% 以内）的，即使刚好超出范围也不值得标出来
  const tiny = Math.abs(delta) < Math.max(5 * 60_000, b.median * 0.1);
  if (b.n >= MIN_BASELINE && (b.outside === 0 || tiny))
    return (
      <span className="chg is-neutral is-normal" title={title}>
        ≈ {tr("常态")}
      </span>
    );
  if (tiny)
    return (
      <span className="chg is-neutral" title={title}>
        → {tr("持平")}
      </span>
    );
  const up = delta > 0;
  const tone = b.outside === 0 ? 'is-neutral' : goodWhenUp == null ? 'is-notable' : up === goodWhenUp ? 'is-good' : 'is-bad';
  return (
    <span className={`chg ${tone}`} title={title}>
      {up ? '↑' : '↓'} {formatHm(Math.abs(delta))}
      {pct != null && <span className="chg-pct"> {Math.round(Math.abs(pct) * 100)}%</span>}
    </span>
  );
}

/** 作息等按晚平均的指标仍和上一期比：↑ / ↓ 加差值和百分比，不分好坏 */
export function ChangeBadge({ cmp, prevText }: { cmp: Change | null; prevText: string | null }) {
  if (!cmp) return <span className="chg is-none">—</span>;
  const flat = Math.abs(cmp.delta) < 60_000 || (cmp.pct != null && Math.abs(cmp.pct) < 0.03);
  const title = prevText ? tr("上一期：{0}", prevText) : undefined;
  if (flat)
    return (
      <span className="chg is-neutral" title={title}>
        → {tr("持平")}
      </span>
    );
  return (
    <span className="chg is-neutral" title={title}>
      {cmp.delta > 0 ? '↑' : '↓'} {formatHm(Math.abs(cmp.delta))}
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
            m.status === 'none' ? tr("还没开始记录") : m.status === 'future' ? tr("还没到") : `${m.ev ? evalText(goal, m.ev) : formatHm(m.ms)} · ${STATUS_TEXT[m.status]}`
          }`}
        >
          {MARK_GLYPH[m.status]}
        </span>
      ))}
      {judged.length > 0 && <span className="gmark-sum">{tr("{0}/{1} 达成", met, judged.length)}</span>}
    </span>
  );
}

/** 点开一行：大折线图 + 本期 / 往常 / 连续天数 / 分段 */
export function RowDetail({
  ctx,
  color,
  label,
  series,
  match,
  untracked,
  baseline,
}: {
  ctx: StatsCtx;
  color: string;
  label: string;
  series: Array<number | null>;
  /** 哪些记录算这一行（未记录这一行没有） */
  match: ((r: DbRecord) => boolean) | null;
  untracked?: boolean;
  baseline: Baseline | null;
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
  const b = baseline;

  return (
    <div className="row-detail" style={{ '--c': color } as CSSProperties}>
      <LineChart
        values={series}
        labels={trend.map((r) => periodLabel(mode, r))}
        color={color}
        format={(v) => formatHm(v)}
        label={tr("{0}：最近 {1} 期", label, trend.length)}
        partialLast={lastIsPartial(trend, now)}
      />
      <dl className="detail-grid">
        <div>
          <dt>{!b ? tr("本期") : b.partial ? tr("到现在为止") : mode === 'day' ? tr("当天") : tr("日均（已过完的 {0} 天）", b.days)}</dt>
          <dd>{b ? valueText(b.cur, b.partial) : '—'}</dd>
        </div>
        <div>
          <dt>{tr("往常（同期中位数）")}</dt>
          <dd>
            {b?.median == null ? '—' : valueText(b.median, b.partial)}
            {b?.median != null && <small>{tr("{0} 期 · 范围 {1}–{2}", b.n, formatHm(b.min!), formatHm(b.max!))}</small>}
          </dd>
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
