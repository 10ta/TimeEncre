// 本地数据库（IndexedDB）。P1 阶段它是唯一存储；P2 起作为 GitHub 数据仓库的本地副本。
import Dexie, { type EntityTable, type Table } from 'dexie';
import type { CatalogItem, Goal, TimeRecord } from '../schema';
import { fromIso, monthKey } from '../lib/time';

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

  constructor() {
    super('timeencre');
    // 这是本地索引结构的版本，和数据文件的 schemaVersion 是两回事。
    // 以后改索引：this.version(2).stores({...}).upgrade(tx => ...)，upgrade 内复用 schema 的迁移函数。
    this.version(1).stores({
      types: 'id, order',
      tags: 'id, order',
      goals: 'id',
      records: 'id, startMs, active, typeId, month',
      meta: 'key',
    });
  }
}

export const db = new TimeEncreDb();

export function toDb(r: TimeRecord): DbRecord {
  const startMs = fromIso(r.intervals[0].start);
  return {
    ...r,
    startMs,
    active: r.deleted || r.state === 'stopped' ? 0 : 1,
    month: monthKey(startMs),
  };
}

export function fromDb(r: DbRecord): TimeRecord {
  const { startMs: _s, active: _a, month: _m, ...rest } = r;
  return rest as TimeRecord;
}
