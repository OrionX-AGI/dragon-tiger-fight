/**
 * 棋盘对局会话（服务器权威）。
 * 完整状态只存在于服务器；发给客户端的净化视图不含未翻开格子的牌面身份。
 */
import type { BoardAction, BoardGameState, PlayerSlot } from '../src/core/boardGame';
import { createBoardGame, applyAction, surrenderBoard } from '../src/core/boardGame';
import type { Faction } from '../src/core/types';
import { otherFaction } from '../src/core/types';
import type { BoardGameView, SeatIndex } from '../src/online/protocol';
import type { SessionCtx } from './cardSession';
import { otherSeat } from './cardSession';

export class BoardSession {
  private state: BoardGameState = createBoardGame();
  private lastAction: BoardAction | null = null;

  constructor(
    private readonly ctx: SessionCtx,
    private readonly gameIndex: number,
  ) {}

  /** 座位对应的席位：0 号座位偶数局先手，每局互换 */
  slotOf(seat: SeatIndex): PlayerSlot {
    const seatZeroFirst = this.gameIndex % 2 === 0;
    return (seat === 0) === seatZeroFirst ? 'first' : 'second';
  }

  seatOfSlot(slot: PlayerSlot): SeatIndex {
    return this.slotOf(0) === slot ? 0 : 1;
  }

  get outcome(): Faction | 'draw' | null {
    return this.state.outcome;
  }

  start(): void {
    this.pushViews();
  }

  viewFor(seat: SeatIndex): BoardGameView {
    return {
      gameIndex: this.gameIndex,
      yourSlot: this.slotOf(seat),
      board: this.state.board.map((cell) =>
        cell === null ? null : { faceUp: cell.faceUp, card: cell.faceUp ? cell.card : null },
      ),
      factions: { ...this.state.factions },
      current: this.state.current,
      captured: [...this.state.captured],
      quietMoves: this.state.quietMoves,
      repetition: {
        first: this.state.repetition.first ? { ...this.state.repetition.first } : null,
        second: this.state.repetition.second ? { ...this.state.repetition.second } : null,
      },
      outcome: this.state.outcome,
      endReason: this.state.endReason,
      lastAction: this.lastAction,
    };
  }

  pushViews(): void {
    this.ctx.send(0, { type: 'boardState', view: this.viewFor(0) });
    this.ctx.send(1, { type: 'boardState', view: this.viewFor(1) });
  }

  /** 执行着法。返回错误文案（null 表示成功） */
  action(seat: SeatIndex, action: BoardAction): string | null {
    if (this.state.outcome !== null) return '对局已结束';
    if (this.state.current !== this.slotOf(seat)) return '还没轮到你行棋';
    try {
      this.state = applyAction(this.state, action);
    } catch (err) {
      return err instanceof Error ? err.message : '着法不合法';
    }
    this.lastAction = action;
    this.pushViews();
    this.checkOver();
    return null;
  }

  /** 认输（阵营尚未确定时引擎会拒绝） */
  surrender(seat: SeatIndex): string | null {
    if (this.state.outcome !== null) return '对局已结束';
    const faction = this.state.factions[this.slotOf(seat)];
    if (faction === null) return '阵营尚未确定，无法认输';
    this.state = surrenderBoard(this.state, faction);
    this.pushViews();
    this.checkOver();
    return null;
  }

  /** 一方离场或掉线超时，直接判对方胜 */
  forceEnd(loserSeat: SeatIndex): void {
    if (this.state.outcome !== null) return;
    const winnerSeat = otherSeat(loserSeat);
    const loserFaction = this.state.factions[this.slotOf(loserSeat)];
    // 阵营未定即离场时按先手=龙兜底一个名义阵营，仅用于结果展示
    const winnerFaction =
      loserFaction !== null
        ? otherFaction(loserFaction)
        : this.slotOf(winnerSeat) === 'first'
          ? 'dragon'
          : 'tiger';
    this.state = { ...this.state, outcome: winnerFaction, endReason: 'abandon' };
    this.pushViews();
    this.ctx.onOver(winnerSeat);
  }

  private checkOver(): void {
    if (this.state.outcome === null) return;
    if (this.state.outcome === 'draw') {
      this.ctx.onOver(null);
      return;
    }
    const winnerSlot: PlayerSlot = this.state.factions.first === this.state.outcome ? 'first' : 'second';
    this.ctx.onOver(this.seatOfSlot(winnerSlot));
  }
}
