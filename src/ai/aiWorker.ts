/**
 * AI 计算 Worker：纸牌值表预计算、纸牌选牌、棋盘搜索全部在这里执行，
 * 避免阻塞主线程（界面卡顿）。协议见 aiClient.ts。
 */
import type { BoardAction, BoardGameState } from '../core/boardGame';
import type { Rank } from '../core/types';
import { chooseBoardAction } from './boardAI';
import type { AiLevel } from './cardAI';
import { chooseCard } from './cardAI';
import { getValueTable } from './cardSolver';

export type AiWorkerRequest =
  | { id: number; type: 'prepareCardSolver' }
  | { id: number; type: 'chooseCard'; myHand: Rank[]; oppHand: Rank[]; level: AiLevel }
  | { id: number; type: 'chooseBoardAction'; state: BoardGameState; level: AiLevel };

export type AiWorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };

const ctx = self as unknown as {
  postMessage(message: AiWorkerResponse): void;
  addEventListener(type: 'message', listener: (ev: MessageEvent<AiWorkerRequest>) => void): void;
};

function handle(msg: AiWorkerRequest): unknown {
  switch (msg.type) {
    case 'prepareCardSolver':
      getValueTable();
      return true;
    case 'chooseCard':
      return chooseCard(msg.myHand, msg.oppHand, msg.level);
    case 'chooseBoardAction':
      return chooseBoardAction(msg.state, msg.level) satisfies BoardAction;
  }
}

ctx.addEventListener('message', (ev) => {
  const msg = ev.data;
  try {
    ctx.postMessage({ id: msg.id, ok: true, result: handle(msg) });
  } catch (err) {
    ctx.postMessage({ id: msg.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});
