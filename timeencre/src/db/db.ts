// 本地数据库（IndexedDB）。P1 阶段它是唯一存储；P2 起作为 GitHub 数据仓库的本地副本。
import Dexie, { type EntityTable, type Table } from 'dexie';
import type { CatalogItem, Goal, KeepItem, KeepList, TimeRecord } from '../schema';
import { fromIso } from '../lib/time';

/** 记录在本地多存三个派生字段用于建索引，导出时剥掉 */
export interface DbRecord extends TimeRecord {
  startMs: number;
  active: 0 | 1;
  month: string;
}

export interface MetaRow {
  key: string;
  value: unknown;
}

class TimeEncreDb extends Dexie {
  types!: EntityTable<CatalogItem, 'id'>;
  tags!: EntityTable<CatalogItem, 'id'>;
  goals!: EntityTable<Goal, 'id'>;
  records!: EntityTable<DbRecord, 'id'>;
  meta!: Table<MetaRow, string>;
  keepLists!: EntityTable<KeepList, 'id'>;
  keepItems!: EntityTable<KeepItem, 'id'>;

  constructor() {
    super('timeencre');
    // 这是本地索引结构的版本，和数据文件的 schemaVersion 是两回事。
    // 以后改索引：this.version(2).stores({...}).upgrade(tx => ...)，upgrade 内复用 schema 的迁移函数。
    const stores = {
      types: 'id, order',
      tags: 'id, order',
      goals: 'id',
      records: 'id, startMs, active, typeId, month',
      meta: 'key',
    };
    this.version(1).stores(stores);
    // v2：month 改为取自记录自身的时间文本（与设备时区无关），已有记录重算一次
    this.version(2)
      .stores(stores)
      .upgrade((tx) =>
        tx
          .table('records')
          .toCollection()
          .modify((r: DbRecord) => {
            r.month = fileMonth(r.intervals[0].start);
          }),
      );
    // v3：Keep 的清单与条目
    this.version(3).stores({ ...stores, keepLists: 'id, order', keepItems: 'id, listId, order' });
  }
}

export const db = new TimeEncreDb();

/**
 * 记录归到哪个月份文件：直接取开始时间文本里的年月（写入时的时区）。
 * 不能用“当前设备时区下的月份”——两台设备时区不同时，跨月边界的记录会被分进不同文件，同步来回改写。
 */
export function fileMonth(iso: string): string {
  return /^\d{4}-\d{2}/.test(iso) ? iso.slice(0, 7) : new Date(fromIso(iso)).toISOString().slice(0, 7);
}

export function toDb(r: TimeRecord): DbRecord {
  const startMs = fromIso(r.intervals[0].start);
  return {
    ...r,
    startMs,
    active: r.deleted || r.state === 'stopped' ? 0 : 1,
    month: fileMonth(r.intervals[0].start),
  };
}

export function fromDb(r: DbRecord): TimeRecord {
  const { startMs: _s, active: _a, month: _m, ...rest } = r;
  return rest as TimeRecord;
}
