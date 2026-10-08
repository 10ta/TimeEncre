import { useEffect, useRef, useState } from 'react';
import { useCounts, useSettings } from '../../db/hooks';
import { clearAllLocalData, discardEnabled, discardSeconds, updateSettings } from '../../db/actions';
import { exportBundle, importBundle, type MergeCount } from '../../io/bundle';
import { importAtl2 } from '../../io/atl2';
import { downloadJson, readJsonFile } from '../../io/download';
import { fileStamp } from '../../lib/time';
import { SyncSection } from '../../sync/SyncSection';
import { LANGS, getLang, switchLang, tr, type Lang } from '../../i18n';

const fmt = (c: MergeCount) => tr("新增 {0}，更新 {1}", c.added, c.updated);

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
        <h1>{tr("设置")}</h1>
      </header>

      <section>
        <h2>{tr("计时")}</h2>
        <label className="toggle">
          <input
            type="checkbox"
            checked={settings.allowConcurrent}
            onChange={(e) => void updateSettings({ allowConcurrent: e.target.checked })}
          />
          <span>
            {tr("允许多个活动同时计时")}
            <small>{tr("关闭后，开始一个新活动会自动停止正在进行的活动")}</small>
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
            <label htmlFor="discard-short">{tr("自动作废过短的计时")}</label>
            <span className="inline-num">
              {tr("停止时不足")}
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={600}
                value={discardSeconds(settings)}
                disabled={!discardEnabled(settings)}
                aria-label={tr("秒数")}
                onChange={(e) => {
                  const v = Math.round(Number(e.target.value));
                  if (v >= 1 && v <= 600) void updateSettings({ discardShortSec: v });
                }}
              />
              {tr("秒的计时直接作废")}
            </span>
            <small>{tr("防止误触产生的零碎记录。作废时会提示，可以点“恢复”。补录和编辑时间不受影响。")}</small>
          </span>
        </div>
        <label className="field is-inline">
          <span className="field-label">{tr("每周从哪天开始")}</span>
          <select value={settings.weekStart} onChange={(e) => void updateSettings({ weekStart: Number(e.target.value) })}>
            <option value={1}>{tr("周一")}</option>
            <option value={0}>{tr("周日")}</option>
          </select>
        </label>
        <p className="hint">
          <a href="#/catalog">{tr("管理活动与标签")}</a>
        </p>
      </section>

      <section>
        <h2>{tr("语言")} · Langue</h2>
        <label className="field is-inline">
          <span className="field-label">{tr("语言")}</span>
          <select value={getLang()} onChange={(e) => switchLang(e.target.value as Lang)} aria-label="Language">
            {LANGS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <p className="hint">{tr("切换后页面会刷新。语言只保存在这台设备上。")}</p>
      </section>

      <section>
        <h2>{tr("数据")}</h2>
        <p className="hint">
          {tr("当前本地共有 {0} 个活动、{1} 个标签、{2} 条记录。", counts?.types ?? 0, counts?.tags ?? 0, counts?.records ?? 0)}
          {persisted === false && tr(" 浏览器尚未授予持久存储，清理浏览器数据会丢失记录，请定期导出。")}
          {persisted === true && tr(" 浏览器已授予持久存储。")}
        </p>
        <div className="row">
          <button
            type="button"
            className="btn"
            onClick={() =>
              void run(async () => {
                downloadJson(await exportBundle(), `timeencre-${fileStamp(Date.now())}.json`);
                return tr("已导出备份文件。");
              })
            }
          >
            {tr("导出备份（JSON）")}
          </button>
          <button type="button" className="btn" onClick={() => bundleRef.current?.click()}>{tr("导入 TimeEncre 备份")}</button>
          <button type="button" className="btn" onClick={() => atlRef.current?.click()}>{tr("导入 A Time Logger 2 备份")}</button>
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
                return tr("导入完成。活动：{0}；标签：{1}；记录：{2}。较旧的数据已跳过。", fmt(r.types), fmt(r.tags), fmt(r.records));
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
                  r.existing && tr("{0} 项已存在", r.existing),
                  r.skipped.groups && tr("{0} 个分组", r.skipped.groups),
                  r.skipped.deleted && tr("{0} 项已删除", r.skipped.deleted),
                  r.skipped.goals && tr("{0} 个目标（暂不支持导入）", r.skipped.goals),
                ].filter(Boolean);
                return (
                  tr("已导入 {0} 个活动、{1} 个标签、{2} 条记录。", r.added.types, r.added.tags, r.added.records) +
                  (skipped.length ? tr(" 跳过：{0}。", skipped.join(tr("，"))) : '')
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
        <h2>{tr("应用")}</h2>
        {window.isSecureContext ? (
          <p className="hint">
            {tr("可以安装到桌面或手机主屏（浏览器地址栏的“安装”按钮，或手机浏览器菜单里的“添加到主屏幕”），装好后可离线使用。")}
          </p>
        ) : (
          <p className="hint">
            {tr("当前是通过 http 地址访问的（比如局域网 IP）。计时、统计和 GitHub 同步都正常，但浏览器不允许在这种页面上安装为 App、离线缓存和在手机上推送通知。 需要这些功能时，请通过 HTTPS 域名或 localhost 访问。")}
          </p>
        )}
        <p className="hint">{tr("版本")} {__APP_VERSION__}</p>
      </section>

      <section className="danger-zone">
        <h2>{tr("清空本地数据")}</h2>
        <p className="hint">{tr("删除这台设备浏览器里的全部活动、标签和记录，无法撤销。仓库设置会保留，之后点同步即可从仓库重新拉取；没有连接仓库的话，请先导出备份。")}</p>
        <div className="row">
          <input
            value={clearText}
            onChange={(e) => setClearText(e.target.value)}
            placeholder={tr("输入“清空”以确认")}
            aria-label={tr("输入清空以确认")}
          />
          <button
            type="button"
            className="btn is-danger"
            disabled={clearText !== tr("清空")}
            onClick={() =>
              void run(async () => {
                await clearAllLocalData();
                setClearText('');
                return tr("本地数据已清空。");
              })
            }
          >
            {tr("清空本地数据")}
          </button>
        </div>
      </section>
    </div>
  );
}
