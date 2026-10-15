// 目标在当前周期的进度，目标页和首页共用
import type { CatalogItem, Goal } from '../../schema';
import { formatHm } from '../../lib/time';
import { rangeOf, type Range } from '../../lib/range';
import { goalProgressMs, goalStatus, type GoalStatus } from '../../lib/stats';
import { tr } from '../../i18n';

export const PERIOD_LABEL = { day: tr("每天"), week: tr("每周"), month: tr("每月") } as const;
export const DIRECTION_LABEL = { atLeast: tr("至少"), atMost: tr("至多") } as const;
export const CURRENT_WORD = { day: tr("今天"), week: tr("本周"), month: tr("本月") } as const;
export const STATUS_TEXT: Record<GoalStatus, string> = { met: tr("已达成"), missed: tr("未达成"), ongoing: tr("进行中"), over: tr("已超出") };

export interface GoalView {
  goal: Goal;
  period: Range;
  title: string;
  /** 首页用：没起名字时用类型/标签名代替周期，例如“阅读 至多 1h 00m” */
  shortTitle: string;
  items: CatalogItem[];
  color: string;
  ms: number;
  target: number;
  status: GoalStatus;
  /** 0–100 */
  pct: number;
  /** 当前周期已流逝的比例 0–1 */
  elapsed: number;
  remainText: string;
}

type RecLike = Parameters<typeof goalProgressMs>[1][number];

export function viewGoal(
  g: Goal,
  records: RecLike[],
  now: number,
  weekStart: number,
  typeMap: Map<string, CatalogItem>,
  tagMap: Map<string, CatalogItem>,
): GoalView {
  const period = rangeOf(g.period, now, weekStart);
  const ms = goalProgressMs(g, records, period.from, period.to, now);
  const target = g.targetMinutes * 60_000;
  const items = [...g.typeIds.map((id) => typeMap.get(id)), ...g.tagIds.map((id) => tagMap.get(id))].filter(
    (x): x is CatalogItem => !!x && !x.deleted,
  );
  const remaining = target - ms;
  return {
    goal: g,
    period,
    title: g.name || tr("{0}{1} {2}", PERIOD_LABEL[g.period], DIRECTION_LABEL[g.direction], formatHm(target)),
    shortTitle:
      g.name ||
      `${items.map((x) => x.name).join(tr("、")) || tr("（已删除）")} ${DIRECTION_LABEL[g.direction]} ${formatHm(target)}`,
    items,
    color: items[0]?.color ?? 'var(--accent)',
    ms,
    target,
    status: goalStatus(g, ms, false),
    pct: Math.min(100, (ms / target) * 100),
    elapsed: Math.min(1, Math.max(0, (now - period.from) / (period.to - period.from))),
    remainText:
      g.direction === 'atLeast'
        ? remaining > 0
          ? tr("还差 {0}", formatHm(remaining))
          : tr("超额 {0}", formatHm(-remaining))
        : remaining >= 0
          ? tr("还剩 {0}", formatHm(remaining))
          : tr("超出 {0}", formatHm(-remaining)),
  };
}
