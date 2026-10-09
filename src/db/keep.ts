// Keep：清单（卡片）与条目。和其他数据一样按 updatedAt“较新者胜出”合并，删除留墓碑。
// 排序用浮点 order：插到两项之间取中间值，不必改动其他条目（多设备同时排序时冲突最少）。
import { db } from './db';
import { PALETTE } from './defaults';
import { newId } from '../lib/id';
import { toIso } from '../lib/time';
import type { KeepItem, KeepList } from '../schema';

const stamp = () => toIso(Date.now());

const alive = <T extends { deleted: boolean }>(x: T) => !x.deleted;

/** 新清单：颜色按顺序轮换，排在最后 */
export async function createList(name = ''): Promise<string> {
  const all = (await db.keepLists.toArray()).filter(alive);
  const id = newId();
  const order = all.reduce((m, l) => Math.max(m, l.order), 0) + 1;
  await db.keepLists.put({ id, name, color: PALETTE[all.length % PALETTE.length], order, pinned: false, updatedAt: stamp(), deleted: false });
  return id;
}

export async function updateList(id: string, patch: Partial<Pick<KeepList, 'name' | 'color' | 'pinned' | 'order'>>) {
  const cur = await db.keepLists.get(id);
  if (!cur) return;
  await db.keepLists.put({ ...cur, ...patch, updatedAt: stamp() });
}

/** 删除清单连同它的条目；返回快照用于撤销 */
export async function deleteList(id: string): Promise<{ list: KeepList; items: KeepItem[] } | null> {
  return db.transaction('rw', [db.keepLists, db.keepItems], async () => {
    const list = await db.keepLists.get(id);
    if (!list) return null;
    const items = (await db.keepItems.where('listId').equals(id).toArray()).filter(alive);
    const t = stamp();
    await db.keepLists.put({ ...list, deleted: true, updatedAt: t });
    await db.keepItems.bulkPut(items.map((x) => ({ ...x, deleted: true, updatedAt: t })));
    return { list, items };
  });
}

/** 撤销删除：按快照写回（更新时间取现在，才能在同步时盖过墓碑） */
export async function restoreKeep(lists: KeepList[], items: KeepItem[]) {
  const t = stamp();
  await db.transaction('rw', [db.keepLists, db.keepItems], async () => {
    await db.keepLists.bulkPut(lists.map((x) => ({ ...x, deleted: false, updatedAt: t })));
    await db.keepItems.bulkPut(items.map((x) => ({ ...x, deleted: false, updatedAt: t })));
  });
}

async function itemsOf(listId: string) {
  return (await db.keepItems.where('listId').equals(listId).toArray()).filter(alive).sort(byOrder);
}

export const byOrder = <T extends { order: number; id: string }>(a: T, b: T) => a.order - b.order || (a.id < b.id ? -1 : 1);

/** 新条目排在清单最后 */
export async function createItem(listId: string, text: string, slot: KeepItem['slot'] = null): Promise<string> {
  const items = await itemsOf(listId);
  const id = newId();
  const order = (items[items.length - 1]?.order ?? 0) + 1;
  await db.keepItems.put({ id, listId, text, done: false, doneAt: null, order, slot, updatedAt: stamp(), deleted: false });
  return id;
}

export async function updateItem(id: string, patch: Partial<Pick<KeepItem, 'text' | 'slot'>>) {
  const cur = await db.keepItems.get(id);
  if (!cur) return;
  await db.keepItems.put({ ...cur, ...patch, updatedAt: stamp() });
}

export async function setItemDone(id: string, done: boolean) {
  const cur = await db.keepItems.get(id);
  if (!cur || cur.done === done) return;
  await db.keepItems.put({ ...cur, done, doneAt: done ? stamp() : null, updatedAt: stamp() });
}

export async function deleteItem(id: string): Promise<KeepItem | null> {
  const cur = await db.keepItems.get(id);
  if (!cur) return null;
  await db.keepItems.put({ ...cur, deleted: true, updatedAt: stamp() });
  return cur;
}

/** 清除清单里已完成的条目；返回被清除的，用于撤销 */
export async function clearDone(listId: string): Promise<KeepItem[]> {
  const done = (await itemsOf(listId)).filter((x) => x.done);
  const t = stamp();
  await db.keepItems.bulkPut(done.map((x) => ({ ...x, deleted: true, updatedAt: t })));
  return done;
}

/** 插到 before 之前的 order（before 为空表示放到最后） */
export function orderBetween(sorted: { id: string; order: number }[], beforeId: string | null, selfId: string): number {
  const rest = sorted.filter((x) => x.id !== selfId);
  if (beforeId === null) return (rest[rest.length - 1]?.order ?? 0) + 1;
  const i = rest.findIndex((x) => x.id === beforeId);
  if (i < 0) return (rest[rest.length - 1]?.order ?? 0) + 1;
  const next = rest[i].order;
  const prev = i > 0 ? rest[i - 1].order : next - 2;
  return (prev + next) / 2;
}

/** 把条目移到某个清单里 beforeId 之前（可以跨清单） */
export async function moveItem(id: string, toListId: string, beforeId: string | null) {
  await db.transaction('rw', db.keepItems, async () => {
    const cur = await db.keepItems.get(id);
    if (!cur) return;
    const order = orderBetween(await itemsOf(toListId), beforeId, id);
    await db.keepItems.put({ ...cur, listId: toListId, order, updatedAt: stamp() });
  });
}

export async function moveList(id: string, beforeId: string | null) {
  await db.transaction('rw', db.keepLists, async () => {
    const cur = await db.keepLists.get(id);
    if (!cur) return;
    const lists = (await db.keepLists.toArray()).filter(alive).sort(byOrder);
    await db.keepLists.put({ ...cur, order: orderBetween(lists, beforeId, id), updatedAt: stamp() });
  });
}
