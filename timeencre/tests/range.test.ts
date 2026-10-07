import { describe, expect, it } from 'vitest';
import { daysIn, rangeLabel, rangeOf, shiftAnchor } from '../src/lib/range';
import { gaps, splitByDay } from '../src/lib/segments';
import { toIso } from '../src/lib/time';

const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();

describe('区间', () => {
  it('周：按每周起始日', () => {
    const fri = at(2026, 10, 2, 15);
    expect(rangeOf('week', fri, 1).from).toBe(at(2026, 9, 28)); // 周一
    expect(rangeOf('week', fri, 0).from).toBe(at(2026, 9, 27)); // 周日
    expect(rangeOf('week', at(2026, 9, 28, 1), 1).from).toBe(at(2026, 9, 28));
    expect(daysIn(...(Object.values(rangeOf('week', fri, 1)).slice(1) as [number, number]))).toHaveLength(7);
  });
  it('月与翻页', () => {
    const r = rangeOf('month', at(2026, 1, 31), 1);
    expect(r.from).toBe(at(2026, 1, 1));
    expect(r.to).toBe(at(2026, 2, 1));
    expect(shiftAnchor('month', at(2026, 1, 31), 1)).toBe(at(2026, 2, 1)); // 不会因 31 号跳过 2 月
  });
  it('标签', () => {
    const now = at(2026, 10, 2, 12);
    expect(rangeLabel(rangeOf('day', now, 1), now)).toBe('今天 10月2日 周五');
    expect(rangeLabel(rangeOf('week', now, 1), now)).toBe('9月28日 – 10月4日');
    expect(rangeLabel(rangeOf('month', now, 1), now)).toBe('2026年10月');
  });
});

describe('按天切分', () => {
  const rec = (s: number, e: number | null) => ({ intervals: [{ start: toIso(s), end: e === null ? null : toIso(e) }] });

  it('跨午夜的睡眠分到两天', () => {
    const sleep = rec(at(2026, 10, 1, 23, 30), at(2026, 10, 2, 7, 30));
    const m = splitByDay([sleep], at(2026, 10, 1), at(2026, 10, 3), at(2026, 10, 3));
    const d1 = m.get(at(2026, 10, 1))![0];
    const d2 = m.get(at(2026, 10, 2))![0];
    expect(d1.ms).toBe(30 * 60_000);
    expect(d1.toNextDay).toBe(true);
    expect(d2.ms).toBe(7.5 * 3600_000);
    expect(d2.fromPrevDay).toBe(true);
  });

  it('进行中的记录算到 now 为止', () => {
    const running = rec(at(2026, 10, 2, 9), null);
    const m = splitByDay([running], at(2026, 10, 2), at(2026, 10, 3), at(2026, 10, 2, 10));
    expect(m.get(at(2026, 10, 2))![0].ms).toBe(3600_000);
  });

  it('空白时段：合并重叠，忽略太短的', () => {
    const g = gaps(
      [
        { start: at(2026, 10, 2, 8), end: at(2026, 10, 2, 12) },
        { start: at(2026, 10, 2, 11), end: at(2026, 10, 2, 13) },
        { start: at(2026, 10, 2, 13, 3), end: at(2026, 10, 2, 14) },
      ],
      at(2026, 10, 2),
      at(2026, 10, 2, 15),
      5 * 60_000,
    );
    expect(g).toEqual([
      { start: at(2026, 10, 2), end: at(2026, 10, 2, 8) },
      { start: at(2026, 10, 2, 14), end: at(2026, 10, 2, 15) },
    ]);
  });
});
