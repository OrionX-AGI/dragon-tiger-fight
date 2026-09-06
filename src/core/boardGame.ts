import { createLogger } from './logger';
import { canCapture, duel } from './rules';
import type { Card, Faction } from './types';
import { allCards, cardKey, otherFaction } from './types';

const log = createLogger('engine');

export const BOARD_SIZE = 4;
export const CELL_COUNT = BOARD_SIZE * BOARD_SIZE;

export interface CellPiece {
  card: Card;
  faceUp: boolean;
}

/** 棋盘格：null 表示空格 */
export type BoardCell = CellPiece | null;

/** 对局中的玩家席位：先手/后手。阵营在第一次翻牌后才确定 */
export type PlayerSlot = 'first' | 'second';

export type BoardAction =
  | { type: 'flip'; index: number }
  | { type: 'move'; from: number; to: number };

/** 对局结束原因：全灭 / 双方同时全灭 / 困毙 / 安静步判和 / 认输 / 离场或掉线判负（在线对战） */
export type BoardEndReason =
  | 'wipeout'
  | 'mutualWipeout'
  | 'stalemate'
  | 'quietDraw'
  | 'surrender'
  | 'abandon';

/**
 * 禁循环计数器：记录某玩家连续用同一棋子在同一对格子间移动的次数。
 * 一次"往返"包含 2 步；连续第 3 次往返（即第 6 步）为非法着法。
 */
export interface RepetitionTracker {
  cardKey: string;
  cells: [number, number];
  count: number;
}

export interface BoardGameState {
  board: BoardCell[];
  factions: Record<PlayerSlot, Faction | null>;
  current: PlayerSlot;
  /** 已被吃掉移出棋盘的牌 */
  captured: Card[];
  /** 双方合计连续未翻牌未吃子的回合数（达到 16 判和） */
  quietMoves: number;
  repetition: Record<PlayerSlot, RepetitionTracker | null>;
  /** 胜负：赢家阵营 / 'draw' 和局 / null 对局进行中 */
  outcome: Faction | 'draw' | null;
  endReason: BoardEndReason | null;
}

/**
 * 和局所需的连续安静回合数（双方合计，无翻牌且无吃子）。
 * 经验参数：最初取 16（等于棋子总数），实测在残局博弈阶段过早强制和棋，调整为 20。
 */
export const QUIET_MOVES_FOR_DRAW = 20;
/** 同一模式连续移动达到该步数后，下一步继续该模式即非法（3 次往返 = 6 步） */
const REPETITION_LIMIT = 5;

export function otherSlot(slot: PlayerSlot): PlayerSlot {
  return slot === 'first' ? 'second' : 'first';
}

export function currentFaction(state: BoardGameState): Faction | null {
  return state.factions[state.current];
}

/** 上下左右相邻格索引 */
export function adjacentIndices(index: number): number[] {
  const row = Math.floor(index / BOARD_SIZE);
  const col = index % BOARD_SIZE;
  const result: number[] = [];
  if (row > 0) result.push(index - BOARD_SIZE);
  if (row < BOARD_SIZE - 1) result.push(index + BOARD_SIZE);
  if (col > 0) result.push(index - 1);
  if (col < BOARD_SIZE - 1) result.push(index + 1);
  return result;
}

/** 用给定的牌序创建对局（供测试与复盘使用），cards[i] 放在第 i 格 */
export function createBoardGameFromCards(cards: Card[]): BoardGameState {
  if (cards.length !== CELL_COUNT) {
    throw new Error(`需要 ${CELL_COUNT} 张牌，实际 ${cards.length} 张`);
  }
  return {
    board: cards.map((card) => ({ card, faceUp: false })),
    factions: { first: null, second: null },
    current: 'first',
    captured: [],
    quietMoves: 0,
    repetition: { first: null, second: null },
    outcome: null,
    endReason: null,
  };
}

/** 洗乱全套 16 张牌开新局 */
export function createBoardGame(rng: () => number = Math.random): BoardGameState {
  const cards = allCards();
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  log.info('棋盘新局开始，16 张牌已洗乱暗置');
  // 布局属于暗牌信息，仅 debug 级别输出，便于复盘时重现同一局
  log.debug('本局布局', cards.map((c, i) => `${i}:${c.faction}${c.rank}`).join(' '));
  return createBoardGameFromCards(cards);
}

function normPair(a: number, b: number): [number, number] {
  return a < b ? [a, b] : [b, a];
}

function matchesPattern(tracker: RepetitionTracker, piece: CellPiece, from: number, to: number): boolean {
  if (tracker.cardKey !== cardKey(piece.card)) return false;
  const [a, b] = normPair(from, to);
  return a === tracker.cells[0] && b === tracker.cells[1];
}

/** 该步普通移动是否会构成第 3 次往返（非法） */
export function violatesRepetition(state: BoardGameState, from: number, to: number): boolean {
  const tracker = state.repetition[state.current];
  const piece = state.board[from];
  if (!tracker || !piece) return false;
  return matchesPattern(tracker, piece, from, to) && tracker.count >= REPETITION_LIMIT;
}

/** 当前玩家所有合法着法（对局结束时为空） */
export function getLegalActions(state: BoardGameState): BoardAction[] {
  if (state.outcome !== null) return [];

  const actions: BoardAction[] = [];
  for (let i = 0; i < CELL_COUNT; i++) {
    const cell = state.board[i];
    if (cell && !cell.faceUp) {
      actions.push({ type: 'flip', index: i });
    }
  }

  const faction = currentFaction(state);
  if (faction !== null) {
    for (let from = 0; from < CELL_COUNT; from++) {
      const cell = state.board[from];
      if (!cell || !cell.faceUp || cell.card.faction !== faction) continue;
      for (const to of adjacentIndices(from)) {
        const target = state.board[to];
        if (target === null) {
          if (!violatesRepetition(state, from, to)) {
            actions.push({ type: 'move', from, to });
          }
        } else if (target.faceUp && target.card.faction !== faction) {
          if (canCapture(cell.card.rank, target.card.rank)) {
            actions.push({ type: 'move', from, to });
          }
        }
      }
    }
  }
  return actions;
}

function cloneState(state: BoardGameState): BoardGameState {
  return {
    board: state.board.map((cell) => (cell ? { card: cell.card, faceUp: cell.faceUp } : null)),
    factions: { ...state.factions },
    current: state.current,
    captured: [...state.captured],
    quietMoves: state.quietMoves,
    repetition: {
      first: state.repetition.first ? { ...state.repetition.first } : null,
      second: state.repetition.second ? { ...state.repetition.second } : null,
    },
    outcome: state.outcome,
    endReason: state.endReason,
  };
}

/**
 * 认输：faction 一方投降，对方直接获胜。
 * 阵营尚未确定（未翻过任何牌）时不允许认输。
 */
export function surrenderBoard(state: BoardGameState, faction: Faction): BoardGameState {
  if (state.outcome !== null) {
    log.warn('拒绝认输：对局已结束', { outcome: state.outcome });
    throw new Error('对局已结束');
  }
  if (state.factions.first === null) {
    log.warn('拒绝认输：阵营尚未确定');
    throw new Error('阵营尚未确定，无法认输');
  }
  log.info('棋盘对局认输', { 认输方: faction });
  const next = cloneState(state);
  next.outcome = otherFaction(faction);
  next.endReason = 'surrender';
  return next;
}

/**
 * 执行一个着法，返回新状态（原状态不被修改）。
 * 非法着法抛出错误（界面层应先用 getLegalActions 过滤，这里是最终防线）。
 */
export function applyAction(state: BoardGameState, action: BoardAction): BoardGameState {
  if (state.outcome !== null) {
    log.warn('拒绝着法：对局已结束', { action, outcome: state.outcome });
    throw new Error('对局已结束');
  }

  const next = cloneState(state);
  const mover = next.current;

  if (action.type === 'flip') {
    const cell = next.board[action.index];
    if (!cell || cell.faceUp) {
      log.warn('拒绝翻牌：该格没有可翻开的暗牌', { index: action.index });
      throw new Error('该格没有可翻开的暗牌');
    }
    cell.faceUp = true;
    log.info(`${mover === 'first' ? '先手' : '后手'}翻牌`, {
      格: action.index,
      翻出: `${cell.card.faction}${cell.card.rank}`,
    });
    if (next.factions.first === null) {
      next.factions[mover] = cell.card.faction;
      next.factions[otherSlot(mover)] = otherFaction(cell.card.faction);
      log.info('阵营已确定', { 先手: next.factions.first, 后手: next.factions.second });
    }
    next.quietMoves = 0;
    next.repetition[mover] = null;
  } else {
    const faction = next.factions[mover];
    if (faction === null) {
      log.warn('拒绝移动：阵营尚未确定，本回合只能翻牌', { action });
      throw new Error('阵营尚未确定，只能翻牌');
    }
    const piece = next.board[action.from];
    if (!piece || !piece.faceUp || piece.card.faction !== faction) {
      log.warn('拒绝移动：出发格没有己方明牌', { from: action.from, faction });
      throw new Error('出发格没有己方明牌');
    }
    if (!adjacentIndices(action.from).includes(action.to)) {
      log.warn('拒绝移动：目标格不相邻', { from: action.from, to: action.to });
      throw new Error('只能移动到上下左右相邻的一格');
    }
    const target = next.board[action.to];
    if (target === null) {
      if (violatesRepetition(next, action.from, action.to)) {
        log.warn('拒绝移动：触发禁循环规则（第 3 次往返）', {
          棋子: cardKey(piece.card),
          两格: normPair(action.from, action.to),
          已连续步数: next.repetition[mover]?.count,
        });
        throw new Error('禁止循环：不得连续第 3 次在相同两格间往返，请改走其他着法');
      }
      const tracker = next.repetition[mover];
      next.repetition[mover] =
        tracker && matchesPattern(tracker, piece, action.from, action.to)
          ? { ...tracker, count: tracker.count + 1 }
          : { cardKey: cardKey(piece.card), cells: normPair(action.from, action.to), count: 1 };
      next.board[action.to] = piece;
      next.board[action.from] = null;
      next.quietMoves += 1;
      log.info(`${mover === 'first' ? '先手' : '后手'}移动`, {
        棋子: `${piece.card.faction}${piece.card.rank}`,
        从: action.from,
        到: action.to,
        连续安静步数: next.quietMoves,
        往返计数: next.repetition[mover]?.count,
      });
    } else {
      if (!target.faceUp) {
        log.warn('拒绝吃子：暗牌不可被吃', { to: action.to });
        throw new Error('暗牌不可被吃');
      }
      if (target.card.faction === faction) {
        log.warn('拒绝吃子：不能吃己方的牌', { to: action.to });
        throw new Error('不能吃己方的牌');
      }
      const result = duel(piece.card.rank, target.card.rank);
      if (result === 'lose') {
        log.warn('拒绝吃子：克制关系不允许', {
          攻: `${piece.card.faction}${piece.card.rank}`,
          守: `${target.card.faction}${target.card.rank}`,
        });
        throw new Error('克制关系不允许：该牌吃不动目标');
      }
      next.captured.push(target.card);
      if (result === 'win') {
        next.board[action.to] = piece;
      } else {
        // 同号对拼，双方移除
        next.captured.push(piece.card);
        next.board[action.to] = null;
      }
      log.info(`${mover === 'first' ? '先手' : '后手'}${result === 'win' ? '吃子' : '同号对拼'}`, {
        攻: `${piece.card.faction}${piece.card.rank}`,
        守: `${target.card.faction}${target.card.rank}`,
        从: action.from,
        到: action.to,
      });
      next.board[action.from] = null;
      next.quietMoves = 0;
      next.repetition[mover] = null;
    }
  }

  // 胜负判定：子力全灭 / 和局
  const remaining: Record<Faction, number> = { dragon: 0, tiger: 0 };
  for (const cell of next.board) {
    if (cell) remaining[cell.card.faction] += 1;
  }
  if (remaining.dragon === 0 && remaining.tiger === 0) {
    next.outcome = 'draw';
    next.endReason = 'mutualWipeout';
  } else if (remaining.dragon === 0) {
    next.outcome = 'tiger';
    next.endReason = 'wipeout';
  } else if (remaining.tiger === 0) {
    next.outcome = 'dragon';
    next.endReason = 'wipeout';
  } else if (next.quietMoves >= QUIET_MOVES_FOR_DRAW) {
    next.outcome = 'draw';
    next.endReason = 'quietDraw';
    log.info(`连续 ${QUIET_MOVES_FOR_DRAW} 步无翻牌无吃子，判和`);
  }

  // 轮到对方；若对方无任何合法着法则困毙判负
  next.current = otherSlot(mover);
  if (next.outcome === null && getLegalActions(next).length === 0) {
    next.outcome = next.factions[mover];
    next.endReason = 'stalemate';
    log.info('对方无任何合法着法，困毙判负', { 负方: next.factions[next.current] });
  }
  if (next.outcome !== null) {
    log.info('棋盘对局结束', { 结果: next.outcome, 场上剩余: remaining });
  }
  return next;
}
