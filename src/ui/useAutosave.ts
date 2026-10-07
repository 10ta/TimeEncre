import { useEffect, useRef } from 'react';

/**
 * value 与 saved 不同时，停顿 delay 毫秒后调用 save；组件卸载时若还有未保存的改动，立即保存。
 * 用 JSON 比较，适合小对象。
 */
/** 返回一个 flush 函数：立即保存尚在等待中的改动（例如输入框失焦时） */
export function useAutosave<T>(value: T, saved: T, save: (v: T) => void, delay = 500): () => void {
  const latest = useRef({ value, save });
  latest.current = { value, save };
  const pending = useRef(false);
  const key = JSON.stringify(value);
  const savedKey = JSON.stringify(saved);
  useEffect(() => {
    if (key === savedKey) {
      pending.current = false;
      return;
    }
    pending.current = true;
    const t = window.setTimeout(() => {
      pending.current = false;
      latest.current.save(latest.current.value);
    }, delay);
    return () => window.clearTimeout(t);
  }, [key, savedKey, delay]);
  useEffect(() => {
    const flush = () => {
      if (pending.current) {
        pending.current = false;
        latest.current.save(latest.current.value);
      }
    };
    // 页面被隐藏 / 关闭时立即保存，不等延时
    const onHide = () => document.visibilityState === 'hidden' && flush();
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHide);
      flush(); // 卸载时（收起、切换页面）立即保存
    };
  }, []);
  return () => {
    if (pending.current) {
      pending.current = false;
      latest.current.save(latest.current.value);
    }
  };
}

/** “已自动保存”提示 */
export function savedLabel(at: number | null): string | null {
  return at ? '已自动保存' : null;
}
