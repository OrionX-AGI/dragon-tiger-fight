import type { DuelResult, Rank } from './types';

/**
 * 克制关系引擎（两种玩法通用）。
 *
 * 1. 编号小的吃编号大的（1 吃 2~7，2 吃 3~8，……7 吃 8）。
 * 2. 特例一：8 号能吃对方 1 号且只能吃 1 号；1 号不能吃对方 8 号（单向克制）。
 * 3. 特例二：同编号相遇，同归于尽。
 */
export function duel(mine: Rank, theirs: Rank): DuelResult {
  if (mine === theirs) return 'both';
  if (mine === 8 && theirs === 1) return 'win';
  if (mine === 1 && theirs === 8) return 'lose';
  return mine < theirs ? 'win' : 'lose';
}

/** 我方 attacker 是否可以主动吃掉（或对拼）对方 defender：棋盘玩法的吃子合法性 */
export function canCapture(attacker: Rank, defender: Rank): boolean {
  return duel(attacker, defender) !== 'lose';
}
