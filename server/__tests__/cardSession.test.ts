import { describe, expect, it } from 'vitest';
import type { SeatIndex, ServerMessage } from '../../src/online/protocol';
import { CardSession } from '../cardSession';

function makeCtx() {
  const sent: [ServerMessage[], ServerMessage[]] = [[], []];
  const overs: Array<SeatIndex | null> = [];
  const ctx = {
    send: (seat: SeatIndex, msg: ServerMessage) => sent[seat].push(msg),
    onOver: (winner: SeatIndex | null) => overs.push(winner),
  };
  return { ctx, sent, overs };
}

function lastCardView(msgs: ServerMessage[]) {
  const m = [...msgs].reverse().find((x) => x.type === 'cardState');
  if (!m || m.type !== 'cardState') throw new Error('没有 cardState 消息');
  return m.view;
}

describe('纸牌会话：提交-揭示', () => {
  it('先提交方不泄露牌面，对方只看到"已扣牌"', () => {
    const { ctx, sent } = makeCtx();
    const s = new CardSession(ctx, 0);
    s.start();

    expect(s.pick(0, 3)).toBeNull();
    const v1 = lastCardView(sent[1]);
    expect(v1.opponentCommitted).toBe(true);
    expect(v1.yourPick).toBeNull();
    expect(v1.history).toHaveLength(0); // 未揭示

    const v0 = lastCardView(sent[0]);
    expect(v0.yourPick).toBe(3);
    expect(v0.opponentCommitted).toBe(false);
  });

  it('双方都提交后同时揭示并结算', () => {
    const { ctx, sent } = makeCtx();
    const s = new CardSession(ctx, 0);
    s.start();
    s.pick(0, 3); // 座位 0 第 0 局执龙
    s.pick(1, 5); // 龙 3 吃 虎 5
    const v0 = lastCardView(sent[0]);
    const v1 = lastCardView(sent[1]);
    expect(v0.history).toHaveLength(1);
    expect(v0.history[0]).toMatchObject({ dragon: 3, tiger: 5, winner: 'dragon' });
    expect(v1.history).toHaveLength(1);
    expect(v0.yourPick).toBeNull(); // 新回合重置
    expect(v1.lost.tiger).toEqual([5]);
  });

  it('非法提交返回错误：不在手牌中 / 重复提交 / 对局已结束', () => {
    const { ctx } = makeCtx();
    const s = new CardSession(ctx, 0);
    s.start();
    s.pick(0, 4);
    s.pick(1, 4); // 同归于尽
    expect(s.pick(0, 4)).toBe('手牌中没有这张牌');
    expect(s.pick(0, 1)).toBeNull();
    expect(s.pick(0, 2)).toBe('本回合已出牌，等待对方');
  });

  it('阵营按局数互换：偶数局座位 0 执龙，奇数局执虎', () => {
    const { ctx } = makeCtx();
    expect(new CardSession(ctx, 0).factionOf(0)).toBe('dragon');
    expect(new CardSession(ctx, 1).factionOf(0)).toBe('tiger');
    expect(new CardSession(ctx, 2).factionOf(0)).toBe('dragon');
  });

  it('认输：对方获胜并回调正确的赢家座位', () => {
    const { ctx, sent, overs } = makeCtx();
    const s = new CardSession(ctx, 1); // 第 1 局：座位 0 执虎，座位 1 执龙
    s.start();
    expect(s.surrender(0)).toBeNull();
    expect(overs).toEqual([1]);
    const v0 = lastCardView(sent[0]);
    expect(v0.outcome).toBe('dragon'); // 虎方认输，龙方（座位 1）胜
    expect(v0.endReason).toBe('surrender');
  });

  it('离场判负：endReason 为 abandon', () => {
    const { ctx, sent, overs } = makeCtx();
    const s = new CardSession(ctx, 0);
    s.start();
    s.forceEnd(1);
    expect(overs).toEqual([0]);
    const v0 = lastCardView(sent[0]);
    expect(v0.outcome).toBe('dragon');
    expect(v0.endReason).toBe('abandon');
  });
});
