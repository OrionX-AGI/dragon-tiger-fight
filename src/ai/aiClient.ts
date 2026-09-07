/**
 * AI 计算入口。界面层只调用这里的异步函数。
 *
 * 小红书小工具容器禁用 Web Worker，因此计算全部在主线程执行。
 * 每次计算前先让出一帧，保证"电脑思考中"等界面状态先绘制出来，
 * 否则同步占用主线程会让用户看到界面卡住而没有任何反馈。
 */
import type { BoardAction, BoardGameState } from '../core/boardGame';
import { createLogger } from '../core/logger';
import type { Rank } from '../core/types';
import { chooseBoardAction } from './boardAI';
import type { AiLevel } from './cardAI';
import { chooseCard } from './cardAI';
import { getValueTable } from './cardSolver';

const log = createLogger('ai');

/** 让出主线程一帧，等界面把加载态画出来后再开始计算 */
function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => setTimeout(resolve, 0));
    } else {
      setTimeout(resolve, 0);
    }
  });
}

/** 预热纸牌求解器（值表约 1 秒算完）；进入纸牌人机对局时提前调用 */
export async function prepareCardAi(): Promise<void> {
  await yieldToUi();
  const start = Date.now();
  getValueTable();
  log.info('纸牌求解器值表就绪', { 耗时毫秒: Date.now() - start });
}

/** 纸牌 AI 选牌 */
export async function requestCardMove(myHand: Rank[], oppHand: Rank[], level: AiLevel): Promise<Rank> {
  await yieldToUi();
  return chooseCard(myHand, oppHand, level);
}

/** 棋盘 AI 行棋 */
export async function requestBoardMove(state: BoardGameState, level: AiLevel): Promise<BoardAction> {
  await yieldToUi();
  return chooseBoardAction(state, level);
}
