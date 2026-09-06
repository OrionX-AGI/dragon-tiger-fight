/**
 * 把净化后的棋盘视图还原成引擎可用的"伪状态"，供客户端本地计算
 * 合法着法提示（高亮可走格）。未翻开格子的牌面身份客户端并不知道，
 * 用占位牌填充——引擎的合法着法计算不依赖暗牌身份：
 * 翻牌对任意暗牌都合法，走子/吃子只涉及双方明牌。
 */
import type { BoardGameState } from '../core/boardGame';
import type { Card } from '../core/types';
import type { BoardGameView } from './protocol';

const PLACEHOLDER_CARD: Card = { faction: 'dragon', rank: 1 };

export function pseudoBoardState(view: BoardGameView): BoardGameState {
  return {
    board: view.board.map((cell) =>
      cell === null ? null : { faceUp: cell.faceUp, card: cell.card ?? PLACEHOLDER_CARD },
    ),
    factions: { ...view.factions },
    current: view.current,
    captured: [...view.captured],
    quietMoves: view.quietMoves,
    repetition: {
      first: view.repetition.first ? { ...view.repetition.first } : null,
      second: view.repetition.second ? { ...view.repetition.second } : null,
    },
    outcome: view.outcome,
    endReason: view.endReason,
  };
}
