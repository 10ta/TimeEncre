import { describe, expect, it } from 'vitest';
import { dragIntervals, gapSelection, snapTime } from '../src/lib/drag';

const M = 60_000;
const at = (h: number, m = 0) => new Date(2026, 9, 7, h, m).getTime();

describe('吸附', () => {
  it('靠近边缘就贴上，否则按 5 分钟取整', () => {
    expect(snapTime(at(9, 3), [at(9, 1)], 4 * M)).toBe(at(9, 1));
    expect(snapTime(at(9, 3), [at(9, 20)], 4 * M)).toBe(at(9, 5));
    expect(snapTime(at(9, 2), [], 4 * M)).toBe(at(9, 0));
    expect(snapTime(at(9, 3), [at(9, 1), at(9, 4)], 4 * M)).toBe(at(9, 4)); // 取最近的那条
  });
});

describe('拖动调整区间', () => {
  const now = at(18);
  const work = [
    { start: at(9), end: at(12) },
    { start: at(13), end: at(17) },
  ];

  it('拖开始 / 结束：不越过同一记录的相邻段，至少 1 分钟', () => {
    expect(dragIntervals(work, 1, 'start', { start: at(11), end: 0 }, now)[1].start).toBe(at(12));
    expect(dragIntervals(work, 0, 'end', { start: 0, end: at(14) }, now)[0].end).toBe(at(13));
    expect(dragIntervals(work, 0, 'end', { start: 0, end: at(8) }, now)[0].end).toBe(at(9) + M);
    expect(dragIntervals(work, 1, 'start', { start: at(12, 30), end: 0 }, now)[1].start).toBe(at(12, 30));
  });

  it('结束不晚于现在；进行中的段只能拖开始', () => {
    expect(dragIntervals(work, 1, 'end', { start: 0, end: at(20) }, now)[1].end).toBe(now);
    const live = [{ start: at(17), end: null }];
    expect(dragIntervals(live, 0, 'end', { start: 0, end: at(19) }, now)).toEqual(live);
    expect(dragIntervals(live, 0, 'start', { start: at(16), end: 0 }, now)[0].start).toBe(at(16));
    expect(dragIntervals(live, 0, 'start', { start: at(19), end: 0 }, now)[0].start).toBe(now - M);
  });

  it('平移保持时长，并被相邻段和当天范围挡住', () => {
    const moved = dragIntervals(work, 0, 'move', { start: at(10), end: at(13) }, now);
    expect(moved[0]).toEqual({ start: at(10), end: at(13) });
    const blocked = dragIntervals(work, 0, 'move', { start: at(11), end: at(14) }, now);
    expect(blocked[0]).toEqual({ start: at(10), end: at(13) });
    const day = { lo: at(0), hi: at(24) };
    expect(dragIntervals([{ start: at(1), end: at(3) }], 0, 'move', { start: at(-1), end: at(1) }, now, day)[0].start).toBe(at(0));
  });

  it('不修改原数组', () => {
    const copy = JSON.parse(JSON.stringify(work));
    dragIntervals(work, 0, 'move', { start: at(10), end: at(13) }, now);
    expect(work).toEqual(copy);
  });
});

describe('空档拖选', () => {
  it('两端限制在空档内，方向任意', () => {
    const gap = { start: at(12), end: at(13) };
    expect(gapSelection(at(12, 40), at(12, 10), gap)).toEqual({ start: at(12, 10), end: at(12, 40) });
    expect(gapSelection(at(12, 30), at(14), gap)).toEqual({ start: at(12, 30), end: at(13) });
  });
});
