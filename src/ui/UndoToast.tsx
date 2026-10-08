import { useEffect, useState } from 'react';
import { onUndo } from './undo';
import { tr } from '../i18n';

export function UndoToast() {
  const [item, setItem] = useState<{ id: number; message: string; undo: () => void | Promise<void> } | null>(null);
  useEffect(() => onUndo(setItem), []);
  useEffect(() => {
    if (!item) return;
    const t = window.setTimeout(() => setItem(null), 7000);
    return () => window.clearTimeout(t);
  }, [item]);
  if (!item) return null;
  return (
    <div className="toast" role="status">
      <span>{item.message}</span>
      <button
        type="button"
        className="btn is-small"
        onClick={() => {
          void item.undo();
          setItem(null);
        }}
      >
        {tr("撤销")}
      </button>
    </div>
  );
}
