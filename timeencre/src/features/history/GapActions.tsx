import { useState } from 'react';
import type { DbRecord } from '../../db/db';
import type { CatalogItem } from '../../schema';
import { fillGap } from '../../db/actions';
import { gapNeighbors } from '../../lib/gaps';
import type { Span } from '../../lib/time';
import { tr } from '../../i18n';

/** 空档的快捷处理：用前一段 / 后一段填满 */
export function GapActions({
  gap,
  records,
  typeMap,
  onDone,
}: {
  gap: Span;
  records: DbRecord[];
  typeMap: Map<string, CatalogItem>;
  onDone?: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const n = gapNeighbors(records, gap);
  const name = (id?: string) => {
    const r = records.find((x) => x.id === id);
    const t = r ? typeMap.get(r.typeId) : undefined;
    return t ? `${t.emoji}${t.name}` : tr("未知活动");
  };
  const fill = async (mode: 'prev' | 'next') => {
    try {
      await fillGap(gap, mode);
      setError(null);
      onDone?.();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  if (!n.prev && !n.next) return null;
  return (
    <span className="gap-actions">
      {n.prev && (
        <button type="button" className="btn is-small" onClick={() => void fill('prev')} title={tr("把前一段的结束时间延长到空档结束")}>
          {tr("↓ 延长")} {name(n.prev.recId)}
        </button>
      )}
      {n.next && (
        <button type="button" className="btn is-small" onClick={() => void fill('next')} title={tr("把后一段的开始时间提前到空档开始")}>
          {tr("↑ 提前")} {name(n.next.recId)}
        </button>
      )}
      {error && <span className="gap-error" role="alert">{error}</span>}
    </span>
  );
}
