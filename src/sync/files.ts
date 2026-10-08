// 本地数据 ⇄ 仓库文件。
// 序列化是确定性的（固定键顺序、固定排序、2 空格缩进），同样的数据永远得到同样的文本，
// 所以可以用 git blob SHA 判断“本地改了没有”“远端改了没有”，也让 GitHub 上的 diff 可读。
import { db, fromDb, toDb, type DbRecord } from '../db/db';
import { getSettings, putSettingsRaw } from '../db/actions';
import { CURRENT_SCHEMA_VERSION, parseProfileFile, parseRecordsFile } from '../schema';
import { mergeLww } from '../io/bundle';
import { fromIso } from '../lib/time';
import { sha1Hex } from '../lib/sha1';
import { tr } from '../i18n';

const KEY_ORDER = [
  'schemaVersion', 'kind', 'month', 'id', 'name', 'emoji', 'color', 'typeId', 'tagIds', 'comment',
  'state', 'intervals', 'start', 'end', 'order', 'archived', 'typeIds', 'period', 'direction',
  'targetMinutes', 'updatedAt', 'deleted', 'types', 'tags', 'goals', 'settings', 'records',
];
const rank = (k: string) => {
  const i = KEY_ORDER.indexOf(k);
  return i < 0 ? KEY_ORDER.length : i;
};

export function canonicalize(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonicalize);
  if (v && typeof v === 'object') {
    const keys = Object.keys(v as object).sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0));
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = canonicalize((v as Record<string, unknown>)[k]);
    return out;
  }
  return v;
}

export const serialize = (obj: unknown): string => JSON.stringify(canonicalize(obj), null, 2) + '\n';

/** 与 `git hash-object` 相同的 blob SHA-1 */
export async function gitBlobSha(text: string): Promise<string> {
  const body = new TextEncoder().encode(text);
  const head = new TextEncoder().encode(`blob ${body.length}\0`);
  const buf = new Uint8Array(head.length + body.length);
  buf.set(head);
  buf.set(body, head.length);
  // http://局域网IP 这类非安全上下文没有 crypto.subtle，退回纯 JS 实现
  if (!globalThis.crypto?.subtle) return sha1Hex(buf);
  const digest = await crypto.subtle.digest('SHA-1', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const PROFILE_PATH = 'profile.json';
const RECORDS_RE = /^records\/(\d{4}-\d{2})\.json$/;
export const isOurFile = (rel: string) => rel === PROFILE_PATH || RECORDS_RE.test(rel);

/** 把本地数据序列化成仓库文件（路径相对于数据目录） */
export async function buildLocalFiles(): Promise<Map<string, string>> {
  const [types, tags, goals, records, settings] = await Promise.all([
    db.types.toArray(),
    db.tags.toArray(),
    db.goals.toArray(),
    db.records.toArray(),
    getSettings(),
  ]);
  const byOrder = <T extends { order: number; id: string }>(a: T, b: T) => a.order - b.order || (a.id < b.id ? -1 : 1);
  const files = new Map<string, string>();
  files.set(
    PROFILE_PATH,
    serialize({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      kind: 'profile',
      types: types.sort(byOrder),
      tags: tags.sort(byOrder),
      goals: goals.sort((a, b) => (a.id < b.id ? -1 : 1)),
      settings,
    }),
  );
  const months = new Map<string, DbRecord[]>();
  for (const r of records) {
    const list = months.get(r.month) ?? [];
    list.push(r);
    months.set(r.month, list);
  }
  for (const [month, list] of [...months].sort()) {
    list.sort((a, b) => a.startMs - b.startMs || (a.id < b.id ? -1 : 1));
    files.set(
      `records/${month}.json`,
      serialize({ schemaVersion: CURRENT_SCHEMA_VERSION, kind: 'records', month, records: list.map(fromDb) }),
    );
  }
  return files;
}

/** 把远端文件按“较新者胜出”合并进本地 */
export async function applyRemoteFile(rel: string, text: string): Promise<void> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(tr("远端文件 {0} 不是有效的 JSON，同步已中止。", rel));
  }
  if (rel === PROFILE_PATH) {
    const p = parseProfileFile(raw);
    await db.transaction('rw', [db.types, db.tags, db.goals, db.meta], async () => {
      const same = <T,>(x: T) => x;
      await mergeLww(db.types, p.types, same);
      await mergeLww(db.tags, p.tags, same);
      await mergeLww(db.goals, p.goals, same);
      const cur = await getSettings();
      if (fromIso(p.settings.updatedAt) > fromIso(cur.updatedAt)) await putSettingsRaw(p.settings);
    });
  } else if (RECORDS_RE.test(rel)) {
    const f = parseRecordsFile(raw);
    await db.transaction('rw', db.records, () => mergeLww(db.records, f.records, toDb));
  }
}
