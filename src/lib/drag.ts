// 日历拖动调整时间的纯计算：吸附与边界限制。界面只负责把指针位置换算成时间。
import type { IntervalMs } from '../db/actions';

export const MIN_SPAN_MS = 60_000;
export const SNAP_STEP_MS = 5 * 60_000;

/** 靠近某条边（threshold 以内）就贴上去；否则按 step 取整 */
export function snapTime(t: number, edges: number[], thresholdMs: number, stepMs = SNAP_STEP_MS): number {
  let best: number | null = null;
  for (const e of edges) if (Math.abs(e - t) <= thresholdMs && (best === null || Math.abs(e - t) < Math.abs(best - t))) best = e;
  return best ?? Math.round(t / stepMs) * stepMs;
}

export type DragMode = 'start' | 'end' | 'move';

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/**
 * 把第 i 段按拖动结果调整，返回新的区间数组（不改原数组）。
 * 限制：不越过同一条记录的前后段；结束不晚于 now；每段至少 MIN_SPAN_MS；不出 [lo, hi]（例如当天范围）。
 * 进行中的段（end = null）只允许拖开始。
 */
export function dragIntervals(
  ivs: IntervalMs[],
  i: number,
  mode: DragMode,
  proposed: { start: number; end: number },
  now: number,
  bounds: { lo: number; hi: number } = { lo: -Infinity, hi: Infinity },
): IntervalMs[] {
  const cur = ivs[i];
  const prevEnd = Math.max(ivs[i - 1]?.end ?? -Infinity, bounds.lo);
  const nextStart = Math.min(ivs[i + 1]?.start ?? Infinity, bounds.hi, now);
  const out = ivs.map((x) => ({ ...x }));
  if (mode === 'start') {
    const limit = (cur.end ?? now) - MIN_SPAN_MS;
    out[i].start = clamp(proposed.start, prevEnd, limit);
  } else if (mode === 'end') {
    if (cur.end === null) return out;
    out[i].end = clamp(proposed.end, cur.start + MIN_SPAN_MS, nextStart);
  } else {
    if (cur.end === null) return out;
    const dur = cur.end - cur.start;
    if (nextStart - prevEnd < dur) return out;
    const s = clamp(proposed.start, prevEnd, nextStart - dur);
    out[i].start = s;
    out[i].end = s + dur;
  }
  return out;
}

/** 在空档里拖选一段：两端都限制在空档内，并按吸附规则取整 */
export function gapSelection(anchor: number, pointer: number, gap: { start: number; end: number }) {
  const a = clamp(anchor, gap.start, gap.end);
  const b = clamp(pointer, gap.start, gap.end);
  return { start: Math.min(a, b), end: Math.max(a, b) };
}
