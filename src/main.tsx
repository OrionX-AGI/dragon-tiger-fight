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

/**
 * 移动端 100vh 不等于可视高度（地址栏、容器外壳、软键盘都会改变它），
 * 这里把真实可视高度写进 --app-height；CSS 里始终保留 100vh 作为回退，
 * 所以即使脚本没跑到，布局依然成立。
 */
function trackViewportHeight(): void {
  const apply = () => {
    const vv = window.visualViewport;
    const h = vv ? vv.height : window.innerHeight;
    document.documentElement.style.setProperty('--app-height', `${h}px`);
  };
  apply();
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', apply);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', apply);
}

trackViewportHeight();

// 自动播放策略要求用户手势后才能出声：首次触摸时启动声音引擎并开始 BGM，
// 之后的触摸只负责唤醒被容器挂起的 AudioContext，所以监听不摘除
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
