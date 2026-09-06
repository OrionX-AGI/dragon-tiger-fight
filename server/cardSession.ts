/**
 * 纸牌对局会话（服务器权威）。
 * 核心是提交-揭示：双方各自暗提交本回合出牌，收齐前不向对方泄露，
 * 收齐后用引擎结算并同时揭示。
 */
import { createCardGame, playRound, surrender } from '../src/core/cardGame';
import type { CardGameState } from '../src/core/cardGame';
import type { Faction, Rank } from '../src/core/types';
import { otherFaction } from '../src/core/types';
import type { CardGameView, SeatIndex, ServerMessage } from '../src/online/protocol';

export interface SessionCtx {
  send(seat: SeatIndex, msg: ServerMessage): void;
  /** 对局结束回调：winnerSeat 为 null 表示和局 */
  onOver(winnerSeat: SeatIndex | null): void;
}

export function otherSeat(seat: SeatIndex): SeatIndex {
  return seat === 0 ? 1 : 0;
}

export class CardSession {
  private state: CardGameState = createCardGame();
  private picks: [Rank | null, Rank | null] = [null, null];

  constructor(
    private readonly ctx: SessionCtx,
    private readonly gameIndex: number,
  ) {}

  /** 座位对应的阵营：0 号座位偶数局执龙，每局互换 */
  factionOf(seat: SeatIndex): Faction {
    const seatZeroDragon = this.gameIndex % 2 === 0;
    return (seat === 0) === seatZeroDragon ? 'dragon' : 'tiger';
  }

  seatOfFaction(faction: Faction): SeatIndex {
    return this.factionOf(0) === faction ? 0 : 1;
  }

  get outcome(): Faction | 'draw' | null {
    return this.state.outcome;
  }

  start(): void {
    this.pushViews();
  }

  viewFor(seat: SeatIndex): CardGameView {
    return {
      gameIndex: this.gameIndex,
      yourFaction: this.factionOf(seat),
      hands: { dragon: [...this.state.hands.dragon], tiger: [...this.state.hands.tiger] },
      lost: { dragon: [...this.state.lost.dragon], tiger: [...this.state.lost.tiger] },
      history: [...this.state.history],
      outcome: this.state.outcome,
      endReason: this.state.endReason,
      yourPick: this.picks[seat],
      opponentCommitted: this.picks[otherSeat(seat)] !== null,
    };
  }

  pushViews(): void {
    this.ctx.send(0, { type: 'cardState', view: this.viewFor(0) });
    this.ctx.send(1, { type: 'cardState', view: this.viewFor(1) });
  }

  /** 提交本回合出牌。返回错误文案（null 表示成功） */
  pick(seat: SeatIndex, rank: Rank): string | null {
    if (this.state.outcome !== null) return '对局已结束';
    if (this.picks[seat] !== null) return '本回合已出牌，等待对方';
    const faction = this.factionOf(seat);
    if (!this.state.hands[faction].includes(rank)) return '手牌中没有这张牌';

    this.picks[seat] = rank;
    if (this.picks[0] !== null && this.picks[1] !== null) {
      const dragonSeat = this.seatOfFaction('dragon');
      const dragonCard = this.picks[dragonSeat]!;
      const tigerCard = this.picks[otherSeat(dragonSeat)]!;
      this.state = playRound(this.state, dragonCard, tigerCard);
      this.picks = [null, null];
      this.pushViews();
      this.checkOver();
    } else {
      this.pushViews();
    }
    return null;
  }

  /** 认输 */
  surrender(seat: SeatIndex): string | null {
    if (this.state.outcome !== null) return '对局已结束';
    this.state = surrender(this.state, this.factionOf(seat));
    this.picks = [null, null];
    this.pushViews();
    this.checkOver();
    return null;
  }

  /** 一方离场或掉线超时，直接判对方胜 */
  forceEnd(loserSeat: SeatIndex): void {
    if (this.state.outcome !== null) return;
    this.state = {
      ...this.state,
      outcome: otherFaction(this.factionOf(loserSeat)),
      endReason: 'abandon',
    };
    this.picks = [null, null];
    this.pushViews();
    this.checkOver();
  }

  private checkOver(): void {
    if (this.state.outcome === null) return;
    const winnerSeat = this.state.outcome === 'draw' ? null : this.seatOfFaction(this.state.outcome);
    this.ctx.onOver(winnerSeat);
  }
}
