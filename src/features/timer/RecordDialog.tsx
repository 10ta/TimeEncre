import { useState } from 'react';
import { Modal } from '../../ui/Modal';
import { TagPicker } from '../../ui/fields';
import { useRecord, useTypeMap } from '../../db/hooks';
import { startRecord } from '../../db/actions';
import { fromDb } from '../../db/db';
import { fromLocalInput, toLocalInput } from '../../lib/time';
import { RecordEditor } from '../records/RecordEditor';

type Props =
  | { mode: 'start'; typeId: string; onClose: () => void }
  | { mode: 'edit'; recordId: string; onClose: () => void };

export function RecordDialog(props: Props) {
  return props.mode === 'start' ? (
    <StartDialog typeId={props.typeId} onClose={props.onClose} />
  ) : (
    <EditDialog recordId={props.recordId} onClose={props.onClose} />
  );
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
    if (Number.isNaN(startMs)) return setError('开始时间无效');
    if (startMs > Date.now() + 60_000) return setError('开始时间不能晚于现在');
    await startRecord(typeId, { comment: comment.trim(), tagIds, startMs });
    onClose();
  };

  return (
    <Modal
      title={type ? `${type.emoji} 开始${type.name}` : '开始计时'}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>取消</button>
          <button type="button" className="btn is-primary" onClick={submit}>开始计时</button>
        </>
      }
    >
      <label className="field">
        <span className="field-label">备注</span>
        <textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="可选" />
      </label>
      <TagPicker value={tagIds} onChange={setTagIds} />
      <div className="field">
        <span className="field-label">开始于</span>
        <div className="row">
          <input type="datetime-local" value={startInput} onChange={(e) => setStartInput(e.target.value)} />
          {QUICK_OFFSETS.map((m) => (
            <button
              key={m}
              type="button"
              className="btn is-small"
              onClick={() => setStartInput(toLocalInput(Date.now() - m * 60_000))}
            >
              {m} 分钟前
            </button>
          ))}
        </div>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
    </Modal>
  );
}

function EditDialog({ recordId, onClose }: { recordId: string; onClose: () => void }) {
  const row = useRecord(recordId);
  if (!row || row.deleted) return null;
  return <RecordEditor key={row.id} mode="edit" rec={fromDb(row)} onClose={onClose} />;
}
