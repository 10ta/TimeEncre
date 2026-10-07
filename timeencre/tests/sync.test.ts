import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/db';
import { clearAllLocalData, saveCatalogItem, startRecord, stopRecord } from '../src/db/actions';
import { saveSyncConfig, syncNow, pendingFiles } from '../src/sync/engine';
import { gitBlobSha, serialize } from '../src/sync/files';
import { FakeGitHub } from './fakeGithub';

let gh: FakeGitHub;

async function resetAll() {
  await db.transaction('rw', [db.types, db.tags, db.goals, db.records, db.meta], async () => {
    await Promise.all([db.types.clear(), db.tags.clear(), db.goals.clear(), db.records.clear(), db.meta.clear()]);
  });
}

beforeEach(async () => {
  await resetAll();
  gh = new FakeGitHub();
  globalThis.fetch = gh.fetch as typeof fetch;
  await saveSyncConfig({ repo: 'me/data', branch: 'main', dir: 'TimeEncre', token: 't', autoSync: false });
});

async function seedLocal() {
  const typeId = await saveCatalogItem('types', { name: '学习', emoji: '🎓', color: '#2e7d6b' });
  const recId = await startRecord(typeId, { startMs: Date.now() - 60_000 });
  await stopRecord(recId);
  return { typeId, recId };
}

describe('git blob sha', () => {
  it('与 git hash-object 一致', async () => {
    expect(await gitBlobSha('')).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
    expect(await gitBlobSha('hello\n')).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
  });
});

describe('GitHub 同步', () => {
  it('空仓库：初始化并推送全部文件', async () => {
    await seedLocal();
    expect(await pendingFiles()).toBe(2);
    const r = await syncNow();
    expect(r.pushed).toBeGreaterThan(0);
    expect(r.pulled).toBe(0);
    const files = gh.files();
    expect(Object.keys(files).sort()).toEqual(
      expect.arrayContaining(['TimeEncre/profile.json', expect.stringMatching(/^TimeEncre\/records\/\d{4}-\d{2}\.json$/)]),
    );
    expect(JSON.parse(files['TimeEncre/profile.json']).types[0].name).toBe('学习');
    expect(await pendingFiles()).toBe(0);
  });

  it('没有变化时不产生新提交', async () => {
    await seedLocal();
    await syncNow();
    const head = gh.head;
    const r = await syncNow();
    expect(r.pushed).toBe(0);
    expect(gh.head).toBe(head);
  });

  it('拉取另一台设备的修改并合并', async () => {
    const { typeId } = await seedLocal();
    await syncNow();
    const profile = JSON.parse(gh.files()['TimeEncre/profile.json']);
    profile.types[0].name = '法语学习';
    profile.types[0].updatedAt = '2099-01-01T00:00:00+08:00';
    await gh.commitFiles({ 'TimeEncre/profile.json': serialize(profile) }, 'other device');
    const r = await syncNow();
    expect(r.pulled).toBe(1);
    expect(r.pushed).toBe(0);
    expect((await db.types.get(typeId))!.name).toBe('法语学习');
  });

  it('推送时被抢先提交：重试且保留其他目录的文件', async () => {
    await gh.commitFiles({ 'Autre/notes.md': '# privé\n' }, 'other app');
    await seedLocal();
    gh.beforeNextUpdateRef = async () => {
      await gh.commitFiles({ 'Autre/journal.md': 'entrée\n' }, 'other app again');
    };
    await syncNow();
    expect(gh.requests.filter((r) => r.startsWith('PATCH')).length).toBe(2); // 第一次 422，第二次成功
    const files = gh.files();
    expect(files['Autre/notes.md']).toBe('# privé\n');
    expect(files['Autre/journal.md']).toBe('entrée\n');
    expect(files['TimeEncre/profile.json']).toBeDefined();
    expect(await pendingFiles()).toBe(0);
  });

  it('新设备：清空本地后从仓库恢复，且不会把空数据推上去', async () => {
    const { recId } = await seedLocal();
    await syncNow();
    const before = gh.files();
    await clearAllLocalData();
    expect(await db.records.count()).toBe(0);
    const r = await syncNow();
    expect(r.pushed).toBe(0);
    expect(await db.records.get(recId)).toBeDefined();
    expect(gh.files()).toEqual(before);
  });

  it('本地改动 + 远端改动不同文件：都保留', async () => {
    await seedLocal();
    await syncNow();
    const t2 = await saveCatalogItem('types', { name: '运动', emoji: '🏃', color: '#3f6fb5' });
    const remoteRec = {
      schemaVersion: 1, kind: 'records', month: '2020-01',
      records: [{ id: 'r-old', typeId: t2, tagIds: [], comment: '', state: 'stopped', updatedAt: '2020-01-01T10:00:00+08:00', deleted: false,
        intervals: [{ start: '2020-01-01T09:00:00+08:00', end: '2020-01-01T10:00:00+08:00' }] }],
    };
    await gh.commitFiles({ 'TimeEncre/records/2020-01.json': serialize(remoteRec) });
    await syncNow();
    expect(await db.records.get('r-old')).toBeDefined();
    expect(JSON.parse(gh.files()['TimeEncre/profile.json']).types.map((t: { name: string }) => t.name)).toContain('运动');
  });

  it('远端文件版本比程序新：中止且不推送', async () => {
    await seedLocal();
    await syncNow();
    const head = gh.head;
    await gh.commitFiles({ 'TimeEncre/profile.json': JSON.stringify({ schemaVersion: 9, kind: 'profile' }) });
    const newHead = gh.head;
    await expect(syncNow()).rejects.toThrow(/v9/);
    expect(gh.head).toBe(newHead);
    expect(newHead).not.toBe(head);
  });
});
