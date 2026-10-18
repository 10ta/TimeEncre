// 统计页下半部分：作息、自定义指标、星期 / 时段规律、Pomo。
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import type { DbRecord } from '../../db/db';
import type { CatalogItem, Settings, StatsMetric } from '../../schema';
import { updateSettings } from '../../db/actions';
import { useTags, useTypes } from '../../db/hooks';
import { newId } from '../../lib/id';
import { addDays, formatHm, startOfDay } from '../../lib/time';
import { daysIn } from '../../lib/range';
import { fromParts, getHour12, zparts } from '../../lib/zone';
import {
  bedMinuteOfDay, change, countedDays, dailyUnion, dailyUntracked, hourHeat, periodValue, pomoStats, previousValue, sessionStats,
  sleepStats, streaks, trendSeries, unionTotal, weekdayAverages, type MeanSd,
} from '../../lib/insights';
import { clockText, hourLabel, weekdayShort } from '../../i18n/dates';
import { isPomodoroComment, POMODORO_BREAK_COMMENT } from '../../pomodoro/store';
import { ChangeBadge, avgLabel, cmpLabel, valueText, type StatsCtx } from './StatRows';
import { Sparkline } from './charts';
import { useAutosave } from '../../ui/useAutosave';
import { tr } from '../../i18n';

/** 一天中的第 m 分钟 → 按 12/24 小时制显示的时刻 */
const minuteText = (m: number) => clockText(fromParts(2000, 1, 1, 0, Math.round(m)));

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="stats-section">
      <header className="stats-section-head">
        <h2>{title}</h2>
        {aside}
      </header>
      {children}
    </section>
  );
}

// ---------- 作息 ----------

/** 早晚变化：时刻差用“早 / 晚”表示，不分好坏 */
function ShiftBadge({ cur, prev }: { cur: MeanSd | null; prev: MeanSd | null }) {
  if (!cur || !prev) return <span className="chg is-none">—</span>;
  const d = cur.mean - prev.mean;
  if (Math.abs(d) < 5) return <span className="chg is-neutral">→ {tr("持平")}</span>;
  return <span className="chg is-neutral">{d < 0 ? tr("早 {0}", formatHm(-d * 60_000)) : tr("晚 {0}", formatHm(d * 60_000))}</span>;
}

export function SleepPanel({ ctx, settings, types }: { ctx: StatsCtx; settings: Settings; types: CatalogItem[] }) {
  const configured = settings.stats?.sleepTypeId;
  const sleepTypeId = configured === undefined ? (types.some((t) => t.id === 'default-sleep') ? 'default-sleep' : null) : configured;
  const { records, range, prevWin, now } = ctx;
  const data = useMemo(() => {
    if (!sleepTypeId) return null;
    const mine = records.filter((r) => r.typeId === sleepTypeId);
    return { cur: sleepStats(mine, range.from, range.to, now), prev: sleepStats(mine, prevWin.from, prevWin.to, now) };
  }, [records, sleepTypeId, range.from, range.to, prevWin.from, prevWin.to, now]);

  const pick = (
    <select
      className="inline-select"
      value={sleepTypeId ?? ''}
      aria-label={tr("作息用哪个活动")}
      onChange={(e) => void updateSettings({ stats: { ...settings.stats, sleepTypeId: e.target.value || null } })}
    >
      <option value="">{tr("不统计")}</option>
      {types.map((t) => (
        <option key={t.id} value={t.id}>
          {t.emoji} {t.name}
        </option>
      ))}
    </select>
  );

  return (
    <Section title={tr("作息")} aside={pick}>
      {!data ? (
        <p className="hint">{tr("选一个代表睡眠的活动，就能看到平均入睡、起床时间和它们有多规律。")}</p>
      ) : data.cur.nights === 0 ? (
        <p className="hint">{tr("这段时间没有完整的睡眠记录（3 小时以上、已结束）。")}</p>
      ) : (
        <>
          <dl className="detail-grid is-wide">
            <div>
              <dt>{tr("平均入睡")}</dt>
              <dd>
                {minuteText(bedMinuteOfDay(data.cur.bed!.mean))}
                <small>{tr("波动 ±{0}", formatHm(data.cur.bed!.sd * 60_000))}</small>
                <ShiftBadge cur={data.cur.bed} prev={data.prev.bed} />
              </dd>
            </div>
            <div>
              <dt>{tr("平均起床")}</dt>
              <dd>
                {minuteText(data.cur.wake!.mean)}
                <small>{tr("波动 ±{0}", formatHm(data.cur.wake!.sd * 60_000))}</small>
                <ShiftBadge cur={data.cur.wake} prev={data.prev.wake} />
              </dd>
            </div>
            <div>
              <dt>{tr("平均时长")}</dt>
              <dd>
                {formatHm(data.cur.avgMs)}
                <small>{tr("{0} 晚", data.cur.nights)}{data.cur.naps ? tr(" · 小睡 {0} 次", data.cur.naps) : ''}</small>
                <ChangeBadge cmp={data.prev.nights ? change(data.cur.avgMs, data.prev.avgMs) : null} goodWhenUp={null} prevText={data.prev.nights ? formatHm(data.prev.avgMs) : null} />
              </dd>
            </div>
          </dl>
          <p className="hint">{tr("一条睡眠记录算一晚（中途醒来暂停也算同一晚），按起床时间归到哪一天；不到 3 小时的算小睡。波动越小作息越规律。比较对象：{0}。", cmpLabel(ctx.mode))}</p>
        </>
      )}
    </Section>
  );
}

// ---------- 自定义指标 ----------

export function MetricsPanel({ ctx, settings, typeMap, tagMap }: { ctx: StatsCtx; settings: Settings; typeMap: Map<string, CatalogItem>; tagMap: Map<string, CatalogItem> }) {
  const metrics = settings.stats?.metrics ?? [];
  const [editing, setEditing] = useState<string | null>(null);
  const save = (next: StatsMetric[]) => updateSettings({ stats: { ...settings.stats, metrics: next } });
  const add = async () => {
    const m = { id: newId(), name: tr("新指标"), typeIds: [], tagIds: [] };
    await save([...metrics, m]);
    setEditing(m.id);
  };
  return (
    <Section
      title={tr("自定义指标")}
      aside={
        <button type="button" className="btn is-small" onClick={() => void add()}>
          {tr("＋ 新建指标")}
        </button>
      }
    >
      {metrics.length === 0 && (
        <p className="hint">{tr("把几个活动或标签合成一项来看，例如“学习质量” = 学习 + 阅读 + 标签 TCF。时长越长代表这天拿出越多时间投入。")}</p>
      )}
      <ul className="metric-list">
        {metrics.map((m) => (
          <MetricCard
            key={m.id}
            metric={m}
            ctx={ctx}
            typeMap={typeMap}
            tagMap={tagMap}
            editing={editing === m.id}
            onEdit={() => setEditing(editing === m.id ? null : m.id)}
            onSave={(patch) => save(metrics.map((x) => (x.id === m.id ? { ...x, ...patch } : x)))}
            onDelete={() => {
              setEditing(null);
              void save(metrics.filter((x) => x.id !== m.id));
            }}
          />
        ))}
      </ul>
    </Section>
  );
}

function MetricCard({
  metric,
  ctx,
  typeMap,
  tagMap,
  editing,
  onEdit,
  onSave,
  onDelete,
}: {
  metric: StatsMetric;
  ctx: StatsCtx;
  typeMap: Map<string, CatalogItem>;
  tagMap: Map<string, CatalogItem>;
  editing: boolean;
  onEdit: () => void;
  onSave: (patch: Partial<StatsMetric>) => Promise<void> | void;
  onDelete: () => void;
}) {
  const { mode, range, prevWin, trend, records, now, firstMs } = ctx;
  const data = useMemo(() => {
    const mine = records.filter((r) => metric.typeIds.includes(r.typeId) || r.tagIds.some((t) => metric.tagIds.includes(t)));
    const total = unionTotal(mine, range.from, range.to, now);
    const days = countedDays(range, now, firstMs);
    const cur = periodValue(total, mode, days);
    const prev = previousValue(unionTotal(mine, prevWin.from, prevWin.to, now), mode, countedDays(prevWin, now, firstMs));
    const series = trendSeries(trend, mode, now, firstMs, (f, t) => unionTotal(mine, f, t, now));
    const ss = sessionStats(mine, range.from, range.to, now);
    const today = startOfDay(now);
    const from = Math.max(addDays(today, -364), firstMs == null ? today : startOfDay(firstMs));
    const st = streaks(dailyUnion(mine, from, addDays(today, 1), now), daysIn(from, addDays(today, 1)));
    return { total, cur, prev, series, ss, st };
  }, [metric, records, range, prevWin, trend, mode, now, firstMs]);
  const color = typeMap.get(metric.typeIds[0])?.color ?? tagMap.get(metric.tagIds[0])?.color ?? 'var(--accent)';
  const parts = [...metric.typeIds.map((id) => typeMap.get(id)), ...metric.tagIds.map((id) => tagMap.get(id))].filter(Boolean) as CatalogItem[];

  return (
    <li className="metric-card" style={{ '--c': color } as CSSProperties}>
      <div className="metric-head">
        <strong>{metric.name || tr("未命名")}</strong>
        <span className="metric-parts">{parts.map((p) => `${p.emoji}${p.name}`).join(' + ') || tr("还没选活动或标签")}</span>
        <button type="button" className="btn is-small is-quiet" aria-expanded={editing} onClick={onEdit}>
          {editing ? tr("收起") : tr("编辑")}
        </button>
      </div>
      <div className="metric-nums">
        <span className="metric-total">{formatHm(data.total)}</span>
        {mode !== 'day' && (
          <span className="metric-avg">
            {avgLabel(mode)} {data.cur == null ? '—' : formatHm(data.cur)}
          </span>
        )}
        <ChangeBadge cmp={change(data.cur, data.prev)} goodWhenUp={null} prevText={data.prev == null ? null : valueText(mode, data.prev)} />
        <Sparkline values={data.series} color={color} label={tr("{0} 的趋势", metric.name)} />
      </div>
      <p className="metric-extra">
        {tr("{0} 段 · 平均 {1} · 最长 {2}", data.ss.count, formatHm(data.ss.avgMs), formatHm(data.ss.longestMs))}
        {' · '}
        {tr("连续 {0} 天（近一年最长 {1} 天）", data.st.current, data.st.longest)}
      </p>
      {editing && <MetricEditor metric={metric} onSave={onSave} onDelete={onDelete} />}
    </li>
  );
}

function MetricEditor({ metric, onSave, onDelete }: { metric: StatsMetric; onSave: (patch: Partial<StatsMetric>) => Promise<void> | void; onDelete: () => void }) {
  const types = useTypes();
  const tags = useTags();
  const [name, setName] = useState(metric.name);
  const flush = useAutosave(name, metric.name, (v) => void onSave({ name: v }), 400);
  const [confirm, setConfirm] = useState(false);
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  return (
    <div className="metric-editor">
      <label className="field">
        <span className="field-label">{tr("名称")}</span>
        <input value={name} onChange={(e) => setName(e.target.value)} onBlur={flush} placeholder={tr("例如：学习质量")} />
      </label>
      <div className="field">
        <span className="field-label">{tr("计入哪些活动")}</span>
        <div className="chips">
          {types?.map((t) => (
            <button key={t.id} type="button" className={`chip${metric.typeIds.includes(t.id) ? ' is-on' : ''}`} style={{ '--c': t.color } as CSSProperties} aria-pressed={metric.typeIds.includes(t.id)} onClick={() => void onSave({ typeIds: toggle(metric.typeIds, t.id) })}>
              {t.emoji} {t.name}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span className="field-label">{tr("或带有这些标签的记录")}</span>
        <div className="chips">
          {tags?.length ? (
            tags.map((t) => (
              <button key={t.id} type="button" className={`chip${metric.tagIds.includes(t.id) ? ' is-on' : ''}`} style={{ '--c': t.color } as CSSProperties} aria-pressed={metric.tagIds.includes(t.id)} onClick={() => void onSave({ tagIds: toggle(metric.tagIds, t.id) })}>
                {t.emoji} {t.name}
              </button>
            ))
          ) : (
            <span className="hint">{tr("还没有标签")}</span>
          )}
        </div>
        <p className="hint">{tr("记录只要满足任一条件就计入；同时进行的几条只算一次。改动即时保存。")}</p>
      </div>
      <div className="inline-foot">
        <span className="spacer" />
        {confirm ? (
          <button type="button" className="btn is-small is-danger" onClick={onDelete}>{tr("确认删除")}</button>
        ) : (
          <button type="button" className="btn is-small is-ghost-danger" onClick={() => setConfirm(true)}>{tr("删除")}</button>
        )}
      </div>
    </div>
  );
}

// ---------- 规律 ----------

const UNTRACKED = '__untracked';

export function PatternsPanel({ ctx, typeMap, topTypes }: { ctx: StatsCtx; typeMap: Map<string, CatalogItem>; topTypes: string[] }) {
  const { records, trend, range, now, firstMs, weekStart } = ctx;
  const [heatKey, setHeatKey] = useState<string>(UNTRACKED);
  // 按趋势窗口统计（周视图最近 8 周……），只算开始用之后、截止到今天的日子
  const days = useMemo(() => {
    const today = addDays(startOfDay(now), 1);
    const start = Math.max(trend[0].from, firstMs == null ? range.to : startOfDay(firstMs));
    return daysIn(start, Math.min(range.to, today));
  }, [trend, range.to, now, firstMs]);
  const rows = useMemo(() => {
    if (!days.length) return [];
    const from = days[0];
    const to = addDays(days[days.length - 1], 1);
    const out = topTypes.slice(0, 6).map((id) => {
      const t = typeMap.get(id);
      const daily = dailyUnion(records.filter((r) => r.typeId === id), from, to, now);
      return { key: id, label: t ? `${t.emoji} ${t.name}` : tr("未知活动"), color: t?.color ?? '#999', avg: weekdayAverages(daily, days) };
    });
    out.push({ key: UNTRACKED, label: tr("未记录"), color: 'var(--muted)', avg: weekdayAverages(dailyUntracked(records, days, now, firstMs), days) });
    return out;
  }, [days, topTypes, typeMap, records, now, firstMs]);
  const heat = useMemo(
    () =>
      days.length
        ? heatKey === UNTRACKED
          ? hourHeat(records, days, now, 'untracked', firstMs)
          : hourHeat(records.filter((r) => r.typeId === heatKey), days, now, 'records', firstMs)
        : null,
    [days, heatKey, records, now, firstMs],
  );
  if (!days.length) return null;
  // 星期按设置里的“每周从哪天开始”排；星期名取窗口里该星期几的某一天来本地化
  const order = Array.from({ length: 7 }, (_, i) => (weekStart + i) % 7);
  const sample = new Map<number, number>();
  for (const d of days) sample.set(zparts(d).wd, d);
  const heatColor = heatKey === UNTRACKED ? 'var(--danger)' : typeMap.get(heatKey)?.color ?? 'var(--accent)';

  return (
    <Section title={tr("规律")} aside={<span className="hint">{tr("统计最近 {0} 天", days.length)}</span>}>
      <h3 className="stats-sub">{tr("星期几平均")}</h3>
      <div className="wd-table" role="table">
        <div className="wd-row is-head" role="row">
          <span role="columnheader" />
          {order.map((wd) => (
            <span key={wd} role="columnheader">{sample.has(wd) ? weekdayShort(sample.get(wd)!) : ''}</span>
          ))}
        </div>
        {rows.map((r) => {
          const max = Math.max(...r.avg, 1);
          return (
            <div key={r.key} className="wd-row" role="row" style={{ '--c': r.color } as CSSProperties}>
              <span className="wd-name" role="rowheader">{r.label}</span>
              {order.map((wd) => (
                <span key={wd} role="cell" className="wd-cell" style={{ '--a': `${Math.round((r.avg[wd] / max) * 70)}%` } as CSSProperties} title={formatHm(r.avg[wd])}>
                  {r.avg[wd] >= 60_000 ? formatHm(r.avg[wd]) : ''}
                </span>
              ))}
            </div>
          );
        })}
      </div>

      <h3 className="stats-sub">
        {tr("时段分布")}
        <select className="inline-select" value={heatKey} onChange={(e) => setHeatKey(e.target.value)} aria-label={tr("看哪一项")}>
          <option value={UNTRACKED}>{tr("未记录")}</option>
          {topTypes.map((id) => (
            <option key={id} value={id}>
              {typeMap.get(id)?.emoji} {typeMap.get(id)?.name ?? tr("未知活动")}
            </option>
          ))}
        </select>
      </h3>
      {heat && (
        <div className="heat" style={{ '--c': heatColor } as CSSProperties} role="img" aria-label={tr("每个星期几每个小时平均有多少分钟")}>
          <span />
          {Array.from({ length: 24 }, (_, h) => (
            <span key={h} className="heat-h">{h % (getHour12() ? 6 : 3) === 0 ? hourLabel(h) : ''}</span>
          ))}
          {order.map((wd) => (
            <HeatRow key={wd} label={sample.has(wd) ? weekdayShort(sample.get(wd)!) : ''} cells={heat[wd]} />
          ))}
        </div>
      )}
      <p className="hint">{tr("颜色越深，平均在那个小时里占的分钟越多。选“未记录”可以看出空档通常出现在什么时候。")}</p>
    </Section>
  );
}

function HeatRow({ label, cells }: { label: string; cells: number[] }) {
  return (
    <>
      <span className="heat-wd">{label}</span>
      {cells.map((m, h) => (
        <span key={h} className="heat-cell" style={{ '--a': `${Math.round((Math.min(m, 60) / 60) * 85)}%` } as CSSProperties} title={tr("{0} 点：平均 {1} 分钟", h, Math.round(m))} />
      ))}
    </>
  );
}

// ---------- Pomo ----------

export function PomoPanel({ ctx, settings }: { ctx: StatsCtx; settings: Settings }) {
  const { records, range, prevWin, mode, now, firstMs } = ctx;
  const workMin = settings.pomodoro.workMin;
  const data = useMemo(() => {
    const isFocus = (r: { comment?: string }) => isPomodoroComment(r.comment ?? '');
    const isBreak = (r: { comment?: string }) => r.comment === POMODORO_BREAK_COMMENT;
    const cur = pomoStats(records, range.from, range.to, now, workMin, isFocus, isBreak);
    const prev = pomoStats(records, prevWin.from, prevWin.to, now, workMin, isFocus, isBreak);
    return { cur, prev, days: countedDays(range, now, firstMs), prevDays: countedDays(prevWin, now, firstMs) };
  }, [records, range, prevWin, now, firstMs, workMin]);
  if (data.cur.focusMs === 0 && data.prev.focusMs === 0) return null;
  const perDay = (n: number, d: number) => (d > 0 ? n / d : 0);
  const share = data.cur.focusMs + data.cur.breakMs > 0 ? data.cur.focusMs / (data.cur.focusMs + data.cur.breakMs) : null;
  return (
    <Section title="Pomo">
      <dl className="detail-grid is-wide">
        <div>
          <dt>{tr("完成的番茄")}</dt>
          <dd>
            {data.cur.done}
            {mode !== 'day' && <small>{tr("日均 {0}", perDay(data.cur.done, data.days).toFixed(1))}</small>}
            <span className="chg is-neutral">
              {tr("{0}：日均 {1}", cmpLabel(mode), perDay(data.prev.done, data.prevDays).toFixed(1))}
            </span>
          </dd>
        </div>
        <div>
          <dt>{tr("专注")}</dt>
          <dd>{formatHm(data.cur.focusMs)}</dd>
        </div>
        <div>
          <dt>{tr("休息")}</dt>
          <dd>
            {formatHm(data.cur.breakMs)}
            {share != null && data.cur.breakMs > 0 && <small>{tr("专注占 {0}%", Math.round(share * 100))}</small>}
          </dd>
        </div>
      </dl>
      <p className="hint">{tr("专注记录达到设定时长的 90% 才算完成一个番茄。休息只有在 Pomo 设置里选了“休息时记录为”才有数据。")}</p>
    </Section>
  );
}

export type { DbRecord };
