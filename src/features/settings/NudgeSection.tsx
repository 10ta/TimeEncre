// 设置页“提醒”：总开关、空闲提醒、例程开始提醒、各活动的连续计时提醒、系统通知授权。
// “至多”目标快到 / 已到上限的提醒不用单独设置，开着总开关就有。
import { useState } from 'react';
import { useTypes } from '../../db/hooks';
import { updateSettings } from '../../db/actions';
import type { NudgeSettings, Settings } from '../../schema';
import { notificationSupported, requestNotificationPermission } from '../../lib/notify';
import { tr } from '../../i18n';

export function NudgeSection({ settings }: { settings: Settings }) {
  const types = useTypes();
  const n: NudgeSettings = settings.nudges ?? {};
  const on = n.enabled !== false;
  const save = (patch: Partial<NudgeSettings>) => updateSettings({ nudges: { ...n, ...patch } });
  const long = Object.entries(n.long ?? {});
  const unused = (types ?? []).filter((t) => !(n.long ?? {})[t.id]);
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported'>(() => (notificationSupported() ? Notification.permission : 'unsupported'));
  const setLong = (next: Record<string, number>) => void save({ long: next });

  return (
    <section>
      <h2>{tr("提醒")}</h2>
      <label className="toggle">
        <input type="checkbox" checked={on} onChange={(e) => void save({ enabled: e.target.checked })} />
        <span>
          {tr("开启提醒")}
          <small>{tr("只在 TimeEncre 页面开着时提醒（后台标签页也行）。“至多”型目标快到上限（80%）和超出时会提醒。")}</small>
        </span>
      </label>
      <label className="toggle">
        <input type="checkbox" disabled={!on} checked={n.routineStart !== false} onChange={(e) => void save({ routineStart: e.target.checked })} />
        <span>
          {tr("例程开始时提醒")}
          <small>{tr("到了例程的时间却没在做那件事时提醒一次。例程在目标页设置。")}</small>
        </span>
      </label>
      <div className="toggle">
        <input id="nudge-idle" type="checkbox" disabled={!on} checked={!!n.idleMin} onChange={(e) => void save({ idleMin: e.target.checked ? 30 : null })} />
        <span>
          <label htmlFor="nudge-idle">{tr("忘记计时提醒")}</label>
          <span className="inline-num">
            {tr("没有任何计时满")}
            <input
              type="number"
              inputMode="numeric"
              min={5}
              max={600}
              value={n.idleMin ?? 30}
              disabled={!on || !n.idleMin}
              aria-label={tr("分钟")}
              onChange={(e) => {
                const v = Math.round(Number(e.target.value));
                if (v >= 5 && v <= 600) void save({ idleMin: v });
              }}
            />
            {tr("分钟时提醒，最多连着三次")}
          </span>
        </span>
      </div>

      <div className="field nudge-long">
        <span className="field-label">{tr("连续计时提醒")}</span>
        {long.map(([typeId, min]) => {
          const t = types?.find((x) => x.id === typeId);
          return (
            <div key={typeId} className="inline-num">
              <span>{t ? `${t.emoji} ${t.name}` : tr("（已删除）")}</span>
              {tr("每连续")}
              <input
                type="number"
                inputMode="numeric"
                min={5}
                max={600}
                value={min}
                disabled={!on}
                aria-label={tr("分钟")}
                onChange={(e) => {
                  const v = Math.round(Number(e.target.value));
                  if (v >= 5 && v <= 600) setLong({ ...n.long, [typeId]: v });
                }}
              />
              {tr("分钟提醒一次")}
              <button
                type="button"
                className="btn is-small is-ghost-danger"
                onClick={() => {
                  const next = { ...n.long };
                  delete next[typeId];
                  setLong(next);
                }}
              >
                {tr("删除")}
              </button>
            </div>
          );
        })}
        {unused.length > 0 && (
          <select
            className="inline-select"
            value=""
            disabled={!on}
            aria-label={tr("给某个活动加连续计时提醒")}
            onChange={(e) => e.target.value && setLong({ ...n.long, [e.target.value]: 45 })}
          >
            <option value="">{tr("＋ 给某个活动加提醒…")}</option>
            {unused.map((t) => (
              <option key={t.id} value={t.id}>
                {t.emoji} {t.name}
              </option>
            ))}
          </select>
        )}
        <p className="hint">{tr("比如上网每 45 分钟、学习每 90 分钟提醒起身休息。暂停后重新开始从头算。")}</p>
      </div>

      {perm === 'unsupported' ? (
        <p className="hint">{tr("这个浏览器不支持系统通知，提醒只显示在页面右上角。")}</p>
      ) : perm === 'granted' ? (
        <p className="hint">{tr("系统通知已开启：页面在后台时也能看到提醒。")}</p>
      ) : perm === 'denied' ? (
        <p className="hint">{tr("系统通知已被浏览器禁止，提醒只显示在页面右上角。")}</p>
      ) : (
        <button type="button" className="btn" onClick={async () => setPerm(await requestNotificationPermission())}>
          {tr("开启系统通知")}
        </button>
      )}
    </section>
  );
}
