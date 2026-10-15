// 把记录按自然日切开：跨午夜的记录在两天里各显示属于当天的部分。
import { addDays } from './time';
import { daysIn } from './range';
import { recordSpans, type Span } from './time';

export interface DaySeg<R> {
  rec: R;
  /** 当天范围内的各段（暂停会产生多段） */
  spans: Span[];
  start: number;
  end: number;
  ms: number;
  /** 从前一天延续过来 / 延续到后一天 */
  fromPrevDay: boolean;
  toNextDay: boolean;
}

type HasIntervals = { intervals: { start: string; end: string | null }[] };

export function splitByDay<R extends HasIntervals>(
  records: R[],
  from: number,
  to: number,
  now: number,
): Map<number, DaySeg<R>[]> {
  const out = new Map<number, DaySeg<R>[]>();
  const all = records.map((rec) => ({ rec, spans: recordSpans(rec, now) }));
  for (const day of daysIn(from, to)) {
    const dayEnd = addDays(day, 1);
    const segs: DaySeg<R>[] = [];
    for (const { rec, spans } of all) {
      const clipped = spans
        .map((s) => ({ start: Math.max(s.start, day), end: Math.min(s.end, dayEnd) }))
        .filter((s) => s.end > s.start);
      if (clipped.length === 0) continue;
      segs.push({
        rec,
        spans: clipped,
        start: clipped[0].start,
        end: clipped[clipped.length - 1].end,
        ms: clipped.reduce((a, s) => a + (s.end - s.start), 0),
        fromPrevDay: spans.some((s) => s.start < day && s.end > day),
        toNextDay: spans.some((s) => s.start < dayEnd && s.end > dayEnd),
      });
    }
    if (segs.length) out.set(day, segs.sort((a, b) => b.start - a.start));
  }
  return out;
}

/** [from, to) 内没有被任何记录覆盖、且不短于 minMs 的空白时段 */
export function gaps(spans: Span[], from: number, to: number, minMs: number): Span[] {
  const sorted = spans
    .map((s) => ({ start: Math.max(s.start, from), end: Math.min(s.end, to) }))
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start);
  const out: Span[] = [];
  let cursor = from;
  for (const s of sorted) {
    if (s.start - cursor >= minMs) out.push({ start: cursor, end: s.start });
    cursor = Math.max(cursor, s.end);
  }
  if (to - cursor >= minMs) out.push({ start: cursor, end: to });
  return out;
}
