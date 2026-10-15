// 空档（未记录时间）的相邻记录与填充。纯函数，界面和写操作共用。
import { fromIso, type Span } from './time';

/** 空档的最小长度：更短的只是秒级的停止 / 开始误差 */
export const GAP_MIN_MS = 60_000;

interface RecLike {
  id: string;
  deleted?: boolean;
  intervals: { start: string; end: string | null }[];
}

export interface Neighbor {
  recId: string;
  /** 记录里与空档相邻的那一段 */
  ivIndex: number;
  /** 那一段与空档相接的时间：前一段的结束 / 后一段的开始 */
  edge: number;
}

/**
 * 空档前后的记录：
 *  prev = 结束时间 ≤ 空档开始、且结束得最晚的那一段（同时进行的多条里取最晚结束的）；
 *  next = 开始时间 ≥ 空档结束、且开始得最早的那一段。进行中的段没有结束时间，只能作为 next。
 */
export function gapNeighbors(records: RecLike[], gap: Span): { prev?: Neighbor; next?: Neighbor } {
  let prev: Neighbor | undefined;
  let next: Neighbor | undefined;
  for (const r of records) {
    if (r.deleted) continue;
    r.intervals.forEach((iv, i) => {
      const s = fromIso(iv.start);
      if (iv.end) {
        const e = fromIso(iv.end);
        if (e <= gap.start && (!prev || e > prev.edge)) prev = { recId: r.id, ivIndex: i, edge: e };
      }
      if (s >= gap.end && (!next || s < next.edge)) next = { recId: r.id, ivIndex: i, edge: s };
    });
  }
  return { prev, next };
}

/** 用相邻记录填满空档后的区间（毫秒）；相邻的那一段已经变了则返回 null */
export function fillIntervals(
  rec: RecLike,
  neighbor: Neighbor,
  gap: Span,
  mode: 'prev' | 'next',
  now: number,
): Array<{ start: number; end: number | null }> | null {
  const ivs = rec.intervals.map((iv) => ({ start: fromIso(iv.start), end: iv.end ? fromIso(iv.end) : null }));
  const iv = ivs[neighbor.ivIndex];
  if (!iv) return null;
  if (mode === 'prev') {
    if (iv.end !== neighbor.edge) return null;
    iv.end = Math.min(gap.end, now);
  } else {
    if (iv.start !== neighbor.edge) return null;
    iv.start = gap.start;
  }
  return ivs;
}
