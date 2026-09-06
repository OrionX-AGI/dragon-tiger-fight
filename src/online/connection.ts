/**
 * 在线对战 WebSocket 客户端封装：
 * - 始终连接页面同源的 /ws（开发时由 Vite 代理到联机服务器）；
 * - 断线自动重连（指数退避），重连成功后自动补发 hello 恢复席位；
 * - clientId 存 sessionStorage（每个标签页独立身份，方便一台电脑开两页测试），
 *   昵称存 localStorage（全局共享）。
 */
import { createLogger } from '../core/logger';
import type { ClientMessage, ServerMessage } from './protocol';
import { WS_PATH } from './protocol';

const log = createLogger('ui');

export type ConnStatus = 'connecting' | 'open' | 'closed';

const CLIENT_ID_KEY = 'longhu:clientId';
const NAME_KEY = 'longhu:playerName';

export function getClientId(): string {
  try {
    let id = sessionStorage.getItem(CLIENT_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(CLIENT_ID_KEY, id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

export function getPlayerName(): string {
  try {
    const saved = localStorage.getItem(NAME_KEY);
    if (saved && saved.trim().length > 0) return saved;
  } catch {
    // 忽略
  }
  return `玩家${Math.floor(1000 + Math.random() * 9000)}`;
}

export function savePlayerName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // 隐私模式下仅本次会话生效
  }
}

type MessageHandler = (msg: ServerMessage) => void;
type StatusHandler = (status: ConnStatus) => void;

const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000];

export class OnlineConnection {
  status: ConnStatus = 'closed';

  private ws: WebSocket | null = null;
  private active = false;
  private retry = 0;
  private retryTimer: number | null = null;
  private msgHandlers = new Set<MessageHandler>();
  private statusHandlers = new Set<StatusHandler>();

  /** 进入在线模式时调用；重复调用无害 */
  start(): void {
    if (this.active) return;
    this.active = true;
    this.open();
  }

  /** 退出在线模式时调用，停止重连并关闭连接 */
  stop(): void {
    this.active = false;
    if (this.retryTimer !== null) {
      window.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.setStatus('closed');
  }

  send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      log.warn('连接未就绪，消息被丢弃', { type: msg.type });
    }
  }

  onMessage(handler: MessageHandler): () => void {
    this.msgHandlers.add(handler);
    return () => this.msgHandlers.delete(handler);
  }

  onStatus(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  private open(): void {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}${WS_PATH}`;
    log.info('连接联机服务器', { url });
    this.setStatus('connecting');
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.retry = 0;
      log.info('联机服务器已连接');
      // 每次（重）连都先自报身份，服务器凭 clientId 恢复席位与对局
      ws.send(JSON.stringify({ type: 'hello', clientId: getClientId(), name: getPlayerName() } satisfies ClientMessage));
      this.setStatus('open');
    };

    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        return;
      }
      for (const handler of this.msgHandlers) handler(msg);
    };

    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.setStatus('closed');
      if (this.active) {
        const delay = RETRY_DELAYS_MS[Math.min(this.retry, RETRY_DELAYS_MS.length - 1)];
        this.retry += 1;
        log.warn(`联机连接断开，${delay / 1000} 秒后重连`);
        this.retryTimer = window.setTimeout(() => {
          this.retryTimer = null;
          if (this.active) this.open();
        }, delay);
      }
    };
  }

  private setStatus(status: ConnStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const handler of this.statusHandlers) handler(status);
  }
}

let singleton: OnlineConnection | null = null;

export function getConnection(): OnlineConnection {
  if (!singleton) singleton = new OnlineConnection();
  return singleton;
}
