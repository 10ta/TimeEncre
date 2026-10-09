import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/db';
import { createManualRecord, freeSpanAround } from '../src/db/actions';
import { dragIntervals } from '../src/lib/drag';

const H = 3_600_000;
const t0 = Date.parse('2026-10-05T00:00:00Z');

beforeEach(async () => {
  await db.records.clear();
});

describe('跨天的完整空档', () => {
  it('前后最近的记录之间，可以跨过午夜', async () => {
    await createManualRecord({ typeId: 'x', comment: '', tagIds: [], intervals: [{ start: t0 + 20 * H, end: t0 + 22 * H }] });
    await createManualRecord({ typeId: 'y', comment: '', tagIds: [], intervals: [{ start: t0 + 31 * H, end: t0 + 32 * H }] });
    expect(await freeSpanAround(t0 + 25 * H, t0 + 40 * H, 0)).toEqual({ start: t0 + 22 * H, end: t0 + 31 * H });
  });
  it('落在记录里返回 null；不早于 floor、不晚于 now', async () => {
    await createManualRecord({ typeId: 'x', comment: '', tagIds: [], intervals: [{ start: t0 + 20 * H, end: t0 + 22 * H }] });
    expect(await freeSpanAround(t0 + 21 * H, t0 + 40 * H, 0)).toBeNull();
    expect(await freeSpanAround(t0 + 23 * H, t0 + 26 * H, 0)).toEqual({ start: t0 + 22 * H, end: t0 + 26 * H });
    expect(await freeSpanAround(t0 + 10 * H, t0 + 26 * H, t0 + 8 * H)).toEqual({ start: t0 + 8 * H, end: t0 + 20 * H });
  });
});

describe('拖动不再限制在当天', () => {
  it('结束可以拖过午夜，开始可以拖回前一天', () => {
    const ivs = [{ start: t0 + 1 * H, end: t0 + 7 * H }];
    expect(dragIntervals(ivs, 0, 'start', { start: t0 - 1 * H, end: t0 + 7 * H }, t0 + 30 * H)[0].start).toBe(t0 - 1 * H);
    expect(dragIntervals(ivs, 0, 'move', { start: t0 + 25 * H, end: t0 + 31 * H }, t0 + 40 * H)[0]).toEqual({ start: t0 + 25 * H, end: t0 + 31 * H });
    // 仍然不能晚于现在
    expect(dragIntervals(ivs, 0, 'end', { start: t0 + 1 * H, end: t0 + 50 * H }, t0 + 30 * H)[0].end).toBe(t0 + 30 * H);
  });
});
