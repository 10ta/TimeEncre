import { useEffect, useState } from 'react';
import { onRecordDiscarded, restoreRecord } from '../db/actions';
import { useTypeMap } from '../db/hooks';
import type { TimeRecord } from '../schema';
import { tr } from '../i18n';

/** 过短的计时被作废时提示，可一键恢复 */
export function DiscardToast() {
  const typeMap = useTypeMap();
  const [item, setItem] = useState<{ snapshot: TimeRecord; seconds: number } | null>(null);
  useEffect(() => onRecordDiscarded(setItem), []);
  useEffect(() => {
    if (!item) return;
    const t = window.setTimeout(() => setItem(null), 7000);
    return () => window.clearTimeout(t);
  }, [item]);
  if (!item) return null;
  const t = typeMap?.get(item.snapshot.typeId);
  return (
    <div className="toast" role="status">
      <span>
        {tr("{0} 不足 {1} 秒，已作废。", t ? `${t.emoji} ${t.name}` : tr("这条计时"), item.seconds)}
      </span>
      <button
        type="button"
        className="btn is-small"
        onClick={() => {
          void restoreRecord(item.snapshot);
          setItem(null);
        }}
      >
        {tr("恢复")}
      </button>
    </div>
  );
}
