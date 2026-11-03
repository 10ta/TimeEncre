// 例程与每日评分：展开成时间段、计划 vs 实际、写操作、同步到 daily.json、备份
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/db';
import { createRoutine, deleteRoutine, patchRoutine, setRating } from '../src/db/daily';
import { _setZoneForTest } from '../src/lib/zone';
import { adherence, currentBlocks, routineBlocks } from '../src/lib/routines';
import { saveSyncConfig, syncNow } from '../src/sync/engine';
import { exportBundle, importBundle } from '../src/io/bundle';
import { FakeGitHub } from './fakeGithub';

const H = 3_600_000;
// 上海时区：2026-10-12 是周一
const at = (d: number, h: number, mi = 0) => Date.parse(`2026-10-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}:00+08:00`);
const iso = (ms: number) => new Date(ms).toISOString();
const rec = (typeId: string, s: number, e: number | null) => ({ typeId, intervals: [{ start: iso(s), end: e === null ? null : iso(e) }] });

beforeEach(() => _setZoneForTest('Asia/Shanghai'));
afterEach(() => _setZoneForTest(null));

describe('例程展开', () => {
  const study = { id: 'r1', typeId: 's', weekdays: [1, 2, 3, 4, 5], start: 9 * 60, end: 12 * 60 };
  const sleep = { id: 'r2', typeId: 'z', weekdays: [0, 1, 2, 3, 4, 5, 6], start: 23 * 60 + 30, end: 7 * 60 };
  it('只在选中的星期几；跨午夜的那段从前一天开始', () => {
    const week = routineBlocks([study], at(12, 0), at(19, 0));
    expect(week).toHaveLength(5);
    expect(week[0]).toMatchObject({ start: at(12, 9), end: at(12, 12) });
    const night = routineBlocks([sleep], at(13, 0), at(14, 0));
    expect(night.map((b) => [b.start, b.end])).toEqual([
      [at(12, 23, 30), at(13, 7)],
      [at(13, 23, 30), at(14, 7)],
    ]);
  });
  it('当前的例程段', () => {
    expect(currentBlocks([study, sleep], at(13, 10))).toHaveLength(1);
    expect(currentBlocks([study, sleep], at(13, 13))).toHaveLength(0);
    expect(currentBlocks([study, sleep], at(14, 2))[0].routine.id).toBe('r2');
  });
  it('删除的、没选天的不展开', () => {
    expect(routineBlocks([{ ...study, deleted: true }, { ...study, weekdays: [] }], at(12, 0), at(19, 0))).toHaveLength(0);
  });
  it('计划 vs 实际：计划时段里做了多少、时段外做了多少，截止到现在', () => {
    const rs = [rec('s', at(12, 8), at(12, 10)), rec('s', at(13, 14), at(13, 15)), rec('x', at(12, 10), at(12, 11))];
    const a = adherence(study, rs, at(12, 0), at(19, 0), at(13, 18));
    expect(a.plannedMs).toBe(6 * H);
    expect(a.doneMs).toBe(1 * H);
    expect(a.outsideMs).toBe(2 * H);
  });
});

describe('写操作与同步', () => {
  let gh: FakeGitHub;
  beforeEach(async () => {
    await Promise.all([db.routines.clear(), db.ratings.clear(), db.meta.clear(), db.records.clear(), db.types.clear(), db.goals.clear()]);
    gh = new FakeGitHub();
    globalThis.fetch = gh.fetch as typeof fetch;
    await saveSyncConfig({ repo: 'me/data', branch: 'main', dir: 'TimeEncre', token: 't', autoSync: false });
  });

  it('不合法的例程被拒绝；删除留墓碑', async () => {
    await expect(createRoutine({ typeId: 's', weekdays: [], start: 60, end: 120 })).rejects.toThrow();
    await expect(createRoutine({ typeId: 's', weekdays: [1], start: 60, end: 60 })).rejects.toThrow();
    const id = await createRoutine({ typeId: 's', weekdays: [5, 1], start: 60, end: 120 });
    expect((await db.routines.get(id))!.weekdays).toEqual([1, 5]);
    await patchRoutine(id, { start: 90 });
    expect((await db.routines.get(id))!.start).toBe(90);
    await deleteRoutine(id);
    expect((await db.routines.get(id))!.deleted).toBe(true);
  });

  it('评分：设置、改、清除', async () => {
    await setRating('2026-10-13', 4);
    await setRating('2026-10-13', 2);
    expect((await db.ratings.get('2026-10-13'))!.score).toBe(2);
    await setRating('2026-10-13', null);
    expect((await db.ratings.get('2026-10-13'))!.deleted).toBe(true);
  });

  it('daily.json：推上去，另一台设备拉下来按条目合并', async () => {
    await createRoutine({ typeId: 's', weekdays: [1], start: 540, end: 720 });
    await setRating('2026-10-13', 5);
    await syncNow();
    const file = JSON.parse(gh.files()['TimeEncre/daily.json']);
    expect(file.kind).toBe('daily');
    expect(file.routines).toHaveLength(1);
    expect(file.ratings[0]).toMatchObject({ id: '2026-10-13', score: 5 });

    // 另一台设备：清空本地后从仓库拉取；同时远端多了一条评分
    await gh.commitFiles({
      'TimeEncre/daily.json': JSON.stringify({ ...file, ratings: [...file.ratings, { id: '2026-10-14', score: 3, updatedAt: new Date().toISOString(), deleted: false }] }),
    });
    await Promise.all([db.routines.clear(), db.ratings.clear(), db.meta.delete('syncState')]);
    await syncNow();
    expect(await db.routines.count()).toBe(1);
    expect((await db.ratings.get('2026-10-14'))!.score).toBe(3);
  });

  it('备份带上例程和评分', async () => {
    await createRoutine({ typeId: 's', weekdays: [1], start: 540, end: 720 });
    await setRating('2026-10-13', 4);
    const b = await exportBundle();
    expect(b.routines).toHaveLength(1);
    expect(b.ratings).toHaveLength(1);
    await Promise.all([db.routines.clear(), db.ratings.clear()]);
    await importBundle(JSON.parse(JSON.stringify(b)));
    expect(await db.routines.count()).toBe(1);
    expect((await db.ratings.get('2026-10-13'))!.score).toBe(4);
  });
});
