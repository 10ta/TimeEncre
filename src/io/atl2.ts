// A Time Logger 2 备份（.ttbkp，本质是 JSON）导入。
// 已知结构：types[{guid,name,color(有符号 ARGB 整数),icon("cat_111"),order,archived,group,deleted}]
//          activities[{guid,typeGuid,state,tags[],intervals[{from,to(Unix 秒),deleted}],deleted}]
// goals / fields / reports 的结构尚未见到样本，暂不导入，只计数。
// guid 原样作为 id 保留，所以重复导入同一份备份不会产生重复记录。
import { db, toDb } from '../db/db';
import type { CatalogItem, TimeRecord } from '../schema';
import { newId } from '../lib/id';
import { toIso } from '../lib/time';
import { PALETTE } from '../db/defaults';
import { tr } from '../i18n';

/** ATL2 内置图标编号 → emoji（来自真实备份样本） */
const ICON_EMOJI: Record<string, string> = {
  cat_111: '😴', cat_81: '🚌', cat_48: '🍕', cat_36: '💼', cat_89: '🏃',
  cat_96: '📖', cat_80: '🛍️', cat_98: '🎮', cat_53: '🧹', cat_45: '🎬',
  cat_102: '🚶', cat_27: '🎓', cat_69: '💻',
};

/** 图标编号对不上时按名字猜 */
const NAME_EMOJI: Array<[RegExp, string]> = [
  [/sleep|睡/i, '😴'], [/bath|shower|洗/i, '🛁'], [/commute|通勤/i, '🚌'],
  [/eat|food|meal|吃|饭|餐/i, '🍜'], [/work|工作|上班/i, '💼'],
  [/sport|gym|运动|健身/i, '🏃'], [/read|阅读|读书/i, '📖'], [/shop|购物/i, '🛍️'],
  [/entertain|game|娱乐|游戏/i, '🎮'], [/house|clean|家务/i, '🧹'],
  [/cinema|movie|film|电影/i, '🎬'], [/walk|散步|步行/i, '🚶'],
  [/study|learn|学习/i, '🎓'], [/internet|web|上网|网络/i, '💻'],
];

const FALLBACK_EMOJI = '⏱️';

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => !!x && typeof x === 'object' && !Array.isArray(x);

export function atl2ColorToHex(c: unknown): string {
  if (typeof c !== 'number' || !Number.isFinite(c)) return PALETTE[0];
  return '#' + (c & 0xffffff).toString(16).padStart(6, '0');
}

function pickEmoji(icon: unknown, name: string): string {
  if (typeof icon === 'string' && ICON_EMOJI[icon]) return ICON_EMOJI[icon];
  for (const [re, emoji] of NAME_EMOJI) if (re.test(name)) return emoji;
  return FALLBACK_EMOJI;
}

export interface Atl2Converted {
  types: CatalogItem[];
  tags: CatalogItem[];
  records: TimeRecord[];
  skipped: { deleted: number; groups: number; emptyRecords: number; goals: number };
}

export function convertAtl2(raw: unknown, nowMs = Date.now()): Atl2Converted {
  if (!isObj(raw) || !Array.isArray(raw.types) || !Array.isArray(raw.activities)) {
    throw new Error(tr("这不是 A Time Logger 2 的备份文件（缺少 types 或 activities）"));
  }
  const stamp = toIso(nowMs);
  const skipped = { deleted: 0, groups: 0, emptyRecords: 0, goals: Array.isArray(raw.goals) ? raw.goals.length : 0 };

  const types: CatalogItem[] = [];
  for (const t of raw.types) {
    if (!isObj(t) || typeof t.guid !== 'string') continue;
    if (t.deleted) { skipped.deleted++; continue; }
    if (t.group) { skipped.groups++; continue; } // 不做父子层级，分组本身不导入
    const name = typeof t.name === 'string' && t.name.trim() ? t.name.trim() : tr("未命名");
    types.push({
      id: t.guid,
      name,
      emoji: pickEmoji(t.icon, name),
      color: atl2ColorToHex(t.color),
      order: typeof t.order === 'number' ? t.order : types.length,
      archived: !!t.archived,
      updatedAt: stamp,
      deleted: false,
    });
  }

  const tagsByName = new Map<string, CatalogItem>();
  const tagId = (name: string): string => {
    const key = name.trim();
    let tag = tagsByName.get(key);
    if (!tag) {
      tag = {
        id: newId(), name: key, emoji: '🏷️',
        color: PALETTE[tagsByName.size % PALETTE.length],
        order: tagsByName.size, archived: false, updatedAt: stamp, deleted: false,
      };
      tagsByName.set(key, tag);
    }
    return tag.id;
  };

  const records: TimeRecord[] = [];
  for (const a of raw.activities) {
    if (!isObj(a) || typeof a.guid !== 'string' || typeof a.typeGuid !== 'string') continue;
    if (a.deleted) { skipped.deleted++; continue; }
    const ivs = (Array.isArray(a.intervals) ? a.intervals : [])
      .filter((iv): iv is Obj => isObj(iv) && !iv.deleted && typeof iv.from === 'number' && iv.from > 0)
      .sort((x, y) => (x.from as number) - (y.from as number));
    if (ivs.length === 0) { skipped.emptyRecords++; continue; }

    const intervals = ivs.map((iv, i) => {
      const to = typeof iv.to === 'number' && iv.to > 0 ? toIso(iv.to * 1000) : null;
      const start = toIso((iv.from as number) * 1000);
      // 只有最后一个区间允许是“未结束”
      return { start, end: to ?? (i < ivs.length - 1 ? start : null) };
    });
    const open = intervals[intervals.length - 1].end === null;
    // 样本中已结束的活动 state 为 0；非 0 且区间都已结束时按“暂停”处理
    const state: TimeRecord['state'] = open ? 'running' : a.state === 0 || a.state == null ? 'stopped' : 'paused';

    const tagIds = (Array.isArray(a.tags) ? a.tags : [])
      .map((t) => (typeof t === 'string' ? t : isObj(t) && typeof t.name === 'string' ? t.name : ''))
      .filter((n) => n.trim())
      .map(tagId);

    records.push({
      id: a.guid,
      typeId: a.typeGuid,
      tagIds: [...new Set(tagIds)],
      comment: typeof a.comment === 'string' ? a.comment : '',
      state,
      intervals,
      updatedAt: stamp,
      deleted: false,
    });
  }

  return { types, tags: [...tagsByName.values()], records, skipped };
}

export interface Atl2Report {
  added: { types: number; tags: number; records: number };
  existing: number;
  skipped: Atl2Converted['skipped'];
}

/** 只新增、不覆盖：已存在的 id 跳过，本地改过的数据不会被备份冲掉 */
export async function importAtl2(raw: unknown): Promise<Atl2Report> {
  const c = convertAtl2(raw);
  return db.transaction('rw', [db.types, db.tags, db.records], async () => {
    let existing = 0;
    const insertNew = async <T extends { id: string }>(table: { bulkGet(ids: string[]): Promise<(unknown | undefined)[]>; bulkPut(items: T[]): Promise<unknown> }, items: T[]) => {
      const found = await table.bulkGet(items.map((x) => x.id));
      const fresh = items.filter((_, i) => !found[i]);
      existing += items.length - fresh.length;
      await table.bulkPut(fresh);
      return fresh.length;
    };
    // 标签按名字去重：本地已有同名标签就复用
    const localTags = new Map((await db.tags.toArray()).filter((t) => !t.deleted).map((t) => [t.name, t.id]));
    const remap = new Map<string, string>();
    const newTags = c.tags.filter((t) => {
      const hit = localTags.get(t.name);
      if (hit) remap.set(t.id, hit);
      return !hit;
    });
    const records = c.records.map((r) => ({ ...r, tagIds: r.tagIds.map((id) => remap.get(id) ?? id) }));

    const types = await insertNew(db.types, c.types);
    const tags = await insertNew(db.tags, newTags);
    const recs = await insertNew(db.records, records.map(toDb));
    return { added: { types, tags, records: recs }, existing, skipped: c.skipped };
  });
}
