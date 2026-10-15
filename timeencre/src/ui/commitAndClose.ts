/**
 * 先提交、再关闭：让容器里获得焦点的输入框失去焦点，强制浏览器提交正在编辑的值
 * （Firefox / Safari 的日期时间框会把某一段里刚输入的数字暂存到失焦时才提交；
 * 如果直接卸载，元素不会收到失焦，暂存的输入就丢了），等这次改动被处理完，下一刻再关闭。
 */
export function commitAndClose(container: HTMLElement | null | undefined, close: () => void) {
  const active = document.activeElement;
  if (active instanceof HTMLElement && container?.contains(active)) active.blur();
  window.setTimeout(close, 0);
}
