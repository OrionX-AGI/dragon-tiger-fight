/**
 * 连接接入层：管理 WebSocket 连接的握手（hello）、消息路由与断线通知。
 * 每个客户端用 clientId 标识（刷新页面后凭它恢复席位与对局）。
 */
import type { WebSocket } from 'ws';
import type { ClientMessage, ServerMessage } from '../src/online/protocol';
import type { PlayerLink, RoomManagerOptions } from './roomManager';
import { RoomManager } from './roomManager';

interface ClientRecord {
  link: PlayerLink;
  socket: WebSocket;
}

function sanitizeName(raw: string): string {
  const name = raw.trim().slice(0, 12);
  return name.length > 0 ? name : '无名玩家';
}

export class Hub {
  readonly manager: RoomManager;
  private clients = new Map<string, ClientRecord>();
  private readonly log: (message: string) => void;

  constructor(options: RoomManagerOptions = {}) {
    this.log = options.log ?? (() => {});
    this.manager = new RoomManager(options);
  }

  attach(socket: WebSocket): void {
    let clientId: string | null = null;

    socket.on('message', (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(raw)) as ClientMessage;
      } catch {
        return;
      }
      try {
        if (clientId === null) {
          if (msg.type !== 'hello' || typeof msg.clientId !== 'string' || msg.clientId.length === 0) {
            socket.close(4000, '需要先发送 hello');
            return;
          }
          clientId = msg.clientId;
          this.handleHello(socket, clientId, sanitizeName(msg.name));
        } else if (msg.type !== 'hello') {
          this.route(clientId, msg);
        }
      } catch (err) {
        this.log(`处理消息出错（${clientId ?? '未知'} / ${msg.type}）：${String(err)}`);
        const record = clientId !== null ? this.clients.get(clientId) : null;
        record?.link.send({ type: 'errorMsg', message: '服务器处理请求时出错' });
      }
    });

    socket.on('close', () => {
      if (clientId === null) return;
      const record = this.clients.get(clientId);
      // 只有当前活跃 socket 断开才算离线（重连后旧 socket 的 close 不应误伤）
      if (record && record.socket === socket) {
        this.clients.delete(clientId);
        this.log(`${record.link.name}（${clientId.slice(0, 8)}）断开连接`);
        this.manager.handleDisconnect(clientId);
      }
    });
  }

  private handleHello(socket: WebSocket, clientId: string, name: string): void {
    const existing = this.clients.get(clientId);
    if (existing && existing.socket !== socket) {
      // 同一身份的新连接：顶掉旧连接
      try {
        existing.socket.close(4001, '账号在其他页面连接');
      } catch {
        // 旧连接可能已失效
      }
    }

    const link: PlayerLink = {
      clientId,
      name,
      send: (msg: ServerMessage) => {
        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify(msg));
        }
      },
    };
    this.clients.set(clientId, { link, socket });
    this.log(`${name}（${clientId.slice(0, 8)}）已连接`);

    const resumed = this.manager.resume(link);
    link.send({ type: 'helloOk', resumed });
    if (resumed === null) {
      this.manager.enterLobby(link);
    }
  }

  private route(clientId: string, msg: ClientMessage): void {
    const record = this.clients.get(clientId);
    if (!record) return;
    const { link } = record;
    const m = this.manager;

    switch (msg.type) {
      case 'setName':
        link.name = sanitizeName(msg.name);
        m.setName(clientId, link.name);
        break;
      case 'listRooms':
        m.enterLobby(link);
        break;
      case 'createRoom':
        m.createRoom(link, msg.gameType);
        break;
      case 'joinRoom':
        m.joinRoom(link, msg.roomId);
        break;
      case 'joinByCode':
        m.joinByCode(link, msg.code);
        break;
      case 'autoMatch':
        m.autoMatch(link, msg.gameType);
        break;
      case 'leaveRoom':
        m.leaveRoom(clientId);
        break;
      case 'setReady':
        m.setReady(clientId, msg.ready);
        break;
      case 'nextGame':
        m.handleNextGame(clientId);
        break;
      case 'cardPick':
        m.handleCardPick(clientId, msg.rank);
        break;
      case 'boardAction':
        m.handleBoardAction(clientId, msg.action);
        break;
      case 'surrender':
        m.handleSurrender(clientId);
        break;
      case 'hello':
        break;
    }
  }
}
