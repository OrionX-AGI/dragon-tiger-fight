import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoomView, ServerMessage } from '../../src/online/protocol';
import type { PlayerLink } from '../roomManager';
import { RoomManager } from '../roomManager';

interface FakePlayer extends PlayerLink {
  inbox: ServerMessage[];
}

function makePlayer(id: string, name: string): FakePlayer {
  const inbox: ServerMessage[] = [];
  return { clientId: id, name, inbox, send: (msg) => inbox.push(msg) };
}

function lastOfType<T extends ServerMessage['type']>(
  player: FakePlayer,
  type: T,
): Extract<ServerMessage, { type: T }> | null {
  const found = [...player.inbox].reverse().find((m) => m.type === type);
  return (found as Extract<ServerMessage, { type: T }> | undefined) ?? null;
}

function lastRoom(player: FakePlayer): RoomView {
  const msg = lastOfType(player, 'roomUpdate');
  if (!msg) throw new Error('没有 roomUpdate');
  return msg.room;
}

describe('房间与匹配', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('创建房间得到 4 位房间码，房间码可入座', () => {
    const m = new RoomManager();
    const p1 = makePlayer('c1', '甲');
    const p2 = makePlayer('c2', '乙');
    m.createRoom(p1, 'card');
    const room = lastRoom(p1);
    expect(room.code).toMatch(/^\d{4}$/);
    expect(room.yourSeat).toBe(0);

    m.joinByCode(p2, room.code);
    expect(lastRoom(p2).seats[1]?.name).toBe('乙');
    expect(lastRoom(p1).seats[1]?.name).toBe('乙');
  });

  it('错误房间码返回错误提示', () => {
    const m = new RoomManager();
    const p = makePlayer('c1', '甲');
    m.joinByCode(p, '0000');
    expect(lastOfType(p, 'errorMsg')?.message).toContain('0000');
  });

  it('大厅订阅者收到房间列表推送', () => {
    const m = new RoomManager();
    const watcher = makePlayer('w', '观众');
    m.enterLobby(watcher);
    expect(lastOfType(watcher, 'roomList')?.rooms).toHaveLength(0);
    const p1 = makePlayer('c1', '甲');
    m.createRoom(p1, 'board');
    const list = lastOfType(watcher, 'roomList')!.rooms;
    expect(list).toHaveLength(1);
    expect(list[0].gameType).toBe('board');
    expect(list[0].playerNames).toEqual(['甲']);
  });

  it('自动匹配优先进"有人已准备"的单人房', () => {
    const m = new RoomManager();
    const idle = makePlayer('c1', '未准备');
    const eager = makePlayer('c2', '已准备');
    m.createRoom(idle, 'card');
    m.createRoom(eager, 'card');
    m.setReady('c2', true);

    const joiner = makePlayer('c3', '匹配者');
    m.autoMatch(joiner, 'card');
    const room = lastRoom(joiner);
    expect(room.seats.some((s) => s?.name === '已准备')).toBe(true);
  });

  it('自动匹配没有已准备的房间时进最早的单人房；没有任何房间时新建', () => {
    const m = new RoomManager();
    const p1 = makePlayer('c1', '甲');
    m.createRoom(p1, 'card');
    const p2 = makePlayer('c2', '乙');
    m.autoMatch(p2, 'card');
    expect(lastRoom(p2).seats[0]?.name).toBe('甲');

    const p3 = makePlayer('c3', '丙');
    m.autoMatch(p3, 'card'); // 前面的房间已满，新建
    expect(m.roomCount()).toBe(2);
    expect(lastRoom(p3).yourSeat).toBe(0);
  });

  it('一方准备启动 15 秒倒计时，另一方超时被踢回大厅', () => {
    const m = new RoomManager({ readyTimeoutMs: 15000 });
    const p1 = makePlayer('c1', '甲');
    const p2 = makePlayer('c2', '乙');
    m.createRoom(p1, 'card');
    m.joinByCode(p2, lastRoom(p1).code);
    m.setReady('c1', true);

    expect(lastRoom(p2).status).toBe('countdown');
    expect(lastRoom(p2).countdownRemainingMs).toBeGreaterThan(0);

    vi.advanceTimersByTime(15001);
    expect(lastOfType(p2, 'kicked')?.reason).toContain('准备');
    expect(m.roomOf('c2')).toBeNull();
    expect(lastRoom(p1).seats[1]).toBeNull();
    expect(lastRoom(p1).status).toBe('waiting');
    // 被踢者回到大厅（收到房间列表）
    expect(lastOfType(p2, 'roomList')).not.toBeNull();
  });

  it('倒计时内对方点准备则立即开局，双方收到对局视图', () => {
    const m = new RoomManager();
    const p1 = makePlayer('c1', '甲');
    const p2 = makePlayer('c2', '乙');
    m.createRoom(p1, 'card');
    m.joinByCode(p2, lastRoom(p1).code);
    m.setReady('c1', true);
    vi.advanceTimersByTime(5000);
    m.setReady('c2', true);

    expect(lastRoom(p1).status).toBe('playing');
    const v1 = lastOfType(p1, 'cardState')!.view;
    const v2 = lastOfType(p2, 'cardState')!.view;
    expect(v1.yourFaction).toBe('dragon'); // 第 0 局座位 0 执龙
    expect(v2.yourFaction).toBe('tiger');
    // 之后超时不再触发踢人
    vi.advanceTimersByTime(20000);
    expect(lastOfType(p2, 'kicked')).toBeNull();
  });

  it('纸牌单局结束且系列未定：进入局间倒计时，5 秒后自动开始下一局（阵营互换）', () => {
    const m = new RoomManager({ nextGameDelayMs: 5000 });
    const p1 = makePlayer('c1', '甲');
    const p2 = makePlayer('c2', '乙');
    m.createRoom(p1, 'card');
    m.joinByCode(p2, lastRoom(p1).code);
    m.setReady('c1', true);
    m.setReady('c2', true);

    m.handleSurrender('c1'); // 第 1 局甲认输，比分 0:1

    const room = lastRoom(p2);
    expect(room.status).toBe('finished');
    expect(room.wins).toEqual([0, 1]);
    expect(room.seriesOver).toBe(false);
    expect(room.nextGameRemainingMs).toBeGreaterThan(0);

    vi.advanceTimersByTime(5001); // 自动开始第 2 局
    const v1 = lastOfType(p1, 'cardState')!.view;
    expect(lastRoom(p1).status).toBe('playing');
    expect(v1.yourFaction).toBe('tiger'); // 第 2 局阵营互换
    expect(v1.history).toHaveLength(0); // 全新一局
  });

  it('局间任一玩家点"开始下一局"立即开局，定时器不再重复触发', () => {
    const m = new RoomManager({ nextGameDelayMs: 5000 });
    const p1 = makePlayer('c1', '甲');
    const p2 = makePlayer('c2', '乙');
    m.createRoom(p1, 'card');
    m.joinByCode(p2, lastRoom(p1).code);
    m.setReady('c1', true);
    m.setReady('c2', true);
    m.handleSurrender('c1');

    m.handleNextGame('c2');
    expect(lastRoom(p1).status).toBe('playing');
    const started = lastOfType(p1, 'cardState')!.view.gameIndex;
    vi.advanceTimersByTime(10000);
    expect(lastOfType(p1, 'cardState')!.view.gameIndex).toBe(started); // 没有再次开局
  });

  it('一方先胜 2 局系列结束：不再自动开局，双方准备后开新系列并清零比分', () => {
    const m = new RoomManager({ nextGameDelayMs: 5000 });
    const p1 = makePlayer('c1', '甲');
    const p2 = makePlayer('c2', '乙');
    m.createRoom(p1, 'card');
    m.joinByCode(p2, lastRoom(p1).code);
    m.setReady('c1', true);
    m.setReady('c2', true);

    m.handleSurrender('c1'); // 第 1 局乙胜
    vi.advanceTimersByTime(5001); // 自动开第 2 局
    m.handleSurrender('c1'); // 第 2 局乙再胜，系列结束

    const room = lastRoom(p2);
    expect(room.wins).toEqual([0, 2]);
    expect(room.seriesOver).toBe(true);
    expect(room.nextGameRemainingMs).toBeNull();
    vi.advanceTimersByTime(10000);
    expect(lastRoom(p2).status).toBe('finished'); // 没有自动开局

    m.setReady('c1', true);
    m.setReady('c2', true); // 新系列
    const room2 = lastRoom(p1);
    expect(room2.status).toBe('playing');
    expect(room2.wins).toEqual([0, 0]); // 比分清零
    expect(room2.draws).toBe(0);
  });

  it('棋盘对局结束不进入局间自动开局，仍走双方准备流程', () => {
    const m = new RoomManager({ nextGameDelayMs: 5000 });
    const p1 = makePlayer('c1', '甲');
    const p2 = makePlayer('c2', '乙');
    m.createRoom(p1, 'board');
    m.joinByCode(p2, lastRoom(p1).code);
    m.setReady('c1', true);
    m.setReady('c2', true);

    m.handleBoardAction('c1', { type: 'flip', index: 0 }); // 确定阵营
    m.handleSurrender('c2');

    const room = lastRoom(p1);
    expect(room.status).toBe('finished');
    expect(room.wins).toEqual([1, 0]);
    expect(room.seriesOver).toBe(false);
    expect(room.nextGameRemainingMs).toBeNull();
    vi.advanceTimersByTime(10000);
    expect(lastRoom(p1).status).toBe('finished'); // 不自动开局

    m.setReady('c1', true);
    m.setReady('c2', true);
    expect(lastRoom(p1).status).toBe('playing');
    expect(lastRoom(p1).wins).toEqual([1, 0]); // 棋盘战绩累计，不清零
  });

  it('对局中主动离场判负，对方收到 abandon 结果', () => {
    const m = new RoomManager();
    const p1 = makePlayer('c1', '甲');
    const p2 = makePlayer('c2', '乙');
    m.createRoom(p1, 'card');
    m.joinByCode(p2, lastRoom(p1).code);
    m.setReady('c1', true);
    m.setReady('c2', true);

    m.leaveRoom('c1');
    expect(lastOfType(p1, 'leftRoom')).not.toBeNull();
    const v2 = lastOfType(p2, 'cardState')!.view;
    expect(v2.outcome).toBe('tiger');
    expect(v2.endReason).toBe('abandon');
    expect(lastRoom(p2).wins).toEqual([0, 1]);
  });

  it('对局中掉线保留席位，重连恢复对局视图；超时判负', () => {
    const m = new RoomManager({ graceMs: 60000 });
    const p1 = makePlayer('c1', '甲');
    const p2 = makePlayer('c2', '乙');
    m.createRoom(p1, 'card');
    m.joinByCode(p2, lastRoom(p1).code);
    m.setReady('c1', true);
    m.setReady('c2', true);

    m.handleDisconnect('c2');
    const notice = lastOfType(p1, 'opponentConnection');
    expect(notice?.connected).toBe(false);
    expect(notice?.graceRemainingMs).toBe(60000);

    // 30 秒内重连
    vi.advanceTimersByTime(30000);
    const p2b = makePlayer('c2', '乙');
    expect(m.resume(p2b)).toBe('game');
    expect(lastOfType(p2b, 'cardState')).not.toBeNull();
    expect(lastOfType(p1, 'opponentConnection')?.connected).toBe(true);

    // 再掉线且超时
    m.handleDisconnect('c2');
    vi.advanceTimersByTime(60001);
    const v1 = lastOfType(p1, 'cardState')!.view;
    expect(v1.endReason).toBe('abandon');
    expect(v1.outcome).toBe('dragon');
    expect(m.roomOf('c2')).toBeNull();
  });

  it('非对局中掉线直接离座，房间清空后解散', () => {
    const m = new RoomManager();
    const p1 = makePlayer('c1', '甲');
    m.createRoom(p1, 'card');
    expect(m.roomCount()).toBe(1);
    m.handleDisconnect('c1');
    expect(m.roomCount()).toBe(0);
  });
});
