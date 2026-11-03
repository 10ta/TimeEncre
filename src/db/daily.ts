// 例程与每日评分的写操作。和其他数据一样每次写入都更新 updatedAt，删除留墓碑。
import { db } from './db';
import { newId } from '../lib/id';
import { toIso } from '../lib/time';
import type { Routine } from '../schema';
import { tr } from '../i18n';

const stamp = () => toIso(Date.now());

export type RoutineDraft = Pick<Routine, 'typeId' | 'weekdays' | 'start' | 'end'>;

function check(d: RoutineDraft) {
  if (!d.typeId) throw new Error(tr("请选择活动"));
  if (d.weekdays.length === 0) throw new Error(tr("至少选一天"));
  if (d.start === d.end) throw new Error(tr("开始和结束不能相同"));
}

export async function createRoutine(d: RoutineDraft): Promise<string> {
  check(d);
  const all = (await db.routines.toArray()).filter((r) => !r.deleted);
  const id = newId();
  const order = all.reduce((m, r) => Math.max(m, r.order), 0) + 1;
  await db.routines.put({ ...d, weekdays: [...d.weekdays].sort(), id, order, updatedAt: stamp(), deleted: false });
  return id;
}

export async function patchRoutine(id: string, patch: Partial<RoutineDraft>) {
  const cur = await db.routines.get(id);
  if (!cur) return;
  const next = { ...cur, ...patch };
  check(next);
  await db.routines.put({ ...next, weekdays: [...next.weekdays].sort(), updatedAt: stamp() });
}

/** 删除；返回快照用于撤销 */
export async function deleteRoutine(id: string): Promise<Routine | null> {
  const cur = await db.routines.get(id);
  if (!cur) return null;
  await db.routines.put({ ...cur, deleted: true, updatedAt: stamp() });
  return cur;
}

export async function restoreRoutine(snapshot: Routine) {
  await db.routines.put({ ...snapshot, deleted: false, updatedAt: stamp() });
}

/** 给某天打分（1–5）；score 为 null 表示清除 */
export async function setRating(day: string, score: number | null) {
  const cur = await db.ratings.get(day);
  if (score == null) {
    if (cur && !cur.deleted) await db.ratings.put({ ...cur, deleted: true, updatedAt: stamp() });
    return;
  }
  await db.ratings.put({ id: day, score, updatedAt: stamp(), deleted: false });
}
