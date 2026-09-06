/**
 * 极简静态文件服务：托管前端构建产物 dist/。
 * 未命中的路径回退到 index.html（单页应用路由）。
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

export function createStaticHandler(distDir: string) {
  const root = resolve(distDir);
  return (req: IncomingMessage, res: ServerResponse): void => {
    const url = (req.url ?? '/').split('?')[0];
    const decoded = decodeURIComponent(url);
    let filePath = normalize(join(root, decoded));
    // 防目录穿越
    if (!filePath.startsWith(root)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
      filePath = join(root, 'index.html');
    }
    if (!existsSync(filePath)) {
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('前端尚未构建：请先运行 npm run build 生成 dist 目录');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream' });
    createReadStream(filePath).pipe(res);
  };
}
