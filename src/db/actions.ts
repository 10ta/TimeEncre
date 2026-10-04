// 所有写操作集中在这里。每次写入都更新 updatedAt，P2 的同步合并依赖它。
import { db, fromDb, toDb, type DbRecord } from './db';
import type { CatalogItem, Settings, TimeRecord } from '../schema';
import { newId } from '../lib/id';
import { fromIso, toIso } from '../lib/time';
import { PALETTE, defaultSettings, defaultTypes } from './defaults';

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

function closeOpenInterval(rec: TimeRecord, now: number): TimeRecord['intervals'] {
  return rec.intervals.map((iv) =>
    iv.end === null ? { ...iv, end: toIso(Math.max(now, fromIso(iv.start))) } : iv,
  );
}

async function activeRecords(): Promise<DbRecord[]> {
  return db.records.where('active').equals(1).toArray();
}

/** 不允许并发时：停止除 exceptId 外所有进行中/暂停的记录 */
async function stopOthersIfExclusive(now: number, exceptId?: string) {
  const s = await getSettings();
  if (s.allowConcurrent) return;
  for (const r of await activeRecords()) {
    if (r.id === exceptId) continue;
    const rec = fromDb(r);
    await db.records.put(
      toDb({ ...rec, intervals: closeOpenInterval(rec, now), state: 'stopped', updatedAt: stamp(now) }),
    );
  }
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
  return db.transaction('rw', db.records, db.meta, async () => {
    await stopOthersIfExclusive(now);
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
  await db.transaction('rw', db.records, db.meta, async () => {
    await stopOthersIfExclusive(now, id);
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
}

/** 在指定时间点停止（番茄钟在后台到点时用，避免停止时间晚于实际结束） */
export const stopRecordAt = (id: string, at: number) =>
  mutateRecord(id, (r) =>
    r.state === 'stopped' ? null : { ...r, intervals: closeOpenInterval(r, at), state: 'stopped' },
  );

export const stopRecord = (id: string) =>
  mutateRecord(id, (r, now) =>
    r.state === 'stopped' ? null : { ...r, intervals: closeOpenInterval(r, now), state: 'stopped' },
  );

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

export async function seedDefaultTypes() {
  await db.types.bulkPut(defaultTypes());
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
