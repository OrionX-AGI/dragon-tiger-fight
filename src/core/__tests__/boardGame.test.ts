import { describe, expect, it } from 'vitest';
import type { BoardCell, BoardGameState } from '../boardGame';
import {
  QUIET_MOVES_FOR_DRAW,
  adjacentIndices,
  applyAction,
  createBoardGameFromCards,
  getLegalActions,
  surrenderBoard,
  violatesRepetition,
} from '../boardGame';
import type { Faction, Rank } from '../types';
import { allCards } from '../types';

function piece(faction: Faction, rank: Rank, faceUp = true): BoardCell {
  return { card: { faction, rank }, faceUp };
}

/** 手工构造对局中期状态（阵营已定，先手执龙） */
function makeState(board: BoardCell[], current: 'first' | 'second' = 'first'): BoardGameState {
  return {
    board,
    factions: { first: 'dragon', second: 'tiger' },
    current,
    captured: [],
    quietMoves: 0,
    repetition: { first: null, second: null },
    outcome: null,
    endReason: null,
  };
}

function emptyBoard(): BoardCell[] {
  return Array(16).fill(null);
}

describe('棋盘基础', () => {
  it('相邻格计算（仅上下左右）', () => {
    expect(adjacentIndices(0).sort((a, b) => a - b)).toEqual([1, 4]);
    expect(adjacentIndices(5).sort((a, b) => a - b)).toEqual([1, 4, 6, 9]);
    expect(adjacentIndices(15).sort((a, b) => a - b)).toEqual([11, 14]);
  });

  it('开局 16 张全暗牌，只能翻牌', () => {
    const s = createBoardGameFromCards(allCards());
    const actions = getLegalActions(s);
    expect(actions).toHaveLength(16);
    expect(actions.every((a) => a.type === 'flip')).toBe(true);
  });
});

describe('翻牌与阵营确定', () => {
  it('先手翻出什么阵营就执什么阵营，翻牌即结束回合', () => {
    const cards = allCards(); // 0~7 龙 1~8，8~15 虎 1~8
    let s = createBoardGameFromCards(cards);
    s = applyAction(s, { type: 'flip', index: 8 }); // 翻出虎 1
    expect(s.factions.first).toBe('tiger');
    expect(s.factions.second).toBe('dragon');
    expect(s.current).toBe('second');
    expect(s.board[8]!.faceUp).toBe(true);
  });

  it('已翻开的牌不能再翻', () => {
    let s = createBoardGameFromCards(allCards());
    s = applyAction(s, { type: 'flip', index: 0 });
    expect(() => applyAction(s, { type: 'flip', index: 0 })).toThrow();
  });
});

describe('移动与吃子', () => {
  it('只能移动到相邻空格，不能斜走或走多格', () => {
    const board = emptyBoard();
    board[5] = piece('dragon', 3);
    const s = makeState(board);
    const moves = getLegalActions(s).filter((a) => a.type === 'move');
    const targets = moves.map((m) => (m.type === 'move' ? m.to : -1)).sort((a, b) => a - b);
    expect(targets).toEqual([1, 4, 6, 9]);
    expect(() => applyAction(s, { type: 'move', from: 5, to: 0 })).toThrow(); // 斜走
    expect(() => applyAction(s, { type: 'move', from: 5, to: 7 })).toThrow(); // 两格
  });

  it('小号吃大号，吃后占据目标格', () => {
    const board = emptyBoard();
    board[0] = piece('dragon', 2);
    board[1] = piece('tiger', 6);
    board[15] = piece('tiger', 7); // 防止吃光直接结束
    let s = makeState(board);
    s = applyAction(s, { type: 'move', from: 0, to: 1 });
    expect(s.board[0]).toBeNull();
    expect(s.board[1]!.card).toEqual({ faction: 'dragon', rank: 2 });
    expect(s.captured).toContainEqual({ faction: 'tiger', rank: 6 });
  });

  it('1 号不能吃对方 8 号，8 号能吃对方 1 号', () => {
    const board = emptyBoard();
    board[0] = piece('dragon', 1);
    board[1] = piece('tiger', 8);
    board[4] = piece('dragon', 8);
    board[8] = piece('tiger', 1);
    const s = makeState(board);
    expect(() => applyAction(s, { type: 'move', from: 0, to: 1 })).toThrow(); // 1 吃 8 非法
    const s2 = applyAction(s, { type: 'move', from: 4, to: 8 }); // 8 吃 1 合法
    expect(s2.board[8]!.card).toEqual({ faction: 'dragon', rank: 8 });
  });

  it('同号对拼双方移除，格子变空', () => {
    const board = emptyBoard();
    board[0] = piece('dragon', 4);
    board[1] = piece('tiger', 4);
    board[15] = piece('tiger', 7);
    board[12] = piece('dragon', 7); // 双方都留有余子，不触发全灭
    let s = makeState(board);
    s = applyAction(s, { type: 'move', from: 0, to: 1 });
    expect(s.board[0]).toBeNull();
    expect(s.board[1]).toBeNull();
    expect(s.captured).toHaveLength(2);
    expect(s.outcome).toBeNull();
  });

  it('暗牌不可被吃，也不可移动', () => {
    const board = emptyBoard();
    board[0] = piece('dragon', 2);
    board[1] = piece('tiger', 6, false); // 暗牌
    const s = makeState(board);
    expect(() => applyAction(s, { type: 'move', from: 0, to: 1 })).toThrow();
    expect(() => applyAction(s, { type: 'move', from: 1, to: 2 })).toThrow();
  });
});

describe('禁循环规则', () => {
  it('同一棋子连续第 3 次往返为非法着法', () => {
    const board = emptyBoard();
    board[0] = piece('dragon', 1);
    board[15] = piece('tiger', 2);
    // 其余格放暗牌，避免和局/困毙干扰（不翻动它们）
    board[10] = piece('tiger', 5, false);
    board[6] = piece('dragon', 5, false);
    let s = makeState(board);

    const dragonMoves: Array<[number, number]> = [
      [0, 1], [1, 0], [0, 1], [1, 0], [0, 1],
    ];
    const tigerMoves: Array<[number, number]> = [
      [15, 14], [14, 15], [15, 14], [14, 15], [15, 14],
    ];
    for (let i = 0; i < 5; i++) {
      s = applyAction(s, { type: 'move', from: dragonMoves[i][0], to: dragonMoves[i][1] });
      s = applyAction(s, { type: 'move', from: tigerMoves[i][0], to: tigerMoves[i][1] });
    }
    // 龙方已连续 5 步在 0/1 间移动，第 6 步（完成第 3 次往返）非法
    expect(violatesRepetition(s, 1, 0)).toBe(true);
    const moves = getLegalActions(s).filter((a) => a.type === 'move' && a.from === 1 && a.to === 0);
    expect(moves).toHaveLength(0);
    expect(() => applyAction(s, { type: 'move', from: 1, to: 0 })).toThrow();
    // 改走其他格是合法的
    expect(() => applyAction(s, { type: 'move', from: 1, to: 2 })).not.toThrow();
  });

  it('翻牌或吃子后计数器重置', () => {
    const board = emptyBoard();
    board[0] = piece('dragon', 1);
    board[15] = piece('tiger', 2);
    board[10] = piece('tiger', 5, false);
    let s = makeState(board);
    s = applyAction(s, { type: 'move', from: 0, to: 1 });
    s = applyAction(s, { type: 'move', from: 15, to: 14 });
    s = applyAction(s, { type: 'flip', index: 10 }); // 龙方翻牌，重置自己的计数
    expect(s.repetition.first).toBeNull();
  });
});

describe('胜负判定', () => {
  it('吃光对方全部子力获胜', () => {
    const board = emptyBoard();
    board[0] = piece('dragon', 2);
    board[1] = piece('tiger', 6);
    let s = makeState(board);
    s = applyAction(s, { type: 'move', from: 0, to: 1 });
    expect(s.outcome).toBe('dragon');
    expect(s.endReason).toBe('wipeout');
  });

  it('末子同号对拼同时全灭判和', () => {
    const board = emptyBoard();
    board[0] = piece('dragon', 4);
    board[1] = piece('tiger', 4);
    let s = makeState(board);
    s = applyAction(s, { type: 'move', from: 0, to: 1 });
    expect(s.outcome).toBe('draw');
    expect(s.endReason).toBe('mutualWipeout');
  });

  it('困毙：轮到行动却无任何合法着法判负', () => {
    const board = emptyBoard();
    board[0] = piece('dragon', 8);
    board[1] = piece('tiger', 2);
    board[5] = piece('tiger', 3);
    // 虎 3 从 5 走到 4，堵死龙 8（0 的相邻格 1、4 均为吃不动的虎牌），龙无翻无走
    let s = makeState(board, 'second');
    s = applyAction(s, { type: 'move', from: 5, to: 4 });
    expect(s.outcome).toBe('tiger');
    expect(s.endReason).toBe('stalemate');
  });

  it(`连续 ${QUIET_MOVES_FOR_DRAW} 步无翻牌无吃子判和`, () => {
    const board = emptyBoard();
    board[0] = piece('dragon', 1);
    board[15] = piece('tiger', 2);
    let s = makeState(board);
    // 双方沿各自底边来回走动（路径设计避开禁循环限制）
    const dragonPath: Array<[number, number]> = [
      [0, 1], [1, 2], [2, 3], [3, 2], [2, 1], [1, 0], [0, 1], [1, 2], [2, 3], [3, 2],
    ];
    const tigerPath: Array<[number, number]> = [
      [15, 14], [14, 13], [13, 12], [12, 13], [13, 14], [14, 15], [15, 14], [14, 13], [13, 12], [12, 13],
    ];
    for (let i = 0; i < QUIET_MOVES_FOR_DRAW / 2; i++) {
      s = applyAction(s, { type: 'move', from: dragonPath[i][0], to: dragonPath[i][1] });
      if (s.outcome !== null) break;
      s = applyAction(s, { type: 'move', from: tigerPath[i][0], to: tigerPath[i][1] });
      if (s.outcome !== null) break;
    }
    expect(s.outcome).toBe('draw');
    expect(s.quietMoves).toBe(QUIET_MOVES_FOR_DRAW);
    expect(s.endReason).toBe('quietDraw');
  });
});

describe('认输', () => {
  it('认输后对方获胜，结束原因为 surrender', () => {
    const board = emptyBoard();
    board[0] = piece('dragon', 2);
    board[15] = piece('tiger', 6);
    const s = makeState(board);
    const next = surrenderBoard(s, 'dragon');
    expect(next.outcome).toBe('tiger');
    expect(next.endReason).toBe('surrender');
    expect(getLegalActions(next)).toHaveLength(0);
  });

  it('阵营未确定时不能认输，对局结束后不能认输', () => {
    const fresh = createBoardGameFromCards(allCards());
    expect(() => surrenderBoard(fresh, 'dragon')).toThrow();
    const board = emptyBoard();
    board[0] = piece('dragon', 2);
    board[15] = piece('tiger', 6);
    const ended = surrenderBoard(makeState(board), 'tiger');
    expect(() => surrenderBoard(ended, 'dragon')).toThrow();
  });
});
