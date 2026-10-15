// 单文件备份的导出 / 导入。导入按“最后修改者胜出”（LWW）逐条合并，
// P2 的 GitHub 同步复用同一个 mergeLww。
import { db, fromDb, toDb } from '../db/db';
import { getSettings, putSettingsRaw } from '../db/actions';
import { CURRENT_SCHEMA_VERSION, parseBundle, type BundleFile } from '../schema';
import { fromIso, toIso } from '../lib/time';

export async function exportBundle(): Promise<BundleFile> {
  const [types, tags, goals, records, settings, keepLists, keepItems] = await Promise.all([
    db.types.orderBy('order').toArray(),
    db.tags.orderBy('order').toArray(),
    db.goals.toArray(),
    db.records.orderBy('startMs').toArray(),
    getSettings(),
    db.keepLists.orderBy('order').toArray(),
    db.keepItems.orderBy('order').toArray(),
  ]);
  // 墓碑（deleted: true）也一并导出，合并时才能正确传播删除
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION as 1,
    kind: 'bundle',
    app: 'TimeEncre',
    exportedAt: toIso(Date.now()),
    types,
    tags,
    goals,
    settings,
    records: records.map(fromDb),
    keepLists,
    keepItems,
  };
}

export interface MergeCount {
  added: number;
  updated: number;
  kept: number;
}

/** 键排序后的 JSON：只用于比较内容 */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object')
    return `{${Object.keys(v as object)
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(v);
}

/**
 * 较新者胜出。修改时间精确到秒，两台设备在同一秒改了同一项时时间相同：
 * 这时按内容比出固定的一方（两边算出来一样），否则两边各留各的，每次同步都互相覆盖。
 */
function newer(incoming: { updatedAt: string }, cur: { updatedAt: string }): boolean {
  const a = fromIso(incoming.updatedAt);
  const b = fromIso(cur.updatedAt);
  if (a !== b) return a > b;
  return stable(incoming) > stable(cur);
}

/** mergeLww 只需要表的这两个方法；用结构类型避开 Dexie 泛型的协变问题 */
export interface BulkTable<Row> {
  bulkGet(ids: string[]): Promise<(Row | undefined)[]>;
  bulkPut(items: Row[]): Promise<unknown>;
}

export async function mergeLww<T extends { id: string; updatedAt: string }, Row extends { id: string; updatedAt: string }>(
  table: BulkTable<Row>,
  items: T[],
  toRow: (item: T) => Row,
): Promise<MergeCount> {
  const count: MergeCount = { added: 0, updated: 0, kept: 0 };
  const existing = await table.bulkGet(items.map((x) => x.id));
  const puts: Row[] = [];
  items.forEach((item, i) => {
    const cur = existing[i];
    if (!cur) {
      count.added++;
      puts.push(toRow(item));
    } else if (newer(toRow(item), cur)) {
      count.updated++;
      puts.push(toRow(item));
    } else {
      count.kept++;
    }
  });
  await table.bulkPut(puts);
  return count;
}

export interface BundleImportReport {
  types: MergeCount;
  tags: MergeCount;
  goals: MergeCount;
  records: MergeCount;
  keep: MergeCount;
  settingsUpdated: boolean;
}

export async function importBundle(raw: unknown): Promise<BundleImportReport> {
  const b = parseBundle(raw);
  return db.transaction('rw', [db.types, db.tags, db.goals, db.records, db.meta, db.keepLists, db.keepItems], async () => {
    const id = <T,>(x: T) => x;
    const types = await mergeLww(db.types, b.types, id);
    const tags = await mergeLww(db.tags, b.tags, id);
    const goals = await mergeLww(db.goals, b.goals, id);
    const records = await mergeLww(db.records, b.records, toDb);
    const kl = await mergeLww(db.keepLists, b.keepLists, id);
    const ki = await mergeLww(db.keepItems, b.keepItems, id);
    const keep = { added: kl.added + ki.added, updated: kl.updated + ki.updated, kept: kl.kept + ki.kept };
    const cur = await getSettings();
    const settingsUpdated = fromIso(b.settings.updatedAt) > fromIso(cur.updatedAt);
    if (settingsUpdated) await putSettingsRaw(b.settings);
    return { types, tags, goals, records, keep, settingsUpdated };
  });
}
