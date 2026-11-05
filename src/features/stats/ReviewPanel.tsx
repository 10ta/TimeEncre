// 统计页周视图最上面的“本周复盘”：自动从这一周的数据得出建议、要点和规律（近 8 周）。
// 建议可以一键落实成目标或例程（都能撤销）。
import { useMemo, type ReactNode } from 'react';
import type { CatalogItem, Goal, Routine, Settings } from '../../schema';
import { useRatings, useRoutines } from '../../db/hooks';
import { deleteGoal, saveGoal } from '../../db/actions';
import { createRoutine, deleteRoutine } from '../../db/daily';
import { weeklyReview, type Link, type ReviewGoal, type Suggestion } from '../../lib/review';
import { formatHm } from '../../lib/time';
import { showUndo } from '../../ui/undo';
import { hourLabel } from '../../i18n/dates';
import { goalRule, minuteText } from '../goals/goalView';
import { Section, sleepTypeOf } from './Panels';
import type { StatsCtx } from './StatRows';
import { tr } from '../../i18n';

const pct = (x: number) => `${Math.round(x * 100)}%`;
/** 日均；本周还没有过完的日子时是到现在为止的总时长 */
const show = (ms: number, partial: boolean) => (partial ? formatHm(ms) : tr("{0}/天", formatHm(ms)));

export function ReviewPanel({ ctx, settings, goals, types, typeMap }: { ctx: StatsCtx; settings: Settings; goals: Goal[]; types: CatalogItem[]; typeMap: Map<string, CatalogItem> }) {
  const routines = useRoutines();
  const ratings = useRatings();
  const sleepTypeId = sleepTypeOf(settings, types);
  const { records, range, prevWin, now, firstMs, weekStart } = ctx;
  const review = useMemo(
    () =>
      routines && ratings
        ? weeklyReview({
            records,
            goals,
            routines,
            ratings,
            week: range,
            prev: prevWin,
            now,
            firstMs,
            weekStart,
            sleepTypeId,
            typeIds: types.map((t) => t.id),
          })
        : null,
    [records, goals, routines, ratings, range, prevWin, now, firstMs, weekStart, sleepTypeId, types],
  );
  if (!review || review.days === 0) return null;

  const name = (id: string | null) => {
    const t = id ? typeMap.get(id) : undefined;
    return t ? `${t.emoji} ${t.name}` : tr("（已删除）");
  };
  // 没起名字的目标用“活动 + 规则”称呼，同一活动有几个目标时也分得清
  const goalName = (g: ReviewGoal) =>
    g.name || `${g.typeIds.map((id) => typeMap.get(id)?.name ?? '').filter(Boolean).join(tr("、")) || tr("目标")} ${goalRule(g as Goal)}`;
  const current = range.from <= now && now < range.to;

  return (
    <Section title={current ? tr("本周复盘（到目前为止）") : tr("本周复盘")}>
      {review.suggestions.length > 0 && (
        <ul className="review-suggest">
          {review.suggestions.map((s, i) => (
            <li key={i}>
              <SuggestionView s={s} name={name} goalName={goalName} sleepTypeId={sleepTypeId} anchor={range.from} />
            </li>
          ))}
        </ul>
      )}

      <dl className="detail-grid is-wide review-facts">
        {review.goals.length > 0 && (
          <div>
            <dt>{tr("目标")}</dt>
            <dd className="review-lines">
              {review.goals.map((g) => (
                <span key={g.goal.id}>
                  {goalName(g.goal)} <b>{g.judged ? tr("{0}/{1} 达成", g.met, g.judged) : tr("进行中")}</b>
                </span>
              ))}
            </dd>
          </div>
        )}
        {review.changes.length > 0 && (
          <div>
            <dt>{tr("超出往常（较前 4 周同期）")}</dt>
            <dd className="review-lines">
              {review.changes.map((c) => (
                <span key={c.typeId}>
                  {name(c.typeId)} <b>{c.cur > c.median ? '↑' : '↓'} {formatHm(Math.abs(c.cur - c.median))}</b>
                  <small>{tr("往常 {0}（{1}–{2}）→ 本周 {3}", show(c.median, c.partial), formatHm(c.min), formatHm(c.max), show(c.cur, c.partial))}</small>
                </span>
              ))}
            </dd>
          </div>
        )}
        {review.routines.length > 0 && (
          <div>
            <dt>{tr("例程：计划 vs 实际")}</dt>
            <dd className="review-lines">
              {review.routines.map((r) => (
                <span key={r.routine.id}>
                  {name(r.routine.typeId)} {minuteText(r.routine.start)}–{minuteText(r.routine.end)} <b>{pct(r.doneMs / r.plannedMs)}</b>
                  <small>{tr("{0} / {1}", formatHm(r.doneMs), formatHm(r.plannedMs))}</small>
                </span>
              ))}
            </dd>
          </div>
        )}
        <div>
          <dt>{tr("感受")}</dt>
          <dd>
            {review.rating.avg == null ? (
              <small>{tr("这周还没打分。计时页可以给每天打 1–5 分。")}</small>
            ) : (
              <>
                {tr("平均 {0} 分", review.rating.avg.toFixed(1))}
                <small>
                  {tr("{0} 天", review.rating.n)}
                  {review.rating.prevAvg != null && tr(" · 上周 {0}", review.rating.prevAvg.toFixed(1))}
                </small>
              </>
            )}
          </dd>
        </div>
      </dl>

      <h3 className="review-sub">{tr("关联（近 8 周）")}</h3>
      <ul className="review-links">
        {review.ratingLinks.length ? (
          review.ratingLinks.map((l) => <LinkLine key={`r${l.typeId}`} l={l} who={tr("评分 4–5 分的日子")} name={name} />)
        ) : (
          <li className="hint">{tr("评分和哪些活动有关联：至少要有 4 天高分（4–5）和 4 天其他分数，目前近 8 周打了 {0} 天。", review.ratedDays)}</li>
        )}
        {review.sleepSplitMs != null &&
          review.sleepLinks.map((l) => <LinkLine key={`s${l.typeId}`} l={l} who={tr("睡了 {0} 以上的第二天", formatHm(review.sleepSplitMs!))} name={name} />)}
        {review.sleepSplitMs != null && review.sleepLinks.length === 0 && (
          <li className="hint">{tr("睡得长短和第二天做的事没有明显关系。")}</li>
        )}
      </ul>
      <p className="hint">{tr("关联是把日子分两组比较各活动的日均，差 20 分钟以上才列出；只说明一起出现，不一定是原因。")}</p>
    </Section>
  );
}

function LinkLine({ l, who, name }: { l: Link; who: string; name: (id: string) => string }) {
  return (
    <li>
      {tr("{0}，{1}平均{2} {3}", who, name(l.typeId), l.diffMs > 0 ? tr("多") : tr("少"), formatHm(Math.abs(l.diffMs)))}
      <small>{tr("（{0} 天 vs {1} 天）", l.nA, l.nB)}</small>
    </li>
  );
}

/** 一键落实：建好之后给一个可撤销的提示 */
async function addGoal(draft: Parameters<typeof saveGoal>[0]) {
  const id = await saveGoal(draft);
  showUndo(tr("已添加目标"), () => deleteGoal(id));
}

async function addRoutine(r: Pick<Routine, 'typeId' | 'weekdays' | 'start' | 'end'>) {
  const id = await createRoutine(r);
  showUndo(tr("已添加例程"), () => void deleteRoutine(id));
}

function SuggestionView({ s, name, goalName, sleepTypeId, anchor }: { s: Suggestion; name: (id: string | null) => string; goalName: (g: ReviewGoal) => string; anchor: number; sleepTypeId: string | null }) {
  let text: string;
  let action: ReactNode = null;
  switch (s.kind) {
    case 'capWindow': {
      text = tr("「{0}」本周超限 {1}/{2} 天，{3} 的时间在 {4}–{5}。给这个时段单独设个上限，比管全天更好做到。", goalName(s.goal), s.missed, s.judged, pct(s.share), hourLabel(s.fromHour), hourLabel(s.toHour));
      action = (
        <button
          type="button"
          className="btn is-small"
          onClick={() =>
            void addGoal({
              name: '', typeIds: s.goal.typeIds, tagIds: s.goal.tagIds, period: 'day', direction: 'atMost', targetMinutes: 15,
              kind: 'window', windowFrom: s.fromHour * 60, windowTo: s.toHour * 60,
            })
          }
        >
          {tr("设 {0}–{1} 至多 15 分钟", hourLabel(s.fromHour), hourLabel(s.toHour))}
        </button>
      );
      break;
    }
    case 'fixTime':
      text =
        s.hour != null
          ? tr("「{0}」本周只达成 {1}/{2}。{3} 平时多在 {4} 做，用一个例程把时间固定下来。", goalName(s.goal), s.met, s.judged, name(s.typeId), hourLabel(s.hour))
          : tr("「{0}」本周只达成 {1}/{2}。用一个例程把时间固定下来。", goalName(s.goal), s.met, s.judged);
      if (s.typeId && s.hour != null) {
        const typeId = s.typeId;
        const start = s.hour * 60;
        action = (
          <button type="button" className="btn is-small" onClick={() => void addRoutine({ typeId, weekdays: [1, 2, 3, 4, 5], start, end: (start + 60) % 1440 })}>
            {tr("添加例程：工作日 {0}–{1}", minuteText(start), minuteText(start + 60))}
          </button>
        );
      }
      break;
    case 'bedtime':
      text = tr("入睡时间波动 ±{0}（平均 {1}）。设一个就寝目标，每天都能看到有没有做到。", formatHm(s.sdMin * 60_000), minuteText(s.bedMin));
      if (sleepTypeId) {
        const typeId = sleepTypeId;
        action = (
          <button type="button" className="btn is-small" onClick={() => void addGoal({ name: '', typeIds: [typeId], tagIds: [], period: 'day', direction: 'atMost', targetMinutes: 1, kind: 'clock', clockEdge: 'start', clockMin: s.suggestMin })}>
            {tr("设“{0} 前开始睡眠”", minuteText(s.suggestMin))}
          </button>
        );
      }
      break;
    case 'routine': {
      const r = s.result;
      text =
        r.peakHour != null
          ? tr("例程「{0} {1}–{2}」只做到 {3}；{0} 实际多在 {4} 做。可以把例程挪过去，或者缩短。", name(r.routine.typeId), minuteText(r.routine.start), minuteText(r.routine.end), pct(r.doneMs / r.plannedMs), hourLabel(r.peakHour))
          : tr("例程「{0} {1}–{2}」只做到 {3}。可以换个时间，或者缩短。", name(r.routine.typeId), minuteText(r.routine.start), minuteText(r.routine.end), pct(r.doneMs / r.plannedMs));
      action = (
        <a className="btn is-small" href="#/goals">
          {tr("去调整")}
        </a>
      );
      break;
    }
    case 'untracked':
      text = tr("本周有 {0} 没有记录，复盘会因此不准。", formatHm(s.ms));
      action = (
        <a className="btn is-small" href={`#/history?mode=week&anchor=${anchor}&gaps=1`}>
          {tr("去补上")}
        </a>
      );
      break;
  }
  return (
    <>
      <span>{text}</span>
      {action}
    </>
  );
}
