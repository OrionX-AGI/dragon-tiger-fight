import { createLogger } from './logger';
import { duel } from './rules';
import type { Faction, Rank } from './types';
import { otherFaction, RANKS } from './types';

const log = createLogger('engine');

/** 对局结束原因：一方打空 / 双方同轮打空 / 认输 / 离场或掉线判负（在线对战） */
export type CardEndReason = 'handEmpty' | 'bothEmpty' | 'surrender' | 'abandon';

/** 单轮记录：双方所出的牌与结果 */
export interface RoundRecord {
  dragon: Rank;
  tiger: Rank;
  /** 该轮赢家；'both' 表示同号同归于尽 */
  winner: Faction | 'both';
}

export interface CardGameState {
  /** 双方当前手牌 */
  hands: Record<Faction, Rank[]>;
  /** 双方已被永久移除的牌 */
  lost: Record<Faction, Rank[]>;
  history: RoundRecord[];
  /** 胜负：赢家阵营 / 'draw' 和局 / null 对局进行中 */
  outcome: Faction | 'draw' | null;
  endReason: CardEndReason | null;
}

export function createCardGame(): CardGameState {
  log.info('纸牌新局开始，双方各持 1~8 号共 8 张');
  return {
    hands: { dragon: [...RANKS], tiger: [...RANKS] },
    lost: { dragon: [], tiger: [] },
    history: [],
    outcome: null,
    endReason: null,
  };
}

/** 认输：faction 一方投降，对方直接获胜 */
export function surrender(state: CardGameState, faction: Faction): CardGameState {
  if (state.outcome !== null) {
    log.warn('拒绝认输：对局已结束', { outcome: state.outcome });
    throw new Error('对局已结束');
  }
  log.info('纸牌对局认输', { 认输方: faction });
  return {
    ...state,
    outcome: otherFaction(faction),
    endReason: 'surrender',
  };
}

/**
 * 结算一轮：双方各出一张手牌，输方牌移除、赢方牌收回，同号双方移除。
 * 返回新状态（原状态不被修改）。
 */
export function playRound(state: CardGameState, dragonCard: Rank, tigerCard: Rank): CardGameState {
  if (state.outcome !== null) {
    log.warn('拒绝出牌：对局已结束', { outcome: state.outcome });
    throw new Error('对局已结束');
  }
  if (!state.hands.dragon.includes(dragonCard)) {
    log.warn('拒绝出牌：龙方手牌中没有该牌', { dragonCard, hand: state.hands.dragon });
    throw new Error(`龙方手牌中没有 ${dragonCard} 号`);
  }
  if (!state.hands.tiger.includes(tigerCard)) {
    log.warn('拒绝出牌：虎方手牌中没有该牌', { tigerCard, hand: state.hands.tiger });
    throw new Error(`虎方手牌中没有 ${tigerCard} 号`);
  }

  const result = duel(dragonCard, tigerCard); // 从龙方视角
  const winner: Faction | 'both' = result === 'both' ? 'both' : result === 'win' ? 'dragon' : 'tiger';

  const hands: Record<Faction, Rank[]> = {
    dragon: [...state.hands.dragon],
    tiger: [...state.hands.tiger],
  };
  const lost: Record<Faction, Rank[]> = {
    dragon: [...state.lost.dragon],
    tiger: [...state.lost.tiger],
  };

  if (winner === 'dragon' || winner === 'both') {
    hands.tiger = hands.tiger.filter((r) => r !== tigerCard);
    lost.tiger.push(tigerCard);
  }
  if (winner === 'tiger' || winner === 'both') {
    hands.dragon = hands.dragon.filter((r) => r !== dragonCard);
    lost.dragon.push(dragonCard);
  }

  let outcome: CardGameState['outcome'] = null;
  let endReason: CardEndReason | null = null;
  const dragonEmpty = hands.dragon.length === 0;
  const tigerEmpty = hands.tiger.length === 0;
  if (dragonEmpty && tigerEmpty) {
    outcome = 'draw';
    endReason = 'bothEmpty';
  } else if (dragonEmpty) {
    outcome = 'tiger';
    endReason = 'handEmpty';
  } else if (tigerEmpty) {
    outcome = 'dragon';
    endReason = 'handEmpty';
  }

  log.info(`第 ${state.history.length + 1} 回合结算`, {
    龙出: dragonCard,
    虎出: tigerCard,
    结果: winner === 'both' ? '同归于尽' : winner === 'dragon' ? '龙方吃牌' : '虎方吃牌',
    龙剩: hands.dragon,
    虎剩: hands.tiger,
  });
  if (outcome !== null) {
    log.info('纸牌对局结束', { 结果: outcome, 回合数: state.history.length + 1 });
  }

  return {
    hands,
    lost,
    history: [...state.history, { dragon: dragonCard, tiger: tigerCard, winner }],
    outcome,
    endReason,
  };
}
