import { useEffect, useState, type CSSProperties } from 'react';
import { useRecord, useSettings, useTypeMap, useTypes } from '../../db/hooks';
import { TagPicker } from '../../ui/fields';
import { updateSettings } from '../../db/actions';
import { useNow } from '../../ui/hooks';
import { formatClock, formatHm, recordSpans, totalMs } from '../../lib/time';
import { notificationSupported, requestNotificationPermission, unlockAudio } from '../../lib/notify';
import { autoBreak, autoFocus, durationMs, linkedTags, remainingMs, type Phase } from '../../pomodoro/machine';
import {
  adoptRecord,
  pausePomo,
  resetPomo,
  settleNow,
  skipPomo,
  startPomo,
  switchPhase,
  useOrphanRecords,
  usePomo,
} from '../../pomodoro/store';
import { stopRecord } from '../../db/actions';

const PHASES: Array<[Phase, string]> = [
  ['work', '专注'],
  ['short', '短休'],
  ['long', '长休'],
];

const mmss = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

export function PomodoroPage() {
  const pomo = usePomo();
  const settings = useSettings();
  const types = useTypes();
  const typeMap = useTypeMap();
  const now = useNow(250, true);
  const [perm, setPerm] = useState(() => (notificationSupported() ? Notification.permission : 'unsupported'));
  const orphans = useOrphanRecords(pomo);
  const current = useRecord(pomo?.recordId ?? '');

  useEffect(() => {
    void settleNow({ alert: false });
  }, []);

  if (!pomo || !settings || !types || !typeMap) return null;
  const cfg = settings.pomodoro;
  const total = durationMs(pomo.phase, cfg);
  const left = remainingMs(pomo, cfg, now);
  const frac = total ? 1 - left / total : 0;
  // 正在进行的专注优先显示它实际关联记录的类型（例如接管来的记录），否则显示设置里选的类型
  const currentType = current && !current.deleted ? typeMap.get(current.typeId) : undefined;
  const linked = currentType ?? (cfg.linkedTypeId ? typeMap.get(cfg.linkedTypeId) : undefined);
  const isWork = pomo.phase === 'work';
  const color = isWork ? linked?.color ?? 'var(--accent)' : 'var(--ok)';
  const nth = Math.min(pomo.done + (isWork ? 1 : 0), cfg.cyclesBeforeLong);

  const setCfg = (patch: Partial<typeof cfg>) => void updateSettings({ pomodoro: { ...cfg, ...patch } });
  const num = (v: string, min: number, max: number) => Math.min(max, Math.max(min, Math.round(Number(v) || min)));

  const r = 120;
  const c = 2 * Math.PI * r;

  return (
    <div className="page pomodoro">
      <header className="page-head">
        <h1>番茄钟</h1>
      </header>

      {orphans && orphans.length > 0 && (
        <div className="notice is-warn pomo-orphans" role="status">
          <p>
            有 {orphans.length} 条“🍅 番茄钟”记录正在计时，但没有关联到当前番茄钟（可能是异常中断留下的，或来自另一台设备）。
          </p>
          <ul>
            {orphans.map((r) => {
              const t = typeMap.get(r.typeId);
              return (
                <li key={r.id}>
                  <span>
                    {t?.emoji} {t?.name ?? '未知类型'} · 已计时 {formatClock(totalMs(recordSpans(r, now)))}
                    {r.state === 'paused' && '（已暂停）'}
                  </span>
                  <button
                    type="button"
                    className="btn is-small is-primary"
                    disabled={pomo.status !== 'idle'}
                    title={pomo.status !== 'idle' ? '先重置当前番茄钟' : '番茄钟从这条记录已计时的进度继续'}
                    onClick={() => {
                      unlockAudio();
                      void adoptRecord(r.id);
                    }}
                  >
                    接管
                  </button>
                  <button type="button" className="btn is-small" onClick={() => void stopRecord(r.id)}>
                    停止这条记录
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="pomo-layout">
        <section className="pomo-main" style={{ '--c': color } as CSSProperties}>
          <div className="tabs pomo-phases" role="tablist" aria-label="阶段">
            {PHASES.map(([p, label]) => (
              <button
                key={p}
                type="button"
                role="tab"
                aria-selected={pomo.phase === p}
                className={pomo.phase === p ? 'is-on' : undefined}
                disabled={pomo.status !== 'idle' && pomo.phase !== p}
                onClick={() => void switchPhase(p)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="pomo-ring">
            <svg viewBox="0 0 280 280" aria-hidden="true">
              <circle cx="140" cy="140" r={r} fill="none" stroke="var(--line)" strokeWidth="10" />
              {frac > 0 && <circle
                cx="140"
                cy="140"
                r={r}
                fill="none"
                stroke="var(--c)"
                strokeWidth="10"
                strokeLinecap="round"
                strokeDasharray={`${frac * c} ${c}`}
                transform="rotate(-90 140 140)"
              />}
            </svg>
            <div className="pomo-center">
              <span className="pomo-phase">
                {isWork ? (linked ? `${linked.emoji} ${linked.name}` : '🍅 专注') : pomo.phase === 'long' ? '☕ 长休' : '☕ 短休'}
              </span>
              <span className="pomo-time" role="timer" aria-live="off">{mmss(left)}</span>
              <span className="pomo-count">
                第 {Math.max(1, nth)} / {cfg.cyclesBeforeLong} 个
                {pomo.status === 'paused' && ' · 已暂停'}
              </span>
            </div>
          </div>

          <div className="pomo-actions">
            {pomo.status === 'running' ? (
              <button type="button" className="btn is-primary is-big" onClick={() => void pausePomo()}>暂停</button>
            ) : (
              <button
                type="button"
                className="btn is-primary is-big"
                onClick={() => {
                  unlockAudio();
                  void startPomo();
                }}
              >
                {pomo.status === 'paused' ? '继续' : isWork ? '开始专注' : '开始休息'}
              </button>
            )}
            {pomo.status !== 'idle' && (
              <button type="button" className="btn" onClick={() => void skipPomo()}>
                {isWork ? '提前结束，去休息' : '结束休息'}
              </button>
            )}
            {(pomo.status !== 'idle' || pomo.done > 0) && (
              <button type="button" className="btn is-quiet" onClick={() => void resetPomo()}>重置</button>
            )}
          </div>

          <p className="pomo-today">
            今天完成 <strong>{pomo.today.count}</strong> 个番茄{pomo.today.focusMs > 0 && `，专注 ${formatHm(pomo.today.focusMs)}`}
          </p>
        </section>

        <section className="pomo-settings">
          <h2>设置</h2>
          <label className="field">
            <span className="field-label">专注时记录为</span>
            <select value={cfg.linkedTypeId ?? ''} onChange={(e) => setCfg({ linkedTypeId: e.target.value || null })} disabled={pomo.status !== 'idle'}>
              <option value="">不记录</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.emoji} {t.name}
                </option>
              ))}
            </select>
          </label>
          <TagPicker value={linkedTags(cfg)} onChange={(ids) => setCfg({ linkedTagIds: ids })} />
          <p className="hint">
            选了类型后，每段专注都会自动生成一条该类型的记录（备注“🍅 番茄钟”），并带上这里选的标签，出现在历史、统计和目标里。
            在顶部横条或计时页暂停、继续、停止这条记录，番茄钟会跟着变。
          </p>
          <div className="pomo-grid">
            {(
              [
                ['workMin', '专注（分钟）', 1, 180],
                ['shortBreakMin', '短休（分钟）', 1, 60],
                ['longBreakMin', '长休（分钟）', 1, 120],
                ['cyclesBeforeLong', '几个番茄后长休', 1, 12],
              ] as const
            ).map(([k, label, min, max]) => (
              <label key={k} className="field">
                <span className="field-label">{label}</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={min}
                  max={max}
                  value={cfg[k]}
                  disabled={pomo.status !== 'idle'}
                  onChange={(e) => setCfg({ [k]: num(e.target.value, min, max) })}
                />
              </label>
            ))}
          </div>
          <label className="toggle">
            <input type="checkbox" checked={autoBreak(cfg)} onChange={(e) => setCfg({ autoStartBreak: e.target.checked })} />
            <span>
              专注结束后自动开始休息
            </span>
          </label>
          <label className="toggle">
            <input type="checkbox" checked={autoFocus(cfg)} onChange={(e) => setCfg({ autoStartFocus: e.target.checked })} />
            <span>
              休息结束后自动开始专注
              <small>两个都开就会一直循环，直到你暂停或重置</small>
            </span>
          </label>
          <label className="toggle">
            <input type="checkbox" checked={cfg.sound} onChange={(e) => setCfg({ sound: e.target.checked })} />
            <span>提示音</span>
          </label>
          {perm === 'unsupported' ? (
            <p className="hint">这个浏览器不支持系统通知。</p>
          ) : perm === 'granted' ? (
            <p className="hint">系统通知已开启。</p>
          ) : (
            perm === 'denied' ? (
              <p className="hint">系统通知已被浏览器禁止，需要在浏览器的网站设置里允许本站通知。</p>
            ) : (
              <button type="button" className="btn" onClick={async () => setPerm(await requestNotificationPermission())}>
                开启系统通知
              </button>
            )
          )}
          <p className="hint">
            页面在后台时，到点提醒依赖浏览器：电脑上基本准时；手机锁屏或浏览器被系统挂起时，提醒可能要等回到页面才出现。计时本身按时间戳计算，不会因此出错。
          </p>
        </section>
      </div>
    </div>
  );
}
