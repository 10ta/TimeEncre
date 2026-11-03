// 目标页下半部分：例程（每周固定几天的时间块）。改动即时保存；删除可撤销。
// 例程会画在历史日历里，计时页会提示“现在计划做什么”，周复盘里有“计划 vs 实际”。
import { type CSSProperties } from 'react';
import { useRoutines, useSettings, useTypes } from '../../db/hooks';
import { createRoutine, deleteRoutine, patchRoutine, restoreRoutine, type RoutineDraft } from '../../db/daily';
import type { CatalogItem, Routine } from '../../schema';
import { ClockField } from '../../ui/ClockField';
import { showUndo } from '../../ui/undo';
import { fromParts } from '../../lib/zone';
import { weekdayNarrow } from '../../i18n/dates';
import { tr } from '../../i18n';

/** 2026-10-11 是周日：加 wd 天就是那个星期几 */
const weekdayName = (wd: number) => weekdayNarrow(fromParts(2026, 10, 11 + wd, 12));

export function RoutinesSection() {
  const routines = useRoutines();
  const types = useTypes();
  const settings = useSettings();
  if (!routines || !types || !settings) return null;
  const ws = settings.weekStart;
  const order = Array.from({ length: 7 }, (_, i) => (ws + i) % 7);

  const add = () => {
    const first = types[0];
    if (!first) return;
    void createRoutine({ typeId: first.id, weekdays: [1, 2, 3, 4, 5], start: 9 * 60, end: 12 * 60 });
  };

  return (
    <section className="routines" aria-labelledby="routines-title">
      <header className="today-head">
        <h2 id="routines-title">{tr("例程")}</h2>
      </header>
      <p className="hint">
        {tr("每周固定时间要做的事，比如工作日 9:00–12:00 学习、每天 23:30 睡觉。它们会画在历史日历里，计时页会提示“现在计划做什么”，周复盘里能看到计划和实际差多少。")}
      </p>
      <ul className="routine-list">
        {routines.map((r) => (
          <RoutineRow key={r.id} routine={r} types={types} order={order} />
        ))}
      </ul>
      <button type="button" className="add-card" onClick={add} disabled={types.length === 0}>
        {tr("＋ 新建例程")}
      </button>
    </section>
  );
}

function RoutineRow({ routine: r, types, order }: { routine: Routine; types: CatalogItem[]; order: number[] }) {
  const t = types.find((x) => x.id === r.typeId);
  // 界面已经挡住了不合法的组合（没有选天、开始等于结束），这里不会出错
  const save = (patch: Partial<RoutineDraft>) => patchRoutine(r.id, patch).catch(() => undefined);
  const toggleDay = (wd: number) => {
    const next = r.weekdays.includes(wd) ? r.weekdays.filter((x) => x !== wd) : [...r.weekdays, wd];
    if (next.length) void save({ weekdays: next });
  };
  return (
    <li className="routine" style={{ '--c': t?.color ?? 'var(--muted)' } as CSSProperties}>
      <select value={r.typeId} onChange={(e) => void save({ typeId: e.target.value })} aria-label={tr("活动|字段")}>
        {!t && <option value={r.typeId}>{tr("（已删除）")}</option>}
        {types.map((x) => (
          <option key={x.id} value={x.id}>
            {x.emoji} {x.name}
          </option>
        ))}
      </select>
      <span className="routine-days" role="group" aria-label={tr("哪几天")}>
        {order.map((wd) => (
          <button key={wd} type="button" className={`day-chip${r.weekdays.includes(wd) ? ' is-on' : ''}`} aria-pressed={r.weekdays.includes(wd)} onClick={() => toggleDay(wd)}>
            {weekdayName(wd)}
          </button>
        ))}
      </span>
      <span className="routine-time">
        <ClockField value={r.start} onChange={(m) => m !== r.end && void save({ start: m })} label={tr("开始")} />
        <span>–</span>
        <ClockField value={r.end} onChange={(m) => m !== r.start && void save({ end: m })} label={tr("结束")} />
      </span>
      <button
        type="button"
        className="btn is-small is-ghost-danger"
        onClick={async () => {
          const snap = await deleteRoutine(r.id);
          if (snap) showUndo(tr("已删除例程"), () => restoreRoutine(snap));
        }}
      >
        {tr("删除")}
      </button>
    </li>
  );
}
