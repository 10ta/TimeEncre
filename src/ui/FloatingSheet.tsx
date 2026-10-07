import { useRef, type CSSProperties, type ReactNode } from 'react';
import { useOutsideClose } from './useOutsideClose';
import { commitAndClose } from './commitAndClose';

/** 浮在页面底部上方的编辑面板（与进行中栏的面板同一种样式）；点外面或 Esc 先提交再关闭 */
export function FloatingSheet({
  color,
  head,
  onClose,
  children,
}: {
  color?: string;
  head: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useOutsideClose(true, ref, onClose);
  return (
    <div className="floating-sheet-wrap">
      <div
        ref={ref}
        className="dock-sheet"
        style={{ '--c': color ?? 'var(--line)' } as CSSProperties}
        onKeyDown={(e) => e.key === 'Escape' && commitAndClose(ref.current, onClose)}
      >
        <header className="dock-sheet-head">{head}</header>
        {children}
      </div>
    </div>
  );
}
