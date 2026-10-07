// 当前版本的类型出口 + 文件迁移框架。
//
// 以后出大版本（比如 v2）时：
//  1. 新建 v2.ts 定义新结构，把下面的导出改指向 v2；
//  2. 在 migrations 里追加 { from: 1, to: 2, up(file) {...} }，只写纯函数；
//  3. 读取任何文件都先过 migrateFile，再用当前 schema 校验。
// 客户端遇到比自己新的 schemaVersion 时拒绝写入（SchemaTooNewError），提示刷新到新版本。
import { z } from 'zod';
import {
  BundleFileV1,
  CatalogItemV1,
  GoalV1,
  ProfileFileV1,
  RecordV1,
  RecordsFileV1,
  SettingsV1,
} from './v1';

export const CURRENT_SCHEMA_VERSION = 1;

export const CatalogItemSchema = CatalogItemV1;
export const RecordSchema = RecordV1;
export const SettingsSchema = SettingsV1;

export type CatalogItem = z.infer<typeof CatalogItemV1>;
export type TimeRecord = z.infer<typeof RecordV1>;
export type Goal = z.infer<typeof GoalV1>;
export type Settings = z.infer<typeof SettingsV1>;
export type ProfileFile = z.infer<typeof ProfileFileV1>;
export type RecordsFile = z.infer<typeof RecordsFileV1>;
export type BundleFile = z.infer<typeof BundleFileV1>;

type AnyFile = { schemaVersion: number; kind: string; [k: string]: unknown };

interface Migration {
  from: number;
  to: number;
  up: (file: AnyFile) => AnyFile;
}

/** 按版本顺序追加，例如：
 *  { from: 1, to: 2, up: (f) => f.kind === 'records'
 *      ? { ...f, records: (f.records as any[]).map(r => ({ ...r, source: 'manual' })) }
 *      : f },
 */
const migrations: Migration[] = [];

export class SchemaTooNewError extends Error {
  constructor(public fileVersion: number) {
    super(
      `数据文件是 v${fileVersion}，当前程序只支持到 v${CURRENT_SCHEMA_VERSION}。请刷新页面更新到最新版本。`,
    );
  }
}

export function migrateFile(raw: unknown): AnyFile {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('不是有效的数据文件（应为 JSON 对象）');
  }
  let file = raw as AnyFile;
  let v = file.schemaVersion;
  if (typeof v !== 'number') throw new Error('数据文件缺少 schemaVersion');
  if (v > CURRENT_SCHEMA_VERSION) throw new SchemaTooNewError(v);
  while (v < CURRENT_SCHEMA_VERSION) {
    const m = migrations.find((x) => x.from === v);
    if (!m) throw new Error(`缺少从 v${v} 升级的迁移脚本`);
    file = { ...m.up(file), schemaVersion: m.to };
    v = m.to;
  }
  return file;
}

export const parseBundle = (raw: unknown): BundleFile => BundleFileV1.parse(migrateFile(raw));
export const parseProfileFile = (raw: unknown): ProfileFile => ProfileFileV1.parse(migrateFile(raw));
export const parseRecordsFile = (raw: unknown): RecordsFile => RecordsFileV1.parse(migrateFile(raw));
