// 模拟在别处 force push：远端历史被改写，TimeEncre 的文件回到旧版本或整个消失
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/db';
import { saveCatalogItem, startRecord, stopRecord, deleteRecord } from '../src/db/actions';
import { saveSyncConfig, syncNow } from '../src/sync/engine';
import { FakeGitHub } from './fakeGithub';

let gh: FakeGitHub;

/** 把分支强制指向一个全新的提交（不以当前 head 为父），内容为给定文件 */
async function forcePush(files: Record<string, string>) {
  const saved = gh.head;
  gh.head = null; // 让新提交没有父提交，等同于改写了历史
  await gh.commitFiles(files, 'force push from elsewhere');
  return saved;
}

beforeEach(async () => {
  await Promise.all([db.types.clear(), db.tags.clear(), db.goals.clear(), db.records.clear(), db.meta.clear()]);
  gh = new FakeGitHub();
  globalThis.fetch = gh.fetch as typeof fetch;
  await saveSyncConfig({ repo: 'me/data', branch: 'main', dir: 'TimeEncre', token: 't', autoSync: false });
});

async function addRecord(name: string) {
  const t = await saveCatalogItem('types', { name, emoji: '⏱️', color: '#3f6fb5' });
  const r = await startRecord(t, { startMs: Date.now() - 60_000 });
  await stopRecord(r);
  return r;
}

describe('别处 force push 之后', () => {
  it('TimeEncre 文件被回退到旧版本：下次同步恢复最新数据，其他文件保留', async () => {
    await gh.commitFiles({ 'Autre/a.md': 'v1\n' });
    const r1 = await addRecord('学习');
    await syncNow();
    const oldFiles = gh.files(); // 只有 r1 的版本
    const r2 = await addRecord('工作');
    await deleteRecord(r1); // 删除也要能保住
    await syncNow();
    // 别处的旧克隆强推：TimeEncre 回到只有 r1 的旧版本，其他文件是新改的
    await forcePush({ ...oldFiles, 'Autre/a.md': 'v2 from force push\n' });
    const r = await syncNow();
    expect(r.pushed).toBeGreaterThan(0);
    const files = gh.files();
    expect(files['Autre/a.md']).toBe('v2 from force push\n');
    const month = Object.keys(files).find((p) => p.startsWith('TimeEncre/records/'))!;
    const recs = JSON.parse(files[month]).records as Array<{ id: string; deleted: boolean }>;
    expect(recs.find((x) => x.id === r2)).toBeDefined();
    expect(recs.find((x) => x.id === r1)!.deleted).toBe(true); // 删除没有被旧版本“复活”
  });

  it('TimeEncre 目录被整个抹掉：下次同步重新写回', async () => {
    const r1 = await addRecord('学习');
    await syncNow();
    await forcePush({ 'Autre/a.md': 'only other files\n' });
    await syncNow();
    const files = gh.files();
    expect(files['Autre/a.md']).toBe('only other files\n');
    expect(files['TimeEncre/profile.json']).toBeDefined();
    const month = Object.keys(files).find((p) => p.startsWith('TimeEncre/records/'))!;
    expect(JSON.parse(files[month]).records.map((x: { id: string }) => x.id)).toContain(r1);
  });

  it('同步进行中被 force push：不覆盖对方，基于新历史重试', async () => {
    await addRecord('学习');
    gh.beforeNextUpdateRef = async () => {
      await forcePush({ 'Autre/a.md': 'forced during sync\n' });
    };
    await syncNow();
    const files = gh.files();
    expect(files['Autre/a.md']).toBe('forced during sync\n');
    expect(files['TimeEncre/profile.json']).toBeDefined();
  });
});
