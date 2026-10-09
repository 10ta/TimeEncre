// 本地数据库从 v1 升级到 v2：已有记录的 month 按记录自身的时间文本重算
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';

describe('IndexedDB v1 → 当前版本', () => {
  it('重算 month，其余字段不变', async () => {
    await Dexie.delete('timeencre');
    const old = new Dexie('timeencre');
    old.version(1).stores({ types: 'id, order', tags: 'id, order', goals: 'id', records: 'id, startMs, active, typeId, month', meta: 'key' });
    await old.open();
    await old.table('records').put({
      id: 'r1', typeId: 't', tagIds: [], comment: 'x', state: 'stopped', deleted: false,
      updatedAt: '2026-10-01T01:00:00+08:00',
      intervals: [{ start: '2026-10-01T00:30:00+08:00', end: '2026-10-01T01:00:00+08:00' }],
      startMs: Date.parse('2026-10-01T00:30:00+08:00'), active: 0,
      month: '2026-09', // 旧版本在纽约时区设备上算出来的
    });
    old.close();

    const { db } = await import('../src/db/db');
    const r = (await db.records.get('r1'))!;
    expect(db.verno).toBe(3);
    expect(r.month).toBe('2026-10');
    expect(r.comment).toBe('x');
    expect(await db.records.where('month').equals('2026-10').count()).toBe(1);
  });
});
