import type { AiLevel } from '../ai/cardAI';
import type { Faction } from '../core/types';

/** 非在线对局配置（一律人机对战） */
export interface MatchConfig {
  /** 人机难度 */
  level: AiLevel;
  /** 纸牌人机：玩家执什么阵营（random 在进局时抽签一次，整轮系列生效） */
  playerFaction: Faction | 'random';
  /** 棋盘人机：先手方 */
  firstMover: 'player' | 'ai' | 'random';
}

export const defaultConfig: MatchConfig = {
  level: 'normal',
  playerFaction: 'dragon',
  firstMover: 'random',
};
