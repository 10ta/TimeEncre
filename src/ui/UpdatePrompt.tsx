import { useRegisterSW } from 'virtual:pwa-register/react';
import { tr } from '../i18n';

/** Service Worker 发现新版本时提示刷新。非 HTTPS（局域网 IP）下浏览器不支持 SW，这里什么也不做 */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      // 长时间开着的页面每小时检查一次更新
      if (reg) setInterval(() => void reg.update(), 60 * 60_000);
    },
  });
  if (!needRefresh && !offlineReady) return null;
  return (
    <div className="toast" role="status">
      {needRefresh ? (
        <>
          <span>{tr("TimeEncre 有新版本。")}</span>
          <button type="button" className="btn is-primary is-small" onClick={() => void updateServiceWorker(true)}>
            {tr("刷新")}
          </button>
          <button type="button" className="btn is-quiet is-small" onClick={() => setNeedRefresh(false)}>
            {tr("稍后")}
          </button>
        </>
      ) : (
        <>
          <span>{tr("已可离线使用。")}</span>
          <button type="button" className="btn is-quiet is-small" onClick={() => setOfflineReady(false)}>
            {tr("知道了")}
          </button>
        </>
      )}
    </div>
  );
}
