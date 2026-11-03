// 目标的计算（纯函数）：四种目标共用一个入口 evalGoal，目标页、首页、统计页、提醒、复盘都用它。
//  duration：周期内累计时长（默认）
//  days：周期内有几天达到 targetMinutes，目标是至少 minDays 天
//  clock：按时作息，每天一次——当天最长那段的开始（入睡）/ 结束（起床）不晚于 clockMin
//  window：只算每天 windowFrom–windowTo 时段里的时长（end ≤ start 表示跨午夜）
import { addDays, recordSpans, type Span } from './time';
import { daysIn } from './range';
import { fromParts, zparts } from './zone';
import { clippedSpans, goalStatus, matchesGoal, type GoalLike, type GoalStatus } from './stats';

export type GoalKind = 'duration' | 'days' | 'clock' | 'window';

export interface GoalSpec extends GoalLike {
  kind?: GoalKind;
  minDays?: number;
  clockEdge?: 'start' | 'end';
  clockMin?: number;
  windowFrom?: number;
  windowTo?: number;
}

interface RecLike {
  typeId: string;
  tagIds: string[];
  intervals: { start: string; end: string | null }[];
}

export const goalKind = (g: GoalSpec): GoalKind => g.kind ?? 'duration';

export interface GoalEval {
  status: GoalStatus;
  /** duration / window：毫秒；days：达标天数；clock：实际时刻（一天中的分钟，入睡按中午起算可超过 1440），没有则为 null */
  value: number | null;
  /** duration / window：目标毫秒；days：天数；clock：目标时刻（同 value 的口径） */
  target: number;
  /** 0–100，进度条用；clock 没有进度条 */
  pct: number | null;
  /** 周期内匹配记录的时长（悬停提示用） */
  ms: number;
}

const sum = (spans: Span[]) => spans.reduce((a, s) => a + s.end - s.start, 0);

/** 每天 windowFrom–windowTo 的时段（从 from 前一天开始，跨午夜的时段才不会漏掉头一段） */
export function windowSpans(fromMin: number, toMin: number, from: number, to: number): Span[] {
  const out: Span[] = [];
  for (const d of daysIn(addDays(from, -1), to)) {
    const p = zparts(d);
    const a = fromParts(p.y, p.m, p.d, 0, fromMin);
    const b = fromParts(p.y, p.m, p.d + (toMin <= fromMin ? 1 : 0), 0, toMin);
    const s = Math.max(a, from);
    const e = Math.min(b, to);
    if (e > s) out.push({ start: s, end: e });
  }
  return out;
}

/** 匹配记录在 [from, to) 里的时长；window 型只算每天的那个时段 */
export function goalMs(g: GoalSpec, records: RecLike[], from: number, to: number, now: number): number {
  const mine = records.filter((r) => matchesGoal(g, r));
  if (goalKind(g) === 'window' && g.windowFrom != null && g.windowTo != null) {
    const wins = windowSpans(g.windowFrom, g.windowTo, from, to);
    return mine.reduce((a, r) => a + wins.reduce((b, w) => b + sum(clippedSpans(r, w.start, w.end, now)), 0), 0);
  }
  return mine.reduce((a, r) => a + sum(clippedSpans(r, from, to, now)), 0);
}

/** 一天中的分钟数（所选时区） */
const minuteOfDay = (ms: number) => {
  const p = zparts(ms);
  return p.h * 60 + p.mi;
};

/**
 * 按时作息：day 这一天要看的“那一段”。
 *  start（入睡）：开始时间在 day 12:00 到次日 12:00 之间、最长的一条记录——这样 00:30 才睡也算这一晚；
 *  end（起床）：结束时间落在这一天、最长的一条记录。小睡比主睡眠短，自然被忽略。
 * 返回那一段的开始 / 结束时刻，没有时为 null；进行中的记录（还没起床）end 为 null。
 */
export function mainBlock(
  records: RecLike[],
  edge: 'start' | 'end',
  day: number,
  now: number,
): { start: number; end: number | null } | null {
  const p = zparts(day);
  const lo = edge === 'start' ? fromParts(p.y, p.m, p.d, 12) : day;
  const hi = edge === 'start' ? fromParts(p.y, p.m, p.d + 1, 12) : addDays(day, 1);
  let best: { start: number; end: number | null; dur: number } | null = null;
  for (const r of records) {
    const spans = recordSpans(r, now);
    if (!spans.length) continue;
    const start = spans[0].start;
    const open = r.intervals[r.intervals.length - 1]?.end === null;
    const end = open ? null : spans[spans.length - 1].end;
    const at = edge === 'start' ? start : end;
    if (at == null || at < lo || at >= hi) continue;
    const dur = sum(spans);
    if (!best || dur > best.dur) best = { start, end, dur };
  }
  return best && { start: best.start, end: best.end };
}

/** 入睡时刻按中午起算（23:30 → 1410，00:30 → 1470），这样过了午夜也能比较 */
export const fromNoon = (m: number) => (m < 720 ? m + 1440 : m);

function clockEval(g: GoalSpec, records: RecLike[], day: number, now: number, finished: boolean): GoalEval {
  const mine = records.filter((r) => matchesGoal(g, r));
  const edge = g.clockEdge ?? 'start';
  const p = zparts(day);
  const targetMin = edge === 'start' ? fromNoon(g.clockMin ?? 0) : (g.clockMin ?? 0);
  // 截止时刻：入睡目标按“这一晚”，可能落在第二天凌晨
  const deadline = fromParts(p.y, p.m, p.d, 0, targetMin);
  const b = mainBlock(mine, edge, day, now);
  const ms = mine.reduce((a, r) => a + sum(clippedSpans(r, day, addDays(day, 1), now)), 0);
  const at = b ? (edge === 'start' ? b.start : b.end) : null;
  if (at != null) {
    const v = edge === 'start' ? fromNoon(minuteOfDay(at)) : minuteOfDay(at);
    return { status: v <= targetMin ? 'met' : 'missed', value: v, target: targetMin, pct: null, ms };
  }
  // 还没有那一段：截止前是进行中；过了截止还没开始 / 还没结束就是晚了
  const late = now > deadline;
  return { status: late ? (finished ? 'missed' : 'over') : finished ? 'missed' : 'ongoing', value: null, target: targetMin, pct: null, ms };
}

/**
 * 目标在一个周期 [from, to) 里的情况。finished = 这个周期已经结束。
 * clock 型的周期总是一天（from 是那天 0 点）。
 */
export function evalGoal(g: GoalSpec, records: RecLike[], period: { from: number; to: number }, now: number, finished: boolean): GoalEval {
  const kind = goalKind(g);
  const target = g.targetMinutes * 60_000;
  if (kind === 'clock') return clockEval(g, records, period.from, now, finished);
  if (kind === 'days') {
    const need = g.minDays ?? 1;
    let n = 0;
    let ms = 0;
    for (const d of daysIn(period.from, period.to)) {
      if (d > now) break;
      const dm = goalMs(g, records, d, addDays(d, 1), now);
      ms += dm;
      if (dm >= target) n++;
    }
    return { status: n >= need ? 'met' : finished ? 'missed' : 'ongoing', value: n, target: need, pct: Math.min(100, (n / need) * 100), ms };
  }
  const ms = goalMs(g, records, period.from, period.to, now);
  return { status: goalStatus(g, ms, finished), value: ms, target, pct: Math.min(100, (ms / target) * 100), ms };
}

/** “至多”型且按时长计（duration / window）：提醒和复盘里的“超限”只针对这类 */
export const isCap = (g: GoalSpec) => g.direction === 'atMost' && (goalKind(g) === 'duration' || goalKind(g) === 'window');
