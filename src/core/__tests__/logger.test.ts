import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearLog,
  createLogger,
  formatLog,
  getLogEntries,
  setLogLevel,
  suppressLogs,
} from '../logger';

afterEach(() => {
  clearLog();
  setLogLevel('off');
  vi.restoreAllMocks();
});

describe('日志模块', () => {
  it('各级别日志都会进入缓冲区，并记录分类与内容', () => {
    const log = createLogger('engine');
    log.info('翻牌', { 格: 3 });
    log.warn('拒绝着法');
    const entries = getLogEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ level: 'info', category: 'engine', message: '翻牌' });
    expect(entries[1]).toMatchObject({ level: 'warn', message: '拒绝着法' });
  });

  it('缓冲区可导出为可读文本', () => {
    createLogger('ai').info('纸牌 AI 出牌', { 出牌: 8 });
    const text = formatLog();
    expect(text).toContain('INFO');
    expect(text).toContain('ai');
    expect(text).toContain('纸牌 AI 出牌');
    expect(text).toContain('"出牌":8');
  });

  it('控制台输出受级别控制，低于当前级别不打印', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = createLogger('ui');

    setLogLevel('error');
    log.debug('不应打印');
    expect(debugSpy).not.toHaveBeenCalled();

    log.error('应打印');
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('suppressLogs 期间完全不记录（用于 AI 搜索）', () => {
    const log = createLogger('engine');
    suppressLogs(() => {
      log.info('搜索内部着法');
      log.warn('搜索内部拒绝');
    });
    expect(getLogEntries()).toHaveLength(0);

    log.info('搜索结束后恢复记录');
    expect(getLogEntries()).toHaveLength(1);
  });

  it('suppressLogs 抛出异常后仍会恢复记录', () => {
    const log = createLogger('engine');
    expect(() =>
      suppressLogs(() => {
        throw new Error('搜索出错');
      }),
    ).toThrow('搜索出错');
    log.info('恢复正常');
    expect(getLogEntries()).toHaveLength(1);
  });
});
