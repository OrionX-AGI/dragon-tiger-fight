export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'off';

export type LogCategory = 'app' | 'ui' | 'engine' | 'ai';

export interface LogEntry {
  time: string;
  level: Exclude<LogLevel, 'off'>;
  category: LogCategory;
  message: string;
  data?: unknown;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  off: 100,
};

const BUFFER_LIMIT = 800;
const STORAGE_KEY = 'longhu:logLevel';

const buffer: LogEntry[] = [];

function envMode(): string {
  try {
    return import.meta.env?.MODE ?? 'production';
  } catch {
    return 'production';
  }
}

/** 默认级别：开发时 info，测试时 off（保持测试输出干净），生产 warn */
function defaultLevel(): LogLevel {
  const mode = envMode();
  if (mode === 'test') return 'off';
  return mode === 'development' ? 'info' : 'warn';
}

function storedLevel(): LogLevel | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw !== null && raw in LEVEL_ORDER ? (raw as LogLevel) : null;
  } catch {
    return null;
  }
}

let consoleLevel: LogLevel = storedLevel() ?? defaultLevel();

export function setLogLevel(level: LogLevel): void {
  consoleLevel = level;
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, level);
    } catch {
      // 隐私模式下 localStorage 不可写，仅本次会话生效
    }
  }
}

export function getLogLevel(): LogLevel {
  return consoleLevel;
}

export function getLogEntries(): LogEntry[] {
  return [...buffer];
}

export function clearLog(): void {
  buffer.length = 0;
}

/** 导出为纯文本，便于反馈问题时附带 */
export function formatLog(): string {
  return buffer
    .map((e) => {
      const data = e.data === undefined ? '' : ` ${safeStringify(e.data)}`;
      return `[${e.time}] ${e.level.toUpperCase().padEnd(5)} ${e.category.padEnd(6)} ${e.message}${data}`;
    })
    .join('\n');
}

function safeStringify(data: unknown): string {
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}

let suppressDepth = 0;

/**
 * 在回调执行期间完全关闭日志。用于 AI 搜索：搜索会调用引擎上万次，
 * 其中的着法日志既无参考价值又会淹没日志缓冲区。
 */
export function suppressLogs<T>(fn: () => T): T {
  suppressDepth += 1;
  try {
    return fn();
  } finally {
    suppressDepth -= 1;
  }
}

function write(level: Exclude<LogLevel, 'off'>, category: LogCategory, message: string, data?: unknown) {
  if (suppressDepth > 0) return;
  const entry: LogEntry = {
    time: new Date().toISOString().slice(11, 23),
    level,
    category,
    message,
    data,
  };
  buffer.push(entry);
  if (buffer.length > BUFFER_LIMIT) buffer.shift();

  if (LEVEL_ORDER[level] < LEVEL_ORDER[consoleLevel]) return;
  const prefix = `[${entry.time}][${category}]`;
  const args = data === undefined ? [prefix, message] : [prefix, message, data];
  if (level === 'error') console.error(...args);
  else if (level === 'warn') console.warn(...args);
  else if (level === 'info') console.info(...args);
  else console.debug(...args);
}

export interface Logger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

export function createLogger(category: LogCategory): Logger {
  return {
    debug: (m, d) => write('debug', category, m, d),
    info: (m, d) => write('info', category, m, d),
    warn: (m, d) => write('warn', category, m, d),
    error: (m, d) => write('error', category, m, d),
  };
}

/**
 * 在浏览器控制台暴露调试入口：
 *   龙虎斗日志.打印()  查看全部日志
 *   龙虎斗日志.级别('debug')  开启详细日志（含 AI 决策过程）
 *   龙虎斗日志.导出()  复制为文本
 */
export function installLogBridge(): void {
  // 仅浏览器环境有效（Node 服务器复用本模块时跳过）
  const g = globalThis as unknown as Record<string, unknown>;
  if (typeof g.window === 'undefined') return;
  const bridge = {
    打印: () => console.log(formatLog()),
    导出: () => formatLog(),
    条目: () => getLogEntries(),
    级别: (level: LogLevel) => {
      setLogLevel(level);
      console.info(`日志级别已设为 ${level}`);
    },
    清空: clearLog,
  };
  g['龙虎斗日志'] = bridge;
  g.longhuLog = bridge;
}
