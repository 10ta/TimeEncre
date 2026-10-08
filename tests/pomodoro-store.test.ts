import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/db';
import { pauseRecord, startRecord, stopRecord, updateSettings } from '../src/db/actions';
import { defaultSettings } from '../src/db/defaults';
import { initialState } from '../src/pomodoro/machine';
import { POMODORO_COMMENT, adoptRecord, followLinkedRecord, getPomo, settleNow } from '../src/pomodoro/store';

const M = 60_000;
const active = async () => (await db.records.where('active').equals(1).toArray()).filter((r) => !r.deleted);

beforeEach(async () => {
  await db.records.clear();
  await db.meta.clear();
  await updateSettings({
    pomodoro: { ...defaultSettings().pomodoro, linkedTypeId: 'study', autoStartBreak: true, autoStartFocus: true, linkedTagIds: ['tcf'] },
  });
});

describe('番茄钟与记录', () => {
  it('两处同时结算只会新建一条专注记录（不会留下孤儿）', async () => {
    const now = Date.now();
    const recId = await startRecord('study', { startMs: now - 31 * M, comment: POMODORO_COMMENT });
    await db.meta.put({
      key: 'pomodoroState',
      value: { ...initialState(now), status: 'running', runSince: now - 31 * M, recordId: recId },
    });
    await Promise.all([settleNow({ alert: false }), settleNow({ alert: false }), settleNow({ alert: false })]);
    const act = await active();
    expect(act).toHaveLength(1);
    const pomo = await getPomo();
    expect(pomo.recordId).toBe(act[0].id);
    expect(act[0].tagIds).toEqual(['tcf']); // 自动带上标签
    expect(pomo.phase).toBe('work');
  });

  it('关联记录在别处被暂停 / 停止时，番茄钟跟着变', async () => {
    const now = Date.now();
    const recId = await startRecord('study', { startMs: now - 5 * M, comment: POMODORO_COMMENT });
    await db.meta.put({ key: 'pomodoroState', value: { ...initialState(now), status: 'running', runSince: now - 5 * M, recordId: recId } });
    await pauseRecord(recId);
    await followLinkedRecord();
    expect((await getPomo()).status).toBe('paused');
    await stopRecord(recId);
    await followLinkedRecord();
    const p = await getPomo();
    expect(p.status).toBe('idle');
    expect(p.recordId).toBeNull();
  });

  it('接管孤儿记录：从已计时的进度继续', async () => {
    const now = Date.now();
    const orphan = await startRecord('study', { startMs: now - 10 * M, comment: POMODORO_COMMENT });
    await adoptRecord(orphan);
    const p = await getPomo();
    expect(p.status).toBe('running');
    expect(p.recordId).toBe(orphan);
    expect(p.runSince).toBeLessThanOrEqual(now - 10 * M + 1000);
  });
});

describe('Pomo 备注标记', () => {
  it('新标记不带语言，旧的中文标记也能识别', async () => {
    const { isPomodoroComment, POMODORO_COMMENT } = await import('../src/pomodoro/store');
    expect(POMODORO_COMMENT).toBe('🍅 Pomo');
    expect(isPomodoroComment('🍅 番茄钟')).toBe(true);
    expect(isPomodoroComment('🍅 Pomo')).toBe(true);
    expect(isPomodoroComment('番茄')).toBe(false);
  });
});
