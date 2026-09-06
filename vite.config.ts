import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // 必须显式绑定 IPv4 回环地址：默认的 'localhost' 在本机会被 Node 解析为 ::1，
    // 导致只监听 IPv6，而浏览器访问 localhost 走 127.0.0.1，连不上。
    host: '127.0.0.1',
    port: 5173,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
