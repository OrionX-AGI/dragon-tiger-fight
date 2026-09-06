import { describe, expect, it } from 'vitest';
import type { Rank } from '../../core/types';
import {
  computeValueTable,
  getValueTable,
  maskFromRanks,
  optimalStrategy,
  ranksFromMask,
  solveMatrixGame,
  stateValue,
} from '../cardSolver';

const TOL = 1e-6;

describe('掩码工具', () => {
  it('掩码与牌号列表互转', () => {
    expect(maskFromRanks([1, 8])).toBe(0b10000001);
    expect(ranksFromMask(0b10000001)).toEqual([1, 8]);
    expect(ranksFromMask(0)).toEqual([]);
    expect(maskFromRanks([1, 2, 3, 4, 5, 6, 7, 8])).toBe(255);
  });
});

describe('矩阵博弈求解（单纯形法）', () => {
  it('猜硬币：值为 0，双方各 1/2', () => {
    const sol = solveMatrixGame([
      [1, -1],
      [-1, 1],
    ]);
    expect(sol.value).toBeCloseTo(0, 6);
    expect(sol.row[0]).toBeCloseTo(0.5, 6);
    expect(sol.col[0]).toBeCloseTo(0.5, 6);
  });

  it('石头剪刀布：值为 0，三者各 1/3', () => {
    const sol = solveMatrixGame([
      [0, -1, 1],
      [1, 0, -1],
      [-1, 1, 0],
    ]);
    expect(sol.value).toBeCloseTo(0, 6);
    for (const p of sol.row) expect(p).toBeCloseTo(1 / 3, 6);
    for (const p of sol.col) expect(p).toBeCloseTo(1 / 3, 6);
  });

  it('存在严格优势策略时收敛到纯策略', () => {
    // 行 0 严格优于行 1；列方随后选收益较小的列 1
    const sol = solveMatrixGame([
      [2, 1],
      [0, 0],
    ]);
    expect(sol.value).toBeCloseTo(1, 6);
    expect(sol.row[0]).toBeCloseTo(1, 6);
  });

  it('非对称矩阵的已知混合解', () => {
    // 经典例子：[[3,-1],[-2,4]]，行方最优 (0.6,0.4)，值 = 1
    const sol = solveMatrixGame([
      [3, -1],
      [-2, 4],
    ]);
    expect(sol.value).toBeCloseTo(1, 6);
    expect(sol.row[0]).toBeCloseTo(0.6, 6);
    expect(sol.row[1]).toBeCloseTo(0.4, 6);
  });
});

describe('值表正确性', () => {
  it('单挑终局：8 对 1 必胜，1 对 8 必败，同号必和', () => {
    expect(stateValue([8], [1])).toBeCloseTo(1, 6);
    expect(stateValue([1], [8])).toBeCloseTo(-1, 6);
    expect(stateValue([5], [5])).toBeCloseTo(0, 6);
    expect(stateValue([2], [5])).toBeCloseTo(1, 6); // 2 吃 5
  });

  it('开局满手对满手是公平局（值为 0）', () => {
    const full: Rank[] = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(Math.abs(stateValue(full, full))).toBeLessThan(TOL);
  });

  it('{2} 对 {1,3}：对方出 1 即可稳吃，必败', () => {
    expect(stateValue([2], [1, 3])).toBeCloseTo(-1, 6);
  });

  it('{1,8} 对 {8}：唯一最优是出 8 换掉对方 8，必胜', () => {
    const strat = optimalStrategy([1, 8], [8]);
    expect(strat.value).toBeCloseTo(1, 6);
    const p8 = strat.probs[strat.ranks.indexOf(8)];
    expect(p8).toBeCloseTo(1, 6);
  });

  it('值表反对称：value(a,b) = -value(b,a)', () => {
    const table = getValueTable();
    const samples: Array<[number, number]> = [
      [0b00000111, 0b11100000], // {1,2,3} vs {6,7,8}
      [0b10000001, 0b01000010], // {1,8} vs {2,7}
      [0b00111100, 0b11000011], // {3,4,5,6} vs {1,2,7,8}
    ];
    for (const [a, b] of samples) {
      const vab = table[(a << 8) | b];
      const vba = table[(b << 8) | a];
      expect(vab + vba).toBeCloseTo(0, 6);
    }
  });

  it('最优策略是合法概率分布，且只覆盖手牌', () => {
    const strat = optimalStrategy([1, 3, 5, 8], [2, 4, 6]);
    expect(strat.ranks).toEqual([1, 3, 5, 8]);
    expect(strat.probs).toHaveLength(4);
    let sum = 0;
    for (const p of strat.probs) {
      expect(p).toBeGreaterThanOrEqual(-TOL);
      sum += p;
    }
    expect(sum).toBeCloseTo(1, 6);
  });

  it('全表计算耗时可接受（< 15 秒）', () => {
    const start = Date.now();
    const table = computeValueTable();
    const elapsed = Date.now() - start;
    expect(table.length).toBe(65536);
    expect(elapsed).toBeLessThan(15000);
  });
});
