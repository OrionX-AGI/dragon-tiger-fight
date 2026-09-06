/**
 * AI Worker 客户端封装。界面层只调用这里的异步函数，
 * 计算在 Worker 线程完成；若 Worker 不可用则自动回退到主线程同步计算。
 */
import type { BoardAction, BoardGameState } from '../core/boardGame';
import { createLogger } from '../core/logger';
import type { Rank } from '../core/types';
import type { AiWorkerRequest, AiWorkerResponse } from './aiWorker';
import { chooseBoardAction } from './boardAI';
import type { AiLevel } from './cardAI';
import { chooseCard } from './cardAI';
import { getValueTable } from './cardSolver';

const log = createLogger('ai');

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

/** undefined = 尚未尝试创建；null = 创建失败，走主线程回退 */
let worker: Worker | null | undefined;
const pending = new Map<number, Pending>();
let nextId = 1;

function failAllPending(reason: string): void {
  for (const [, p] of pending) p.reject(new Error(reason));
  pending.clear();
}

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL('./aiWorker.ts', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (ev: MessageEvent<AiWorkerResponse>) => {
      const msg = ev.data;
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.result);
      else p.reject(new Error(msg.error));
    });
    worker.addEventListener('error', (ev) => {
      log.error('AI Worker 出错，后续计算回退到主线程', { message: ev.message });
      worker?.terminate();
      worker = null;
      failAllPending('AI Worker 出错');
    });
    log.info('AI Worker 已启动');
  } catch (err) {
    log.warn('当前环境不支持 Web Worker，AI 计算将在主线程执行', { err: String(err) });
    worker = null;
  }
  return worker;
}

/** 对联合类型逐成员做 Omit（TS 的 Omit 不会自动分配到联合成员上） */
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

function call(request: DistributiveOmit<AiWorkerRequest, 'id'>): Promise<unknown> | null {
  const w = getWorker();
  if (!w) return null;
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ ...request, id });
  });
}

/** 预热纸牌求解器（值表约 1 秒算完）；进入纸牌人机对局时提前调用 */
export async function prepareCardAi(): Promise<void> {
  const p = call({ type: 'prepareCardSolver' });
  if (p) {
    try {
      await p;
      return;
    } catch {
      // Worker 失败则回退主线程
    }
  }
  getValueTable();
}

/** 纸牌 AI 选牌（异步，不阻塞界面） */
export async function requestCardMove(myHand: Rank[], oppHand: Rank[], level: AiLevel): Promise<Rank> {
  const p = call({ type: 'chooseCard', myHand, oppHand, level });
  if (p) {
    try {
      return (await p) as Rank;
    } catch (err) {
      log.warn('Worker 选牌失败，回退主线程', { err: String(err) });
    }
  }
  return chooseCard(myHand, oppHand, level);
}

/** 棋盘 AI 行棋（异步，不阻塞界面） */
export async function requestBoardMove(state: BoardGameState, level: AiLevel): Promise<BoardAction> {
  const p = call({ type: 'chooseBoardAction', state, level });
  if (p) {
    try {
      return (await p) as BoardAction;
    } catch (err) {
      log.warn('Worker 行棋失败，回退主线程', { err: String(err) });
    }
  }
  return chooseBoardAction(state, level);
}
