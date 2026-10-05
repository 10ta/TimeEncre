// 所有写操作集中在这里。每次写入都更新 updatedAt，P2 的同步合并依赖它。
import { db, fromDb, toDb, type DbRecord } from './db';
import type { CatalogItem, Settings, TimeRecord } from '../schema';
import { newId } from '../lib/id';
import { fromIso, toIso } from '../lib/time';
import { DEFAULT_ID_PREFIX, PALETTE, defaultSettings, defaultTypes } from './defaults';

const SETTINGS_KEY = 'settings';
const stamp = (ms = Date.now()) => toIso(ms);

// ---------- 设置 ----------

export async function getSettings(): Promise<Settings> {
  const row = await db.meta.get(SETTINGS_KEY);
  return row ? (row.value as Settings) : defaultSettings();
}

export async function updateSettings(patch: Partial<Omit<Settings, 'updatedAt'>>) {
  const cur = await getSettings();
  await db.meta.put({ key: SETTINGS_KEY, value: { ...cur, ...patch, updatedAt: stamp() } });
}

export async function putSettingsRaw(s: Settings) {
  await db.meta.put({ key: SETTINGS_KEY, value: s });
}

// ---------- 计时 ----------

export const discardEnabled = (s: Settings) => s.discardShort ?? true;
export const discardSeconds = (s: Settings) => s.discardShortSec ?? 30;

/** 过短计时被作废时通知界面（提示 + 恢复） */
type DiscardListener = (info: { snapshot: TimeRecord; seconds: number }) => void;
const discardListeners = new Set<DiscardListener>();
export function onRecordDiscarded(l: DiscardListener) {
  discardListeners.add(l);
  return () => void discardListeners.delete(l);
}

/**
 * 停止一条记录；总时长不足设定秒数时直接作废（标记删除）。所有“停止”都走这里。
 * 返回写入的记录；作废时同时返回停止后的快照，供“恢复”使用。
 */
async function finishRecord(rec: TimeRecord, at: number): Promise<{ next: TimeRecord; discarded: TimeRecord | null }> {
  const stopped: TimeRecord = { ...rec, intervals: closeOpenInterval(rec, at), state: 'stopped', updatedAt: stamp(at) };
  const s = await getSettings();
  const total = stopped.intervals.reduce((a, iv) => a + (fromIso(iv.end!) - fromIso(iv.start)), 0);
  if (discardEnabled(s) && total < discardSeconds(s) * 1000) {
    return { next: { ...stopped, deleted: true }, discarded: stopped };
  }
  return { next: stopped, discarded: null };
}

function announce(discarded: Array<TimeRecord | null>, seconds: number) {
  for (const d of discarded) if (d) discardListeners.forEach((l) => l({ snapshot: d, seconds }));
}

function closeOpenInterval(rec: TimeRecord, now: number): TimeRecord['intervals'] {
  return rec.intervals.map((iv) =>
    iv.end === null ? { ...iv, end: toIso(Math.max(now, fromIso(iv.start))) } : iv,
  );
}

async function activeRecords(): Promise<DbRecord[]> {
  return db.records.where('active').equals(1).toArray();
}

/** 不允许并发时：停止除 exceptId 外所有进行中/暂停的记录 */
async function stopOthersIfExclusive(now: number, exceptId?: string): Promise<TimeRecord[]> {
  const s = await getSettings();
  if (s.allowConcurrent) return [];
  const discarded: TimeRecord[] = [];
  for (const r of await activeRecords()) {
    if (r.id === exceptId) continue;
    const { next, discarded: d } = await finishRecord(fromDb(r), now);
    await db.records.put(toDb(next));
    if (d) discarded.push(d);
  }
  return discarded;
}

export interface StartOptions {
  comment?: string;
  tagIds?: string[];
  /** 补记“几分钟前就开始了” */
  startMs?: number;
}

export async function startRecord(typeId: string, opts: StartOptions = {}): Promise<string> {
  const now = Date.now();
  const start = Math.min(opts.startMs ?? now, now);
  let discarded: TimeRecord[] = [];
  const id = await db.transaction('rw', db.records, db.meta, async () => {
    discarded = await stopOthersIfExclusive(now);
    const rec: TimeRecord = {
      id: newId(),
      typeId,
      tagIds: opts.tagIds ?? [],
      comment: opts.comment ?? '',
      state: 'running',
      intervals: [{ start: toIso(start), end: null }],
      updatedAt: stamp(now),
      deleted: false,
    };
    await db.records.put(toDb(rec));
    return rec.id;
  });
  announce(discarded, discardSeconds(await getSettings()));
  return id;
}

async function mutateRecord(id: string, fn: (rec: TimeRecord, now: number) => TimeRecord | null) {
  const now = Date.now();
  await db.transaction('rw', db.records, db.meta, async () => {
    const row = await db.records.get(id);
    if (!row) return;
    const next = fn(fromDb(row), now);
    if (next) await db.records.put(toDb({ ...next, updatedAt: stamp(now) }));
  });
}

export const pauseRecord = (id: string) =>
  mutateRecord(id, (r, now) =>
    r.state !== 'running' ? null : { ...r, intervals: closeOpenInterval(r, now), state: 'paused' },
  );

export async function resumeRecord(id: string) {
  const now = Date.now();
  let discarded: TimeRecord[] = [];
  await db.transaction('rw', db.records, db.meta, async () => {
    discarded = await stopOthersIfExclusive(now, id);
    const row = await db.records.get(id);
    if (!row || row.state !== 'paused') return;
    const r = fromDb(row);
    await db.records.put(
      toDb({
        ...r,
        intervals: [...r.intervals, { start: toIso(now), end: null }],
        state: 'running',
        updatedAt: stamp(now),
      }),
    );
  });
  announce(discarded, discardSeconds(await getSettings()));
}

/** 在指定时间点停止（番茄钟在后台到点时用，避免停止时间晚于实际结束） */
export async function stopRecordAt(id: string, at: number) {
  let discarded: TimeRecord | null = null;
  await db.transaction('rw', db.records, db.meta, async () => {
    const row = await db.records.get(id);
    if (!row || row.state === 'stopped' || row.deleted) return;
    const r = await finishRecord(fromDb(row), at);
    discarded = r.discarded;
    await db.records.put(toDb(r.next));
  });
  announce([discarded], discardSeconds(await getSettings()));
}

export const stopRecord = (id: string) => stopRecordAt(id, Date.now());

/** 点类型格子：没在计时 → 开始；正在计时 → 停止；暂停中 → 继续 */
export async function toggleType(typeId: string) {
  const mine = (await activeRecords())
    .filter((r) => r.typeId === typeId)
    .sort((a, b) => b.startMs - a.startMs);
  const top = mine[0];
  if (!top) return startRecord(typeId);
  if (top.state === 'running') return stopRecord(top.id);
  return resumeRecord(top.id);
}

// ---------- 编辑与补录 ----------

export interface IntervalMs {
  start: number;
  end: number | null;
}

/** 区间合法性：至少一段、按时间排序互不重叠、开始早于结束、不晚于现在；只有最后一段可以未结束 */
export function validateIntervals(ivs: IntervalMs[], now = Date.now()): string | null {
  if (ivs.length === 0) return '至少要有一段时间';
  for (let i = 0; i < ivs.length; i++) {
    const { start, end } = ivs[i];
    const n = ivs.length > 1 ? `第 ${i + 1} 段` : '';
    if (!Number.isFinite(start)) return `${n}开始时间无效`;
    if (start > now) return `${n}开始时间不能晚于现在`;
    if (end === null) {
      if (i !== ivs.length - 1) return `${n}缺少结束时间`;
      continue;
    }
    if (!Number.isFinite(end)) return `${n}结束时间无效`;
    if (end <= start) return `${n}结束时间必须晚于开始时间`;
    if (end > now + 60_000) return `${n}结束时间不能晚于现在`;
    const next = ivs[i + 1];
    if (next && next.start < end) return `第 ${i + 1} 段和第 ${i + 2} 段时间重叠或顺序颠倒`;
  }
  return null;
}

export interface RecordDraft {
  typeId: string;
  comment: string;
  tagIds: string[];
  intervals: IntervalMs[];
}

const toIntervals = (ivs: IntervalMs[]) =>
  ivs.map((iv) => ({ start: toIso(iv.start), end: iv.end === null ? null : toIso(iv.end) }));

export async function saveRecord(id: string, draft: RecordDraft) {
  const err = validateIntervals(draft.intervals);
  if (err) throw new Error(err);
  await mutateRecord(id, (r) => {
    // 只有进行中的记录最后一段是未结束的（编辑器不允许改它的结束时间），其余保持原状态
    const open = draft.intervals[draft.intervals.length - 1].end === null;
    const state: TimeRecord['state'] = open ? 'running' : r.state === 'running' ? 'stopped' : r.state;
    return {
      ...r,
      typeId: draft.typeId,
      comment: draft.comment,
      tagIds: draft.tagIds,
      intervals: toIntervals(draft.intervals),
      state,
    };
  });
}

/** 补录：直接创建一条已结束的记录 */
export async function createManualRecord(draft: RecordDraft): Promise<string> {
  const err = validateIntervals(draft.intervals);
  if (err) throw new Error(err);
  if (draft.intervals.some((iv) => iv.end === null)) throw new Error('补录的记录需要填写结束时间');
  const rec: TimeRecord = {
    id: newId(),
    typeId: draft.typeId,
    tagIds: draft.tagIds,
    comment: draft.comment,
    state: 'stopped',
    intervals: toIntervals(draft.intervals),
    updatedAt: stamp(),
    deleted: false,
  };
  await db.records.put(toDb(rec));
  return rec.id;
}

const DAY_MS = 86_400_000;

/** 与给定区间重叠的其他记录（用于提示，不阻止保存——允许并发计时时重叠是正常的） */
export async function findOverlaps(ivs: IntervalMs[], excludeId?: string): Promise<DbRecord[]> {
  const now = Date.now();
  const spans = ivs.map((iv) => ({ start: iv.start, end: iv.end ?? now }));
  const lo = Math.min(...spans.map((s) => s.start));
  const hi = Math.max(...spans.map((s) => s.end));
  const candidates = await db.records.where('startMs').between(lo - 7 * DAY_MS, hi, true, false).toArray();
  return candidates.filter((r) => {
    if (r.deleted || r.id === excludeId) return false;
    return r.intervals.some((iv) => {
      const s = fromIso(iv.start);
      const e = iv.end ? fromIso(iv.end) : now;
      return spans.some((x) => s < x.end && e > x.start);
    });
  });
}

export const deleteRecord = (id: string) =>
  mutateRecord(id, (r, now) => ({
    ...r,
    intervals: closeOpenInterval(r, now),
    state: 'stopped',
    deleted: true,
  }));

// ---------- 类型与标签（同一套逻辑） ----------

export type CatalogKind = 'types' | 'tags';
const table = (kind: CatalogKind) => (kind === 'types' ? db.types : db.tags);

export interface CatalogDraft {
  id?: string;
  name: string;
  emoji: string;
  color: string;
}

export async function saveCatalogItem(kind: CatalogKind, draft: CatalogDraft): Promise<string> {
  const t = table(kind);
  if (draft.id) {
    const cur = await t.get(draft.id);
    if (cur) {
      await t.put({ ...cur, name: draft.name, emoji: draft.emoji, color: draft.color, updatedAt: stamp() });
      return cur.id;
    }
  }
  const all = await t.toArray();
  const item: CatalogItem = {
    id: newId(),
    name: draft.name,
    emoji: draft.emoji,
    color: draft.color,
    order: all.reduce((m, x) => Math.max(m, x.order), -1) + 1,
    archived: false,
    updatedAt: stamp(),
    deleted: false,
  };
  await t.put(item);
  return item.id;
}

export async function quickCreateTag(name: string): Promise<string> {
  const count = await db.tags.count();
  return saveCatalogItem('tags', { name, emoji: '🏷️', color: PALETTE[count % PALETTE.length] });
}

export async function setArchived(kind: CatalogKind, id: string, archived: boolean) {
  await table(kind).update(id, { archived, updatedAt: stamp() });
}

export async function softDeleteCatalogItem(kind: CatalogKind, id: string) {
  await table(kind).update(id, { deleted: true, updatedAt: stamp() });
}

/** 在未归档的可见项里与相邻项交换顺序 */
export async function moveCatalogItem(kind: CatalogKind, id: string, dir: -1 | 1) {
  const t = table(kind);
  await db.transaction('rw', t, async () => {
    const list = (await t.orderBy('order').toArray()).filter((x) => !x.deleted && !x.archived);
    const i = list.findIndex((x) => x.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    const s = stamp();
    // 交换后统一重排 order，顺带修正历史数据里可能重复的 order
    const reordered = [...list];
    [reordered[i], reordered[j]] = [reordered[j], reordered[i]];
    await Promise.all(
      reordered
        .map((x, idx) => ({ x, idx }))
        .filter(({ x, idx }) => x.order !== idx)
        .map(({ x, idx }) => t.put({ ...x, order: idx, updatedAt: s })),
    );
  });
}

// ---------- 初始化 / 清空 ----------

/** 只补上本地还没有的默认类型（已存在的，哪怕被改过、删过，都不动） */
export async function seedDefaultTypes() {
  const seeds = defaultTypes();
  const existing = await db.types.bulkGet(seeds.map((s) => s.id));
  await db.types.bulkPut(seeds.filter((_, i) => !existing[i]));
}

/** 清空本地数据，但保留同步配置（仓库、令牌），方便清空后重新从仓库拉取。
 *  同步状态必须一起清掉，否则下次同步会把“空”当成本地修改推上去。 */
export async function clearAllLocalData() {
  await db.transaction('rw', [db.types, db.tags, db.goals, db.records, db.meta], async () => {
    const keep = await db.meta.get('syncConfig');
    await Promise.all([db.types.clear(), db.tags.clear(), db.goals.clear(), db.records.clear(), db.meta.clear()]);
    if (keep) await db.meta.put(keep);
  });
}

// ---------- 目标 ----------

export interface GoalDraft {
  id?: string;
  name: string;
  typeIds: string[];
  tagIds: string[];
  period: 'day' | 'week' | 'month';
  direction: 'atLeast' | 'atMost';
  targetMinutes: number;
}

export async function saveGoal(d: GoalDraft): Promise<string> {
  if (d.typeIds.length === 0 && d.tagIds.length === 0) throw new Error('至少选择一个类型或标签');
  if (!(d.targetMinutes > 0)) throw new Error('目标时长必须大于 0');
  const id = d.id ?? newId();
  await db.goals.put({
    id,
    name: d.name,
    typeIds: d.typeIds,
    tagIds: d.tagIds,
    period: d.period,
    direction: d.direction,
    targetMinutes: d.targetMinutes,
    updatedAt: stamp(),
    deleted: false,
  });
  return id;
}

export async function deleteGoal(id: string) {
  await db.goals.update(id, { deleted: true, updatedAt: stamp() });
}

// ---------- 即时保存（原地编辑）用的局部更新与撤销 ----------

export interface RecordPatchLive {
  typeId?: string;
  comment?: string;
  tagIds?: string[];
  intervals?: IntervalMs[];
}

export async function patchRecord(id: string, patch: RecordPatchLive) {
  if (patch.intervals) {
    const err = validateIntervals(patch.intervals);
    if (err) throw new Error(err);
  }
  await mutateRecord(id, (r) => {
    const next: TimeRecord = { ...r };
    if (patch.typeId !== undefined) next.typeId = patch.typeId;
    if (patch.comment !== undefined) next.comment = patch.comment;
    if (patch.tagIds !== undefined) next.tagIds = patch.tagIds;
    if (patch.intervals) {
      next.intervals = toIntervals(patch.intervals);
      const open = patch.intervals[patch.intervals.length - 1].end === null;
      next.state = open ? 'running' : r.state === 'running' ? 'stopped' : r.state;
    }
    return next;
  });
}

/** 撤销：把记录恢复成展开编辑前的快照（作为一次新的修改，便于同步） */
export async function restoreRecord(snapshot: TimeRecord) {
  await db.records.put(toDb({ ...snapshot, updatedAt: stamp() }));
}

export async function patchGoal(id: string, patch: Partial<Omit<GoalDraft, 'id'>>) {
  const cur = await db.goals.get(id);
  if (!cur) return;
  const next = { ...cur, ...patch };
  if (next.typeIds.length === 0 && next.tagIds.length === 0) throw new Error('至少选择一个类型或标签');
  if (!(next.targetMinutes > 0)) throw new Error('目标时长必须大于 0');
  await db.goals.put({ ...next, updatedAt: stamp() });
}

export async function restoreGoal(snapshot: import('../schema').Goal) {
  await db.goals.put({ ...snapshot, updatedAt: stamp() });
}

export async function patchCatalogItem(kind: CatalogKind, id: string, patch: Partial<Pick<CatalogItem, 'name' | 'emoji' | 'color'>>) {
  if (patch.name !== undefined && !patch.name.trim()) throw new Error('名称不能为空');
  await table(kind).update(id, { ...patch, updatedAt: stamp() });
}

export async function restoreCatalogItem(kind: CatalogKind, snapshot: CatalogItem) {
  await table(kind).put({ ...snapshot, updatedAt: stamp() });
}

// ---------- 合并同名的类型 / 标签 ----------

/** 名称（去掉首尾空格）相同、未删除的项，两个以上为一组 */
export async function findDuplicateGroups(kind: CatalogKind): Promise<CatalogItem[][]> {
  const byName = new Map<string, CatalogItem[]>();
  for (const x of await table(kind).toArray()) {
    if (x.deleted) continue;
    const k = x.name.trim();
    byName.set(k, [...(byName.get(k) ?? []), x]);
  }
  return [...byName.values()].filter((g) => g.length > 1);
}

/**
 * 每组保留一个：优先固定 id 的默认项（以后再选默认类型就不会重复），其次被记录引用最多的，再次最早创建的。
 * 记录、目标、番茄钟设置里对其余项的引用都改指向保留项；其余项标记删除。全部是普通修改，会随同步传到其他设备。
 */
export async function mergeDuplicates(kind: CatalogKind): Promise<{ groups: number; removed: number; recordsUpdated: number }> {
  const groups = await findDuplicateGroups(kind);
  if (groups.length === 0) return { groups: 0, removed: 0, recordsUpdated: 0 };
  const now = stamp();
  return db.transaction('rw', [db.types, db.tags, db.records, db.goals, db.meta], async () => {
    const records = (await db.records.toArray()).filter((r) => !r.deleted);
    const refCount = (id: string) =>
      records.filter((r) => (kind === 'types' ? r.typeId === id : r.tagIds.includes(id))).length;
    const remap = new Map<string, string>();
    let removed = 0;
    const defaultIdByName = new Map(kind === 'types' ? defaultTypes().map((d) => [d.name, d.id]) : []);
    for (const g of groups) {
      const ranked = [...g].sort(
        (a, b) =>
          Number(b.id.startsWith(DEFAULT_ID_PREFIX)) - Number(a.id.startsWith(DEFAULT_ID_PREFIX)) ||
          refCount(b.id) - refCount(a.id) ||
          (a.id < b.id ? -1 : 1),
      );
      let keep = ranked[0];
      // 组里没有固定 id 的默认项、但名称和某个默认类型相同：改用固定 id 作为保留项，
      // 以后在任何设备上再选默认类型都会和它合并，而不是又多出一份
      const defaultId = defaultIdByName.get(keep.name.trim());
      if (!keep.id.startsWith(DEFAULT_ID_PREFIX) && defaultId) {
        keep = { ...keep, id: defaultId, deleted: false };
        removed--; // 新建了保留项，下面会把组里原有的全部移除
      }
      for (const x of g) if (x.id !== keep.id) remap.set(x.id, keep.id);
      // 保留项：只要组里有一个没归档，就不归档；排序取最靠前的
      await table(kind).put({
        ...keep,
        archived: g.every((x) => x.archived),
        order: Math.min(...g.map((x) => x.order)),
        updatedAt: now,
      });
      for (const x of g) {
        if (x.id === keep.id) continue;
        await table(kind).put({ ...x, deleted: true, updatedAt: now });
        removed++;
      }
    }
    const mapIds = (ids: string[]) => [...new Set(ids.map((id) => remap.get(id) ?? id))];
    let recordsUpdated = 0;
    for (const r of records) {
      const next =
        kind === 'types'
          ? remap.has(r.typeId) ? { ...r, typeId: remap.get(r.typeId)! } : null
          : r.tagIds.some((id) => remap.has(id)) ? { ...r, tagIds: mapIds(r.tagIds) } : null;
      if (next) {
        await db.records.put({ ...next, updatedAt: now });
        recordsUpdated++;
      }
    }
    for (const g of await db.goals.toArray()) {
      const ids = kind === 'types' ? g.typeIds : g.tagIds;
      if (!ids.some((id) => remap.has(id))) continue;
      await db.goals.put({ ...g, [kind === 'types' ? 'typeIds' : 'tagIds']: mapIds(ids), updatedAt: now });
    }
    const s = await getSettings();
    const p = s.pomodoro;
    if (kind === 'types' && p.linkedTypeId && remap.has(p.linkedTypeId)) {
      await putSettingsRaw({ ...s, pomodoro: { ...p, linkedTypeId: remap.get(p.linkedTypeId)! }, updatedAt: now });
    }
    if (kind === 'tags' && (p.linkedTagIds ?? []).some((id) => remap.has(id))) {
      await putSettingsRaw({ ...s, pomodoro: { ...p, linkedTagIds: mapIds(p.linkedTagIds ?? []) }, updatedAt: now });
    }
    return { groups: groups.length, removed, recordsUpdated };
  });
}
