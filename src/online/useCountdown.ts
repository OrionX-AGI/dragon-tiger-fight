import { useEffect, useState } from 'react';

/**
 * 把服务器下发的"剩余毫秒"换算成本地滴答的剩余秒数。
 * remainingMs 变化时重置截止时间；为 null 表示无倒计时。
 */
export function useCountdown(remainingMs: number | null): number | null {
  const [deadline, setDeadline] = useState<number | null>(null);
  const [, forceTick] = useState(0);

  useEffect(() => {
    setDeadline(remainingMs === null ? null : Date.now() + remainingMs);
  }, [remainingMs]);

  useEffect(() => {
    if (deadline === null) return;
    const timer = window.setInterval(() => forceTick((n) => n + 1), 250);
    return () => window.clearInterval(timer);
  }, [deadline]);

  if (deadline === null) return null;
  return Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
}
