import { useLiveQuery } from 'dexie-react-hooks';
import { db, type DbRecord } from './db';
import { findDuplicateGroups, getSettings, type CatalogKind } from './actions';
import type { CatalogItem } from '../schema';

const DAY = 86_400_000;

const visible = (withArchived: boolean) => (x: CatalogItem) =>
  !x.deleted && (withArchived || !x.archived);

export const useTypes = (withArchived = false) =>
  useLiveQuery(async () => (await db.types.orderBy('order').toArray()).filter(visible(withArchived)), [withArchived]);

export const useTags = (withArchived = false) =>
  useLiveQuery(async () => (await db.tags.orderBy('order').toArray()).filter(visible(withArchived)), [withArchived]);

/** 包含已归档、已删除，用于显示历史记录引用的类型/标签 */
export const useTypeMap = () =>
  useLiveQuery(async () => new Map((await db.types.toArray()).map((t) => [t.id, t])), []);

export const useTagMap = () =>
  useLiveQuery(async () => new Map((await db.tags.toArray()).map((t) => [t.id, t])), []);

export const useActiveRecords = () =>
  useLiveQuery(
    async () =>
      (await db.records.where('active').equals(1).toArray()).sort((a, b) => b.startMs - a.startMs),
    [],
  );

export const useSettings = () => useLiveQuery(getSettings, []);

/** 可能与 fromMs 之后有交集的记录（开始于 fromMs 前两天内的，加上所有进行中的） */
export const useRecordsAround = (fromMs: number) =>
  useLiveQuery(async () => {
    const [recent, active] = await Promise.all([
      db.records.where('startMs').aboveOrEqual(fromMs - 2 * DAY).toArray(),
      db.records.where('active').equals(1).toArray(),
    ]);
    const map = new Map<string, DbRecord>();
    for (const r of [...recent, ...active]) if (!r.deleted) map.set(r.id, r);
    return [...map.values()];
  }, [fromMs]);

export const useRecord = (id: string) => useLiveQuery(() => db.records.get(id), [id]);

export const useCounts = () =>
  useLiveQuery(async () => ({
    types: (await db.types.toArray()).filter((x) => !x.deleted).length,
    tags: (await db.tags.toArray()).filter((x) => !x.deleted).length,
    records: (await db.records.toArray()).filter((x) => !x.deleted).length,
  }), []);

/** 与 [from, to) 有交集的记录：开始于 from 前 7 天之内的，加上所有进行中的 */
export const useRecordsInRange = (from: number, to: number) =>
  useLiveQuery(async () => {
    const [inRange, active] = await Promise.all([
      db.records.where('startMs').between(from - 7 * DAY, to, true, false).toArray(),
      db.records.where('active').equals(1).toArray(),
    ]);
    const map = new Map<string, DbRecord>();
    for (const r of [...inRange, ...active]) if (!r.deleted) map.set(r.id, r);
    return [...map.values()];
  }, [from, to]);

/** UUIDv7 按时间排序，所以按 id 排就是按创建顺序 */
export const useGoals = () =>
  useLiveQuery(async () => (await db.goals.toArray()).filter((g) => !g.deleted).sort((a, b) => (a.id < b.id ? -1 : 1)), []);

/** 最早一条记录的开始时间；没有记录时为 null */
export const useFirstRecordMs = () =>
  useLiveQuery(async () => {
    const all = await db.records.orderBy('startMs').toArray();
    return all.find((r) => !r.deleted)?.startMs ?? null;
  }, []);

export const useDuplicateGroups = (kind: CatalogKind) => useLiveQuery(() => findDuplicateGroups(kind), [kind]);
