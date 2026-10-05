import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/db';
import {
  clearAllLocalData,
  findDuplicateGroups,
  mergeDuplicates,
  saveCatalogItem,
  saveGoal,
  seedDefaultTypes,
  startRecord,
  stopRecord,
  updateSettings,
  getSettings,
} from '../src/db/actions';
import { defaultSettings } from '../src/db/defaults';
import { saveSyncConfig, syncNow } from '../src/sync/engine';
import { FakeGitHub } from './fakeGithub';

let gh: FakeGitHub;
beforeEach(async () => {
  await Promise.all([db.types.clear(), db.tags.clear(), db.goals.clear(), db.records.clear(), db.meta.clear()]);
  gh = new FakeGitHub();
  globalThis.fetch = gh.fetch as typeof fetch;
  await saveSyncConfig({ repo: 'me/data', branch: 'main', dir: 'TimeEncre', token: 't', autoSync: false });
});

describe('默认类型', () => {
  it('两台设备都选默认类型再同步：仍然只有一份，且不覆盖另一台的改名', async () => {
    await seedDefaultTypes(); // 设备 A
    await saveCatalogItem('types', { id: 'default-sleep', name: '睡觉', emoji: '😴', color: '#7A5C8E' });
    await syncNow();
    await clearAllLocalData(); // 设备 B：本地全新，但连着同一个仓库
    await seedDefaultTypes();
    await syncNow();
    const types = JSON.parse(gh.files()['TimeEncre/profile.json']).types as Array<{ id: string; name: string }>;
    expect(types).toHaveLength(14);
    expect(types.find((t) => t.id === 'default-sleep')!.name).toBe('睡觉');
    expect(await findDuplicateGroups('types')).toHaveLength(0);
  });

  it('旧版本留下的两份随机 id 重名默认类型：合并成固定 id，之后再选默认类型不会重复', async () => {
    const a = await saveCatalogItem('types', { name: '工作', emoji: '💼', color: '#E07B1F' });
    const b = await saveCatalogItem('types', { name: '工作', emoji: '💼', color: '#E07B1F' });
    const rec = await startRecord(b, { startMs: Date.now() - 60_000 });
    await stopRecord(rec);
    const r = await mergeDuplicates('types');
    expect(r.removed).toBe(1);
    expect((await db.records.get(rec))!.typeId).toBe('default-work');
    expect((await db.types.get(a))!.deleted).toBe(true);
    expect((await db.types.get(b))!.deleted).toBe(true);
    await seedDefaultTypes();
    expect(await findDuplicateGroups('types')).toHaveLength(0);
  });
});

describe('合并同名', () => {
  it('记录、目标、番茄钟设置改指向保留项；重复项被删除', async () => {
    await seedDefaultTypes();
    const dup = await saveCatalogItem('types', { name: '学习', emoji: '🎓', color: '#000000' }); // 旧版本留下的随机 id
    const rec = await startRecord(dup, { startMs: Date.now() - 60_000 });
    await stopRecord(rec);
    await saveGoal({ name: '', typeIds: [dup], tagIds: [], period: 'day', direction: 'atLeast', targetMinutes: 60 });
    await updateSettings({ pomodoro: { ...defaultSettings().pomodoro, linkedTypeId: dup } });

    expect(await findDuplicateGroups('types')).toHaveLength(1);
    const r = await mergeDuplicates('types');
    expect(r).toEqual({ groups: 1, removed: 1, recordsUpdated: 1 });
    expect((await db.records.get(rec))!.typeId).toBe('default-study'); // 优先保留固定 id
    expect((await db.goals.toArray())[0].typeIds).toEqual(['default-study']);
    expect((await getSettings()).pomodoro.linkedTypeId).toBe('default-study');
    expect((await db.types.get(dup))!.deleted).toBe(true);
    expect(await findDuplicateGroups('types')).toHaveLength(0);
  });
});
