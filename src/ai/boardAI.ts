import type { BoardAction, BoardGameState } from '../core/boardGame';
import { adjacentIndices, applyAction, currentFaction, getLegalActions } from '../core/boardGame';
import { createLogger, suppressLogs } from '../core/logger';
import { canCapture, duel } from '../core/rules';
import type { Card, Faction, Rank } from '../core/types';
import { allCards, cardKey, otherFaction } from '../core/types';
import type { AiLevel } from './cardAI';

/**
 * 棋盘 AI。暗牌对 AI 同样不可见：搜索前先把未翻开的牌随机"确定化"
 * （PIMC，Perfect Information Monte Carlo），对多个样本做时间预算内的
 * 迭代加深 α-β 剪枝搜索，取平均收益最高的着法。
 */

interface SearchConfig {
  /** 确定化样本数 */
  samples: number;
  /** 时间预算（毫秒），超时后回退到最后一个完整搜完的深度 */
  timeMs: number;
  /** 迭代加深的最大深度 */
  maxDepth: number;
}

const CONFIGS: Record<Exclude<AiLevel, 'easy'>, SearchConfig> = {
  normal: { samples: 4, timeMs: 280, maxDepth: 3 },
  hard: { samples: 12, timeMs: 950, maxDepth: 8 },
};

const log = createLogger('ai');

function describeAction(action: BoardAction): string {
  return action.type === 'flip' ? `翻开第 ${action.index} 格` : `${action.from} → ${action.to}`;
}

/** 未翻开的牌 = 全套 16 张 - 已翻开 - 已被吃 */
function unrevealedCards(state: BoardGameState): Card[] {
  const seen = new Set<string>();
  for (const cell of state.board) {
    if (cell && cell.faceUp) seen.add(cardKey(cell.card));
  }
  for (const card of state.captured) seen.add(cardKey(card));
  return allCards().filter((c) => !seen.has(cardKey(c)));
}

/** 把暗牌按随机排列重新指派，得到一个"完全信息"假想局面 */
function determinize(state: BoardGameState, rng: () => number): BoardGameState {
  const pool = unrevealedCards(state);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  let k = 0;
  const board = state.board.map((cell) => {
    if (cell && !cell.faceUp) return { card: pool[k++], faceUp: false };
    return cell ? { ...cell } : null;
  });
  return { ...state, board, repetition: { ...state.repetition } };
}

/** 单子价值：基础分 + 能吃掉的对方在场牌数（克制保留价值） */
function pieceWorth(rank: Rank, enemyRanks: Rank[]): number {
  return 1.5 + enemyRanks.filter((e) => duel(rank, e) === 'win').length;
}

/**
 * 局面估值（me 视角）：
 * - 子力：每子按"能吃掉的对方在场牌数"计值（自带克制保留奖励，如对方 1 在场时己方 8 更值钱）；
 * - 机动性：己方明牌可走的相邻空格数，轻微加权；
 * - 悬空惩罚：己方明牌紧邻能吃掉它的对方明牌时按其价值扣分，轮到对方走时加重。
 */
function evaluate(state: BoardGameState, me: Faction): number {
  const ranksOnBoard: Record<Faction, Rank[]> = { dragon: [], tiger: [] };
  for (const cell of state.board) {
    if (cell) ranksOnBoard[cell.card.faction].push(cell.card.rank);
  }

  const moverFaction = currentFaction(state);

  const scoreOf = (f: Faction): number => {
    const enemy = otherFaction(f);
    const enemyRanks = ranksOnBoard[enemy];
    let material = 0;
    let mobility = 0;
    let hanging = 0;

    for (let i = 0; i < state.board.length; i++) {
      const cell = state.board[i];
      if (!cell || cell.card.faction !== f) continue;
      const worth = pieceWorth(cell.card.rank, enemyRanks);
      material += worth;
      if (!cell.faceUp) continue;

      for (const adj of adjacentIndices(i)) {
        const nb = state.board[adj];
        if (nb === null) {
          mobility += 1;
        } else if (nb.faceUp && nb.card.faction === enemy && canCapture(nb.card.rank, cell.card.rank)) {
          // 被对方明牌贴住且能被吃：轮到对方走时几乎等于丢子
          hanging = Math.max(hanging, worth * (moverFaction === enemy ? 0.8 : 0.35));
        }
      }
    }
    return material + 0.06 * mobility - hanging;
  };

  return scoreOf(me) - scoreOf(otherFaction(me));
}

const WIN_SCORE = 10000;

/** 搜索超时信号（回退到上一完整深度的结果） */
class DeadlineExceeded extends Error {}

interface SearchContext {
  deadline: number;
  nodes: number;
}

function orderActions(state: BoardGameState, actions: BoardAction[]): BoardAction[] {
  const score = (act: BoardAction): number => {
    if (act.type === 'flip') return 1;
    const target = state.board[act.to];
    if (target === null) return 0;
    // 吃子最优先，被吃目标越值钱越靠前
    return 10 + target.card.rank;
  };
  return [...actions].sort((a, b) => score(b) - score(a));
}

function alphabeta(
  state: BoardGameState,
  depth: number,
  alpha: number,
  beta: number,
  me: Faction,
  ctx: SearchContext,
): number {
  ctx.nodes++;
  if ((ctx.nodes & 127) === 0 && Date.now() > ctx.deadline) {
    throw new DeadlineExceeded();
  }

  if (state.outcome !== null) {
    if (state.outcome === 'draw') return 0;
    return state.outcome === me ? WIN_SCORE + depth : -(WIN_SCORE + depth);
  }
  if (depth <= 0) return evaluate(state, me);

  const actions = orderActions(state, getLegalActions(state));
  const maximizing = currentFaction(state) === me;
  let best = maximizing ? -Infinity : Infinity;
  for (const action of actions) {
    const value = alphabeta(applyAction(state, action), depth - 1, alpha, beta, me, ctx);
    if (maximizing) {
      best = Math.max(best, value);
      alpha = Math.max(alpha, value);
    } else {
      best = Math.min(best, value);
      beta = Math.min(beta, value);
    }
    if (beta <= alpha) break;
  }
  return best;
}

function randomChoice<T>(items: T[], rng: () => number): T {
  return items[Math.floor(rng() * items.length)];
}

export function chooseBoardAction(
  state: BoardGameState,
  level: AiLevel,
  rng: () => number = Math.random,
): BoardAction {
  const actions = getLegalActions(state);
  if (actions.length === 0) {
    log.error('棋盘 AI 无法行棋：没有合法着法（本应已判困毙）', { current: state.current });
    throw new Error('没有合法着法');
  }
  if (actions.length === 1) {
    log.info('棋盘 AI 行棋', { 难度: level, 着法: describeAction(actions[0]), 说明: '唯一合法着法' });
    return actions[0];
  }

  const me = currentFaction(state);

  // 简单难度 / 阵营未定（开局第一翻）：随机，略偏好吃子
  if (level === 'easy' || me === null) {
    const captures = actions.filter((a) => a.type === 'move' && state.board[a.to] !== null);
    const picked =
      captures.length > 0 && rng() < 0.6 ? randomChoice(captures, rng) : randomChoice(actions, rng);
    log.info('棋盘 AI 行棋', {
      难度: level,
      着法: describeAction(picked),
      可选着法数: actions.length,
      说明: me === null ? '阵营未定，随机翻牌' : '简单难度随机',
    });
    return picked;
  }

  const started = Date.now();
  const { samples, timeMs, maxDepth } = CONFIGS[level as Exclude<AiLevel, 'easy'>];
  const ctx: SearchContext = { deadline: started + timeMs, nodes: 0 };

  // 固定一组确定化样本，保证不同深度的评分可比
  const determinized: BoardGameState[] = [];
  const rootStates: BoardGameState[][] = [];
  suppressLogs(() => {
    for (let s = 0; s < samples; s++) {
      const det = determinize(state, rng);
      determinized.push(det);
      rootStates.push(actions.map((a) => applyAction(det, a)));
    }
  });

  // 迭代加深：totals 保存最后一个完整搜完的深度的评分
  let totals = new Array<number>(actions.length).fill(0);
  let completedDepth = 0;
  let order = actions.map((_, i) => i);

  suppressLogs(() => {
    for (let depth = 1; depth <= maxDepth; depth++) {
      const layer = new Array<number>(actions.length).fill(0);
      try {
        for (let s = 0; s < samples; s++) {
          for (const i of order) {
            layer[i] += alphabeta(rootStates[s][i], depth - 1, -Infinity, Infinity, me, ctx);
          }
        }
      } catch (err) {
        if (err instanceof DeadlineExceeded) break;
        throw err;
      }
      totals = layer;
      completedDepth = depth;
      // 按上一深度评分从高到低排根着法，提升下一深度的剪枝效率
      order = [...order].sort((a, b) => layer[b] - layer[a]);
      if (Date.now() > ctx.deadline) break;
    }
  });

  // 若第 1 层都没搜完（极端情况），退化为单轮估值
  if (completedDepth === 0) {
    suppressLogs(() => {
      for (let i = 0; i < actions.length; i++) {
        for (let s = 0; s < samples; s++) {
          totals[i] += evaluate(rootStates[s][i], me);
        }
      }
    });
  }

  let bestIndices: number[] = [];
  let bestValue = -Infinity;
  for (let i = 0; i < actions.length; i++) {
    if (totals[i] > bestValue + 1e-9) {
      bestValue = totals[i];
      bestIndices = [i];
    } else if (Math.abs(totals[i] - bestValue) <= 1e-9) {
      bestIndices.push(i);
    }
  }
  const chosen = actions[randomChoice(bestIndices, rng)];
  log.info('棋盘 AI 行棋', {
    难度: level,
    着法: describeAction(chosen),
    可选着法数: actions.length,
    最优评分: (bestValue / samples).toFixed(2),
    并列最优数: bestIndices.length,
    完成深度: completedDepth,
    搜索节点: ctx.nodes,
    确定化样本: samples,
    耗时毫秒: Date.now() - started,
  });
  log.debug(
    '各候选着法评分',
    Object.fromEntries(actions.map((a, i) => [describeAction(a), (totals[i] / samples).toFixed(2)])),
  );
  return chosen;
}
