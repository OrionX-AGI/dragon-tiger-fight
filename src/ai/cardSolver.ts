/**
 * 纸牌玩法精确求解器。
 *
 * 纸牌玩法是一个"同时出牌"的零和博弈：每个局面由双方剩余手牌唯一决定。
 * 手牌用 8 位掩码表示（bit0=1 号 … bit7=8 号），一个局面即 (myMask, oppMask)，
 * 共 256 × 256 = 65536 个局面。
 *
 * 每个局面本身是一个不超过 8×8 的矩阵博弈（我方选一张、对方选一张），
 * 其精确值与最优混合策略可用线性规划（单纯形法）求解；
 * 局面之间按剩余总张数自底向上做动态规划，即可得到全局精确值表。
 *
 * 值的含义：从"我方"视角，+1 = 必胜，-1 = 必败，0 = 双方最优时和局。
 */
import { duel } from '../core/rules';
import type { Rank } from '../core/types';

// ---------------------------------------------------------------------------
// 掩码工具
// ---------------------------------------------------------------------------

/** rank(1~8) 对应的掩码位 */
export function rankBit(rank: Rank): number {
  return 1 << (rank - 1);
}

export function maskFromRanks(ranks: readonly Rank[]): number {
  let mask = 0;
  for (const r of ranks) mask |= rankBit(r);
  return mask;
}

export function ranksFromMask(mask: number): Rank[] {
  const ranks: Rank[] = [];
  for (let r = 1; r <= 8; r++) {
    if (mask & (1 << (r - 1))) ranks.push(r as Rank);
  }
  return ranks;
}

function popCount(mask: number): number {
  let n = 0;
  while (mask) {
    mask &= mask - 1;
    n++;
  }
  return n;
}

// ---------------------------------------------------------------------------
// 矩阵博弈求解（单纯形法）
// ---------------------------------------------------------------------------

export interface MatrixSolution {
  /** 博弈值（行方视角） */
  value: number;
  /** 行方最优混合策略（概率分布） */
  row: number[];
  /** 列方最优混合策略（概率分布） */
  col: number[];
}

const EPS = 1e-9;

/**
 * 标准型单纯形法：maximize c·y  s.t.  A y <= b, y >= 0（b 全为正）。
 * 使用 Bland 规则防止循环。返回目标值、原始解 y 与对偶解（松弛变量的检验数）。
 */
function simplexMaximize(
  A: number[][],
  b: number[],
  c: number[],
): { z: number; y: number[]; duals: number[] } {
  const m = A.length;
  const n = c.length;
  const width = n + m + 1;
  // 表：m 行约束 + 1 行目标
  const T: number[][] = [];
  for (let i = 0; i < m; i++) {
    const row = new Array<number>(width).fill(0);
    for (let j = 0; j < n; j++) row[j] = A[i][j];
    row[n + i] = 1;
    row[width - 1] = b[i];
    T.push(row);
  }
  const obj = new Array<number>(width).fill(0);
  for (let j = 0; j < n; j++) obj[j] = -c[j];
  T.push(obj);

  const basis: number[] = [];
  for (let i = 0; i < m; i++) basis.push(n + i);

  for (let iter = 0; iter < 500; iter++) {
    // Bland：选下标最小的负检验数列进基
    let col = -1;
    for (let j = 0; j < width - 1; j++) {
      if (T[m][j] < -EPS) {
        col = j;
        break;
      }
    }
    if (col === -1) break; // 已最优

    // 最小比值出基（比值相同取基变量下标最小者）
    let rowIdx = -1;
    let best = Infinity;
    for (let i = 0; i < m; i++) {
      if (T[i][col] > EPS) {
        const ratio = T[i][width - 1] / T[i][col];
        if (ratio < best - EPS || (ratio < best + EPS && (rowIdx === -1 || basis[i] < basis[rowIdx]))) {
          best = ratio;
          rowIdx = i;
        }
      }
    }
    if (rowIdx === -1) throw new Error('单纯形法：问题无界（不应出现）');

    // 高斯消元转轴
    const pivot = T[rowIdx][col];
    for (let j = 0; j < width; j++) T[rowIdx][j] /= pivot;
    for (let i = 0; i <= m; i++) {
      if (i === rowIdx) continue;
      const factor = T[i][col];
      if (Math.abs(factor) < EPS) continue;
      for (let j = 0; j < width; j++) T[i][j] -= factor * T[rowIdx][j];
    }
    basis[rowIdx] = col;
  }

  const y = new Array<number>(n).fill(0);
  for (let i = 0; i < m; i++) {
    if (basis[i] < n) y[basis[i]] = T[i][width - 1];
  }
  const duals: number[] = [];
  for (let i = 0; i < m; i++) duals.push(T[m][n + i]);
  return { z: T[m][width - 1], y, duals };
}

function normalizeDistribution(probs: number[]): number[] {
  let sum = 0;
  const clipped = probs.map((p) => (p > 0 ? p : 0));
  for (const p of clipped) sum += p;
  if (sum <= 0) {
    return clipped.map(() => 1 / clipped.length);
  }
  return clipped.map((p) => p / sum);
}

/**
 * 求解零和矩阵博弈：行方选行使收益最大化，列方选列使其最小化。
 * matrix[i][j] 为行方收益。返回博弈值与双方最优混合策略。
 */
export function solveMatrixGame(matrix: number[][]): MatrixSolution {
  const m = matrix.length;
  const n = matrix[0].length;

  // 平移使所有收益 >= 1，保证 LP 有界且目标值为正
  let min = Infinity;
  for (const row of matrix) for (const v of row) min = Math.min(min, v);
  const K = 1 - min;

  // 列方 LP：maximize Σy_j  s.t.  Σ_j M'[i][j]·y_j <= 1（对每个行 i），y >= 0
  const A = matrix.map((row) => row.map((v) => v + K));
  const { z, y, duals } = simplexMaximize(A, new Array<number>(m).fill(1), new Array<number>(n).fill(1));
  const gameValueShifted = 1 / z;
  return {
    value: gameValueShifted - K,
    row: normalizeDistribution(duals.map((d) => d * gameValueShifted)),
    col: normalizeDistribution(y.map((v) => v * gameValueShifted)),
  };
}

// ---------------------------------------------------------------------------
// 全局值表（动态规划）
// ---------------------------------------------------------------------------

function tableIndex(myMask: number, oppMask: number): number {
  return (myMask << 8) | oppMask;
}

/** 一轮出牌后的后继局面 */
function successor(myMask: number, oppMask: number, myRank: Rank, oppRank: Rank): [number, number] {
  const result = duel(myRank, oppRank);
  const nextMy = result === 'win' ? myMask : myMask & ~rankBit(myRank);
  const nextOpp = result === 'lose' ? oppMask : oppMask & ~rankBit(oppRank);
  return [nextMy, nextOpp];
}

function lookupValue(table: Float64Array, myMask: number, oppMask: number): number {
  if (myMask === 0 && oppMask === 0) return 0;
  if (myMask === 0) return -1;
  if (oppMask === 0) return 1;
  return table[tableIndex(myMask, oppMask)];
}

function buildMatrix(table: Float64Array, myMask: number, oppMask: number): number[][] {
  const myRanks = ranksFromMask(myMask);
  const oppRanks = ranksFromMask(oppMask);
  return myRanks.map((a) =>
    oppRanks.map((b) => {
      const [nm, no] = successor(myMask, oppMask, a, b);
      return lookupValue(table, nm, no);
    }),
  );
}

/**
 * 自底向上计算全部 65536 个局面的精确博弈值。
 * 利用反对称性 value(a,b) = -value(b,a)（同掩码局面值恒为 0）减半计算量。
 * 在普通桌面机器上约 1 秒完成，结果建议全局缓存。
 */
export function computeValueTable(): Float64Array {
  const table = new Float64Array(256 * 256);
  const pc: number[] = [];
  for (let mask = 0; mask < 256; mask++) pc.push(popCount(mask));

  // 终局：一方为空
  for (let mask = 1; mask < 256; mask++) {
    table[tableIndex(mask, 0)] = 1;
    table[tableIndex(0, mask)] = -1;
  }

  // 按剩余总张数从小到大处理（后继局面总张数一定更小或同层已知终局）
  for (let total = 2; total <= 16; total++) {
    for (let my = 1; my < 256; my++) {
      if (pc[my] >= total) continue;
      for (let opp = my; opp < 256; opp++) {
        if (pc[my] + pc[opp] !== total) continue;
        if (my === opp) {
          // 完全对称局面，唯一博弈值必为 0
          table[tableIndex(my, opp)] = 0;
          continue;
        }
        const { value } = solveMatrixGame(buildMatrix(table, my, opp));
        table[tableIndex(my, opp)] = value;
        table[tableIndex(opp, my)] = -value;
      }
    }
  }
  return table;
}

let cachedTable: Float64Array | null = null;

/** 取全局值表（首次调用会现场计算，约 1 秒；之后直接复用） */
export function getValueTable(): Float64Array {
  if (!cachedTable) {
    cachedTable = computeValueTable();
  }
  return cachedTable;
}

/** 是否已完成预计算（供界面判断是否需要等待） */
export function isSolverReady(): boolean {
  return cachedTable !== null;
}

/** 查询局面值（我方视角，+1 必胜 / -1 必败 / 0 和局） */
export function stateValue(myRanks: readonly Rank[], oppRanks: readonly Rank[]): number {
  return lookupValue(getValueTable(), maskFromRanks(myRanks), maskFromRanks(oppRanks));
}

export interface OptimalStrategy {
  /** 我方手牌（与 probs 一一对应） */
  ranks: Rank[];
  /** 每张牌的最优出牌概率 */
  probs: number[];
  /** 当前局面的博弈值 */
  value: number;
}

/** 求当前局面我方的精确最优混合策略 */
export function optimalStrategy(myRanks: readonly Rank[], oppRanks: readonly Rank[]): OptimalStrategy {
  const myMask = maskFromRanks(myRanks);
  const oppMask = maskFromRanks(oppRanks);
  if (myMask === 0 || oppMask === 0) {
    throw new Error('双方手牌都不能为空');
  }
  const table = getValueTable();
  const solution = solveMatrixGame(buildMatrix(table, myMask, oppMask));
  return { ranks: ranksFromMask(myMask), probs: solution.row, value: solution.value };
}
