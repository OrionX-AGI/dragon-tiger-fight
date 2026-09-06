import { describe, expect, it } from 'vitest';
import { createCardGame, playRound } from '../../core/cardGame';
import { suppressLogs } from '../../core/logger';
import type { Faction, Rank } from '../../core/types';
import type { AiLevel } from '../cardAI';
import { chooseCard } from '../cardAI';

/** 可复现的伪随机数生成器（mulberry32） */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('纸牌 AI', () => {
  it('各难度都只出自己手中的牌', () => {
    const myHand: Rank[] = [1, 3, 5, 8];
    const oppHand: Rank[] = [2, 4, 8];
    for (const level of ['easy', 'normal', 'hard'] as const) {
      for (let i = 0; i < 30; i++) {
        expect(myHand).toContain(chooseCard(myHand, oppHand, level));
      }
    }
  });

  it('只剩一张牌时直接出该牌', () => {
    expect(chooseCard([6], [1, 2], 'hard')).toBe(6);
  });

  it('困难难度在唯一最优局面下不犯错：{1,8} 对 {8} 必出 8', () => {
    // 出 8 与对方 8 同尽后 1 独存必胜；出 1 被对方 8 吃掉后变成 8 对 8 只能和。
    for (let i = 0; i < 40; i++) {
      expect(chooseCard([1, 8], [8], 'hard')).toBe(8);
    }
  });
});

/** 让两个难度的 AI 对打若干局，返回 A 方得分率（胜 1 分、和 0.5 分） */
function scoreRate(levelA: AiLevel, levelB: AiLevel, games: number, seed: number): number {
  const rng = mulberry32(seed);
  let score = 0;
  suppressLogs(() => {
    for (let g = 0; g < games; g++) {
      let state = createCardGame();
      // A 执龙、B 执虎；牌力完全对称，先后无影响（同时出牌）
      while (state.outcome === null) {
        const dragonCard = chooseCard(state.hands.dragon, state.hands.tiger, levelA, rng);
        const tigerCard = chooseCard(state.hands.tiger, state.hands.dragon, levelB, rng);
        state = playRound(state, dragonCard, tigerCard);
      }
      const outcome = state.outcome as Faction | 'draw';
      if (outcome === 'dragon') score += 1;
      else if (outcome === 'draw') score += 0.5;
    }
  });
  return score / games;
}

describe('纸牌 AI 强度阶梯', () => {
  it('困难明显强于简单', () => {
    expect(scoreRate('hard', 'easy', 200, 42)).toBeGreaterThan(0.75);
  });

  it('困难不弱于普通', () => {
    expect(scoreRate('hard', 'normal', 200, 43)).toBeGreaterThanOrEqual(0.5);
  });

  it('普通强于简单', () => {
    expect(scoreRate('normal', 'easy', 200, 44)).toBeGreaterThan(0.6);
  });

  it('困难对困难接近五五开（均衡策略自我对弈）', () => {
    const rate = scoreRate('hard', 'hard', 200, 45);
    expect(rate).toBeGreaterThan(0.4);
    expect(rate).toBeLessThan(0.6);
  });
});
