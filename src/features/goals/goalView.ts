// 目标在当前周期的进度，目标页、首页、统计页共用
import type { CatalogItem, Goal } from '../../schema';
import { formatHm } from '../../lib/time';
import { rangeOf, type Range } from '../../lib/range';
import type { GoalStatus } from '../../lib/stats';
import { evalGoal, goalKind, type GoalEval } from '../../lib/goals';
import { fromParts } from '../../lib/zone';
import { clockText } from '../../i18n/dates';
import { tr } from '../../i18n';

export const PERIOD_LABEL = { day: tr("每天"), week: tr("每周"), month: tr("每月") } as const;
export const DIRECTION_LABEL = { atLeast: tr("至少"), atMost: tr("至多") } as const;
export const CURRENT_WORD = { day: tr("今天"), week: tr("本周"), month: tr("本月") } as const;
export const STATUS_TEXT: Record<GoalStatus, string> = { met: tr("已达成"), missed: tr("未达成"), ongoing: tr("进行中"), over: tr("已超出") };
export const KIND_LABEL = {
  duration: tr("累计时长"),
  days: tr("几天达标"),
  clock: tr("按时作息"),
  window: tr("某个时段"),
} as const;
export const EDGE_LABEL = { start: tr("开始不晚于"), end: tr("结束不晚于") } as const;

/** 一天中的第 m 分钟（可以超过 1440）→ 按 12/24 小时制显示 */
export const minuteText = (m: number) => clockText(fromParts(2000, 1, 1, 0, Math.round(m)));

/** “22:00–02:00” */
export const windowText = (g: Pick<Goal, 'windowFrom' | 'windowTo'>) => `${minuteText(g.windowFrom ?? 0)}–${minuteText(g.windowTo ?? 0)}`;

/** 目标本身的说明，不含名字：“每周至少 4 天 ≥ 30m”“开始不晚于 23:30”“每天 22:00–02:00 至多 15m” */
export function goalRule(g: Goal): string {
  const target = formatHm(g.targetMinutes * 60_000);
  switch (goalKind(g)) {
    case 'days':
      return tr("{0}至少 {1} 天、每天 ≥ {2}", PERIOD_LABEL[g.period], g.minDays ?? 1, target);
    case 'clock':
      return `${EDGE_LABEL[g.clockEdge ?? 'start']} ${minuteText(g.clockMin ?? 0)}`;
    case 'window':
      return tr("{0} {1} {2} {3}", PERIOD_LABEL[g.period], windowText(g), DIRECTION_LABEL[g.direction], target);
    default:
      return tr("{0}{1} {2}", PERIOD_LABEL[g.period], DIRECTION_LABEL[g.direction], target);
  }
}

/** 进度数字：“1h 20m / 3h”“2 / 4 天”“23:12 / 23:30” */
export function evalText(g: Goal, ev: GoalEval): string {
  switch (goalKind(g)) {
    case 'days':
      return tr("{0} / {1} 天", ev.value ?? 0, ev.target);
    case 'clock':
      return `${ev.value == null ? '—' : minuteText(ev.value)} / ${minuteText(ev.target)}`;
    default:
      return `${formatHm(ev.value ?? 0)} / ${formatHm(ev.target)}`;
  }
}

/** 进行中时的提示：还差多少 / 还剩多少 */
function remainText(g: Goal, ev: GoalEval): string {
  const kind = goalKind(g);
  if (kind === 'days') {
    const left = ev.target - (ev.value ?? 0);
    return left > 0 ? tr("还差 {0} 天", left) : STATUS_TEXT.met;
  }
  if (kind === 'clock') return g.clockEdge === 'end' ? tr("{0} 前结束", minuteText(ev.target)) : tr("{0} 前开始", minuteText(ev.target));
  const remaining = ev.target - (ev.value ?? 0);
  return g.direction === 'atLeast'
    ? remaining > 0
      ? tr("还差 {0}", formatHm(remaining))
      : tr("超额 {0}", formatHm(-remaining))
    : remaining >= 0
      ? tr("还剩 {0}", formatHm(remaining))
      : tr("超出 {0}", formatHm(-remaining));
}

export interface GoalView {
  goal: Goal;
  period: Range;
  title: string;
  /** 首页用：没起名字时用活动/标签名开头，例如“阅读 每天至多 1h” */
  shortTitle: string;
  items: CatalogItem[];
  color: string;
  ev: GoalEval;
  status: GoalStatus;
  /** 进度数字 */
  numbers: string;
  /** 0–100；按时作息没有进度条 */
  pct: number | null;
  /** 当前周期已流逝的比例 0–1 */
  elapsed: number;
  remainText: string;
}

type RecLike = Parameters<typeof evalGoal>[1][number];

export function viewGoal(
  g: Goal,
  records: RecLike[],
  now: number,
  weekStart: number,
  typeMap: Map<string, CatalogItem>,
  tagMap: Map<string, CatalogItem>,
): GoalView {
  const period = rangeOf(g.period, now, weekStart);
  const ev = evalGoal(g, records, period, now, false);
  const items = [...g.typeIds.map((id) => typeMap.get(id)), ...g.tagIds.map((id) => tagMap.get(id))].filter(
    (x): x is CatalogItem => !!x && !x.deleted,
  );
  const rule = goalRule(g);
  return {
    goal: g,
    period,
    title: g.name || rule,
    shortTitle: g.name || `${items.map((x) => x.name).join(tr("、")) || tr("（已删除）")} ${rule}`,
    items,
    color: items[0]?.color ?? 'var(--accent)',
    ev,
    status: ev.status,
    numbers: evalText(g, ev),
    pct: ev.pct,
    elapsed: Math.min(1, Math.max(0, (now - period.from) / (period.to - period.from))),
    remainText: remainText(g, ev),
  };
}
