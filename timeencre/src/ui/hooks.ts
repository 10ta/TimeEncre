import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';

/** 每 intervalMs 刷新一次的当前时间；显示时长永远用时间戳相减，不靠累加 */
export function useNow(intervalMs = 1000, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs, enabled]);
  return now;
}

/** 点击 + 长按（触屏）/ 右键（鼠标）两种操作 */
export function useLongPress(onLong: () => void, onTap: () => void, ms = 500) {
  const timer = useRef<number | undefined>(undefined);
  const fired = useRef(false);
  const clear = () => {
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    timer.current = undefined;
  };
  return {
    onPointerDown: (e: PointerEvent) => {
      if (e.button !== 0) return;
      fired.current = false;
      clear();
      timer.current = window.setTimeout(() => {
        fired.current = true;
        onLong();
      }, ms);
    },
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
    onClick: (e: MouseEvent) => {
      if (fired.current) {
        fired.current = false;
        e.preventDefault();
        return;
      }
      onTap();
    },
    onContextMenu: (e: MouseEvent) => {
      e.preventDefault();
      clear();
      if (!fired.current) {
        fired.current = true;
        onLong();
      }
    },
  };
}
