import { describe, expect, it } from 'vitest';
import type { SeatIndex, ServerMessage } from '../../src/online/protocol';
import { BoardSession } from '../boardSession';

function makeCtx() {
  const sent: [ServerMessage[], ServerMessage[]] = [[], []];
  const overs: Array<SeatIndex | null> = [];
  const ctx = {
    send: (seat: SeatIndex, msg: ServerMessage) => sent[seat].push(msg),
    onOver: (winner: SeatIndex | null) => overs.push(winner),
  };
  return { ctx, sent, overs };
}

function lastBoardView(msgs: ServerMessage[]) {
  const m = [...msgs].reverse().find((x) => x.type === 'boardState');
  if (!m || m.type !== 'boardState') throw new Error('没有 boardState 消息');
  return m.view;
}

describe('棋盘会话：净化视图与着法校验', () => {
  it('开局视图不泄露任何暗牌身份', () => {
    const { ctx, sent } = makeCtx();
    const s = new BoardSession(ctx, 0);
    s.start();
    for (const seat of [0, 1] as const) {
      const view = lastBoardView(sent[seat]);
      expect(view.board).toHaveLength(16);
      for (const cell of view.board) {
        expect(cell).not.toBeNull();
        expect(cell!.faceUp).toBe(false);
        expect(cell!.card).toBeNull(); // 关键：暗牌身份不下发
      }
    }
  });

  it('翻牌后该格牌面公开，其余仍隐藏；轮次校验生效', () => {
    const { ctx, sent } = makeCtx();
    const s = new BoardSession(ctx, 0); // 第 0 局座位 0 先手
    s.start();
    expect(s.action(1, { type: 'flip', index: 0 })).toBe('还没轮到你行棋');
    expect(s.action(0, { type: 'flip', index: 0 })).toBeNull();

    const view = lastBoardView(sent[1]);
    expect(view.board[0]!.faceUp).toBe(true);
    expect(view.board[0]!.card).not.toBeNull();
    expect(view.factions.first).not.toBeNull();
    expect(view.current).toBe('second');
    expect(view.lastAction).toEqual({ type: 'flip', index: 0 });
    const hiddenCells = view.board.filter((c) => c !== null && !c.faceUp);
    expect(hiddenCells.every((c) => c!.card === null)).toBe(true);
  });

  it('引擎拒绝的非法着法以错误文案返回', () => {
    const { ctx } = makeCtx();
    const s = new BoardSession(ctx, 0);
    s.start();
    s.action(0, { type: 'flip', index: 0 });
    // 座位 1 试图翻已翻开的格子
    expect(s.action(1, { type: 'flip', index: 0 })).toBeTruthy();
  });

  it('阵营未定时不能认输；确定后可认输', () => {
    const { ctx, overs } = makeCtx();
    const s = new BoardSession(ctx, 0);
    s.start();
    expect(s.surrender(0)).toBe('阵营尚未确定，无法认输');
    s.action(0, { type: 'flip', index: 0 });
    expect(s.surrender(1)).toBeNull();
    expect(overs).toEqual([0]);
  });

  it('掉线判负：endReason 为 abandon，赢家座位正确', () => {
    const { ctx, sent, overs } = makeCtx();
    const s = new BoardSession(ctx, 0);
    s.start();
    s.action(0, { type: 'flip', index: 3 });
    s.forceEnd(1);
    expect(overs).toEqual([0]);
    const v = lastBoardView(sent[0]);
    expect(v.endReason).toBe('abandon');
    expect(v.outcome).not.toBe('draw');
  });
});
