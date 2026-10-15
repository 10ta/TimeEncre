// 系统通知 + 提示音。Android 上必须通过 Service Worker 发通知，桌面端两种都可以。

export const notificationSupported = () => typeof window !== 'undefined' && 'Notification' in window;

export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!notificationSupported()) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  return Notification.requestPermission();
}

export async function notify(title: string, body: string): Promise<void> {
  if (!notificationSupported() || Notification.permission !== 'granted') return;
  const opts: NotificationOptions = { body, tag: 'timeencre-pomodoro', icon: './icon-192.png' };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) return void (await reg.showNotification(title, opts));
    new Notification(title, opts);
  } catch {
    /* 某些浏览器在非安全上下文中会抛错，忽略 */
  }
}

// 浏览器要求音频必须在用户操作后才能播放：在点击“开始”时调用 unlockAudio()
let ctx: AudioContext | null = null;

export function unlockAudio() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    ctx = null;
  }
}

function tone(freq: number, at: number, dur: number, type: OscillatorType = 'sine', vol = 0.22) {
  const c = ctx!;
  const t = c.currentTime + at;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(c.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

/**
 * 进入某个阶段的提示音，三种听起来不一样：
 * 专注 = 明亮的上行三音；短休息 = 柔和的下行两音；长休息 = 更慢、更长的下行四音。
 */
export function phaseSound(phase: 'work' | 'short' | 'long') {
  if (!ctx) return;
  if (ctx.state === 'suspended') void ctx.resume();
  if (phase === 'work') {
    [523.25, 659.25, 783.99].forEach((f, i) => tone(f, i * 0.13, 0.22, 'sine', 0.25));
    tone(1046.5, 0.39, 0.45, 'sine', 0.2);
  } else if (phase === 'short') {
    tone(783.99, 0, 0.45, 'triangle', 0.28);
    tone(523.25, 0.3, 0.7, 'triangle', 0.28);
  } else {
    [783.99, 659.25, 523.25, 392].forEach((f, i) => tone(f, i * 0.38, i === 3 ? 1.2 : 0.6, 'triangle', 0.28));
  }
}
