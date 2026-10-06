import { useEffect, useRef, type RefObject } from 'react';

/**
 * 打开时，点击 ref 以外的地方就关闭。点的是另一个带 aria-expanded 的开关（它自己会切换）、
 * 对话框或提示条时不处理。推迟注册，避免打开它的那次点击立刻把它关掉。
 */
export function useOutsideClose(open: boolean, ref: RefObject<HTMLElement | null>, onClose: () => void) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t || !t.isConnected) return;
      if (ref.current?.contains(t)) return;
      if (t.closest('[aria-expanded], dialog, .toast')) return;
      closeRef.current();
    };
    const id = window.setTimeout(() => document.addEventListener('pointerdown', onDown), 0);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open, ref]);
}
