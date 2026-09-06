import { describe, expect, it } from 'vitest';
import { createCardGame, playRound, surrender } from '../cardGame';

describe('纸牌对拼状态机', () => {
  it('开局双方各持 1~8 共 8 张', () => {
    const s = createCardGame();
    expect(s.hands.dragon).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(s.hands.tiger).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(s.outcome).toBeNull();
  });

  it('输方牌移除，赢方牌收回手中', () => {
    let s = createCardGame();
    s = playRound(s, 2, 5); // 龙 2 吃 虎 5
    expect(s.hands.dragon).toContain(2);
    expect(s.hands.tiger).not.toContain(5);
    expect(s.lost.tiger).toEqual([5]);
    expect(s.lost.dragon).toEqual([]);
    expect(s.history[0].winner).toBe('dragon');
  });

  it('同号对拼双方牌都移除', () => {
    let s = createCardGame();
    s = playRound(s, 4, 4);
    expect(s.hands.dragon).not.toContain(4);
    expect(s.hands.tiger).not.toContain(4);
    expect(s.history[0].winner).toBe('both');
  });

  it('8 吃对方 1，1 不能吃 8', () => {
    let s = createCardGame();
    s = playRound(s, 8, 1); // 龙 8 吃 虎 1
    expect(s.hands.dragon).toContain(8);
    expect(s.hands.tiger).not.toContain(1);
    s = playRound(s, 1, 8); // 虎 8 吃 龙 1
    expect(s.hands.dragon).not.toContain(1);
    expect(s.hands.tiger).toContain(8);
  });

  it('一方打空手牌则对方获胜', () => {
    let s = createCardGame();
    // 虎方每轮出小编号吃掉龙方大编号：虎 1 依次吃龙 2~7
    for (const dragonCard of [2, 3, 4, 5, 6, 7] as const) {
      s = playRound(s, dragonCard, 1);
    }
    // 龙方只剩 1、8。虎 2 吃 龙 8，龙只剩 1
    s = playRound(s, 8, 2);
    expect(s.hands.dragon).toEqual([1]);
    // 虎 8 吃 龙 1，龙方打空
    s = playRound(s, 1, 8);
    expect(s.hands.dragon).toEqual([]);
    expect(s.outcome).toBe('tiger');
    expect(s.endReason).toBe('handEmpty');
  });

  it('末轮同号对拼双方同时打空判和', () => {
    let s = createCardGame();
    // 双方每轮出同号牌，全部同归于尽
    for (const r of [1, 2, 3, 4, 5, 6, 7, 8] as const) {
      s = playRound(s, r, r);
    }
    expect(s.hands.dragon).toEqual([]);
    expect(s.hands.tiger).toEqual([]);
    expect(s.outcome).toBe('draw');
    expect(s.endReason).toBe('bothEmpty');
  });

  it('认输后对方获胜，结束原因为 surrender', () => {
    let s = createCardGame();
    s = playRound(s, 3, 5);
    const next = surrender(s, 'tiger');
    expect(next.outcome).toBe('dragon');
    expect(next.endReason).toBe('surrender');
    expect(() => playRound(next, 1, 1)).toThrow();
    expect(() => surrender(next, 'dragon')).toThrow();
  });

  it('出不在手牌中的牌抛错', () => {
    let s = createCardGame();
    s = playRound(s, 3, 3);
    expect(() => playRound(s, 3, 1)).toThrow();
    expect(() => playRound(s, 1, 3)).toThrow();
  });

  it('对局结束后不能继续出牌', () => {
    let s = createCardGame();
    for (const r of [1, 2, 3, 4, 5, 6, 7, 8] as const) {
      s = playRound(s, r, r);
    }
    expect(() => playRound(s, 1, 1)).toThrow();
  });
});
