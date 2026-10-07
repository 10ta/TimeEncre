import { useEffect, useRef, useState } from 'react';
import { useCounts, useSettings } from '../../db/hooks';
import { clearAllLocalData, discardEnabled, discardSeconds, updateSettings } from '../../db/actions';
import { exportBundle, importBundle, type MergeCount } from '../../io/bundle';
import { importAtl2 } from '../../io/atl2';
import { downloadJson, readJsonFile } from '../../io/download';
import { fileStamp } from '../../lib/time';
import { SyncSection } from '../../sync/SyncSection';

const fmt = (c: MergeCount) => `新增 ${c.added}，更新 ${c.updated}`;

export function SettingsPage() {
  const settings = useSettings();
  const counts = useCounts();
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const bundleRef = useRef<HTMLInputElement>(null);
  const atlRef = useRef<HTMLInputElement>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [clearText, setClearText] = useState('');

  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null));
  }, []);

  if (!settings) return null;

  const run = async (fn: () => Promise<string>) => {
    try {
      setMsg({ text: await fn() });
    } catch (e) {
      setMsg({ text: (e as Error).message, error: true });
    }
  };

  return (
    <div className="page settings">
      <header className="page-head">
        <h1>设置</h1>
      </header>

      <section>
        <h2>计时</h2>
        <label className="toggle">
          <input
            type="checkbox"
            checked={settings.allowConcurrent}
            onChange={(e) => void updateSettings({ allowConcurrent: e.target.checked })}
          />
          <span>
            允许多个活动同时计时
            <small>关闭后，开始一个新活动会自动停止正在进行的活动</small>
          </span>
        </label>
        <div className="toggle">
          <input
            id="discard-short"
            type="checkbox"
            checked={discardEnabled(settings)}
            onChange={(e) => void updateSettings({ discardShort: e.target.checked })}
          />
          <span>
            <label htmlFor="discard-short">自动作废过短的计时</label>
            <span className="inline-num">
              停止时不足
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={600}
                value={discardSeconds(settings)}
                disabled={!discardEnabled(settings)}
                aria-label="秒数"
                onChange={(e) => {
                  const v = Math.round(Number(e.target.value));
                  if (v >= 1 && v <= 600) void updateSettings({ discardShortSec: v });
                }}
              />
              秒的计时直接作废
            </span>
            <small>防止误触产生的零碎记录。作废时会提示，可以点“恢复”。补录和编辑时间不受影响。</small>
          </span>
        </div>
        <label className="field is-inline">
          <span className="field-label">每周从哪天开始</span>
          <select value={settings.weekStart} onChange={(e) => void updateSettings({ weekStart: Number(e.target.value) })}>
            <option value={1}>周一</option>
            <option value={0}>周日</option>
          </select>
        </label>
        <p className="hint">
          <a href="#/catalog">管理活动与标签</a>
        </p>
      </section>

      <section>
        <h2>数据</h2>
        <p className="hint">
          当前本地共有 {counts?.types ?? 0} 个活动、{counts?.tags ?? 0} 个标签、{counts?.records ?? 0} 条记录。
          {persisted === false && ' 浏览器尚未授予持久存储，清理浏览器数据会丢失记录，请定期导出。'}
          {persisted === true && ' 浏览器已授予持久存储。'}
        </p>
        <div className="row">
          <button
            type="button"
            className="btn"
            onClick={() =>
              void run(async () => {
                downloadJson(await exportBundle(), `timeencre-${fileStamp(Date.now())}.json`);
                return '已导出备份文件。';
              })
            }
          >
            导出备份（JSON）
          </button>
          <button type="button" className="btn" onClick={() => bundleRef.current?.click()}>导入 TimeEncre 备份</button>
          <button type="button" className="btn" onClick={() => atlRef.current?.click()}>导入 A Time Logger 2 备份</button>
        </div>
        <input
          ref={bundleRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f)
              void run(async () => {
                const r = await importBundle(await readJsonFile(f));
                return `导入完成。活动：${fmt(r.types)}；标签：${fmt(r.tags)}；记录：${fmt(r.records)}。较旧的数据已跳过。`;
              });
          }}
        />
        <input
          ref={atlRef}
          type="file"
          accept=".ttbkp,.json,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f)
              void run(async () => {
                const r = await importAtl2(await readJsonFile(f));
                const skipped = [
                  r.existing && `${r.existing} 项已存在`,
                  r.skipped.groups && `${r.skipped.groups} 个分组`,
                  r.skipped.deleted && `${r.skipped.deleted} 项已删除`,
                  r.skipped.goals && `${r.skipped.goals} 个目标（暂不支持导入）`,
                ].filter(Boolean);
                return (
                  `已导入 ${r.added.types} 个活动、${r.added.tags} 个标签、${r.added.records} 条记录。` +
                  (skipped.length ? ` 跳过：${skipped.join('，')}。` : '')
                );
              });
          }}
        />
        {msg && (
          <p className={msg.error ? 'form-error' : 'notice'} role="status">
            {msg.text}
          </p>
        )}
      </section>

      <SyncSection />

      <section>
        <h2>应用</h2>
        {window.isSecureContext ? (
          <p className="hint">
            可以安装到桌面或手机主屏（浏览器地址栏的“安装”按钮，或手机浏览器菜单里的“添加到主屏幕”），装好后可离线使用。
          </p>
        ) : (
          <p className="hint">
            当前是通过 http 地址访问的（比如局域网 IP）。计时、统计和 GitHub 同步都正常，但浏览器不允许在这种页面上安装为 App、离线缓存和在手机上推送通知。
            需要这些功能时，请通过 HTTPS 域名或 localhost 访问。
          </p>
        )}
        <p className="hint">版本 {__APP_VERSION__}</p>
      </section>

      <section className="danger-zone">
        <h2>清空本地数据</h2>
        <p className="hint">删除这台设备浏览器里的全部活动、标签和记录，无法撤销。仓库设置会保留，之后点同步即可从仓库重新拉取；没有连接仓库的话，请先导出备份。</p>
        <div className="row">
          <input
            value={clearText}
            onChange={(e) => setClearText(e.target.value)}
            placeholder="输入“清空”以确认"
            aria-label="输入清空以确认"
          />
          <button
            type="button"
            className="btn is-danger"
            disabled={clearText !== '清空'}
            onClick={() =>
              void run(async () => {
                await clearAllLocalData();
                setClearText('');
                return '本地数据已清空。';
              })
            }
          >
            清空本地数据
          </button>
        </div>
      </section>
    </div>
  );
}
