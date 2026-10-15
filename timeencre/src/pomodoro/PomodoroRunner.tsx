// 全局常驻：无论在哪个页面，都在阶段到点时结算并提醒，同时把剩余时间显示在标签页标题上；
// 并让番茄钟跟随它关联的那条记录在别处的暂停 / 继续 / 停止。
import { useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { useSettings } from '../db/hooks';
import { useNow } from '../ui/hooks';
import { endsAt, remainingMs } from './machine';
import { followLinkedRecord, settleNow, usePomo } from './store';

const mmss = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

export function PomodoroRunner({ baseTitle }: { baseTitle: string }) {
  const pomo = usePomo();
  const settings = useSettings();
  const running = pomo?.status === 'running';
  const now = useNow(1000, running);
  const linked = useLiveQuery(
    async () => (pomo?.recordId ? ((await db.records.get(pomo.recordId)) ?? null) : null),
    [pomo?.recordId],
  );

  // 打开 app 时先结算一次（页面关闭期间可能已经到点）
  useEffect(() => {
    void settleNow({ alert: false });
  }, []);

  // 用一次性定时器精确到点：后台标签页里的单次定时器不会像连续定时器那样被大幅推迟
  const end = pomo && settings ? endsAt(pomo, settings.pomodoro) : null;
  useEffect(() => {
    if (end === null) return;
    const t = window.setTimeout(() => void settleNow(), Math.max(0, end - Date.now()) + 50);
    const onVisible = () => document.visibilityState === 'visible' && void settleNow();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [end]);

  // 关联记录的状态变了（在顶部横条或计时页操作过），番茄钟跟上
  const linkedKey = linked === undefined ? 'loading' : linked ? `${linked.state}:${linked.deleted}` : 'gone';
  useEffect(() => {
    if (linkedKey !== 'loading' && pomo?.recordId) void followLinkedRecord();
  }, [linkedKey, pomo?.recordId, pomo?.status]);

  useEffect(() => {
    if (!pomo || !settings || pomo.status === 'idle') {
      document.title = baseTitle;
      return;
    }
    const icon = pomo.phase === 'work' ? '🍅' : '☕';
    const paused = pomo.status === 'paused' ? '⏸ ' : '';
    document.title = `${paused}${icon} ${mmss(remainingMs(pomo, settings.pomodoro, now))} · ${baseTitle}`;
  }, [pomo, settings, now, baseTitle]);

  return null;
}
