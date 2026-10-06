// 番茄钟的持久化与副作用：状态存在本地（不同步到仓库，每台设备各自计时），
// 工作段会在“计时”里生成一条所选类型的记录，所以番茄时间会出现在历史和统计里。
//
// 所有操作都经 exclusive() 串行执行：到点结算可能同时由多处触发（后台定时器、打开页面、
// 回到前台、开发模式下 React 的二次执行、PWA 窗口和浏览器标签页同时开着），
// 并发执行会读到同一份旧状态、各自新建一条记录，留下一条番茄钟不再认识的“孤儿”记录。
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type DbRecord } from '../db/db';
import { getSettings, pauseRecord, resumeRecord, startRecord, stopRecord, stopRecordAt } from '../db/actions';
import { chime, notify } from '../lib/notify';
import { fromIso } from '../lib/time';
import * as M from './machine';
import type { PomoState } from './machine';

const KEY = 'pomodoroState';
export const POMODORO_COMMENT = '🍅 番茄钟';

let chain: Promise<unknown> = Promise.resolve();

/** 同一标签页内用 Promise 链排队；浏览器支持 Web Locks（HTTPS / localhost）时多个标签页之间也互斥 */
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  const run = () => (locks ? (locks.request('timeencre-pomodoro', fn) as Promise<T>) : fn());
  const p = chain.then(run, run);
  chain = p.catch(() => undefined);
  return p;
}

export async function getPomo(): Promise<PomoState> {
  return ((await db.meta.get(KEY))?.value as PomoState | undefined) ?? M.initialState(Date.now());
}
const putPomo = (s: PomoState) => db.meta.put({ key: KEY, value: s });

export const usePomo = () => useLiveQuery(getPomo, []);

const cfg = async () => (await getSettings()).pomodoro;

const startLinkedRecord = (c: M.PomoConfig, startMs: number) =>
  startRecord(c.linkedTypeId!, { startMs, comment: POMODORO_COMMENT, tagIds: M.linkedTags(c) });

async function settleInner(alert: boolean) {
  const c = await cfg();
  const now = Date.now();
  const before = await getPomo();
  const { state, finished, workStartedAt } = M.settle(before, c, now);
  if (finished.length === 0 && state === before) return;
  for (const f of finished) if (f.recordId) await stopRecordAt(f.recordId, f.endAt);
  let next = state;
  if (workStartedAt !== null && c.linkedTypeId) next = { ...next, recordId: await startLinkedRecord(c, workStartedAt) };
  await putPomo(next);
  if (finished.length && alert) {
    const last = finished[finished.length - 1];
    const title = last.phase === 'work' ? '🍅 专注结束' : '☕ 休息结束';
    const body =
      last.phase === 'work'
        ? `今天已完成 ${next.today.count} 个番茄。${next.status === 'running' ? '休息已自动开始。' : '该休息一下了。'}`
        : next.status === 'running' ? '新的专注已自动开始。' : '准备开始下一个番茄。';
    if (c.sound) chime();
    await notify(title, body);
  }
}

/** 推进到现在；有阶段结束时提醒 */
export const settleNow = (opts: { alert: boolean } = { alert: true }) => exclusive(() => settleInner(opts.alert));

export const startPomo = () =>
  exclusive(async () => {
    await settleInner(false);
    const c = await cfg();
    const s = await getPomo();
    const now = Date.now();
    if (s.status === 'running') return;
    let next = M.start(s, now);
    if (s.status === 'paused') {
      if (s.recordId) await resumeRecord(s.recordId);
    } else if (s.phase === 'work' && c.linkedTypeId) {
      next = { ...next, recordId: await startLinkedRecord(c, now) };
    }
    await putPomo(next);
  });

export const pausePomo = () =>
  exclusive(async () => {
    await settleInner(false);
    const s = await getPomo();
    if (s.status !== 'running') return;
    if (s.recordId) await pauseRecord(s.recordId);
    await putPomo(M.pause(s, Date.now()));
  });

export const skipPomo = () =>
  exclusive(async () => {
    const s = await getPomo();
    if (s.recordId) await stopRecord(s.recordId);
    await putPomo(M.skip(s, await cfg()));
  });

export const resetPomo = () =>
  exclusive(async () => {
    const s = await getPomo();
    if (s.recordId) await stopRecord(s.recordId);
    await putPomo(M.reset(s, Date.now()));
  });

export const switchPhase = (phase: M.Phase) => exclusive(async () => putPomo(M.switchPhase(await getPomo(), phase)));

/**
 * 关联记录在别处被暂停 / 继续 / 停止（顶部横条、计时页、其他设备同步过来）时，番茄钟跟着变：
 * 暂停 → 暂停；继续 → 继续；停止或删除 → 当作“提前结束本段”。只改番茄钟状态，不再去动记录。
 */
export const followLinkedRecord = () =>
  exclusive(async () => {
    const s = await getPomo();
    if (!s.recordId || s.status === 'idle') return;
    const row = await db.records.get(s.recordId);
    if (!row || row.deleted || row.state === 'stopped') {
      await putPomo({ ...M.skip(s, await cfg()), recordId: null });
      return;
    }
    if (row.state === 'paused' && s.status === 'running') {
      const lastEnd = row.intervals[row.intervals.length - 1].end;
      await putPomo(M.pause(s, lastEnd ? fromIso(lastEnd) : Date.now()));
    } else if (row.state === 'running' && s.status === 'paused') {
      await putPomo(M.start(s, fromIso(row.intervals[row.intervals.length - 1].start)));
    }
  });

/** 正在计时、带番茄钟备注、但当前番茄钟没有关联的记录 */
export const useOrphanRecords = (pomo: PomoState | undefined) =>
  useLiveQuery(
    async () =>
      (await db.records.where('active').equals(1).toArray()).filter(
        (r) => !r.deleted && r.comment === POMODORO_COMMENT && r.id !== pomo?.recordId,
      ),
    [pomo?.recordId],
  );

/** 接管一条记录：番茄钟从它已经计时的进度继续（已超时的话会立即按准确时间结算） */
export const adoptRecord = (id: string) =>
  exclusive(async () => {
    const s = await getPomo();
    if (s.status !== 'idle') throw new Error('请先重置当前的 Pomo');
    const row: DbRecord | undefined = await db.records.get(id);
    if (!row || row.deleted || row.state === 'stopped') return;
    let closed = 0;
    let openStart: number | null = null;
    for (const iv of row.intervals) {
      if (iv.end) closed += fromIso(iv.end) - fromIso(iv.start);
      else openStart = fromIso(iv.start);
    }
    await putPomo({
      ...s,
      phase: 'work',
      status: openStart !== null ? 'running' : 'paused',
      accMs: closed,
      runSince: openStart,
      recordId: id,
    });
    await settleInner(true);
  });
