/**
 * 在线对战前后端共享协议。
 *
 * 所有消息走 WebSocket + JSON。服务器是权威：客户端只提交"意图"，
 * 状态一律由服务器结算后以"视图"形式推送。棋盘暗牌身份在净化视图中
 * 不会下发，纸牌当回合的暗出牌在双方都提交前不会泄露给对方。
 */
import type { BoardAction, BoardEndReason, PlayerSlot, RepetitionTracker } from '../core/boardGame';
import type { CardEndReason, RoundRecord } from '../core/cardGame';
import type { Card, Faction, Rank } from '../core/types';

export type GameType = 'card' | 'board';

export type SeatIndex = 0 | 1;

export type RoomStatus = 'waiting' | 'countdown' | 'playing' | 'finished';

/** 大厅房间列表中的一行 */
export interface RoomSummary {
  id: string;
  code: string;
  gameType: GameType;
  status: RoomStatus;
  playerNames: string[];
  /** 是否已有玩家点了准备（自动匹配优先进这类房间） */
  hasReady: boolean;
}

export interface SeatView {
  name: string;
  ready: boolean;
  connected: boolean;
}

/** 房间内视图（每个座位收到的内容相同，除 yourSeat 外） */
export interface RoomView {
  id: string;
  code: string;
  gameType: GameType;
  status: RoomStatus;
  seats: [SeatView | null, SeatView | null];
  yourSeat: SeatIndex;
  /** 准备倒计时剩余毫秒；无倒计时为 null */
  countdownRemainingMs: number | null;
  /** 本轮系列比分：按座位计的胜局数与和局数（纸牌新系列开始时清零） */
  wins: [number, number];
  draws: number;
  /** 当前是第几局（从 0 起，决定阵营/先手互换） */
  gameIndex: number;
  /** 纸牌三局两胜：局间自动开始下一局的剩余毫秒；不在局间为 null */
  nextGameRemainingMs: number | null;
  /** 纸牌三局两胜：本轮系列是否已分出胜负（棋盘恒为 false） */
  seriesOver: boolean;
}

/** 纸牌对局视图（手牌构成按规则本就公开，唯一秘密是当回合未揭示的出牌） */
export interface CardGameView {
  gameIndex: number;
  yourFaction: Faction;
  hands: Record<Faction, Rank[]>;
  lost: Record<Faction, Rank[]>;
  history: RoundRecord[];
  outcome: Faction | 'draw' | null;
  endReason: CardEndReason | null;
  /** 你本回合已提交的牌（刷新恢复用）；未提交为 null */
  yourPick: Rank | null;
  opponentCommitted: boolean;
}

/** 净化后的棋盘格：未翻开的格子不含牌面身份 */
export interface BoardCellView {
  faceUp: boolean;
  card: Card | null;
}

export interface BoardGameView {
  gameIndex: number;
  yourSlot: PlayerSlot;
  board: (BoardCellView | null)[];
  factions: Record<PlayerSlot, Faction | null>;
  current: PlayerSlot;
  captured: Card[];
  quietMoves: number;
  repetition: Record<PlayerSlot, RepetitionTracker | null>;
  outcome: Faction | 'draw' | null;
  endReason: BoardEndReason | null;
  lastAction: BoardAction | null;
}

// ---------------------------------------------------------------------------
// 客户端 → 服务器
// ---------------------------------------------------------------------------

export type ClientMessage =
  | { type: 'hello'; clientId: string; name: string }
  | { type: 'setName'; name: string }
  | { type: 'listRooms' }
  | { type: 'createRoom'; gameType: GameType }
  | { type: 'joinRoom'; roomId: string }
  | { type: 'joinByCode'; code: string }
  | { type: 'autoMatch'; gameType: GameType }
  | { type: 'leaveRoom' }
  | { type: 'setReady'; ready: boolean }
  | { type: 'nextGame' }
  | { type: 'cardPick'; rank: Rank }
  | { type: 'boardAction'; action: BoardAction }
  | { type: 'surrender' };

// ---------------------------------------------------------------------------
// 服务器 → 客户端
// ---------------------------------------------------------------------------

export type ServerMessage =
  | { type: 'helloOk'; resumed: 'room' | 'game' | null }
  | { type: 'roomList'; rooms: RoomSummary[] }
  | { type: 'roomUpdate'; room: RoomView }
  | { type: 'leftRoom' }
  | { type: 'kicked'; reason: string }
  | { type: 'cardState'; view: CardGameView }
  | { type: 'boardState'; view: BoardGameView }
  | { type: 'opponentConnection'; connected: boolean; graceRemainingMs: number | null }
  | { type: 'errorMsg'; message: string };

/** WebSocket 路径（生产环境与页面同源同端口；开发环境由 Vite 代理） */
export const WS_PATH = '/ws';
/** 联机服务器默认端口 */
export const DEFAULT_PORT = 8787;
/** 一方准备后另一方的响应时限 */
export const READY_TIMEOUT_MS = 15000;
/** 对局中掉线的席位保留时长 */
export const DISCONNECT_GRACE_MS = 60000;
/** 纸牌三局两胜：先胜此局数者赢下整轮系列 */
export const SERIES_TARGET_WINS = 2;
/** 纸牌局间自动开始下一局的等待时长 */
export const NEXT_GAME_DELAY_MS = 5000;
