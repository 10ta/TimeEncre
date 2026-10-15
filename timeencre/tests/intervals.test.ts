import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach } from 'vitest';
import { db } from '../src/db/db';
import { createManualRecord, findOverlaps, saveRecord, startRecord, validateIntervals } from '../src/db/actions';
import { fromIso } from '../src/lib/time';

const H = 3600_000;
const now = new Date(2026, 9, 2, 18).getTime();

describe('validateIntervals', () => {
  it('合法', () => {
    expect(validateIntervals([{ start: now - 3 * H, end: now - 2 * H }, { start: now - H, end: null }], now)).toBeNull();
  });
  it('各种非法情况', () => {
    expect(validateIntervals([], now)).toMatch(/至少/);
    expect(validateIntervals([{ start: now - H, end: now - 2 * H }], now)).toMatch(/晚于开始/);
    expect(validateIntervals([{ start: now + H, end: null }], now)).toMatch(/不能晚于现在/);
    expect(validateIntervals([{ start: now - 3 * H, end: null }, { start: now - H, end: now }], now)).toMatch(/缺少结束/);
    expect(validateIntervals([{ start: now - 3 * H, end: now - H }, { start: now - 2 * H, end: now }], now)).toMatch(/重叠/);
    expect(validateIntervals([{ start: NaN, end: now }], now)).toMatch(/无效/);
  });
});

describe('编辑与补录', () => {
  beforeEach(async () => {
    await db.records.clear();
    await db.meta.clear();
  });

  it('补录 + 重叠检测', async () => {
    const t = Date.now();
    const a = await createManualRecord({ typeId: 'x', comment: '', tagIds: [], intervals: [{ start: t - 2 * H, end: t - H }] });
    const hits = await findOverlaps([{ start: t - 1.5 * H, end: t - 0.5 * H }]);
    expect(hits.map((r) => r.id)).toEqual([a]);
    expect(await findOverlaps([{ start: t - 1.5 * H, end: t - 0.5 * H }], a)).toHaveLength(0);
    expect(await findOverlaps([{ start: t - 0.9 * H, end: t - 0.5 * H }])).toHaveLength(0);
  });

  it('编辑进行中的记录：保持进行中，月份索引随开始时间更新', async () => {
    const id = await startRecord('x');
    const lastMonth = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 15, 9).getTime();
    await saveRecord(id, { typeId: 'y', comment: 'c', tagIds: [], intervals: [{ start: lastMonth, end: null }] });
    const r = (await db.records.get(id))!;
    expect(r.state).toBe('running');
    expect(r.typeId).toBe('y');
    expect(fromIso(r.intervals[0].start)).toBe(lastMonth);
    const d = new Date(lastMonth);
    expect(r.month).toBe(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  });

  it('补录不允许未结束', async () => {
    await expect(createManualRecord({ typeId: 'x', comment: '', tagIds: [], intervals: [{ start: Date.now() - H, end: null }] })).rejects.toThrow();
  });
});
