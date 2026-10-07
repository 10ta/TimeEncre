// 单文件备份的导出 / 导入。导入按“最后修改者胜出”（LWW）逐条合并，
// P2 的 GitHub 同步复用同一个 mergeLww。
import { db, fromDb, toDb } from '../db/db';
import { getSettings, putSettingsRaw } from '../db/actions';
import { CURRENT_SCHEMA_VERSION, parseBundle, type BundleFile } from '../schema';
import { fromIso, toIso } from '../lib/time';

export async function exportBundle(): Promise<BundleFile> {
  const [types, tags, goals, records, settings] = await Promise.all([
    db.types.orderBy('order').toArray(),
    db.tags.orderBy('order').toArray(),
    db.goals.toArray(),
    db.records.orderBy('startMs').toArray(),
    getSettings(),
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
  };
}

export interface MergeCount {
  added: number;
  updated: number;
  kept: number;
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
    } else if (fromIso(item.updatedAt) > fromIso(cur.updatedAt)) {
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
  settingsUpdated: boolean;
}

export async function importBundle(raw: unknown): Promise<BundleImportReport> {
  const b = parseBundle(raw);
  return db.transaction('rw', [db.types, db.tags, db.goals, db.records, db.meta], async () => {
    const id = <T,>(x: T) => x;
    const types = await mergeLww(db.types, b.types, id);
    const tags = await mergeLww(db.tags, b.tags, id);
    const goals = await mergeLww(db.goals, b.goals, id);
    const records = await mergeLww(db.records, b.records, toDb);
    const cur = await getSettings();
    const settingsUpdated = fromIso(b.settings.updatedAt) > fromIso(cur.updatedAt);
    if (settingsUpdated) await putSettingsRaw(b.settings);
    return { types, tags, goals, records, settingsUpdated };
  });
}
