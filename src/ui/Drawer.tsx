import { useEffect, useRef, useState, type ReactNode } from 'react';

/** 在条目下方展开 / 收起的抽屉。收起动画结束后才卸载内容；Esc 收起 */
export function Drawer({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const [render, setRender] = useState(open);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) {
      setRender(true);
      const t = window.setTimeout(() => ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 230);
      return () => window.clearTimeout(t);
    }
    const t = window.setTimeout(() => setRender(false), 220);
    return () => window.clearTimeout(t);
  }, [open]);
  return (
    <div
      ref={ref}
      className={`drawer${open ? ' is-open' : ''}`}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="drawer-inner">{render && <div className="drawer-body">{children}</div>}</div>
    </div>
  );
}
