import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/db';
import { byOrder, clearDone, createItem, createList, deleteList, moveItem, moveList, orderBetween, restoreKeep, setItemDone } from '../src/db/keep';
import { applyRemoteFile, buildLocalFiles, KEEP_PATH, isOurFile } from '../src/sync/files';
import { exportBundle, importBundle } from '../src/io/bundle';
import { parseBundle } from '../src/schema';

const live = async (listId: string) => (await db.keepItems.where('listId').equals(listId).toArray()).filter((x) => !x.deleted).sort(byOrder);

beforeEach(async () => {
  await db.keepLists.clear();
  await db.keepItems.clear();
});

describe('Keep 动作', () => {
  it('新建、勾选、清除已完成、删除与撤销', async () => {
    const a = await createList('PREMIER');
    const i1 = await createItem(a, '研究克鲁赛德');
    const i2 = await createItem(a, '火力dps概念');
    expect((await live(a)).map((x) => x.text)).toEqual(['研究克鲁赛德', '火力dps概念']);
    await setItemDone(i1, true);
    const done = (await db.keepItems.get(i1))!;
    expect(done.done).toBe(true);
    expect(done.doneAt).not.toBeNull();
    const cleared = await clearDone(a);
    expect(cleared.map((x) => x.id)).toEqual([i1]);
    expect((await live(a)).map((x) => x.id)).toEqual([i2]);
    const snap = (await deleteList(a))!;
    expect((await db.keepLists.get(a))!.deleted).toBe(true);
    expect(await live(a)).toEqual([]);
    await restoreKeep([snap.list], snap.items);
    expect((await live(a)).map((x) => x.id)).toEqual([i2]);
  });

  it('排序：插到中间、跨清单移动、清单排序', async () => {
    const a = await createList('A');
    const b = await createList('B');
    const x = await createItem(a, 'x');
    const y = await createItem(a, 'y');
    const z = await createItem(a, 'z');
    await moveItem(z, a, x);
    expect((await live(a)).map((i) => i.text)).toEqual(['z', 'x', 'y']);
    await moveItem(x, b, null);
    expect((await live(a)).map((i) => i.text)).toEqual(['z', 'y']);
    expect((await live(b)).map((i) => i.text)).toEqual(['x']);
    await moveList(b, a);
    const lists = (await db.keepLists.toArray()).sort(byOrder);
    expect(lists.map((l) => l.name)).toEqual(['B', 'A']);
    expect(orderBetween([{ id: 'p', order: 1 }, { id: 'q', order: 2 }], 'p', 'n')).toBe(0);
  });
});

describe('Keep 同步与备份', () => {
  it('keep.json：没用过不建；按条目较新者胜出', async () => {
    expect((await buildLocalFiles()).has(KEEP_PATH)).toBe(false);
    expect(isOurFile('keep.json')).toBe(true);
    const a = await createList('L');
    const i = await createItem(a, 'old');
    const files = await buildLocalFiles();
    const f = JSON.parse(files.get(KEEP_PATH)!);
    expect(f.kind).toBe('keep');
    expect(f.items[0].text).toBe('old');
    // 远端：同一条目更新的版本 + 一个新条目
    f.items[0] = { ...f.items[0], text: 'new', updatedAt: '2099-01-01T00:00:00+00:00' };
    f.items.push({ ...f.items[0], id: 'remote-1', text: 'r', order: 5 });
    await applyRemoteFile(KEEP_PATH, JSON.stringify(f));
    expect((await live(a)).map((x) => [x.id === i, x.text])).toEqual([[true, 'new'], [false, 'r']]);
  });

  it('备份里带上 Keep；旧备份没有 Keep 也能读', async () => {
    const a = await createList('L');
    await createItem(a, 'x', { start: '2026-10-09T14:00:00-04:00', end: '2026-10-09T15:00:00-04:00' });
    const bundle = await exportBundle();
    expect(bundle.keepItems[0].slot?.start).toBe('2026-10-09T14:00:00-04:00');
    await db.keepLists.clear();
    await db.keepItems.clear();
    const r = await importBundle(JSON.parse(JSON.stringify(bundle)));
    expect(r.keep.added).toBe(2);
    const { keepLists: _l, keepItems: _i, ...old } = bundle;
    expect(parseBundle(old).keepItems).toEqual([]);
  });
});
