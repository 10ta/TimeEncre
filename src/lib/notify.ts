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

/** 三声短促的提示音 */
export function chime() {
  if (!ctx) return;
  const t = ctx.currentTime;
  [0, 0.22, 0.44].forEach((dt, i) => {
    const osc = ctx!.createOscillator();
    const gain = ctx!.createGain();
    osc.type = 'sine';
    osc.frequency.value = i === 2 ? 1046.5 : 784;
    gain.gain.setValueAtTime(0.0001, t + dt);
    gain.gain.exponentialRampToValueAtTime(0.25, t + dt + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.18);
    osc.connect(gain).connect(ctx!.destination);
    osc.start(t + dt);
    osc.stop(t + dt + 0.2);
  });
}
