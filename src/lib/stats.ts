// 统计与目标的纯计算。所有时长都按 [from, to) 裁剪，进行中的记录算到 now。
import { recordSpans, type Span } from './time';
import { rangeOf, shiftAnchor, type Range, type RangeMode } from './range';

interface RecLike {
  typeId: string;
  tagIds: string[];
  intervals: { start: string; end: string | null }[];
}

export function clippedSpans(r: RecLike, from: number, to: number, now: number): Span[] {
  return recordSpans(r, now)
    .map((s) => ({ start: Math.max(s.start, from), end: Math.min(s.end, to) }))
    .filter((s) => s.end > s.start);
}

const spanSum = (spans: Span[]) => spans.reduce((a, s) => a + (s.end - s.start), 0);

/** 按键汇总；一条记录可以属于多个键（标签） */
export function sumBy<R extends RecLike>(
  records: R[],
  from: number,
  to: number,
  now: number,
  keysOf: (r: R) => string[],
): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of records) {
    const ms = spanSum(clippedSpans(r, from, to, now));
    if (ms <= 0) continue;
    for (const k of keysOf(r)) out.set(k, (out.get(k) ?? 0) + ms);
  }
  return out;
}

export const sumByType = <R extends RecLike>(rs: R[], from: number, to: number, now: number) =>
  sumBy(rs, from, to, now, (r) => [r.typeId]);

/** 没有标签的记录归到 '' */
export const sumByTag = <R extends RecLike>(rs: R[], from: number, to: number, now: number) =>
  sumBy(rs, from, to, now, (r) => (r.tagIds.length ? r.tagIds : ['']));

/** 区间并集的总长度（同时进行的记录只算一次） */
export function unionMs(spans: Span[]): number {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  let total = 0;
  let curS = -Infinity;
  let curE = -Infinity;
  for (const s of sorted) {
    if (s.start > curE) {
      if (curE > curS) total += curE - curS;
      curS = s.start;
      curE = s.end;
    } else curE = Math.max(curE, s.end);
  }
  if (curE > curS) total += curE - curS;
  return total;
}

/** 实际流逝时间（截止到 now）中没有被任何记录覆盖的部分 */
export function untrackedMs(records: RecLike[], from: number, to: number, now: number): number {
  const end = Math.min(to, now);
  if (end <= from) return 0;
  return end - from - unionMs(records.flatMap((r) => clippedSpans(r, from, end, now)));
}

// ---------- 目标 ----------

export interface GoalLike {
  typeIds: string[];
  tagIds: string[];
  period: RangeMode;
  direction: 'atLeast' | 'atMost';
  targetMinutes: number;
}

export const matchesGoal = (g: GoalLike, r: RecLike) =>
  g.typeIds.includes(r.typeId) || r.tagIds.some((t) => g.tagIds.includes(t));

export function goalProgressMs(g: GoalLike, records: RecLike[], from: number, to: number, now: number): number {
  return records.filter((r) => matchesGoal(g, r)).reduce((a, r) => a + spanSum(clippedSpans(r, from, to, now)), 0);
}

export type GoalStatus = 'met' | 'missed' | 'ongoing' | 'over';

/** 已结束的周期：达成 / 未达成；当前周期：“至少”型未达到前为进行中，“至多”型超了就是 over */
export function goalStatus(g: GoalLike, ms: number, finished: boolean): GoalStatus {
  const target = g.targetMinutes * 60_000;
  if (g.direction === 'atLeast') return ms >= target ? 'met' : finished ? 'missed' : 'ongoing';
  return ms > target ? (finished ? 'missed' : 'over') : finished ? 'met' : 'ongoing';
}

export const HISTORY_PERIODS: Record<RangeMode, number> = { day: 14, week: 8, month: 6 };

/** 当前周期在前、往回数 n 个周期 */
export function recentPeriods(mode: RangeMode, now: number, weekStart: number, n: number): Range[] {
  const out: Range[] = [];
  let anchor = now;
  for (let i = 0; i < n; i++) {
    out.push(rangeOf(mode, anchor, weekStart));
    anchor = shiftAnchor(mode, anchor, -1);
  }
  return out;
}
