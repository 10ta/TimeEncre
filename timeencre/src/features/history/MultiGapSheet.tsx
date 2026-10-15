// 一次处理多段未记录时间（历史里“全选未记录”）。和单个空档的面板是同一套操作，只是对勾选的每一段都生效：
//  - “延长上一段 / 提前下一段”：每一段各自用它自己前面 / 后面的那条记录填满；
//  - 点一个活动：每一段各建一条该活动的记录，随后可以给这些记录一起写备注、加标签（即时保存）。
// 点外面或 Esc 收起；做完的操作都可以撤销。
import { useState, type CSSProperties } from 'react';
import { createManualRecord, deleteRecord, fillGap, patchRecord, restoreRecord } from '../../db/actions';
import { useTypes } from '../../db/hooks';
import { FloatingSheet } from '../../ui/FloatingSheet';
import { TagPicker } from '../../ui/fields';
import { useAutosave } from '../../ui/useAutosave';
import { showUndo } from '../../ui/undo';
import { formatHm, type Span } from '../../lib/time';
import { slotText } from '../../i18n/dates';
import type { CatalogItem, TimeRecord } from '../../schema';
import { tr } from '../../i18n';

export function MultiGapSheet({
  gaps,
  now,
  typeMap,
  onClose,
}: {
  gaps: Span[];
  now: number;
  typeMap: Map<string, CatalogItem>;
  onClose: () => void;
}) {
  const types = useTypes();
  const [checked, setChecked] = useState<Set<number>>(() => new Set(gaps.map((_, i) => i)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ ids: string[]; typeId: string } | null>(null);
  const chosen = gaps.filter((_, i) => checked.has(i));
  const total = chosen.reduce((a, g) => a + g.end - g.start, 0);

  const toggle = (i: number) =>
    setChecked((cur) => {
      const next = new Set(cur);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const fill = async (mode: 'prev' | 'next') => {
    if (busy || !chosen.length) return;
    setBusy(true);
    const snaps: TimeRecord[] = [];
    let skipped = 0;
    for (const g of chosen) {
      try {
        snaps.push(await fillGap(g, mode));
      } catch {
        skipped++; // 这一段前面 / 后面没有记录
      }
    }
    setBusy(false);
    if (!snaps.length) return setError(mode === 'prev' ? tr("这些空档前面都没有记录") : tr("这些空档后面都没有记录"));
    onClose();
    const msg = mode === 'prev' ? tr("已用上一段填满 {0} 段", snaps.length) : tr("已用下一段填满 {0} 段", snaps.length);
    showUndo(skipped ? `${msg}${tr("（{0} 段没有相邻记录，已跳过）", skipped)}` : msg, async () => {
      // 倒序恢复：同一条记录被改了两次时，最后留下的是最早的样子
      for (const r of [...snaps].reverse()) await restoreRecord(r);
    });
  };

  const pick = async (typeId: string) => {
    if (busy || !chosen.length) return;
    setBusy(true);
    try {
      const ids: string[] = [];
      for (const g of chosen) ids.push(await createManualRecord({ typeId, comment: '', tagIds: [], intervals: [{ start: g.start, end: g.end }] }));
      setCreated({ ids, typeId });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const head = (
    <>
      <strong>{tr("未记录 {0} 段", chosen.length)}</strong>
      <span className="gap-sheet-range">{tr("共 {0}", formatHm(total))}</span>
    </>
  );

  if (created) {
    const t = typeMap.get(created.typeId);
    return (
      <FloatingSheet head={head} onClose={onClose} color={t?.color}>
        <BatchEdit ids={created.ids} typeName={t ? `${t.emoji} ${t.name}` : tr("未知活动")} onClose={onClose} />
      </FloatingSheet>
    );
  }

  return (
    <FloatingSheet head={head} onClose={onClose}>
      <div className="inline-form">
        <div className="field">
          <span className="field-label">
            {tr("要处理的时间段")}
            <button type="button" className="btn is-small is-quiet mg-all" onClick={() => setChecked(checked.size === gaps.length ? new Set() : new Set(gaps.map((_, i) => i)))}>
              {checked.size === gaps.length ? tr("全不选") : tr("全选")}
            </button>
          </span>
          <ul className="mg-list">
            {gaps.map((g, i) => (
              <li key={g.start}>
                <label>
                  <input type="checkbox" checked={checked.has(i)} onChange={() => toggle(i)} />
                  <span className="mg-time">{slotText(g.start, g.end, now)}</span>
                  <span className="mg-ms">{formatHm(g.end - g.start)}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
        <div className="gap-sheet-actions">
          <span className="gap-actions">
            <button type="button" className="btn is-small" disabled={busy || !chosen.length} onClick={() => void fill('prev')} title={tr("每一段都把它前一段的结束时间延长到空档结束")}>
              {tr("↓ 各自延长上一段")}
            </button>
            <button type="button" className="btn is-small" disabled={busy || !chosen.length} onClick={() => void fill('next')} title={tr("每一段都把它后一段的开始时间提前到空档开始")}>
              {tr("↑ 各自提前下一段")}
            </button>
          </span>
        </div>
        <div className="field">
          <span className="field-label">{tr("记录为哪个活动")}</span>
          <div className="pick-grid" role="group" aria-label={tr("记录为哪个活动")}>
            {types?.map((t) => (
              <button key={t.id} type="button" className="pick" style={{ '--c': t.color } as CSSProperties} disabled={busy || !chosen.length} onClick={() => void pick(t.id)}>
                <span className="pick-emoji" aria-hidden="true">{t.emoji}</span>
                <span className="pick-name">{t.name}</span>
              </button>
            ))}
          </div>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="inline-foot">
          <span className="spacer" />
          <button type="button" className="btn is-small" onClick={onClose}>{tr("收起")}</button>
        </div>
      </div>
    </FloatingSheet>
  );
}

/** 刚补录的几条记录：备注和标签一起改，即时保存 */
function BatchEdit({ ids, typeName, onClose }: { ids: string[]; typeName: string; onClose: () => void }) {
  const [comment, setComment] = useState('');
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [saved, setSaved] = useState({ comment: '', tagIds: [] as string[] });
  const [confirmDelete, setConfirmDelete] = useState(false);
  useAutosave({ comment, tagIds }, saved, (v) => {
    setSaved(v);
    void Promise.all(ids.map((id) => patchRecord(id, { comment: v.comment.trim(), tagIds: v.tagIds })));
  });
  return (
    <div className="inline-form">
      <p className="notice">{tr("已补录 {0} 段为「{1}」。下面的备注和标签会同时用于这 {0} 条记录。", ids.length, typeName)}</p>
      <label className="field">
        <span className="field-label">{tr("备注")}</span>
        <textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={tr("可选")} />
      </label>
      <TagPicker value={tagIds} onChange={setTagIds} />
      <div className="inline-foot">
        <span className="save-state" aria-live="polite">{saved.comment || saved.tagIds.length ? tr("已自动保存") : ''}</span>
        <span className="spacer" />
        {confirmDelete ? (
          <button type="button" className="btn is-small is-danger" onClick={() => void Promise.all(ids.map((id) => deleteRecord(id))).then(onClose)}>
            {tr("确认删除这 {0} 条", ids.length)}
          </button>
        ) : (
          <button type="button" className="btn is-small is-ghost-danger" onClick={() => setConfirmDelete(true)}>{tr("删除")}</button>
        )}
        <button type="button" className="btn is-small" onClick={onClose}>{tr("收起")}</button>
      </div>
    </div>
  );
}
