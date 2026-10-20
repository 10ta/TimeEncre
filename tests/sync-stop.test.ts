// 回归：一台设备停止了计时，另一台设备还停留在“进行中”时又改了这条记录（更新时间更晚），
// 同步后不能把已经停止的计时“复活”成进行中。
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, toDb, type DbRecord, type MetaRow } from '../src/db/db';
import { patchRecord, saveCatalogItem, startRecord, stopRecord } from '../src/db/actions';
import { saveSyncConfig, syncNow } from '../src/sync/engine';
import { reconcileRecord } from '../src/io/bundle';
import { FakeGitHub } from './fakeGithub';
import type { CatalogItem } from '../src/schema';

const H = 3_600_000;
let gh: FakeGitHub;

interface Device {
  types: CatalogItem[];
  records: DbRecord[];
  meta: MetaRow[];
}
async function snapshot(): Promise<Device> {
  return { types: await db.types.toArray(), records: await db.records.toArray(), meta: await db.meta.toArray() };
}
async function load(d: Device) {
  await Promise.all([db.types.clear(), db.records.clear(), db.meta.clear(), db.tags.clear(), db.goals.clear()]);
  await db.types.bulkPut(d.types);
  await db.records.bulkPut(d.records);
  await db.meta.bulkPut(d.meta);
}

beforeEach(async () => {
  await Promise.all([db.types.clear(), db.records.clear(), db.meta.clear(), db.tags.clear(), db.goals.clear()]);
  gh = new FakeGitHub();
  globalThis.fetch = gh.fetch as typeof fetch;
  await saveSyncConfig({ repo: 'me/data', branch: 'main', dir: 'TimeEncre', token: 't', autoSync: false });
});

describe('停止的计时不会被另一台设备复活', () => {
  it('手机开始 → 电脑停止并同步 → 手机（仍是进行中）改了备注再同步 → 电脑同步：仍是已停止', async () => {
    // 手机：开始睡眠并同步
    const typeId = await saveCatalogItem('types', { name: '睡眠', emoji: '😴', color: '#7a5c8e' });
    const id = await startRecord(typeId, { startMs: Date.now() - 8 * H });
    await syncNow();
    const phone = await snapshot();

    // 电脑：全新设备，同步拿到进行中的睡眠，停止，再同步
    await load({ types: [], records: [], meta: phone.meta.filter((m) => m.key !== 'syncState') });
    await syncNow();
    expect((await db.records.get(id))!.state).toBe('running');
    await new Promise((r) => setTimeout(r, 1100)); // 修改时间精确到秒
    await stopRecord(id);
    const stoppedEnd = (await db.records.get(id))!.intervals[0].end;
    await syncNow();
    const pc = await snapshot();

    // 手机：没同步过，记录仍在进行中；之后改了备注（更新时间比电脑的停止更晚）
    await load(phone);
    await new Promise((r) => setTimeout(r, 1100));
    await patchRecord(id, { comment: '手机上补的备注' });
    await syncNow();
    const onPhone = (await db.records.get(id))!;
    expect(onPhone.state).toBe('stopped');
    expect(onPhone.intervals[0].end).toBe(stoppedEnd);
    expect(onPhone.comment).toBe('手机上补的备注');

    // 电脑：再同步
    await load(pc);
    await syncNow();
    const onPc = (await db.records.get(id))!;
    expect(onPc.state).toBe('stopped');
    expect(onPc.intervals[0].end).toBe(stoppedEnd);
    expect(onPc.comment).toBe('手机上补的备注');
  });
});

describe('reconcileRecord', () => {
  const base = {
    id: 'r', typeId: 't', tagIds: [], comment: '', deleted: false, updatedAt: '2026-10-10T00:00:00Z',
  };
  const mk = (over: object) => toDb({ ...base, state: 'running', intervals: [{ start: '2026-10-10T00:00:00Z', end: null }], ...over } as never);
  it('较新的一份还在进行中、另一份同一段已结束：采用结束', () => {
    const w = mk({ comment: 'new', updatedAt: '2026-10-12T00:00:00Z' });
    const l = mk({ state: 'stopped', intervals: [{ start: '2026-10-10T00:00:00Z', end: '2026-10-10T07:00:00Z' }] });
    const m = reconcileRecord(w, l);
    expect(m.state).toBe('stopped');
    expect(m.active).toBe(0);
    expect(m.comment).toBe('new');
    expect(m.intervals[0].end).toBe('2026-10-10T07:00:00Z');
  });
  it('另一份暂停后又继续了：接上它后面的段', () => {
    const w = mk({ updatedAt: '2026-10-12T00:00:00Z' });
    const l = mk({ intervals: [{ start: '2026-10-10T00:00:00Z', end: '2026-10-10T01:00:00Z' }, { start: '2026-10-10T02:00:00Z', end: null }] });
    const m = reconcileRecord(w, l);
    expect(m.state).toBe('running');
    expect(m.intervals).toHaveLength(2);
  });
  it('都在进行中、或较新的一份已结束、或有删除：不变', () => {
    const w = mk({ updatedAt: '2026-10-12T00:00:00Z' });
    expect(reconcileRecord(w, mk({}))).toBe(w);
    const closed = mk({ state: 'stopped', intervals: [{ start: '2026-10-10T00:00:00Z', end: '2026-10-10T07:00:00Z' }] });
    expect(reconcileRecord(closed, w)).toBe(closed);
    const del = mk({ deleted: true });
    expect(reconcileRecord(del, closed)).toBe(del);
  });
});
