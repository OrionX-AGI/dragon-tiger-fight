/**
 * 联机服务器入口：单端口同时提供
 * - HTTP 静态托管（前端构建产物 dist/）
 * - WebSocket 对战服务（路径 /ws）
 *
 * 启动：npm run server（或双击 启动联机服务器.bat）
 */
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { DEFAULT_PORT, WS_PATH } from '../src/online/protocol';
import { Hub } from './hub';
import { createStaticHandler } from './static';

const here = dirname(fileURLToPath(import.meta.url));
const distDir = join(here, '..', 'dist');
const port = Number(process.env.PORT ?? DEFAULT_PORT);

function timestamp(): string {
  return new Date().toISOString().slice(11, 19);
}

function log(message: string): void {
  console.log(`[${timestamp()}] ${message}`);
}

const hub = new Hub({ log });
const httpServer = createServer(createStaticHandler(distDir));
const wss = new WebSocketServer({ server: httpServer, path: WS_PATH });

wss.on('connection', (socket) => hub.attach(socket));

function lanAddresses(): string[] {
  const result: string[] = [];
  for (const infos of Object.values(networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family === 'IPv4' && !info.internal) result.push(info.address);
    }
  }
  return result;
}

httpServer.listen(port, '0.0.0.0', () => {
  console.log('==============================================');
  console.log('  龙虎斗 · 联机服务器已启动');
  console.log('==============================================');
  console.log(`  本机访问：  http://localhost:${port}/`);
  for (const ip of lanAddresses()) {
    console.log(`  局域网访问：http://${ip}:${port}/   ← 告诉你的对手`);
  }
  console.log('  停止服务器：在本窗口按 Ctrl + C');
  console.log('==============================================');
});
