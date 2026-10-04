// 目标表单。LiveGoalForm：原地编辑，即时保存，可撤销；CreateGoalForm：新建，点“添加”。
import { useState, type CSSProperties } from 'react';
import { useTags, useTypes } from '../../db/hooks';
import { deleteGoal, patchGoal, restoreGoal, saveGoal, type GoalDraft } from '../../db/actions';
import type { Goal } from '../../schema';
import { useAutosave } from '../../ui/useAutosave';
import { DIRECTION_LABEL, PERIOD_LABEL } from './goalView';

type Fields = Omit<GoalDraft, 'id'>;

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
  return (
    <>
      <div className="goal-sentence">
        <select value={value.period} onChange={(e) => onChange({ period: e.target.value as Fields['period'] })} aria-label="周期">
          {Object.entries(PERIOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={value.direction} onChange={(e) => onChange({ direction: e.target.value as Fields['direction'] })} aria-label="方向">
          {Object.entries(DIRECTION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input type="number" min="0" inputMode="numeric" value={hours} onChange={(e) => onHours(e.target.value)} aria-label="小时" />
        <span>小时</span>
        <input type="number" min="0" max="59" step="5" inputMode="numeric" value={minutes} onChange={(e) => onMinutes(e.target.value)} aria-label="分钟" />
        <span>分钟</span>
      </div>
      <div className="field">
        <span className="field-label">计入哪些类型</span>
        <div className="chips">
          {types?.map((t) => (
            <button key={t.id} type="button" className={`chip${value.typeIds.includes(t.id) ? ' is-on' : ''}`} style={{ '--c': t.color } as CSSProperties} aria-pressed={value.typeIds.includes(t.id)} onClick={() => onChange({ typeIds: toggle(value.typeIds, t.id) })}>
              {t.emoji} {t.name}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span className="field-label">或带有这些标签的记录</span>
        <div className="chips">
          {tags?.length ? (
            tags.map((t) => (
              <button key={t.id} type="button" className={`chip${value.tagIds.includes(t.id) ? ' is-on' : ''}`} style={{ '--c': t.color } as CSSProperties} aria-pressed={value.tagIds.includes(t.id)} onClick={() => onChange({ tagIds: toggle(value.tagIds, t.id) })}>
                {t.emoji} {t.name}
              </button>
            ))
          ) : (
            <span className="hint">还没有标签</span>
          )}
        </div>
        <p className="hint">记录只要满足任一条件就计入。</p>
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
  useAutosave(minutesOf(hours, minutes), goal.targetMinutes, (targetMinutes) => void save({ targetMinutes }), 500);
  useAutosave(name.trim(), goal.name, (n) => void save({ name: n }), 600);

  const changed =
    JSON.stringify([goal.name, goal.typeIds, goal.tagIds, goal.period, goal.direction, goal.targetMinutes]) !==
    JSON.stringify([snapshot.name, snapshot.typeIds, snapshot.tagIds, snapshot.period, snapshot.direction, snapshot.targetMinutes]);

  const undo = async () => {
    await restoreGoal(snapshot);
    setHours(String(Math.floor(snapshot.targetMinutes / 60)));
    setMinutes(String(snapshot.targetMinutes % 60));
    setName(snapshot.name);
    setError(null);
    setSaved(false);
  };

  return (
    <div className="inline-form">
      <GoalFields value={goal} onChange={(p) => void save(p)} hours={hours} minutes={minutes} onHours={setHours} onMinutes={setMinutes} />
      <label className="field">
        <span className="field-label">名称（可选）</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="留空则自动生成" />
      </label>
      {error && <p className="form-error" role="alert">{error}（这一处还没有保存）</p>}
      <div className="inline-foot">
        <button type="button" className="btn is-small" disabled={!changed} onClick={() => void undo()}>撤销修改</button>
        <span className="save-state" aria-live="polite">{saved && !error ? '已自动保存' : ''}</span>
        <span className="spacer" />
        {confirmDelete ? (
          <button type="button" className="btn is-small is-danger" onClick={() => deleteGoal(goal.id).then(onClose)}>确认删除</button>
        ) : (
          <button type="button" className="btn is-small is-ghost-danger" onClick={() => setConfirmDelete(true)}>删除</button>
        )}
        <button type="button" className="btn is-small" onClick={onClose}>收起</button>
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
      await saveGoal({ ...value, name: value.name.trim(), targetMinutes: minutesOf(hours, minutes) });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="inline-form">
      <GoalFields value={value} onChange={(p) => setValue((v) => ({ ...v, ...p }))} hours={hours} minutes={minutes} onHours={setHours} onMinutes={setMinutes} />
      <label className="field">
        <span className="field-label">名称（可选）</span>
        <input value={value.name} onChange={(e) => setValue((v) => ({ ...v, name: e.target.value }))} placeholder="留空则自动生成" />
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="inline-foot">
        <span className="spacer" />
        <button type="button" className="btn is-small" onClick={onDone}>取消</button>
        <button type="button" className="btn is-small is-primary" onClick={() => void submit()}>添加</button>
      </div>
    </div>
  );
}
