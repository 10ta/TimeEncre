import { useState } from 'react';
import { Modal } from '../../ui/Modal';
import { TagPicker } from '../../ui/fields';
import { useTypeMap } from '../../db/hooks';
import { startRecord } from '../../db/actions';
import { fromLocalInput, toLocalInput } from '../../lib/time';
import { tr } from '../../i18n';
import { DateTimeField } from '../../ui/DateTimeField';

/** 长按 / 右键类型格子：带备注、标签或补记开始时间地开始计时 */
export function RecordDialog(props: { mode: 'start'; typeId: string; onClose: () => void }) {
  return <StartDialog typeId={props.typeId} onClose={props.onClose} />;
}

const QUICK_OFFSETS = [5, 15, 30];

function StartDialog({ typeId, onClose }: { typeId: string; onClose: () => void }) {
  const typeMap = useTypeMap();
  const type = typeMap?.get(typeId);
  const [comment, setComment] = useState('');
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [startInput, setStartInput] = useState(() => toLocalInput(Date.now()));
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const startMs = fromLocalInput(startInput);
    if (Number.isNaN(startMs)) return setError(tr("开始时间无效"));
    if (startMs > Date.now() + 60_000) return setError(tr("开始时间不能晚于现在"));
    await startRecord(typeId, { comment: comment.trim(), tagIds, startMs });
    onClose();
  };

  return (
    <Modal
      title={type ? tr("{0} 开始{1}", type.emoji, type.name) : tr("开始计时")}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>{tr("取消")}</button>
          <button type="button" className="btn is-primary" onClick={submit}>{tr("开始计时")}</button>
        </>
      }
    >
      <label className="field">
        <span className="field-label">{tr("备注")}</span>
        <textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={tr("可选")} />
      </label>
      <TagPicker value={tagIds} onChange={setTagIds} />
      <div className="field">
        <span className="field-label">{tr("开始于")}</span>
        <div className="row">
          <DateTimeField label={tr("开始于")} value={startInput} onChange={setStartInput} />
          {QUICK_OFFSETS.map((m) => (
            <button
              key={m}
              type="button"
              className="btn is-small"
              onClick={() => setStartInput(toLocalInput(Date.now() - m * 60_000))}
            >
              {tr("{0} 分钟前", m)}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
    </Modal>
  );
}
