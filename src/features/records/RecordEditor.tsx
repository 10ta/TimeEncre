// 记录的完整编辑器：类型、逐段起止时间、备注、标签。编辑已有记录和补录共用。
import { useMemo, useState } from 'react';
import { Modal } from '../../ui/Modal';
import { TagPicker } from '../../ui/fields';
import { IconButton } from '../../ui/Icon';
import { useTypeMap, useTypes } from '../../db/hooks';
import {
  createManualRecord,
  deleteRecord,
  findOverlaps,
  saveRecord,
  stopRecord,
  validateIntervals,
  type IntervalMs,
} from '../../db/actions';
import type { TimeRecord } from '../../schema';
import { formatHm, fromIso, fromLocalInput, toLocalInput } from '../../lib/time';

interface Row {
  key: number;
  start: string;
  /** null = 进行中（不可编辑） */
  end: string | null;
  /** 原值：输入框没动过就用原始 ISO，避免分钟精度的输入框吃掉秒 */
  orig?: { startInput: string; endInput: string | null; start: number; end: number | null };
}

let rowKey = 0;
const rowFrom = (start: number, end: number | null): Row => {
  const startInput = toLocalInput(start);
  const endInput = end === null ? null : toLocalInput(end);
  return { key: ++rowKey, start: startInput, end: endInput, orig: { startInput, endInput, start, end } };
};

function rowsToIntervals(rows: Row[]): IntervalMs[] {
  return rows.map((r) => ({
    start: r.orig && r.start === r.orig.startInput ? r.orig.start : fromLocalInput(r.start),
    end: r.end === null ? null : r.orig && r.end === r.orig.endInput && r.orig.end !== null ? r.orig.end : fromLocalInput(r.end),
  }));
}

type Props =
  | { mode: 'edit'; rec: TimeRecord; onClose: () => void }
  | { mode: 'add'; initial?: { start: number; end: number; typeId?: string }; onClose: () => void };

export function RecordEditor(props: Props) {
  const types = useTypes(true);
  const typeMap = useTypeMap();
  const rec = props.mode === 'edit' ? props.rec : null;
  const running = rec?.state === 'running';

  const [typeId, setTypeId] = useState(rec?.typeId ?? (props.mode === 'add' ? props.initial?.typeId ?? '' : ''));
  const [comment, setComment] = useState(rec?.comment ?? '');
  const [tagIds, setTagIds] = useState<string[]>(rec?.tagIds ?? []);
  const [rows, setRows] = useState<Row[]>(() => {
    if (rec) return rec.intervals.map((iv) => rowFrom(fromIso(iv.start), iv.end ? fromIso(iv.end) : null));
    const now = Date.now();
    const init = props.mode === 'add' ? props.initial : undefined;
    const end = init?.end ?? Math.floor(now / 60_000) * 60_000;
    const start = init?.start ?? end - 30 * 60_000;
    return [{ key: ++rowKey, start: toLocalInput(start), end: toLocalInput(end) }];
  });
  const [error, setError] = useState<string | null>(null);
  const [overlapWarn, setOverlapWarn] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const intervals = useMemo(() => rowsToIntervals(rows), [rows]);
  const totalMs = intervals.reduce((a, iv) => a + Math.max(0, (iv.end ?? Date.now()) - iv.start), 0);
  const effectiveType = typeId || types?.find((t) => !t.archived)?.id || '';

  const setRow = (key: number, patch: Partial<Row>) => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setOverlapWarn(null);
    setError(null);
  };

  const addRow = () => {
    const last = intervals[intervals.length - 1];
    const start = last.end ?? Date.now();
    const end = Math.min(start + 15 * 60_000, Date.now());
    setRows((rs) => [...rs, { key: ++rowKey, start: toLocalInput(start), end: toLocalInput(Math.max(end, start + 60_000)) }]);
  };

  const submit = async () => {
    if (!effectiveType) return setError('请先选择类型');
    const err = validateIntervals(intervals);
    if (err) return setError(err);
    if (!overlapWarn) {
      const overlaps = await findOverlaps(intervals, rec?.id);
      if (overlaps.length) {
        const names = [...new Set(overlaps.map((r) => typeMap?.get(r.typeId)?.name ?? '未知类型'))];
        setOverlapWarn(`和「${names.slice(0, 3).join('、')}」${names.length > 3 ? '等' : ''}的时间有重叠。`);
        return;
      }
    }
    try {
      const draft = { typeId: effectiveType, comment: comment.trim(), tagIds, intervals };
      if (rec) await saveRecord(rec.id, draft);
      else await createManualRecord(draft);
      props.onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Modal
      title={rec ? '编辑记录' : '补录'}
      onClose={props.onClose}
      footer={
        <>
          {rec &&
            (confirmDelete ? (
              <button type="button" className="btn is-danger" onClick={() => deleteRecord(rec.id).then(props.onClose)}>
                确认删除
              </button>
            ) : (
              <button type="button" className="btn is-ghost-danger" onClick={() => setConfirmDelete(true)}>
                删除
              </button>
            ))}
          <span className="spacer" />
          {rec && rec.state !== 'stopped' && (
            <button type="button" className="btn" onClick={() => stopRecord(rec.id).then(props.onClose)}>停止</button>
          )}
          <button type="button" className="btn is-primary" onClick={() => void submit()}>
            {overlapWarn ? '仍然保存' : '保存'}
          </button>
        </>
      }
    >
      <label className="field">
        <span className="field-label">类型</span>
        <select value={effectiveType} onChange={(e) => setTypeId(e.target.value)}>
          {types
            ?.filter((t) => !t.archived || t.id === effectiveType)
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.emoji} {t.name}
                {t.archived ? '（已归档）' : ''}
              </option>
            ))}
        </select>
      </label>

      <div className="field">
        <span className="field-label">
          时间段<span className="field-aside">共 {formatHm(totalMs)}</span>
        </span>
        <ol className="iv-list">
          {rows.map((r, i) => (
            <li key={r.key}>
              <input
                type="datetime-local"
                aria-label={`第 ${i + 1} 段开始`}
                value={r.start}
                onChange={(e) => setRow(r.key, { start: e.target.value })}
              />
              <span className="iv-sep" aria-hidden="true">–</span>
              {r.end === null ? (
                <span className="iv-open">进行中</span>
              ) : (
                <input
                  type="datetime-local"
                  aria-label={`第 ${i + 1} 段结束`}
                  value={r.end}
                  onChange={(e) => setRow(r.key, { end: e.target.value })}
                />
              )}
              {rows.length > 1 && r.end !== null && (
                <IconButton icon="close" label={`删除第 ${i + 1} 段`} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} />
              )}
            </li>
          ))}
        </ol>
        {!running && (
          <button type="button" className="btn is-small is-quiet iv-add" onClick={addRow}>
            ＋ 添加一段
          </button>
        )}
        {rows.length > 1 && <p className="hint">多段表示中间暂停过；段与段之间的空隙不计入时长。</p>}
      </div>

      <label className="field">
        <span className="field-label">备注</span>
        <textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="可选" />
      </label>
      <TagPicker value={tagIds} onChange={setTagIds} />

      {overlapWarn && (
        <p className="notice is-warn" role="status">
          {overlapWarn}允许同时计时时这是正常的；如果是录错了，请调整时间。
        </p>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
    </Modal>
  );
}
