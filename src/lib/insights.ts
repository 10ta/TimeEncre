// 统计页的进一步分析（纯函数）：平均值、与上一期比较、趋势序列、目标完成情况、作息规律、
// 自定义指标、星期 / 时段规律、连续天数、Pomo。所有“哪一天 / 几点”都按设置里的时区算。
import { addDays, recordSpans, startOfDay, type Span } from './time';
import { daysIn, rangeOf, shiftAnchor, type Range, type RangeMode } from './range';
import { fromParts, zparts } from './zone';
import { clippedSpans, goalProgressMs, goalStatus, unionMs, type GoalLike, type GoalStatus } from './stats';

export interface RecLike {
  id?: string;
  typeId: string;
  tagIds: string[];
  comment?: string;
  intervals: { start: string; end: string | null }[];
}

const H = 3_600_000;

/** 趋势往回看几期（含本期）：日视图 14 天，周视图 8 周，月视图 6 个月 */
export const TREND_PERIODS: Record<RangeMode, number> = { day: 14, week: 8, month: 6 };

// ---------- 平均 ----------

/**
 * 计入平均的天数：区间里到今天为止（今天算一整天）、且不早于第一条记录那天的天数。
 * 还没过完的本周 / 本月按已过去的天数算，开始用之前的日子不算。
 */
export function countedDays(range: { from: number; to: number }, now: number, firstMs: number | null): number {
  if (firstMs == null) return 0;
  const from = Math.max(range.from, startOfDay(firstMs));
  const to = Math.min(range.to, addDays(startOfDay(now), 1));
  let n = 0;
  for (let d = from; d < to; d = addDays(d, 1)) n++;
  return n;
}

/**
 * 每一期用来比较的数值：日视图 = 当天总时长；周视图 = 日均；月视图 = 周均（日均 × 7）。
 * 没有可计入的天数时为 null。
 */
export function periodValue(total: number, mode: RangeMode, days: number): number | null {
  if (mode === 'day') return days > 0 ? total : null;
  if (days <= 0) return null;
  return mode === 'week' ? total / days : (total / days) * 7;
}

/** 与哪一段比较：周 / 月是上一周 / 上一月；日是前 7 天的日均（和昨天单独比太随机） */
export function previousWindow(mode: RangeMode, range: Range, weekStart: number): { from: number; to: number } {
  if (mode === 'day') return { from: addDays(range.from, -7), to: range.from };
  return rangeOf(mode, shiftAnchor(mode, range.from, -1), weekStart);
}

/** 上一期的比较值：日视图用前 7 天的日均，其余同 periodValue */
export function previousValue(total: number, mode: RangeMode, days: number): number | null {
  if (days <= 0) return null;
  return mode === 'day' ? total / days : periodValue(total, mode, days);
}

export interface Change {
  /** 本期 - 上期（同单位） */
  delta: number;
  /** 相对变化；上期为 0 时为 null */
  pct: number | null;
}

export function change(cur: number | null, prev: number | null): Change | null {
  if (cur == null || prev == null) return null;
  return { delta: cur - prev, pct: prev > 0 ? (cur - prev) / prev : null };
}

// ---------- 分组求和 ----------

export type KeyOf<R> = (r: R) => string[];

/** 各键在 [from, to) 里的时长（一条记录可以属于多个键） */
export function totalsBy<R extends RecLike>(records: R[], from: number, to: number, now: number, keysOf: KeyOf<R>): Map<string, number> {
  const out = new Map<string, number>();
  if (to <= from) return out;
  for (const r of records) {
    const ms = clippedSpans(r, from, to, now).reduce((a, s) => a + s.end - s.start, 0);
    if (ms <= 0) continue;
    for (const k of keysOf(r)) out.set(k, (out.get(k) ?? 0) + ms);
  }
  return out;
}

/** 一组记录在 [from, to) 里覆盖的时间（同时进行的只算一次） */
export function unionTotal(records: RecLike[], from: number, to: number, now: number): number {
  if (to <= from) return 0;
  return unionMs(records.flatMap((r) => clippedSpans(r, from, to, now)));
}

/** 未记录：实际流逝（不早于第一条记录、不晚于现在）中没被任何记录覆盖的时间 */
export function untrackedIn(records: RecLike[], from: number, to: number, now: number, firstMs: number | null): number {
  if (firstMs == null) return 0;
  const a = Math.max(from, firstMs);
  const b = Math.min(to, now);
  if (b <= a) return 0;
  return b - a - unionTotal(records, a, b, now);
}

// ---------- 趋势 ----------

/** 往回 n 期（最早的在前，最后一期就是当前这期） */
export function trendRanges(mode: RangeMode, anchor: number, weekStart: number, n = TREND_PERIODS[mode]): Range[] {
  const out: Range[] = [];
  let a = anchor;
  for (let i = 0; i < n; i++) {
    out.unshift(rangeOf(mode, a, weekStart));
    a = shiftAnchor(mode, a, -1);
  }
  return out;
}

/** 每一期的比较值序列；还没开始用或在将来的期为 null */
export function trendSeries(
  ranges: Range[],
  mode: RangeMode,
  now: number,
  firstMs: number | null,
  totalOf: (from: number, to: number) => number,
): Array<number | null> {
  return ranges.map((r) => {
    const days = countedDays(r, now, firstMs);
    if (days <= 0) return null;
    return periodValue(totalOf(r.from, r.to), mode, days);
  });
}

// ---------- 目标完成情况 ----------

export interface GoalMark {
  from: number;
  to: number;
  /** none = 还没开始用（第一条记录之前）；future = 还没到 */
  status: GoalStatus | 'none' | 'future';
  ms: number;
}

/**
 * 视图区间里目标的各个周期：每日目标在周视图里是 7 天，在月视图里是当月每天；
 * 每周目标是与区间有交集的各周；比区间长的目标（例如周视图里的每月目标）就是包含它的那一期。
 */
export function goalMarks(
  goal: GoalLike,
  records: RecLike[],
  range: { from: number; to: number },
  now: number,
  firstMs: number | null,
  weekStart: number,
): GoalMark[] {
  const seen = new Set<number>();
  const out: GoalMark[] = [];
  for (const d of daysIn(range.from, range.to)) {
    const p = rangeOf(goal.period, d, weekStart);
    if (seen.has(p.from)) continue;
    seen.add(p.from);
    if (p.from > now) {
      out.push({ from: p.from, to: p.to, status: 'future', ms: 0 });
      continue;
    }
    if (firstMs == null || p.to <= firstMs) {
      out.push({ from: p.from, to: p.to, status: 'none', ms: 0 });
      continue;
    }
    const ms = goalProgressMs(goal, records, p.from, p.to, now);
    out.push({ from: p.from, to: p.to, status: goalStatus(goal, ms, p.to <= now), ms });
  }
  return out;
}

/** 只针对某一个活动（或某一个标签）的目标，才在那一行显示完成情况和红绿箭头 */
export function goalForKey<G extends GoalLike>(goals: G[], key: string, kind: 'type' | 'tag'): G | undefined {
  return goals.find((g) =>
    kind === 'type'
      ? g.typeIds.length === 1 && g.typeIds[0] === key && g.tagIds.length === 0
      : g.tagIds.length === 1 && g.tagIds[0] === key && g.typeIds.length === 0,
  );
}

// ---------- 每天的时长、连续天数、分段 ----------

/** 每天（0 点）匹配记录覆盖的时长；同时进行的只算一次 */
export function dailyUnion(records: RecLike[], from: number, to: number, now: number): Map<number, number> {
  const spans = records.flatMap((r) => recordSpans(r, now));
  const out = new Map<number, number>();
  for (const day of daysIn(from, to)) {
    const end = addDays(day, 1);
    const clipped = spans
      .map((s) => ({ start: Math.max(s.start, day), end: Math.min(s.end, end) }))
      .filter((s) => s.end > s.start);
    if (clipped.length) out.set(day, unionMs(clipped));
  }
  return out;
}

/**
 * 连续天数：当前连续（今天还没做的话从昨天往回数，今天还有机会）和窗口里最长的一次。
 * days 是从早到晚、截止到今天的每一天。
 */
export function streaks(daily: Map<number, number>, days: number[], minMs = 60_000): { current: number; longest: number } {
  let longest = 0;
  let run = 0;
  for (const d of days) {
    run = (daily.get(d) ?? 0) >= minMs ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  let current = 0;
  let i = days.length - 1;
  if (i >= 0 && (daily.get(days[i]) ?? 0) < minMs) i--; // 今天还没做，不算断
  for (; i >= 0 && (daily.get(days[i]) ?? 0) >= minMs; i--) current++;
  return { current, longest };
}

export interface SessionStats {
  count: number;
  totalMs: number;
  avgMs: number;
  longestMs: number;
}

/** 分段：每个计时区间（暂停会分成几段）算一段，按区间裁剪 */
export function sessionStats(records: RecLike[], from: number, to: number, now: number): SessionStats {
  const spans = records.flatMap((r) => clippedSpans(r, from, to, now));
  const total = spans.reduce((a, s) => a + s.end - s.start, 0);
  return {
    count: spans.length,
    totalMs: total,
    avgMs: spans.length ? total / spans.length : 0,
    longestMs: spans.reduce((m, s) => Math.max(m, s.end - s.start), 0),
  };
}

// ---------- 作息 ----------

export interface MeanSd {
  /** 分钟 */
  mean: number;
  sd: number;
}

export interface SleepStats {
  nights: number;
  /** 入睡：从中午 12 点起算的分钟（这样 23:00 和 01:00 是连续的） */
  bed: MeanSd | null;
  /** 起床：从 0 点起算的分钟 */
  wake: MeanSd | null;
  avgMs: number;
  /** 不到 3 小时的算小睡，不计入作息 */
  naps: number;
}

const MAIN_SLEEP_MS = 3 * H;

function meanSd(xs: number[]): MeanSd | null {
  if (!xs.length) return null;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
  return { mean, sd };
}

/** 睡眠记录：一条记录是一晚（中途醒来暂停也算同一晚），按起床时间落在哪一期来归属 */
export function sleepStats(records: RecLike[], from: number, to: number, now: number): SleepStats {
  const bed: number[] = [];
  const wake: number[] = [];
  const durs: number[] = [];
  let naps = 0;
  for (const r of records) {
    if (r.intervals.some((iv) => iv.end === null)) continue; // 还在睡
    const spans = recordSpans(r, now);
    if (!spans.length) continue;
    const start = spans[0].start;
    const end = spans[spans.length - 1].end;
    if (end < from || end >= to) continue;
    const dur = spans.reduce((a, s) => a + s.end - s.start, 0);
    if (dur < MAIN_SLEEP_MS) {
      naps++;
      continue;
    }
    const b = zparts(start);
    const w = zparts(end);
    bed.push((b.h * 60 + b.mi - 720 + 1440) % 1440);
    wake.push(w.h * 60 + w.mi);
    durs.push(dur);
  }
  return {
    nights: durs.length,
    bed: meanSd(bed),
    wake: meanSd(wake),
    avgMs: durs.length ? durs.reduce((a, b) => a + b, 0) / durs.length : 0,
    naps,
  };
}

/** 入睡的“中午起算分钟”换回一天中的分钟 */
export const bedMinuteOfDay = (m: number) => (Math.round(m) + 720) % 1440;

// ---------- 星期 / 时段规律 ----------

/** 每个星期几（0 = 周日）的平均时长；只算开始用之后、截止到今天的日子 */
export function weekdayAverages(daily: Map<number, number>, days: number[]): number[] {
  const sum = [0, 0, 0, 0, 0, 0, 0];
  const cnt = [0, 0, 0, 0, 0, 0, 0];
  for (const d of days) {
    const wd = zparts(d).wd;
    sum[wd] += daily.get(d) ?? 0;
    cnt[wd]++;
  }
  return sum.map((s, i) => (cnt[i] ? s / cnt[i] : 0));
}

/** 每天未记录的时长（截止到现在） */
export function dailyUntracked(records: RecLike[], days: number[], now: number, firstMs: number | null): Map<number, number> {
  const out = new Map<number, number>();
  for (const d of days) out.set(d, untrackedIn(records, d, addDays(d, 1), now, firstMs));
  return out;
}

/**
 * 时段热力：星期几 × 每个小时，平均有多少分钟在做这件事（或未记录）。
 * 返回 [星期几 0–6][小时 0–23] 的平均分钟数；只把已经过去的小时计入平均。
 */
export function hourHeat(
  records: RecLike[],
  days: number[],
  now: number,
  mode: 'records' | 'untracked',
  firstMs: number | null,
): number[][] {
  const sum = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  const cnt = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  const all = records.flatMap((r) => recordSpans(r, now));
  for (const d of days) {
    const p = zparts(d);
    const dayEnd = addDays(d, 1);
    const daySpans = all
      .map((s) => ({ start: Math.max(s.start, d), end: Math.min(s.end, dayEnd) }))
      .filter((s) => s.end > s.start)
      .sort((a, b) => a.start - b.start);
    for (let h = 0; h < 24; h++) {
      const a = fromParts(p.y, p.m, p.d, h);
      const b = Math.min(fromParts(p.y, p.m, p.d, h + 1), now);
      if (b <= a || (firstMs != null && b <= firstMs)) continue;
      const lo = firstMs != null ? Math.max(a, firstMs) : a;
      const covered = unionMs(daySpans.map((s) => ({ start: Math.max(s.start, lo), end: Math.min(s.end, b) })).filter((s) => s.end > s.start));
      sum[p.wd][h] += (mode === 'records' ? covered : b - lo - covered) / 60_000;
      cnt[p.wd][h]++;
    }
  }
  return sum.map((row, wd) => row.map((s, h) => (cnt[wd][h] ? s / cnt[wd][h] : 0)));
}

// ---------- Pomo ----------

export interface PomoStats {
  /** 完成的番茄：专注记录总时长达到设定的 90% */
  done: number;
  focusMs: number;
  breakMs: number;
}

export function pomoStats(
  records: RecLike[],
  from: number,
  to: number,
  now: number,
  workMin: number,
  isFocus: (r: RecLike) => boolean,
  isBreak: (r: RecLike) => boolean,
): PomoStats {
  let done = 0;
  let focusMs = 0;
  let breakMs = 0;
  for (const r of records) {
    if (isFocus(r)) {
      focusMs += clippedSpans(r, from, to, now).reduce((a, s) => a + s.end - s.start, 0);
      const spans = recordSpans(r, now);
      const end = spans[spans.length - 1]?.end ?? 0;
      const total = spans.reduce((a, s) => a + s.end - s.start, 0);
      if (!r.intervals.some((iv) => iv.end === null) && end >= from && end < to && total >= workMin * 60_000 * 0.9) done++;
    } else if (isBreak(r)) {
      breakMs += clippedSpans(r, from, to, now).reduce((a, s) => a + s.end - s.start, 0);
    }
  }
  return { done, focusMs, breakMs };
}

export type { Span };
