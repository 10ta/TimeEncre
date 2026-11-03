// 例程（每周固定几天的时间块）展开成具体的时间段，以及“计划 vs 实际”。纯函数。
import { addDays, recordSpans, type Span } from './time';
import { daysIn } from './range';
import { fromParts, zparts } from './zone';
import { unionMs } from './stats';

export interface RoutineLike {
  id: string;
  typeId: string;
  weekdays: number[];
  /** 一天中的分钟数；end ≤ start 表示跨午夜到第二天 */
  start: number;
  end: number;
  deleted?: boolean;
}

export interface RoutineBlock<R extends RoutineLike = RoutineLike> {
  routine: R;
  /** 这一段属于哪天（那天 0 点）：按开始那天算 */
  day: number;
  start: number;
  end: number;
}

/** 与 [from, to) 有交集的各段（前一天开始、跨午夜进来的也算） */
export function routineBlocks<R extends RoutineLike>(routines: R[], from: number, to: number): RoutineBlock<R>[] {
  const out: RoutineBlock<R>[] = [];
  const live = routines.filter((r) => !r.deleted && r.weekdays.length > 0 && r.start !== r.end);
  if (!live.length) return out;
  for (const day of daysIn(addDays(from, -1), to)) {
    const p = zparts(day);
    for (const r of live) {
      if (!r.weekdays.includes(p.wd)) continue;
      const start = fromParts(p.y, p.m, p.d, 0, r.start);
      const end = fromParts(p.y, p.m, p.d + (r.end <= r.start ? 1 : 0), 0, r.end);
      if (end > from && start < to) out.push({ routine: r, day, start, end });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** 此刻正在进行的例程段 */
export function currentBlocks<R extends RoutineLike>(routines: R[], now: number): RoutineBlock<R>[] {
  return routineBlocks(routines, now, now + 1).filter((b) => b.start <= now && now < b.end);
}

interface RecLike {
  typeId: string;
  intervals: { start: string; end: string | null }[];
}

export interface Adherence {
  /** 截止到现在，计划的时长 */
  plannedMs: number;
  /** 计划时段里实际在做这件事的时长 */
  doneMs: number;
  /** 这件事在计划时段之外做了多久（同一范围内） */
  outsideMs: number;
}

/**
 * 计划 vs 实际：某个例程在 [from, to) 里（截止到 now）计划了多久，
 * 其中实际在做同一活动的有多久；同时进行的记录只算一次。
 */
export function adherence<R extends RoutineLike>(routine: R, records: RecLike[], from: number, to: number, now: number): Adherence {
  const end = Math.min(to, now);
  const blocks = routineBlocks([routine], from, end).map((b) => ({ start: Math.max(b.start, from), end: Math.min(b.end, end) })).filter((b) => b.end > b.start);
  const spans = records
    .filter((r) => r.typeId === routine.typeId)
    .flatMap((r) => recordSpans(r, now))
    .map((s) => ({ start: Math.max(s.start, from), end: Math.min(s.end, end) }))
    .filter((s) => s.end > s.start);
  const inside: Span[] = [];
  for (const b of blocks)
    for (const s of spans) {
      const a = Math.max(b.start, s.start);
      const e = Math.min(b.end, s.end);
      if (e > a) inside.push({ start: a, end: e });
    }
  const plannedMs = unionMs(blocks);
  const doneMs = unionMs(inside);
  return { plannedMs, doneMs, outsideMs: unionMs(spans) - doneMs };
}
