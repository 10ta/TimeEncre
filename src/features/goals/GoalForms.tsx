// 目标表单。LiveGoalForm：原地编辑，即时保存，可撤销；CreateGoalForm：新建，点“添加”。
import { useRef, useState, type CSSProperties } from 'react';
import { useTags, useTypes } from '../../db/hooks';
import { deleteGoal, patchGoal, restoreGoal, saveGoal, type GoalDraft } from '../../db/actions';
import type { Goal } from '../../schema';
import { useAutosave } from '../../ui/useAutosave';
import { commitAndClose } from '../../ui/commitAndClose';
import { DIRECTION_LABEL, EDGE_LABEL, KIND_LABEL, PERIOD_LABEL } from './goalView';
import { goalKind, type GoalKind } from '../../lib/goals';
import { ClockField } from '../../ui/ClockField';
import { tr } from '../../i18n';

type Fields = Omit<GoalDraft, 'id'>;

/** 换目标类型时补上那一类需要的字段（不合法的组合在保存时也会被纠正） */
function kindDefaults(v: Fields, kind: GoalKind, targetMinutes: number): Partial<Fields> {
  switch (kind) {
    case 'days':
      // 每天的门槛：例如“每周至少 4 天、每天 30 分钟”
      return { kind, period: v.period === 'day' ? 'week' : v.period, minDays: v.minDays ?? 4, direction: 'atLeast', targetMinutes: 30 };
    case 'clock':
      return { kind, clockEdge: v.clockEdge ?? 'start', clockMin: v.clockMin ?? 23 * 60 + 30 };
    case 'window':
      // 例如“22:00–02:00 至多 15 分钟”
      return { kind, period: 'day', windowFrom: v.windowFrom ?? 22 * 60, windowTo: v.windowTo ?? 2 * 60, direction: 'atMost', targetMinutes: 15 };
    default:
      return { kind, targetMinutes: targetMinutes > 1 ? targetMinutes : 60 };
  }
}

function GoalFields({
  value,
  onChange,
  hours,
  minutes,
  onHours,
  onMinutes,
}: {
  value: Fields;
  onChange: (patch: Partial<Fields>) => void;
  hours: string;
  minutes: string;
  onHours: (v: string) => void;
  onMinutes: (v: string) => void;
}) {
  const types = useTypes();
  const tags = useTags();
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const kind = goalKind(value);
  const duration = (
    <>
      <input type="number" min="0" inputMode="numeric" value={hours} onChange={(e) => onHours(e.target.value)} aria-label={tr("小时")} />
      <span>{tr("小时")}</span>
      <input type="number" min="0" max="59" step="5" inputMode="numeric" value={minutes} onChange={(e) => onMinutes(e.target.value)} aria-label={tr("分钟")} />
      <span>{tr("分钟")}</span>
    </>
  );
  const periods = Object.entries(PERIOD_LABEL).filter(([k]) => kind !== 'days' || k !== 'day');
  const periodSelect = (
    <select value={value.period} onChange={(e) => onChange({ period: e.target.value as Fields['period'] })} aria-label={tr("周期")}>
      {periods.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
    </select>
  );
  const directionSelect = (
    <select value={value.direction} onChange={(e) => onChange({ direction: e.target.value as Fields['direction'] })} aria-label={tr("方向")}>
      {Object.entries(DIRECTION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
    </select>
  );
  return (
    <>
      <div className="tabs is-small goal-kinds" role="tablist" aria-label={tr("目标类型")}>
        {(Object.keys(KIND_LABEL) as GoalKind[]).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={kind === k}
            className={kind === k ? 'is-on' : undefined}
            onClick={() => kind !== k && onChange(kindDefaults(value, k, (Number(hours) || 0) * 60 + (Number(minutes) || 0)))}
          >
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>
      <div className="goal-sentence">
        {kind === 'duration' && (
          <>
            {periodSelect}
            {directionSelect}
            {duration}
          </>
        )}
        {kind === 'days' && (
          <>
            {periodSelect}
            <span>{tr("至少")}</span>
            <input type="number" min="1" max={value.period === 'week' ? 7 : 31} inputMode="numeric" value={value.minDays ?? ''} onChange={(e) => onChange({ minDays: Math.round(Number(e.target.value)) || undefined })} aria-label={tr("天数")} />
            <span>{tr("天，每天至少")}</span>
            {duration}
          </>
        )}
        {kind === 'clock' && (
          <>
            <select value={value.clockEdge ?? 'start'} onChange={(e) => onChange({ clockEdge: e.target.value as 'start' | 'end' })} aria-label={tr("看开始还是结束")}>
              {Object.entries(EDGE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <ClockField value={value.clockMin ?? 0} onChange={(m) => onChange({ clockMin: m })} label={tr("时刻")} />
          </>
        )}
        {kind === 'window' && (
          <>
            {periodSelect}
            <ClockField value={value.windowFrom ?? 0} onChange={(m) => onChange({ windowFrom: m })} label={tr("时段开始")} />
            <span>–</span>
            <ClockField value={value.windowTo ?? 0} onChange={(m) => onChange({ windowTo: m })} label={tr("时段结束")} />
            {directionSelect}
            {duration}
          </>
        )}
      </div>
      {kind === 'clock' && (
        <p className="hint goal-kind-hint">
          {tr("每天只看最长的那一段：“开始”看入睡（凌晨 0:30 才睡也算前一晚），“结束”看起床。小睡比主睡眠短，不受影响。")}
        </p>
      )}
      {kind === 'window' && <p className="hint goal-kind-hint">{tr("只算每天这个时段里的时间；结束早于开始表示跨午夜。")}</p>}
      <div className="field">
        <span className="field-label">{tr("计入哪些活动")}</span>
        <div className="chips">
          {types?.map((t) => (
            <button key={t.id} type="button" className={`chip${value.typeIds.includes(t.id) ? ' is-on' : ''}`} style={{ '--c': t.color } as CSSProperties} aria-pressed={value.typeIds.includes(t.id)} onClick={() => onChange({ typeIds: toggle(value.typeIds, t.id) })}>
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
              <button key={t.id} type="button" className={`chip${value.tagIds.includes(t.id) ? ' is-on' : ''}`} style={{ '--c': t.color } as CSSProperties} aria-pressed={value.tagIds.includes(t.id)} onClick={() => onChange({ tagIds: toggle(value.tagIds, t.id) })}>
                {t.emoji} {t.name}
              </button>
            ))
          ) : (
            <span className="hint">{tr("还没有标签")}</span>
          )}
        </div>
        <p className="hint">{tr("记录只要满足任一条件就计入。")}</p>
      </div>
    </>
  );
}

const minutesOf = (h: string, m: string) => (Number(h) || 0) * 60 + (Number(m) || 0);

export function LiveGoalForm({ goal, onClose }: { goal: Goal; onClose: () => void }) {
  const [snapshot] = useState(goal);
  const [hours, setHours] = useState(String(Math.floor(goal.targetMinutes / 60)));
  const [minutes, setMinutes] = useState(String(goal.targetMinutes % 60));
  const [name, setName] = useState(goal.name);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const save = async (patch: Partial<Fields>) => {
    try {
      await patchGoal(goal.id, patch);
      setError(null);
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  // 按时作息不用时长：不自动保存时长，免得和保存时固定的值来回改
  const isClock = goalKind(goal) === 'clock';
  const flushTarget = useAutosave(isClock ? goal.targetMinutes : minutesOf(hours, minutes), goal.targetMinutes, (targetMinutes) => void save({ targetMinutes }), 500);
  const flushName = useAutosave(name.trim(), goal.name, (n) => void save({ name: n }), 600);
  const formRef = useRef<HTMLDivElement>(null);

  const fp = (g: Goal) => JSON.stringify([g.name, g.typeIds, g.tagIds, g.period, g.direction, g.targetMinutes, g.kind ?? 'duration', g.minDays, g.clockEdge, g.clockMin, g.windowFrom, g.windowTo]);
  const changed = fp(goal) !== fp(snapshot);

  const undo = async () => {
    await restoreGoal(snapshot);
    setHours(String(Math.floor(snapshot.targetMinutes / 60)));
    setMinutes(String(snapshot.targetMinutes % 60));
    setName(snapshot.name);
    setError(null);
    setSaved(false);
  };

  return (
    <div
      ref={formRef}
      className="inline-form"
      onBlurCapture={() => {
        flushTarget();
        flushName();
      }}
    >
      <GoalFields
        value={goal}
        onChange={(p) => {
          if (p.targetMinutes != null && p.targetMinutes > 1) {
            setHours(String(Math.floor(p.targetMinutes / 60)));
            setMinutes(String(p.targetMinutes % 60));
          }
          void save(p);
        }}
        hours={hours}
        minutes={minutes}
        onHours={setHours}
        onMinutes={setMinutes}
      />
      <label className="field">
        <span className="field-label">{tr("名称（可选）")}</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={tr("留空则自动生成")} />
      </label>
      {error && <p className="form-error" role="alert">{error}{tr("（这一处还没有保存）")}</p>}
      <div className="inline-foot">
        <button type="button" className="btn is-small" disabled={!changed} onClick={() => void undo()}>{tr("撤销修改")}</button>
        <span className="save-state" aria-live="polite">{saved && !error ? tr("已自动保存") : ''}</span>
        <span className="spacer" />
        {confirmDelete ? (
          <button type="button" className="btn is-small is-danger" onClick={() => deleteGoal(goal.id).then(onClose)}>{tr("确认删除")}</button>
        ) : (
          <button type="button" className="btn is-small is-ghost-danger" onClick={() => setConfirmDelete(true)}>{tr("删除")}</button>
        )}
        <button type="button" className="btn is-small" onClick={() => commitAndClose(formRef.current, onClose)}>{tr("收起")}</button>
      </div>
    </div>
  );
}

export function CreateGoalForm({ onDone }: { onDone: () => void }) {
  const [value, setValue] = useState<Fields>({ name: '', typeIds: [], tagIds: [], period: 'week', direction: 'atLeast', targetMinutes: 600 });
  const [hours, setHours] = useState('10');
  const [minutes, setMinutes] = useState('0');
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    try {
      await saveGoal({ ...value, name: value.name.trim(), targetMinutes: goalKind(value) === 'clock' ? 1 : minutesOf(hours, minutes) });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="inline-form">
      <GoalFields
        value={value}
        onChange={(p) => {
          if (p.targetMinutes != null && p.targetMinutes > 1) {
            setHours(String(Math.floor(p.targetMinutes / 60)));
            setMinutes(String(p.targetMinutes % 60));
          }
          setValue((v) => ({ ...v, ...p }));
        }}
        hours={hours}
        minutes={minutes}
        onHours={setHours}
        onMinutes={setMinutes}
      />
      <label className="field">
        <span className="field-label">{tr("名称（可选）")}</span>
        <input value={value.name} onChange={(e) => setValue((v) => ({ ...v, name: e.target.value }))} placeholder={tr("留空则自动生成")} />
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="inline-foot">
        <span className="spacer" />
        <button type="button" className="btn is-small" onClick={onDone}>{tr("取消")}</button>
        <button type="button" className="btn is-small is-primary" onClick={() => void submit()}>{tr("添加")}</button>
      </div>
    </div>
  );
}
