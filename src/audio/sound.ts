/**
 * 声音引擎：背景音乐与全部音效都用 Web Audio 在运行时合成，零媒体文件。
 *
 * 为什么不用音频文件：
 *   - 小红书小工具是离线 zip 包，媒体文件必须打进包内，一段 1 分钟 BGM
 *     约 0.7-1MB，会把包体推向 2MB 建议线；纯代码合成零字节。
 *   - 容器 CSP 禁止 data:/blob: 媒体源，运行时生成的音频没法喂给 <audio>；
 *     Web Audio 直接走音频线程，不经过媒体元素，不受此限制。
 *   - 完全自己合成，无任何第三方授权问题。
 *
 * 实现要点：
 *   - 所有音色在初始化时用纯 JS 数学预渲染进 AudioBuffer（古筝拨弦用
 *     Karplus-Strong 算法），之后播放只是零成本的 buffer 调度。
 *     刻意不用 ScriptProcessorNode：棋盘困难 AI 会阻塞主线程约 1 秒，
 *     实时生成必然爆音。
 *   - BGM 调度器提前约 3 秒排音符，主线程被 AI 占住时音乐不断。
 *   - 浏览器自动播放策略要求用户手势后才能出声，main.tsx 在首次
 *     pointerdown 时调用 ensureAudio()。
 *   - 兼容基线 Chrome 61：AudioContext 带 webkit 前缀回退，不用
 *     Object.fromEntries / globalThis 等晚于基线的 API。
 */

import { createLogger } from '../core/logger';

const log = createLogger('audio');

export type SfxName = 'dragon' | 'tiger' | 'mutual' | 'draw';

const MUSIC_KEY = 'longhu:music';
const SFX_KEY = 'longhu:sfx';

// ---------- 偏好 ----------

function readPref(key: string): boolean {
  try {
    return localStorage.getItem(key) !== '0';
  } catch {
    return true;
  }
}

function writePref(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    // 隐私模式下仅本次会话生效
  }
}

let musicOn = readPref(MUSIC_KEY);
let sfxOn = readPref(SFX_KEY);

// ---------- 引擎状态 ----------

let ctx: AudioContext | null = null;
let bgmGain: GainNode | null = null;
let sfxGain: GainNode | null = null;
/** 拨弦音色缓存：MIDI 音高 → 预渲染 buffer */
const pluckCache: Record<number, AudioBuffer> = {};
const sfxBuffers: Partial<Record<SfxName, AudioBuffer>> = {};

// ---------- BGM 乐谱 ----------

/** 拍速与循环长度：66 BPM、64 拍一循环（约 58 秒） */
const SPB = 60 / 66;
const LOOP_BEATS = 64;

/**
 * [拍号, MIDI 音高, 音量]。A 羽调式五声音阶（A C D E G），
 * 旋律声部 + 每 8-12 拍一个的低音声部。初始化时按拍号排序。
 */
const SEQ: Array<[number, number, number]> = [
  // 低音声部
  [0, 45, 0.4], [12, 52, 0.34], [16, 50, 0.36], [24, 45, 0.4],
  [32, 45, 0.4], [44, 52, 0.34], [48, 50, 0.36], [56, 45, 0.4],
  // 旋律声部：起 - 承 - 转 - 合 四句
  [0, 69, 0.6], [1.5, 72, 0.46], [2, 74, 0.55], [4, 76, 0.62], [6, 74, 0.46],
  [7, 72, 0.4], [8, 69, 0.56], [11, 67, 0.38], [12, 69, 0.5],
  [16, 64, 0.52], [17.5, 67, 0.4], [18, 69, 0.55], [20, 72, 0.58], [22, 69, 0.46],
  [23, 67, 0.38], [24, 64, 0.5], [27, 62, 0.36], [28, 64, 0.46],
  [32, 69, 0.6], [33.5, 72, 0.46], [34, 74, 0.56], [36, 76, 0.62], [38, 74, 0.46],
  [39, 72, 0.4], [40, 74, 0.52], [43, 72, 0.38], [44, 69, 0.55],
  [48, 67, 0.46], [50, 64, 0.44], [52, 62, 0.4], [54, 64, 0.46], [56, 69, 0.56],
];
let seqSorted = false;

/** 调度参数：提前排 3.2 秒，每 400ms 补一次 */
const LOOKAHEAD_S = 3.2;
const TICK_MS = 400;

let bgmTimer: number | null = null;
let seqPos = 0;
let loopStart = 0;

// ---------- 合成工具 ----------

function midiToFreq(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

/** 峰值归一化到 0.85，并做尾部 120ms 淡出消除截断爆音 */
function polish(data: Float32Array, sr: number): void {
  let peak = 0;
  for (let i = 0; i < data.length; i++) {
    const a = Math.abs(data[i]);
    if (a > peak) peak = a;
  }
  const k = peak > 0 ? 0.85 / peak : 1;
  const fade = Math.min(data.length, Math.floor(sr * 0.12));
  for (let i = 0; i < data.length; i++) {
    let v = data[i] * k;
    const left = data.length - i;
    if (left < fade) v *= left / fade;
    data[i] = v;
  }
}

function toBuffer(c: AudioContext, data: Float32Array): AudioBuffer {
  const buf = c.createBuffer(1, data.length, c.sampleRate);
  buf.getChannelData(0).set(data);
  return buf;
}

/**
 * Karplus-Strong 拨弦：噪声突发注入延迟线，反复取两点平均衰减，
 * 天然就是"拨一下慢慢暗下去"的弦音。低音给更长的时值。
 */
function renderPluck(c: AudioContext, freq: number): AudioBuffer {
  const sr = c.sampleRate;
  const dur = freq < 200 ? 2.4 : 1.7;
  const n = Math.floor(sr * dur);
  const out = new Float32Array(n);
  const period = Math.max(2, Math.round(sr / freq));
  const line = new Float32Array(period);
  // 初始激励：轻度低通的噪声，让音头偏"丝弦"而不是"钢丝"
  let prev = 0;
  for (let i = 0; i < period; i++) {
    const white = Math.random() * 2 - 1;
    prev = 0.55 * prev + 0.45 * white;
    line[i] = prev;
  }
  // 每经过一个周期整体衰减到 rho，使各音高的余音时长一致
  const rho = Math.pow(0.001, 1 / (freq * dur));
  let idx = 0;
  for (let i = 0; i < n; i++) {
    const cur = line[idx];
    const nxt = line[(idx + 1) % period];
    out[i] = cur;
    line[idx] = rho * 0.5 * (cur + nxt);
    idx = (idx + 1) % period;
  }
  polish(out, sr);
  return toBuffer(c, out);
}

/** 龙吟：基频先扬后抑的多谐波啸声，带渐强颤音与气声 */
function renderDragon(c: AudioContext): AudioBuffer {
  const sr = c.sampleRate;
  const dur = 1.8;
  const n = Math.floor(sr * dur);
  const out = new Float32Array(n);
  let phase = 0;
  let noiseLp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    // 基频：150Hz 起，0.45s 处顶到 ~350Hz，再滑落回 ~190Hz（高斯包络）
    const bump = Math.exp(-Math.pow(t - 0.45, 2) / (2 * 0.28 * 0.28));
    const vib = Math.sin(2 * Math.PI * 5.5 * t) * 9 * Math.min(1, t / 0.5);
    const f = 150 + 200 * bump + vib;
    phase += (2 * Math.PI * f) / sr;
    // 谐波叠加后软削波，出一点"啸"的毛边
    const raw =
      Math.sin(phase) +
      0.55 * Math.sin(2 * phase) +
      0.35 * Math.sin(3 * phase) +
      0.22 * Math.sin(4 * phase) +
      0.14 * Math.sin(5 * phase);
    const tone = Math.tanh(1.6 * raw);
    // 气声：低通白噪
    noiseLp = 0.92 * noiseLp + 0.08 * (Math.random() * 2 - 1);
    const attack = Math.min(1, t / 0.07);
    const release = t > 1.0 ? Math.exp(-(t - 1.0) / 0.32) : 1;
    out[i] = (tone + 1.6 * noiseLp) * attack * release;
  }
  polish(out, sr);
  return toBuffer(c, out);
}

/** 虎啸：低频下坠的咆哮，27Hz 幅度调制出喉音颗粒感，加隆隆低噪 */
function renderTiger(c: AudioContext): AudioBuffer {
  const sr = c.sampleRate;
  const dur = 1.5;
  const n = Math.floor(sr * dur);
  const out = new Float32Array(n);
  let phase = 0;
  let rumble = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f = 115 - 45 * Math.min(1, t / dur);
    phase += (2 * Math.PI * f) / sr;
    const raw =
      Math.sin(phase) +
      0.7 * Math.sin(2 * phase) +
      0.5 * Math.sin(3 * phase) +
      0.3 * Math.sin(4 * phase);
    const tone = Math.tanh(2.2 * raw);
    // 喉音：27Hz 颤幅
    const growl = 1 - 0.5 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 27 * t));
    // 低频隆隆声
    rumble = 0.965 * rumble + 0.035 * (Math.random() * 2 - 1);
    const attack = Math.min(1, t / 0.05);
    const release = t > 0.85 ? Math.exp(-(t - 0.85) / 0.28) : 1;
    out[i] = (tone * growl + 2.4 * rumble) * attack * release;
  }
  polish(out, sr);
  return toBuffer(c, out);
}

/** 同归于尽：金属撞击（环形调制噪声两枚）+ 低频闷响 */
function renderMutual(c: AudioContext): AudioBuffer {
  const sr = c.sampleRate;
  const dur = 1.1;
  const n = Math.floor(sr * dur);
  const out = new Float32Array(n);
  let thudPhase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const noise = Math.random() * 2 - 1;
    const clang =
      noise *
      (Math.sin(2 * Math.PI * 620 * t) + 0.7 * Math.sin(2 * Math.PI * 947 * t)) *
      Math.exp(-t / 0.16);
    const thudF = 70 * Math.exp(-t / 0.5) + 38;
    thudPhase += (2 * Math.PI * thudF) / sr;
    const thud = Math.sin(thudPhase) * Math.exp(-t / 0.26);
    const attack = Math.min(1, t / 0.008);
    out[i] = (0.7 * clang + 1.1 * thud) * attack;
  }
  polish(out, sr);
  return toBuffer(c, out);
}

/** 和棋：一记磬/锣，非谐分音各自衰减，微微拍频 */
function renderDraw(c: AudioContext): AudioBuffer {
  const sr = c.sampleRate;
  const dur = 2.4;
  const n = Math.floor(sr * dur);
  const out = new Float32Array(n);
  /** [频率Hz, 幅度, 衰减秒] —— 手调的类磬分音列 */
  const partials: Array<[number, number, number]> = [
    [196, 1.0, 1.25], [198.5, 0.6, 1.1], [327, 0.5, 0.8],
    [439, 0.35, 0.55], [566, 0.22, 0.4], [742, 0.14, 0.3],
  ];
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let v = 0;
    for (let p = 0; p < partials.length; p++) {
      const pt = partials[p];
      v += pt[1] * Math.sin(2 * Math.PI * pt[0] * t) * Math.exp(-t / pt[2]);
    }
    // 击打噪头（30ms）
    if (t < 0.03) v += (Math.random() * 2 - 1) * (1 - t / 0.03) * 0.4;
    const attack = Math.min(1, t / 0.012);
    out[i] = v * attack;
  }
  polish(out, sr);
  return toBuffer(c, out);
}

// ---------- BGM 调度 ----------

function scheduleNote(midi: number, vel: number, when: number): void {
  if (!ctx || !bgmGain) return;
  let buf = pluckCache[midi];
  if (!buf) {
    buf = renderPluck(ctx, midiToFreq(midi));
    pluckCache[midi] = buf;
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = ctx.createGain();
  g.gain.value = vel;
  src.connect(g);
  g.connect(bgmGain);
  src.start(when);
}

function pump(): void {
  if (!ctx) return;
  const horizon = ctx.currentTime + LOOKAHEAD_S;
  // 单次最多排完两圈，防御 suspend 后时间跳变导致的追赶循环
  let guard = SEQ.length * 2;
  while (guard-- > 0) {
    if (seqPos >= SEQ.length) {
      seqPos = 0;
      loopStart += LOOP_BEATS * SPB;
    }
    const ev = SEQ[seqPos];
    const t = loopStart + ev[0] * SPB;
    if (t > horizon) break;
    scheduleNote(ev[1], ev[2], Math.max(t, ctx.currentTime + 0.02));
    seqPos++;
  }
}

function startBgm(): void {
  if (!ctx || bgmTimer !== null) return;
  if (!seqSorted) {
    SEQ.sort((a, b) => a[0] - b[0]);
    seqSorted = true;
  }
  seqPos = 0;
  loopStart = ctx.currentTime + 0.15;
  if (bgmGain) bgmGain.gain.value = 0.5;
  pump();
  bgmTimer = window.setInterval(pump, TICK_MS);
  log.info('背景音乐开始', {});
}

function stopBgm(): void {
  if (bgmTimer !== null) {
    window.clearInterval(bgmTimer);
    bgmTimer = null;
  }
  // 已排程的音符直接静音（不然余音还要响一秒多）
  if (bgmGain) bgmGain.gain.value = 0;
  log.info('背景音乐停止', {});
}

// ---------- 对外接口 ----------

/**
 * 在用户手势回调里调用：首次创建 AudioContext 并渲染全部音色，
 * 之后的调用只负责把被自动播放策略挂起的上下文唤醒。
 */
export function ensureAudio(): void {
  if (ctx) {
    if (ctx.state === 'suspended' && !document.hidden) {
      ctx.resume();
    }
    return;
  }
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) {
    log.warn('当前环境不支持 Web Audio，静音运行', {});
    return;
  }
  const started = Date.now();
  ctx = new Ctor();
  bgmGain = ctx.createGain();
  bgmGain.gain.value = 0.5;
  bgmGain.connect(ctx.destination);
  sfxGain = ctx.createGain();
  sfxGain.gain.value = 0.9;
  sfxGain.connect(ctx.destination);

  sfxBuffers.dragon = renderDragon(ctx);
  sfxBuffers.tiger = renderTiger(ctx);
  sfxBuffers.mutual = renderMutual(ctx);
  sfxBuffers.draw = renderDraw(ctx);
  // 预渲染乐谱里用到的所有音高，避免播放中途现算
  for (let i = 0; i < SEQ.length; i++) {
    const midi = SEQ[i][1];
    if (!pluckCache[midi]) pluckCache[midi] = renderPluck(ctx, midiToFreq(midi));
  }

  // 页面不可见时挂起（平台性能规范要求不可见时停媒体），回来再恢复
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) {
      ctx.suspend();
    } else {
      ctx.resume();
    }
  });

  if (ctx.state === 'suspended') ctx.resume();
  if (musicOn) startBgm();
  log.info('声音引擎就绪', { 合成耗时毫秒: Date.now() - started, 音乐: musicOn, 音效: sfxOn });
}

/** 播放一枚音效（龙吟 / 虎啸 / 同归于尽 / 和棋） */
export function playSfx(name: SfxName): void {
  if (!sfxOn || !ctx || !sfxGain) return;
  const buf = sfxBuffers[name];
  if (!buf) return;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(sfxGain);
  src.start();
}

export function isMusicOn(): boolean {
  return musicOn;
}

export function isSfxOn(): boolean {
  return sfxOn;
}

export function setMusicOn(on: boolean): void {
  musicOn = on;
  writePref(MUSIC_KEY, on);
  if (on) {
    // 设置页的开关本身就是手势，此处可以直接把引擎拉起来
    ensureAudio();
    startBgm();
  } else {
    stopBgm();
  }
}

export function setSfxOn(on: boolean): void {
  sfxOn = on;
  writePref(SFX_KEY, on);
  if (on) ensureAudio();
}
