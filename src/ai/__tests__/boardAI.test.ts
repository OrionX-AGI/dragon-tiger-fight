import { describe, expect, it } from 'vitest';
import { applyAction, createBoardGame, getLegalActions } from '../../core/boardGame';
import { clearLog, getLogEntries } from '../../core/logger';
import { chooseBoardAction } from '../boardAI';

/** 可复现的伪随机数发生器 */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('棋盘 AI 与引擎冒烟测试', () => {
  it('随机整局对战：着法始终合法、对局必然终止', () => {
    const rng = mulberry32(42);
    for (let g = 0; g < 60; g++) {
      let s = createBoardGame(rng);
      let steps = 0;
      while (s.outcome === null) {
        const legal = getLegalActions(s);
        expect(legal.length).toBeGreaterThan(0);
        const action = chooseBoardAction(s, 'easy', rng);
        s = applyAction(s, action); // 非法着法会在此抛错
        steps++;
        expect(steps).toBeLessThan(800);
      }
      expect(['dragon', 'tiger', 'draw']).toContain(s.outcome);
    }
  });

  it('普通与困难难度返回的着法都在合法着法列表中', () => {
    const rng = mulberry32(7);
    let s = createBoardGame(rng);
    for (let i = 0; i < 6 && s.outcome === null; i++) {
      s = applyAction(s, chooseBoardAction(s, 'easy', rng));
    }
    for (const level of ['normal', 'hard'] as const) {
      const action = chooseBoardAction(s, level, rng);
      expect(getLegalActions(s)).toContainEqual(action);
    }
  });

  it('困难难度遵守时间预算（单步不超过 3 秒）', () => {
    const rng = mulberry32(23);
    let s = createBoardGame(rng);
    for (let i = 0; i < 8 && s.outcome === null; i++) {
      s = applyAction(s, chooseBoardAction(s, 'easy', rng));
    }
    const start = Date.now();
    const action = chooseBoardAction(s, 'hard', rng);
    expect(Date.now() - start).toBeLessThan(3000);
    expect(getLegalActions(s)).toContainEqual(action);
  });

  it('搜索期间不写日志，只留下一条决策记录', () => {
    const rng = mulberry32(11);
    let s = createBoardGame(rng);
    for (let i = 0; i < 6 && s.outcome === null; i++) {
      s = applyAction(s, chooseBoardAction(s, 'easy', rng));
    }
    clearLog();
    chooseBoardAction(s, 'hard', rng);
    const entries = getLogEntries();
    expect(entries.filter((e) => e.category === 'engine')).toHaveLength(0);
    expect(entries.filter((e) => e.category === 'ai' && e.level === 'info')).toHaveLength(1);
  });
});
