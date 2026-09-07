import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ensureAudio } from './audio/sound';
import { createLogger, getLogLevel, installLogBridge } from './core/logger';
import './styles.css';

const log = createLogger('app');

installLogBridge();

window.addEventListener('error', (e) => {
  log.error('未捕获的运行时错误', { message: e.message, source: e.filename, line: e.lineno });
});
window.addEventListener('unhandledrejection', (e) => {
  log.error('未处理的 Promise 拒绝', { reason: String(e.reason) });
});

// 自动播放策略要求用户手势后才能出声：首次点击时启动声音引擎并开始 BGM，
// 之后的点击只负责唤醒被浏览器挂起的 AudioContext，所以监听不摘除
window.addEventListener('pointerdown', () => ensureAudio());

log.info('龙虎斗启动', {
  日志级别: getLogLevel(),
  调试入口: '控制台输入 龙虎斗日志.打印() 查看日志，龙虎斗日志.级别("debug") 开启详细日志',
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
