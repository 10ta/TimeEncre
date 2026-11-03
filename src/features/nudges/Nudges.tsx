// App 内提醒：页面打开时（可以是后台标签页）每半分钟按 lib/nudges 的规则检查一次。
// 新的提醒同时发系统通知（已授权时）和页面右上角的提示；同一件事只提醒一次，记在本机。
import { useEffect, useRef, useState } from 'react';
import { useGoals, useRecordsInRange, useRoutines, useSettings, useTypeMap } from '../../db/hooks';
import { useNow } from '../../ui/hooks';
import { addDays, formatHm, startOfDay } from '../../lib/time';
import { rangeOf } from '../../lib/range';
import { dueNudges, type Nudge } from '../../lib/nudges';
import { notify } from '../../lib/notify';
import { clockRange } from '../../i18n/dates';
import { CURRENT_WORD } from '../goals/goalView';
import type { CatalogItem } from '../../schema';
import { tr } from '../../i18n';

const STORE = 'timeencre.nudges.fired';
/** 记住多久以内提醒过的 key */
const KEEP_MS = 3 * 86_400_000;

function loadFired(): Map<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) ?? '[]') as Array<[string, number]>;
    const cutoff = Date.now() - KEEP_MS;
    return new Map(raw.filter(([, t]) => t > cutoff));
  } catch {
    return new Map();
  }
}

function saveFired(m: Map<string, number>) {
  try {
    localStorage.setItem(STORE, JSON.stringify([...m]));
  } catch {
    /* 存不下就只在本次打开期间去重 */
  }
}

/** 提醒的标题和正文 */
export function nudgeText(n: Nudge, typeMap: Map<string, CatalogItem>): { title: string; body: string } {
  const name = (id: string) => {
    const t = typeMap.get(id);
    return t ? `${t.emoji} ${t.name}` : tr("（已删除）");
  };
  switch (n.kind) {
    case 'cap': {
      const what = n.goal.name || n.goal.typeIds.map(name).join(tr("、"));
      return {
        title: n.level === 100 ? tr("{0}已超出上限", what) : tr("{0}快到上限了", what),
        body: tr("{0}已 {1}，上限 {2}", CURRENT_WORD[n.goal.period], formatHm(n.ms), formatHm(n.target)),
      };
    }
    case 'long':
      return { title: tr("{0} 已经连续 {1}", name(n.typeId), formatHm(n.minutes * 60_000)), body: tr("站起来活动一下？") };
    case 'idle':
      return { title: tr("已经 {0} 没有计时", formatHm(n.minutes * 60_000)), body: tr("现在在做什么？") };
    case 'routine':
      return { title: tr("按计划现在是 {0}", name(n.typeId)), body: clockRange(n.start, n.end) };
  }
}

export function Nudges() {
  const settings = useSettings();
  const goals = useGoals();
  const routines = useRoutines();
  const typeMap = useTypeMap();
  const now = useNow(30_000);
  const ws = settings?.weekStart ?? 1;
  const from = Math.min(rangeOf('month', now, ws).from, rangeOf('week', now, ws).from);
  const records = useRecordsInRange(from, addDays(startOfDay(now), 1));
  const fired = useRef<Map<string, number> | null>(null);
  const [shown, setShown] = useState<Array<{ key: string; title: string; body: string }>>([]);

  useEffect(() => {
    if (!settings || !goals || !routines || !records || !typeMap) return;
    fired.current ??= loadFired();
    const seen = fired.current;
    const fresh = dueNudges({ now, records, goals, routines, config: settings.nudges, weekStart: ws }).filter((n) => !seen.has(n.key));
    if (!fresh.length) return;
    const t = Date.now();
    for (const n of fresh) for (const k of [n.key, ...n.also]) seen.set(k, t);
    saveFired(seen);
    const msgs = fresh.map((n) => ({ key: n.key, ...nudgeText(n, typeMap) }));
    for (const m of msgs) void notify(m.title, m.body, `timeencre-${m.key.split(':')[0]}`);
    setShown((cur) => [...cur, ...msgs].slice(-3));
  }, [now, settings, goals, routines, records, typeMap, ws]);

  if (!shown.length) return null;
  return (
    <>
      {shown.map((m) => (
        <div key={m.key} className="toast is-nudge" role="status">
          <span>
            <b>{m.title}</b>
            <small>{m.body}</small>
          </span>
          <button type="button" className="btn is-small" onClick={() => setShown((cur) => cur.filter((x) => x.key !== m.key))}>
            {tr("知道了")}
          </button>
        </div>
      ))}
    </>
  );
}
