// Pomo 圆环：进度弧 + 圆环内的控制按钮 + 状态动画。
//  开始 / 继续：向外扩散一圈光晕；暂停：进度弧缓慢呼吸；结束本段 / 重置：进度弧倒卷回 0；
//  一段自然到点：先亮满一整圈，再倒卷回 0。系统开启“减少动态效果”时动画由 CSS 关闭。
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Icon, type IconName } from '../../ui/Icon';
import type { Phase } from '../../pomodoro/machine';
import { tr } from '../../i18n';

type Status = 'idle' | 'running' | 'paused';
type Anim = 'none' | 'complete' | 'rewind';

const R = 132;
const C = 2 * Math.PI * R;

export function PomoRing({
  phase,
  status,
  frac,
  color,
  label,
  time,
  sub,
  canReset,
  onStart,
  onPause,
  onEnd,
  onReset,
}: {
  phase: Phase;
  status: Status;
  /** 0–1 */
  frac: number;
  color: string;
  label: ReactNode;
  time: string;
  sub: ReactNode;
  canReset: boolean;
  onStart: () => void;
  onPause: () => void;
  onEnd: () => void;
  onReset: () => void;
}) {
  const [anim, setAnim] = useState<Anim>('none');
  const [ripple, setRipple] = useState(0);
  const prev = useRef({ status, phase });
  const userRewind = useRef(false);
  const timers = useRef<number[]>([]);

  const run = (steps: Array<[Anim, number]>) => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    let at = 0;
    for (const [a, ms] of steps) {
      timers.current.push(window.setTimeout(() => setAnim(a), at));
      at += ms;
    }
    timers.current.push(window.setTimeout(() => setAnim('none'), at));
  };

  // 在绘制前判断：阶段自然结束时，先把弧停在满圈，避免先闪一下 0
  useLayoutEffect(() => {
    const p = prev.current;
    prev.current = { status, phase };
    if (p.status !== 'running' && status === 'running') setRipple((n) => n + 1);
    const ended = p.phase !== phase || (p.status !== 'idle' && status === 'idle');
    if (!ended) return;
    if (userRewind.current) {
      userRewind.current = false;
      return; // 已在点击时开始倒卷
    }
    if (p.status === 'running') {
      setAnim('complete');
      run([['complete', 450], ['rewind', 700]]);
    }
  }, [status, phase]);

  const act = (fn: () => void, rewind = false) => () => {
    if (rewind) {
      userRewind.current = true;
      setAnim('rewind'); // 先打开过渡，再让进度变为 0，才能看到倒卷
      run([['rewind', 700]]);
    }
    fn();
  };

  const shown = anim === 'complete' ? 1 : frac;
  const idle = status === 'idle';

  return (
    <div className={`pomo-ring is-${status} anim-${anim}`} style={{ '--c': color } as CSSProperties}>
      <svg viewBox="0 0 300 300" aria-hidden="true">
        <circle className="ring-track" cx="150" cy="150" r={R} />
        {ripple > 0 && <circle key={ripple} className="ring-ripple" cx="150" cy="150" r={R} />}
        <circle
          className="ring-arc"
          cx="150"
          cy="150"
          r={R}
          strokeDasharray={C}
          strokeDashoffset={C * (1 - Math.min(1, Math.max(0, shown)))}
          style={{ opacity: shown <= 0 && anim === 'none' ? 0 : 1 }}
          transform="rotate(-90 150 150)"
        />
      </svg>
      <div className="pomo-center">
        <span className="pomo-phase">{label}</span>
        <span className="pomo-time" role="timer">{time}</span>
        <span className="pomo-count">{sub}</span>
        <div className="ring-controls">
          <Slot show={canReset} icon="reset" text={tr("重置")} onClick={act(onReset, true)} />
          {status === 'running' ? (
            <Slot primary show icon="pause" text={tr("暂停")} onClick={onPause} />
          ) : (
            <Slot primary show icon="play" text={status === 'paused' ? tr("继续") : phase === 'work' ? tr("开始专注") : tr("开始休息")} onClick={onStart} />
          )}
          <Slot show={!idle} icon="stop" text={phase === 'work' ? tr("结束专注") : tr("结束休息")} onClick={act(onEnd, true)} />
        </div>
      </div>
    </div>
  );
}

function Slot({
  show,
  primary,
  icon,
  text,
  onClick,
}: {
  show: boolean;
  primary?: boolean;
  icon: IconName;
  text: string;
  onClick: () => void;
}) {
  if (!show) return <span className="ring-slot" aria-hidden="true" />;
  return (
    <span className="ring-slot">
      <button type="button" className={`ring-btn${primary ? ' is-primary' : ''}`} onClick={onClick} aria-label={text}>
        <Icon name={icon} />
      </button>
      <span className="ring-btn-label" aria-hidden="true">{text}</span>
    </span>
  );
}
