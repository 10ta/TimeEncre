import { useState, type CSSProperties } from 'react';
import { Modal } from '../../ui/Modal';
import { useTags, useTypes } from '../../db/hooks';
import { deleteGoal, saveGoal, type GoalDraft } from '../../db/actions';
import type { Goal } from '../../schema';

import { DIRECTION_LABEL, PERIOD_LABEL } from './goalView';

export function GoalDialog({ goal, onClose }: { goal: Goal | null; onClose: () => void }) {
  const types = useTypes();
  const tags = useTags();
  const [name, setName] = useState(goal?.name ?? '');
  const [typeIds, setTypeIds] = useState<string[]>(goal?.typeIds ?? []);
  const [tagIds, setTagIds] = useState<string[]>(goal?.tagIds ?? []);
  const [period, setPeriod] = useState<GoalDraft['period']>(goal?.period ?? 'week');
  const [direction, setDirection] = useState<GoalDraft['direction']>(goal?.direction ?? 'atLeast');
  const [hours, setHours] = useState(String(Math.floor((goal?.targetMinutes ?? 600) / 60)));
  const [minutes, setMinutes] = useState(String((goal?.targetMinutes ?? 600) % 60));
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const toggle = (list: string[], set: (v: string[]) => void, id: string) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const submit = async () => {
    const targetMinutes = (Number(hours) || 0) * 60 + (Number(minutes) || 0);
    try {
      await saveGoal({ id: goal?.id, name: name.trim(), typeIds, tagIds, period, direction, targetMinutes });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Modal
      title={goal ? '编辑目标' : '新建目标'}
      onClose={onClose}
      footer={
        <>
          {goal &&
            (confirmDelete ? (
              <button type="button" className="btn is-danger" onClick={() => deleteGoal(goal.id).then(onClose)}>确认删除</button>
            ) : (
              <button type="button" className="btn is-ghost-danger" onClick={() => setConfirmDelete(true)}>删除</button>
            ))}
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>取消</button>
          <button type="button" className="btn is-primary" onClick={() => void submit()}>保存</button>
        </>
      }
    >
      <div className="goal-sentence">
        <select value={period} onChange={(e) => setPeriod(e.target.value as GoalDraft['period'])} aria-label="周期">
          {Object.entries(PERIOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={direction} onChange={(e) => setDirection(e.target.value as GoalDraft['direction'])} aria-label="方向">
          {Object.entries(DIRECTION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input type="number" min="0" inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value)} aria-label="小时" />
        <span>小时</span>
        <input type="number" min="0" max="59" step="5" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} aria-label="分钟" />
        <span>分钟</span>
      </div>

      <div className="field">
        <span className="field-label">计入哪些类型</span>
        <div className="chips">
          {types?.map((t) => (
            <button key={t.id} type="button" className={`chip${typeIds.includes(t.id) ? ' is-on' : ''}`} style={{ '--c': t.color } as CSSProperties} aria-pressed={typeIds.includes(t.id)} onClick={() => toggle(typeIds, setTypeIds, t.id)}>
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
              <button key={t.id} type="button" className={`chip${tagIds.includes(t.id) ? ' is-on' : ''}`} style={{ '--c': t.color } as CSSProperties} aria-pressed={tagIds.includes(t.id)} onClick={() => toggle(tagIds, setTagIds, t.id)}>
                {t.emoji} {t.name}
              </button>
            ))
          ) : (
            <span className="hint">还没有标签</span>
          )}
        </div>
        <p className="hint">记录只要满足任一条件就计入。例如选“学习”和标签“TCF”，通勤路上带 TCF 标签的听力也会算进去。</p>
      </div>
      <label className="field">
        <span className="field-label">名称（可选）</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="留空则自动生成" />
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
    </Modal>
  );
}
