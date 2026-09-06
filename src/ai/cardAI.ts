import { createLogger } from '../core/logger';
import { duel } from '../core/rules';
import type { Rank } from '../core/types';
import { optimalStrategy } from './cardSolver';

const log = createLogger('ai');

export type AiLevel = 'easy' | 'normal' | 'hard';

export const AI_LEVEL_LABELS: Record<AiLevel, string> = {
  easy: '简单',
  normal: '普通',
  hard: '困难',
};

/**
 * 普通难度中"走精确最优"的概率，其余时间走短视启发式。
 * 调大该值普通难度更强（玩家胜率下降），调小则更弱。
 */
export const NORMAL_OPTIMAL_RATIO = 0.45;

/** 牌 r 在对方手牌 hand 面前的"战力"：能吃掉几张 */
function strength(r: Rank, hand: Rank[]): number {
  return hand.filter((o) => duel(r, o) === 'win').length;
}

/**
 * 单轮收益（从我方视角，零和）：
 * 赢 = 拆掉对方这张牌的威胁 + 1（子力差）；输 = 损失我方这张牌的战力 - 1；同尽 = 两者相抵。
 * 仅用于普通难度的短视启发式。
 */
function payoffOf(mine: Rank, theirs: Rank, myHand: Rank[], oppHand: Rank[]): number {
  const result = duel(mine, theirs);
  const threatOfTheirs = 1 + strength(theirs, myHand);
  const valueOfMine = 1 + strength(mine, oppHand);
  if (result === 'win') return threatOfTheirs;
  if (result === 'lose') return -valueOfMine;
  return threatOfTheirs - valueOfMine;
}

function sampleIndex(weights: number[], rng: () => number): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return i;
  }
  return weights.length - 1;
}

/** 短视启发式：假设对方均匀出牌，对单轮期望收益做软最大化加权随机 */
function heuristicPick(myHand: Rank[], oppHand: Rank[], rng: () => number): Rank {
  const expected = myHand.map(
    (m) => oppHand.reduce((acc, o) => acc + payoffOf(m, o, myHand, oppHand), 0) / oppHand.length,
  );
  const temperature = 1.2;
  const maxE = Math.max(...expected);
  const weights = expected.map((e) => Math.exp((e - maxE) / temperature));
  return myHand[sampleIndex(weights, rng)];
}

/** 精确最优：查全局值表求当前局面纳什均衡混合策略并抽样 */
function optimalPick(myHand: Rank[], oppHand: Rank[], rng: () => number): { card: Rank; value: number; probs: number[] } {
  const strat = optimalStrategy(myHand, oppHand);
  const card = strat.ranks[sampleIndex(strat.probs, rng)];
  return { card, value: strat.value, probs: strat.probs };
}

/**
 * AI 选牌。myHand/oppHand 均为公开信息（规则规定手牌构成公开）。
 * - 简单：均匀随机。
 * - 普通：按 NORMAL_OPTIMAL_RATIO 概率走精确最优，其余走短视启发式。
 * - 困难：全局精确求解的纳什均衡混合策略，理论上不可被利用。
 */
export function chooseCard(
  myHand: Rank[],
  oppHand: Rank[],
  level: AiLevel,
  rng: () => number = Math.random,
): Rank {
  if (myHand.length === 0) {
    log.error('纸牌 AI 无法出牌：手牌为空');
    throw new Error('手牌为空');
  }
  if (myHand.length === 1) {
    log.info('纸牌 AI 出牌', { 难度: level, 出牌: myHand[0], 说明: '只剩一张牌' });
    return myHand[0];
  }

  const started = Date.now();

  if (level === 'easy') {
    const picked = myHand[Math.floor(rng() * myHand.length)];
    log.info('纸牌 AI 出牌', { 难度: level, 出牌: picked, 我方手牌: myHand, 对方手牌: oppHand });
    return picked;
  }

  if (level === 'normal') {
    const useOptimal = rng() < NORMAL_OPTIMAL_RATIO;
    const picked = useOptimal ? optimalPick(myHand, oppHand, rng).card : heuristicPick(myHand, oppHand, rng);
    log.info('纸牌 AI 出牌', {
      难度: level,
      出牌: picked,
      走法来源: useOptimal ? '精确最优' : '启发式',
      我方手牌: myHand,
      对方手牌: oppHand,
    });
    return picked;
  }

  const { card, value, probs } = optimalPick(myHand, oppHand, rng);
  log.info('纸牌 AI 出牌', {
    难度: level,
    出牌: card,
    局面值: value.toFixed(3),
    我方手牌: myHand,
    对方手牌: oppHand,
    耗时毫秒: Date.now() - started,
  });
  log.debug('困难难度最优混合策略', Object.fromEntries(myHand.map((r, i) => [r, probs[i].toFixed(3)])));
  return card;
}
