// Keep 的查询与派生状态
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { byOrder } from '../../db/keep';
import { fromIso } from '../../lib/time';
import type { KeepItem, KeepList } from '../../schema';

export const useKeepLists = () =>
  useLiveQuery(async () => (await db.keepLists.toArray()).filter((x) => !x.deleted).sort(byOrder), []);

export const useKeepItems = () =>
  useLiveQuery(async () => (await db.keepItems.toArray()).filter((x) => !x.deleted).sort(byOrder), []);

/** 是否用过 Keep（有清单，含已删除的也不算） */
export const useHasKeep = () => useLiveQuery(async () => (await db.keepLists.toArray()).some((x) => !x.deleted), []);

/** 预约的状态：还没开始 / 已经开始（在时间段内）/ 已经过期（结束了还没完成）/ 已完成 */
export type SlotState = 'upcoming' | 'started' | 'overdue' | 'done';

export function slotMs(it: KeepItem): { start: number; end: number } | null {
  if (!it.slot) return null;
  return { start: fromIso(it.slot.start), end: fromIso(it.slot.end) };
}

export function slotState(it: KeepItem, now: number): SlotState | null {
  const s = slotMs(it);
  if (!s) return null;
  if (it.done) return 'done';
  if (now >= s.end) return 'overdue';
  if (now >= s.start) return 'started';
  return 'upcoming';
}

export type ListMap = Map<string, KeepList>;
export const listMap = (lists: KeepList[]): ListMap => new Map(lists.map((l) => [l.id, l]));
