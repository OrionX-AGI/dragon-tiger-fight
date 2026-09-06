/**
 * 房间与匹配管理（服务器权威）。
 *
 * 三种进入方式统一为"入座"：
 * - 房间列表：大厅实时推送未满员房间，点击入座；
 * - 房间码：创建房间得 4 位数字码，对方输码入座；
 * - 自动匹配：优先进"有人已准备的单人房"，其次"单人房"，否则新建房间等待。
 *
 * 准备机制：两人入座后任一方点准备即启动倒计时（默认 15 秒），
 * 另一方超时未准备则被踢回大厅；双方都准备立即开局。
 * 对局结束回到"入座未准备"状态，再次双准备即为再来一局（阵营/先手互换）。
 */
import type { BoardAction } from '../src/core/boardGame';
import type { Rank } from '../src/core/types';
import type {
  GameType,
  RoomStatus,
  RoomSummary,
  RoomView,
  SeatIndex,
  ServerMessage,
} from '../src/online/protocol';
import {
  DISCONNECT_GRACE_MS,
  NEXT_GAME_DELAY_MS,
  READY_TIMEOUT_MS,
  SERIES_TARGET_WINS,
} from '../src/online/protocol';
import { BoardSession } from './boardSession';
import { CardSession, otherSeat } from './cardSession';

/** 连接层提供的玩家句柄（可在重连时替换 send 实现） */
export interface PlayerLink {
  clientId: string;
  name: string;
  send(msg: ServerMessage): void;
}

interface Seat {
  link: PlayerLink;
  ready: boolean;
  connected: boolean;
  graceTimer: ReturnType<typeof setTimeout> | null;
  graceDeadline: number | null;
}

interface Room {
  id: string;
  code: string;
  gameType: GameType;
  status: RoomStatus;
  seats: [Seat | null, Seat | null];
  session: CardSession | BoardSession | null;
  gameIndex: number;
  wins: [number, number];
  draws: number;
  countdownTimer: ReturnType<typeof setTimeout> | null;
  countdownDeadline: number | null;
  /** 纸牌三局两胜：局间自动开始下一局的定时器 */
  nextGameTimer: ReturnType<typeof setTimeout> | null;
  nextGameDeadline: number | null;
  createdAt: number;
}

export interface RoomManagerOptions {
  readyTimeoutMs?: number;
  graceMs?: number;
  nextGameDelayMs?: number;
  log?: (message: string) => void;
}

let nextRoomId = 1;

export class RoomManager {
  private rooms = new Map<string, Room>();
  /** clientId → roomId */
  private memberRoom = new Map<string, string>();
  /** 订阅大厅列表的玩家 */
  private lobby = new Map<string, PlayerLink>();

  private readonly readyTimeoutMs: number;
  private readonly graceMs: number;
  private readonly nextGameDelayMs: number;
  private readonly log: (message: string) => void;

  constructor(options: RoomManagerOptions = {}) {
    this.readyTimeoutMs = options.readyTimeoutMs ?? READY_TIMEOUT_MS;
    this.graceMs = options.graceMs ?? DISCONNECT_GRACE_MS;
    this.nextGameDelayMs = options.nextGameDelayMs ?? NEXT_GAME_DELAY_MS;
    this.log = options.log ?? (() => {});
  }

  // -------------------------------------------------------------------------
  // 大厅
  // -------------------------------------------------------------------------

  enterLobby(link: PlayerLink): void {
    this.lobby.set(link.clientId, link);
    link.send({ type: 'roomList', rooms: this.roomSummaries() });
  }

  private leaveLobby(clientId: string): void {
    this.lobby.delete(clientId);
  }

  private roomSummaries(): RoomSummary[] {
    const list: RoomSummary[] = [];
    for (const room of this.rooms.values()) {
      if (room.status === 'playing') continue;
      list.push({
        id: room.id,
        code: room.code,
        gameType: room.gameType,
        status: room.status,
        playerNames: room.seats.filter((s): s is Seat => s !== null).map((s) => s.link.name),
        hasReady: room.seats.some((s) => s !== null && s.ready),
      });
    }
    return list.sort((a, b) => a.id.localeCompare(b.id));
  }

  private broadcastLobby(): void {
    const msg: ServerMessage = { type: 'roomList', rooms: this.roomSummaries() };
    for (const link of this.lobby.values()) link.send(msg);
  }

  // -------------------------------------------------------------------------
  // 建房 / 入座
  // -------------------------------------------------------------------------

  createRoom(link: PlayerLink, gameType: GameType): void {
    if (this.memberRoom.has(link.clientId)) {
      link.send({ type: 'errorMsg', message: '你已在一个房间中' });
      return;
    }
    const room: Room = {
      id: `r${nextRoomId++}`,
      code: this.generateCode(),
      gameType,
      status: 'waiting',
      seats: [this.makeSeat(link), null],
      session: null,
      gameIndex: 0,
      wins: [0, 0],
      draws: 0,
      countdownTimer: null,
      countdownDeadline: null,
      nextGameTimer: null,
      nextGameDeadline: null,
      createdAt: Date.now(),
    };
    this.rooms.set(room.id, room);
    this.memberRoom.set(link.clientId, room.id);
    this.leaveLobby(link.clientId);
    this.log(`房间 ${room.id}（码 ${room.code}，${gameType}）由 ${link.name} 创建`);
    this.pushRoom(room);
    this.broadcastLobby();
  }

  joinRoom(link: PlayerLink, roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) {
      link.send({ type: 'errorMsg', message: '房间不存在或已解散' });
      return;
    }
    this.seatInto(link, room);
  }

  joinByCode(link: PlayerLink, code: string): void {
    const room = [...this.rooms.values()].find((r) => r.code === code.trim());
    if (!room) {
      link.send({ type: 'errorMsg', message: `没有找到房间码为 ${code} 的房间` });
      return;
    }
    this.seatInto(link, room);
  }

  autoMatch(link: PlayerLink, gameType: GameType): void {
    if (this.memberRoom.has(link.clientId)) {
      link.send({ type: 'errorMsg', message: '你已在一个房间中' });
      return;
    }
    const candidates = [...this.rooms.values()]
      .filter(
        (r) =>
          r.gameType === gameType &&
          r.status !== 'playing' &&
          r.seats.filter((s) => s !== null).length === 1,
      )
      .sort((a, b) => a.createdAt - b.createdAt);
    // 优先进"有人已准备"的房间，其次任意单人房
    const withReady = candidates.find((r) => r.seats.some((s) => s !== null && s.ready));
    const target = withReady ?? candidates[0];
    if (target) {
      this.seatInto(link, target);
    } else {
      this.createRoom(link, gameType);
    }
  }

  private seatInto(link: PlayerLink, room: Room): void {
    if (this.memberRoom.has(link.clientId)) {
      link.send({ type: 'errorMsg', message: '你已在一个房间中' });
      return;
    }
    if (room.status === 'playing') {
      link.send({ type: 'errorMsg', message: '该房间正在对局中' });
      return;
    }
    const free = room.seats[0] === null ? 0 : room.seats[1] === null ? 1 : null;
    if (free === null) {
      link.send({ type: 'errorMsg', message: '该房间已满员' });
      return;
    }
    room.seats[free] = this.makeSeat(link);
    this.memberRoom.set(link.clientId, room.id);
    this.leaveLobby(link.clientId);
    this.log(`${link.name} 入座房间 ${room.id} 席位 ${free}`);
    this.evaluateRoom(room);
    this.pushRoom(room);
    this.broadcastLobby();
  }

  private makeSeat(link: PlayerLink): Seat {
    return { link, ready: false, connected: true, graceTimer: null, graceDeadline: null };
  }

  private generateCode(): string {
    const used = new Set([...this.rooms.values()].map((r) => r.code));
    for (let i = 0; i < 10000; i++) {
      const code = String(Math.floor(1000 + Math.random() * 9000));
      if (!used.has(code)) return code;
    }
    throw new Error('房间码耗尽');
  }

  // -------------------------------------------------------------------------
  // 准备 / 倒计时 / 开局
  // -------------------------------------------------------------------------

  setReady(clientId: string, ready: boolean): void {
    const found = this.findSeat(clientId);
    if (!found) return;
    const { room, seat } = found;
    if (room.status === 'playing') return;
    room.seats[seat]!.ready = ready;
    this.evaluateRoom(room);
    this.pushRoom(room);
    this.broadcastLobby();
  }

  setName(clientId: string, name: string): void {
    const found = this.findSeat(clientId);
    if (found) {
      found.room.seats[found.seat]!.link.name = name;
      this.pushRoom(found.room);
      this.broadcastLobby();
    }
  }

  /** 本轮系列是否已分出胜负（仅纸牌启用三局两胜；棋盘每局独立） */
  private seriesDecided(room: Room): boolean {
    return (
      room.gameType === 'card' &&
      (room.wins[0] >= SERIES_TARGET_WINS || room.wins[1] >= SERIES_TARGET_WINS)
    );
  }

  /** 根据人数与准备状态推进房间：双准备开局 / 单准备启动倒计时 / 否则取消倒计时 */
  private evaluateRoom(room: Room): void {
    if (room.status === 'playing') return;
    // 局间等待自动开局时不走准备/倒计时流程
    if (room.nextGameTimer !== null) return;
    const occupied = room.seats.filter((s): s is Seat => s !== null);
    const readyCount = occupied.filter((s) => s.ready).length;

    if (occupied.length === 2 && readyCount === 2) {
      this.startGame(room);
      return;
    }
    if (occupied.length === 2 && readyCount === 1) {
      if (room.countdownTimer === null) {
        room.countdownDeadline = Date.now() + this.readyTimeoutMs;
        room.countdownTimer = setTimeout(() => this.onCountdownExpire(room), this.readyTimeoutMs);
        room.status = 'countdown';
      }
      return;
    }
    this.cancelCountdown(room);
    if (room.status === 'countdown') {
      room.status = room.session !== null ? 'finished' : 'waiting';
    }
  }

  private cancelCountdown(room: Room): void {
    if (room.countdownTimer !== null) {
      clearTimeout(room.countdownTimer);
      room.countdownTimer = null;
      room.countdownDeadline = null;
    }
  }

  private onCountdownExpire(room: Room): void {
    room.countdownTimer = null;
    room.countdownDeadline = null;
    if (room.status === 'playing') return;
    const occupied = room.seats.filter((s): s is Seat => s !== null);
    const readyCount = occupied.filter((s) => s.ready).length;
    if (occupied.length === 2 && readyCount === 1) {
      const lazySeat = room.seats[0]?.ready ? 1 : 0;
      const lazy = room.seats[lazySeat]!;
      this.log(`房间 ${room.id}：${lazy.link.name} 超时未准备，被移出房间`);
      this.removeSeat(room, lazySeat);
      lazy.link.send({ type: 'kicked', reason: '15 秒内未点击准备，已被移出房间' });
      this.enterLobby(lazy.link);
      room.status = room.session !== null ? 'finished' : 'waiting';
      this.pushRoom(room);
      this.broadcastLobby();
      this.cleanupIfEmpty(room);
    } else {
      this.evaluateRoom(room);
      this.pushRoom(room);
    }
  }

  private cancelNextGame(room: Room): void {
    if (room.nextGameTimer !== null) {
      clearTimeout(room.nextGameTimer);
      room.nextGameTimer = null;
      room.nextGameDeadline = null;
    }
  }

  private startGame(room: Room): void {
    this.cancelCountdown(room);
    this.cancelNextGame(room);
    // 上一轮系列已分胜负：这次开局属于新系列，比分清零
    if (this.seriesDecided(room)) {
      room.wins = [0, 0];
      room.draws = 0;
    }
    room.status = 'playing';
    const ctx = {
      send: (seat: SeatIndex, msg: ServerMessage) => {
        room.seats[seat]?.link.send(msg);
      },
      onOver: (winnerSeat: SeatIndex | null) => this.onGameOver(room, winnerSeat),
    };
    room.session =
      room.gameType === 'card' ? new CardSession(ctx, room.gameIndex) : new BoardSession(ctx, room.gameIndex);
    this.log(`房间 ${room.id} 第 ${room.gameIndex + 1} 局开始（${room.gameType}）`);
    this.pushRoom(room);
    this.broadcastLobby();
    room.session.start();
  }

  private onGameOver(room: Room, winnerSeat: SeatIndex | null): void {
    if (room.status !== 'playing') return;
    room.status = 'finished';
    room.gameIndex += 1;
    if (winnerSeat === null) room.draws += 1;
    else room.wins[winnerSeat] += 1;
    for (const seat of room.seats) {
      if (seat) seat.ready = false;
    }
    this.log(
      `房间 ${room.id} 对局结束，${winnerSeat === null ? '和局' : `席位 ${winnerSeat} 胜`}，比分 ${room.wins[0]}:${room.wins[1]}`,
    );
    // 纸牌三局两胜：系列未定则进入局间，倒计时后自动开始下一局（和局不计胜场，加赛）
    if (room.gameType === 'card' && !this.seriesDecided(room)) {
      const bothSeated = room.seats[0] !== null && room.seats[1] !== null;
      if (bothSeated) {
        room.nextGameDeadline = Date.now() + this.nextGameDelayMs;
        room.nextGameTimer = setTimeout(() => this.onNextGameTimer(room), this.nextGameDelayMs);
        this.log(`房间 ${room.id} 系列未定，${this.nextGameDelayMs / 1000} 秒后自动开始下一局`);
      }
    }
    this.pushRoom(room);
    this.broadcastLobby();
  }

  private onNextGameTimer(room: Room): void {
    room.nextGameTimer = null;
    room.nextGameDeadline = null;
    const bothSeated = room.seats[0] !== null && room.seats[1] !== null;
    if (room.status === 'finished' && bothSeated && !this.seriesDecided(room)) {
      this.startGame(room);
    } else {
      this.pushRoom(room);
    }
  }

  /** 局间任一玩家点击"开始下一局"：立即开局 */
  handleNextGame(clientId: string): void {
    const found = this.findSeat(clientId);
    if (!found) return;
    const { room } = found;
    if (room.nextGameTimer === null || room.status !== 'finished') return;
    this.log(`房间 ${room.id}：玩家请求立即开始下一局`);
    this.startGame(room);
  }

  // -------------------------------------------------------------------------
  // 对局消息
  // -------------------------------------------------------------------------

  handleCardPick(clientId: string, rank: Rank): void {
    const found = this.findSeat(clientId);
    if (!found || !(found.room.session instanceof CardSession)) return;
    const error = found.room.session.pick(found.seat, rank);
    if (error) found.room.seats[found.seat]!.link.send({ type: 'errorMsg', message: error });
  }

  handleBoardAction(clientId: string, action: BoardAction): void {
    const found = this.findSeat(clientId);
    if (!found || !(found.room.session instanceof BoardSession)) return;
    const error = found.room.session.action(found.seat, action);
    if (error) found.room.seats[found.seat]!.link.send({ type: 'errorMsg', message: error });
  }

  handleSurrender(clientId: string): void {
    const found = this.findSeat(clientId);
    if (!found || found.room.session === null || found.room.status !== 'playing') return;
    const error = found.room.session.surrender(found.seat);
    if (error) found.room.seats[found.seat]!.link.send({ type: 'errorMsg', message: error });
  }

  // -------------------------------------------------------------------------
  // 离开 / 断线 / 重连
  // -------------------------------------------------------------------------

  leaveRoom(clientId: string): void {
    const found = this.findSeat(clientId);
    if (!found) return;
    const { room, seat } = found;
    const link = room.seats[seat]!.link;

    if (room.status === 'playing' && room.session !== null) {
      // 对局中主动离场 = 判负
      room.session.forceEnd(seat);
    }
    this.removeSeat(room, seat);
    link.send({ type: 'leftRoom' });
    this.enterLobby(link);
    this.evaluateRoom(room);
    this.pushRoom(room);
    this.broadcastLobby();
    this.cleanupIfEmpty(room);
  }

  /** 连接断开：对局中保留席位一段时间等待重连，否则直接离座 */
  handleDisconnect(clientId: string): void {
    this.leaveLobby(clientId);
    const found = this.findSeat(clientId);
    if (!found) return;
    const { room, seat } = found;

    if (room.status === 'playing') {
      const s = room.seats[seat]!;
      s.connected = false;
      s.graceDeadline = Date.now() + this.graceMs;
      s.graceTimer = setTimeout(() => this.onGraceExpire(room, seat), this.graceMs);
      this.log(`房间 ${room.id}：${s.link.name} 掉线，保留席位 ${this.graceMs / 1000} 秒`);
      room.seats[otherSeat(seat)]?.link.send({
        type: 'opponentConnection',
        connected: false,
        graceRemainingMs: this.graceMs,
      });
      this.pushRoom(room);
    } else {
      const link = room.seats[seat]!.link;
      this.log(`房间 ${room.id}：${link.name} 断开连接，离座`);
      this.removeSeat(room, seat);
      this.evaluateRoom(room);
      this.pushRoom(room);
      this.broadcastLobby();
      this.cleanupIfEmpty(room);
    }
  }

  private onGraceExpire(room: Room, seat: SeatIndex): void {
    const s = room.seats[seat];
    if (!s || s.connected) return;
    s.graceTimer = null;
    this.log(`房间 ${room.id}：席位 ${seat} 重连超时，判负离座`);
    if (room.status === 'playing' && room.session !== null) {
      room.session.forceEnd(seat);
    }
    this.removeSeat(room, seat);
    this.pushRoom(room);
    this.broadcastLobby();
    this.cleanupIfEmpty(room);
  }

  /**
   * 重连：换上新的连接句柄，恢复房间与对局视图。
   * 返回恢复到的位置（null 表示此人不在任何房间）。
   */
  resume(link: PlayerLink): 'room' | 'game' | null {
    const found = this.findSeat(link.clientId);
    if (!found) return null;
    const { room, seat } = found;
    const s = room.seats[seat]!;
    s.link = link;
    s.connected = true;
    s.graceDeadline = null;
    if (s.graceTimer !== null) {
      clearTimeout(s.graceTimer);
      s.graceTimer = null;
    }
    this.log(`房间 ${room.id}：${link.name} 已重连`);
    room.seats[otherSeat(seat)]?.link.send({
      type: 'opponentConnection',
      connected: true,
      graceRemainingMs: null,
    });
    this.pushRoom(room);
    if (room.session !== null) {
      if (room.session instanceof CardSession) {
        link.send({ type: 'cardState', view: room.session.viewFor(seat) });
      } else {
        link.send({ type: 'boardState', view: room.session.viewFor(seat) });
      }
      return 'game';
    }
    return 'room';
  }

  // -------------------------------------------------------------------------
  // 工具
  // -------------------------------------------------------------------------

  private findSeat(clientId: string): { room: Room; seat: SeatIndex } | null {
    const roomId = this.memberRoom.get(clientId);
    if (!roomId) return null;
    const room = this.rooms.get(roomId);
    if (!room) {
      this.memberRoom.delete(clientId);
      return null;
    }
    const seat = room.seats.findIndex((s) => s !== null && s.link.clientId === clientId);
    if (seat !== 0 && seat !== 1) return null;
    return { room, seat };
  }

  private removeSeat(room: Room, seat: SeatIndex): void {
    const s = room.seats[seat];
    if (!s) return;
    if (s.graceTimer !== null) clearTimeout(s.graceTimer);
    this.cancelNextGame(room);
    this.memberRoom.delete(s.link.clientId);
    room.seats[seat] = null;
    // 对局态随席位清空而失效（保留 finished 战绩与 gameIndex）
    if (room.status === 'playing') {
      room.status = 'waiting';
      room.session = null;
    }
  }

  private cleanupIfEmpty(room: Room): void {
    if (room.seats[0] === null && room.seats[1] === null) {
      this.cancelCountdown(room);
      this.cancelNextGame(room);
      this.rooms.delete(room.id);
      this.log(`房间 ${room.id} 已解散`);
      this.broadcastLobby();
    }
  }

  private pushRoom(room: Room): void {
    for (const seat of [0, 1] as const) {
      const s = room.seats[seat];
      if (!s || !s.connected) continue;
      s.link.send({ type: 'roomUpdate', room: this.roomViewFor(room, seat) });
    }
  }

  private roomViewFor(room: Room, seat: SeatIndex): RoomView {
    return {
      id: room.id,
      code: room.code,
      gameType: room.gameType,
      status: room.status,
      seats: [this.seatView(room.seats[0]), this.seatView(room.seats[1])],
      yourSeat: seat,
      countdownRemainingMs:
        room.countdownDeadline !== null ? Math.max(0, room.countdownDeadline - Date.now()) : null,
      wins: [...room.wins],
      draws: room.draws,
      gameIndex: room.gameIndex,
      nextGameRemainingMs:
        room.nextGameDeadline !== null ? Math.max(0, room.nextGameDeadline - Date.now()) : null,
      seriesOver: this.seriesDecided(room),
    };
  }

  private seatView(seat: Seat | null): RoomView['seats'][number] {
    if (!seat) return null;
    return { name: seat.link.name, ready: seat.ready, connected: seat.connected };
  }

  /** 供测试与调试 */
  roomCount(): number {
    return this.rooms.size;
  }

  roomOf(clientId: string): { id: string; code: string; status: RoomStatus } | null {
    const found = this.findSeat(clientId);
    if (!found) return null;
    return { id: found.room.id, code: found.room.code, status: found.room.status };
  }
}
