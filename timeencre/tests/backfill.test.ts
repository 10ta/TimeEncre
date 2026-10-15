import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/db';
import { createManualRecord, startRecord, suggestBackfillRange } from '../src/db/actions';

const M = 60_000;
const at = (h: number, m: number, s = 0) => new Date(2026, 9, 7, h, m, s).getTime();

beforeEach(async () => {
  await db.records.clear();
  await db.meta.clear();
});

describe('补录默认时间', () => {
  it('从最近一段结束（有秒数则进到下一分钟）到现在', async () => {
    await createManualRecord({ typeId: 'x', comment: '', tagIds: [], intervals: [{ start: at(8, 13), end: at(10, 15, 40) }] });
    await createManualRecord({ typeId: 'y', comment: '', tagIds: [], intervals: [{ start: at(8, 5), end: at(8, 13) }] });
    expect(await suggestBackfillRange(at(10, 47, 30))).toEqual({ start: at(10, 16), end: at(10, 47) });
  });

  it('恰好整分钟结束：首尾相接', async () => {
    await createManualRecord({ typeId: 'x', comment: '', tagIds: [], intervals: [{ start: at(9, 0), end: at(10, 15) }] });
    expect((await suggestBackfillRange(at(11, 0))).start).toBe(at(10, 15));
  });

  it('有更晚开始的进行中计时：补到它开始为止', async () => {
    await createManualRecord({ typeId: 'x', comment: '', tagIds: [], intervals: [{ start: at(9, 0), end: at(10, 15) }] });
    await startRecord('y', { startMs: at(10, 40) });
    expect(await suggestBackfillRange(at(11, 0))).toEqual({ start: at(10, 15), end: at(10, 40) });
  });

  it('没有记录或没有空白时退回最近 30 分钟', async () => {
    expect(await suggestBackfillRange(at(11, 0))).toEqual({ start: at(10, 30), end: at(11, 0) });
    await createManualRecord({ typeId: 'x', comment: '', tagIds: [], intervals: [{ start: at(9, 0), end: at(10, 59, 50) }] });
    expect(await suggestBackfillRange(at(11, 0, 20))).toEqual({ start: at(10, 30), end: at(11, 0) });
  });
});
