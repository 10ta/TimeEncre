// 性能 / 逻辑优化的回归测试：行为保持不变，只修掉边角问题
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/db';
import { pauseRecord, resumeRecord, startRecord, stopRecord, suggestBackfillRange, toggleType, updateSettings } from '../src/db/actions';
import { mergeLww } from '../src/io/bundle';
import { _setZoneForTest, fromParts } from '../src/lib/zone';
import { addDays, startOfDay } from '../src/lib/time';
import { clippedSpans, goalProgressMs } from '../src/lib/stats';

const M = 60_000;
const live = async () => (await db.records.where('active').equals(1).toArray()).filter((r) => !r.deleted);

beforeEach(async () => {
  await Promise.all([db.records.clear(), db.meta.clear(), db.types.clear()]);
});

describe('计时操作', () => {
  it('连点两下格子：先开始再停止，不会建出两条', async () => {
    await updateSettings({ allowConcurrent: true, discardShort: false });
    await Promise.all([toggleType('t'), toggleType('t')]);
    const all = (await db.records.toArray()).filter((r) => !r.deleted);
    expect(all).toHaveLength(1);
    expect(all[0].state).toBe('stopped');
  });

  it('继续一条已经停止的记录：什么也不做，也不会停掉别的计时', async () => {
    await updateSettings({ allowConcurrent: false });
    const a = await startRecord('a', { startMs: Date.now() - 10 * M });
    await pauseRecord(a);
    await stopRecord(a);
    const b = await startRecord('b', { startMs: Date.now() - 5 * M });
    await resumeRecord(a);
    expect((await live()).map((r) => r.id)).toEqual([b]);
  });

  it('补录默认时间：七天前开始、至今还在计时的记录也会截住结束时间', async () => {
    const now = Date.parse('2026-10-15T12:00:00Z');
    const old = await startRecord('x', { startMs: now - 10 * 24 * 60 * M });
    await pauseRecord(old);
    // 模拟：暂停后又在 11:30 继续
    const row = (await db.records.get(old))!;
    await db.records.put({ ...row, state: 'running', active: 1, intervals: [...row.intervals, { start: '2026-10-15T11:30:00Z', end: null }] });
    await db.records.put({ ...(await db.records.get(old))! });
    await startRecord('y', { startMs: now - 3 * 60 * M });
    const y = (await live()).find((r) => r.typeId === 'y')!;
    await db.records.put({ ...y, state: 'stopped', active: 0, intervals: [{ start: '2026-10-15T09:00:00Z', end: '2026-10-15T10:00:00Z' }] });
    const r = await suggestBackfillRange(now);
    expect(r).toEqual({ start: Date.parse('2026-10-15T10:00:00Z'), end: Date.parse('2026-10-15T11:30:00Z') });
  });
});

describe('同步合并', () => {
  it('修改时间相同、内容不同：两台设备选出同一个版本（不会来回覆盖）', async () => {
    const t = '2026-10-15T08:00:00+00:00';
    const a = { id: 'x', name: 'A', emoji: '1', color: '#000000', order: 1, archived: false, updatedAt: t, deleted: false };
    const b = { ...a, name: 'B' };
    const id = <T,>(v: T) => v;
    // 设备 1 有 A，收到 B
    await db.types.clear();
    await db.types.put(a);
    await mergeLww(db.types, [b], id);
    const r1 = (await db.types.get('x'))!.name;
    // 设备 2 有 B，收到 A
    await db.types.clear();
    await db.types.put(b);
    await mergeLww(db.types, [a], id);
    const r2 = (await db.types.get('x'))!.name;
    expect(r1).toBe(r2);
    // 内容相同：不算更新
    const c = await mergeLww(db.types, [{ ...(await db.types.get('x'))! }], id);
    expect(c).toEqual({ added: 0, updated: 0, kept: 1 });
  });
});

describe('缓存不改变结果', () => {
  it('fromParts 缓存：换时区后不会用到旧结果', () => {
    _setZoneForTest('Asia/Shanghai');
    const a = fromParts(2026, 10, 15, 9);
    expect(fromParts(2026, 10, 15, 9)).toBe(a);
    _setZoneForTest('America/New_York');
    expect(fromParts(2026, 10, 15, 9)).toBe(a + 12 * 60 * M);
    _setZoneForTest(null);
  });

  it('已结束记录的解析缓存：结果和直接计算一样；进行中的记录仍按 now 计算', () => {
    const closed = { typeId: 't', tagIds: [], intervals: [{ start: '2026-10-15T08:00:00Z', end: '2026-10-15T09:00:00Z' }] };
    const open = { typeId: 't', tagIds: [], intervals: [{ start: '2026-10-15T08:00:00Z', end: null }] };
    const from = Date.parse('2026-10-15T00:00:00Z');
    const to = Date.parse('2026-10-16T00:00:00Z');
    const g = { typeIds: ['t'], tagIds: [], period: 'day' as const, direction: 'atLeast' as const, targetMinutes: 60 };
    expect(goalProgressMs(g, [closed], from, to, 0)).toBe(60 * M);
    expect(goalProgressMs(g, [closed], from, to, 0)).toBe(60 * M);
    expect(clippedSpans(open, from, to, Date.parse('2026-10-15T08:30:00Z'))[0].end).toBe(Date.parse('2026-10-15T08:30:00Z'));
    expect(clippedSpans(open, from, to, Date.parse('2026-10-15T08:45:00Z'))[0].end).toBe(Date.parse('2026-10-15T08:45:00Z'));
    expect(addDays(startOfDay(from), 1)).toBeGreaterThan(from);
  });
});
