import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/db';
import { onRecordDiscarded, pauseRecord, restoreRecord, startRecord, stopRecord, updateSettings } from '../src/db/actions';
import type { TimeRecord } from '../src/schema';

beforeEach(async () => {
  await db.records.clear();
  await db.meta.clear();
});

describe('自动作废过短的计时', () => {
  it('默认开启 30 秒：不足的作废并通知，可恢复；够长的保留', async () => {
    const seen: TimeRecord[] = [];
    const off = onRecordDiscarded(({ snapshot }) => seen.push(snapshot));
    const short = await startRecord('x', { startMs: Date.now() - 10_000 });
    await stopRecord(short);
    expect((await db.records.get(short))!.deleted).toBe(true);
    expect(seen.map((r) => r.id)).toEqual([short]);
    await restoreRecord(seen[0]);
    const back = (await db.records.get(short))!;
    expect(back.deleted).toBe(false);
    expect(back.state).toBe('stopped');

    const long = await startRecord('x', { startMs: Date.now() - 45_000 });
    await stopRecord(long);
    expect((await db.records.get(long))!.deleted).toBe(false);
    off();
  });

  it('关闭后不作废；秒数可调；暂停过的按各段总和计算', async () => {
    await updateSettings({ discardShort: false });
    const a = await startRecord('x', { startMs: Date.now() - 5_000 });
    await stopRecord(a);
    expect((await db.records.get(a))!.deleted).toBe(false);

    await updateSettings({ discardShort: true, discardShortSec: 120 });
    const b = await startRecord('x', { startMs: Date.now() - 90_000 });
    await pauseRecord(b);
    await stopRecord(b);
    expect((await db.records.get(b))!.deleted).toBe(true);
  });

  it('不允许并发时，开始新计时会自动停止旧的，旧的过短也作废', async () => {
    await updateSettings({ allowConcurrent: false });
    const a = await startRecord('x', { startMs: Date.now() - 3_000 });
    await startRecord('y');
    expect((await db.records.get(a))!.deleted).toBe(true);
  });
});
