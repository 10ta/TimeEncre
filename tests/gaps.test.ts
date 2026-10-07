import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/db';
import { createManualRecord, fillGap, startRecord } from '../src/db/actions';
import { gapNeighbors } from '../src/lib/gaps';
import { fromIso, toIso } from '../src/lib/time';

const at = (h: number, m: number) => new Date(2026, 9, 7, h, m).getTime();
const rec = (id: string, ...ivs: Array<[number, number | null]>) => ({
  id,
  intervals: ivs.map(([s, e]) => ({ start: toIso(s), end: e === null ? null : toIso(e) })),
});

describe('空档的相邻记录', () => {
  it('前一段取结束最晚的，后一段取开始最早的', () => {
    const rs = [
      rec('eat', [at(7, 0), at(7, 30)]),
      rec('commute', [at(7, 10), at(7, 40)]), // 与吃饭同时进行，结束得更晚
      rec('work', [at(8, 0), at(12, 0)], [at(13, 0), at(17, 0)]),
    ];
    const n = gapNeighbors(rs, { start: at(7, 40), end: at(8, 0) });
    expect(n.prev).toEqual({ recId: 'commute', ivIndex: 0, edge: at(7, 40) });
    expect(n.next).toEqual({ recId: 'work', ivIndex: 0, edge: at(8, 0) });
    // 午休空档：前后都是“工作”的不同段
    const lunch = gapNeighbors(rs, { start: at(12, 0), end: at(13, 0) });
    expect(lunch.prev).toEqual({ recId: 'work', ivIndex: 0, edge: at(12, 0) });
    expect(lunch.next).toEqual({ recId: 'work', ivIndex: 1, edge: at(13, 0) });
  });
});

describe('填充空档', () => {
  beforeEach(async () => {
    await db.records.clear();
    await db.meta.clear();
  });

  it('延长上一段 / 提前下一段（包括进行中的记录）', async () => {
    const a = await createManualRecord({ typeId: 'eat', comment: '', tagIds: [], intervals: [{ start: at(7, 0), end: at(7, 30) }] });
    const b = await startRecord('study', { startMs: at(8, 0) });
    const now = at(9, 0);
    await fillGap({ start: at(7, 30), end: at(7, 45) }, 'prev', now);
    expect((await db.records.get(a))!.intervals[0].end).toBe(toIso(at(7, 45)));
    await fillGap({ start: at(7, 45), end: at(8, 0) }, 'next', now);
    const rb = (await db.records.get(b))!;
    expect(fromIso(rb.intervals[0].start)).toBe(at(7, 45));
    expect(rb.state).toBe('running');
  });

  it('没有相邻记录时报错', async () => {
    await expect(fillGap({ start: at(7, 0), end: at(8, 0) }, 'prev', at(9, 0))).rejects.toThrow();
  });
});
