import { describe, expect, it } from 'vitest';
import { canCapture, duel } from '../rules';
import { RANKS } from '../types';

describe('克制关系引擎', () => {
  it('同号同归于尽', () => {
    for (const r of RANKS) {
      expect(duel(r, r)).toBe('both');
    }
  });

  it('8 号吃对方 1 号（单向克制）', () => {
    expect(duel(8, 1)).toBe('win');
    expect(duel(1, 8)).toBe('lose');
  });

  it('穷举 8x8：除特例外编号小的吃编号大的', () => {
    for (const mine of RANKS) {
      for (const theirs of RANKS) {
        const result = duel(mine, theirs);
        if (mine === theirs) {
          expect(result).toBe('both');
        } else if (mine === 8 && theirs === 1) {
          expect(result).toBe('win');
        } else if (mine === 1 && theirs === 8) {
          expect(result).toBe('lose');
        } else {
          expect(result).toBe(mine < theirs ? 'win' : 'lose');
        }
      }
    }
  });

  it('canCapture：吃与同尽均为合法吃子，被吃为非法', () => {
    expect(canCapture(1, 2)).toBe(true);
    expect(canCapture(3, 3)).toBe(true);
    expect(canCapture(8, 1)).toBe(true);
    expect(canCapture(1, 8)).toBe(false);
    expect(canCapture(5, 2)).toBe(false);
  });
});
