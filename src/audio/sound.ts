/**
 * 声音引擎：背景音乐与音效全部用 Web Audio 在运行时合成，零媒体文件。
 *
 * 为什么不用音频文件：
 *   - 小红书小工具是离线 zip 包，媒体文件必须打进包内，一段 1 分钟 BGM
 *     约 0.7-1MB，会把包体推向 2MB 建议线；纯代码合成零字节。
 *   - 容器 CSP 禁止 data:/blob: 媒体源，运行时生成的音频没法喂给 <audio>；
 *     Web Audio 直接走音频线程，不经过媒体元素，不受此限制。
 *   - 完全自己合成，无任何第三方授权问题。
 *
 * 音效设计（实测教训：模仿龙吟虎啸的拟声很难听，简短干净的乐音才好听）：
 *   - dragon（龙方吃子）：三连升调铃音，明亮清脆
 *   - tiger（虎方吃子）：两连降调木鱼声，低沉温润，与龙方一升一降好分辨
 *   - mutual（同归于尽）：金属撞击 + 低频闷响
 *   - draw（和棋）：一记磬声
 *   - victory / defeat（终局按玩家胜负播，不按阵营）：军号上行版胜利号 /
 *     下行三音的失落乐句
 *
 * 实现要点：
 *   - 所有音色在初始化时用纯 JS 数学预渲染进 AudioBuffer（拨弦用
 *     Karplus-Strong 算法，其余逐采样加法合成），之后播放只是零成本的
 *     buffer 调度。刻意不用 ScriptProcessorNode：棋盘困难 AI 会阻塞主线程
 *     约 1 秒，实时生成必然爆音。
 *   - BGM 调度器提前约 3 秒排音符，主线程被 AI 占住时音乐不断。
 *   - 浏览器自动播放策略要求用户手势后才能出声，main.tsx 在首次
 *     pointerdown 时调用 ensureAudio()。
 *   - 兼容基线 Chrome 61：AudioContext 带 webkit 前缀回退，不用
 *     Object.fromEntries / globalThis 等晚于基线的 API。
 */

import { createLogger } from '../core/logger';

const log = createLogger('audio');

export type SfxName = 'dragon' | 'tiger' | 'mutual' | 'draw' | 'victory' | 'defeat';

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

/** 拍速与循环长度：84 BPM、64 拍一循环（约 46 秒） */
const SPB = 60 / 84;
const LOOP_BEATS = 64;

/**
 * [拍号, MIDI 音高, 音量]。A 羽调式五声音阶（A C D E G）。
 * 旋律基本一拍一音、句尾留长音，比首版（66 BPM、大量空拍）更连贯流畅；
 * 低音声部每 8 拍一个撑住底。初始化时按拍号排序。
 */
const SEQ: Array<[number, number, number]> = [
  // 低音声部
  [0, 45, 0.38], [8, 52, 0.32], [16, 50, 0.34], [24, 45, 0.38],
  [32, 45, 0.38], [40, 52, 0.32], [48, 50, 0.34], [56, 45, 0.38],
  // 旋律声部：起
  [0, 69, 0.56], [1, 72, 0.48], [2, 74, 0.52], [3.5, 76, 0.58], [4, 74, 0.46],
  [5, 72, 0.44], [6, 69, 0.5], [7.5, 67, 0.4], [8, 69, 0.52],
  [10, 72, 0.46], [11, 74, 0.48], [12, 76, 0.54], [13, 74, 0.44], [14, 72, 0.42], [15, 74, 0.46],
  // 承
  [16, 76, 0.54], [17, 79, 0.5], [18, 76, 0.46], [19, 74, 0.44], [20, 72, 0.48],
  [21, 74, 0.44], [22, 72, 0.42], [23, 69, 0.46], [24, 72, 0.48], [25, 69, 0.44],
  [26, 67, 0.4], [27, 69, 0.5], [30, 64, 0.4], [31, 67, 0.42],
  // 转
  [32, 69, 0.56], [33, 72, 0.48], [34, 74, 0.52], [35.5, 76, 0.56], [36, 79, 0.54],
  [37, 76, 0.46], [38, 74, 0.44], [39, 72, 0.42], [40, 74, 0.5], [41, 76, 0.48],
  [42, 74, 0.44], [43, 72, 0.42], [44, 69, 0.5], [45, 72, 0.44], [46, 69, 0.42], [47, 67, 0.4],
  // 合
  [48, 64, 0.46], [49, 67, 0.42], [50, 69, 0.5], [51, 72, 0.46], [52, 69, 0.44],
  [53, 67, 0.4], [54, 64, 0.42], [55, 62, 0.38], [56, 64, 0.44], [57, 67, 0.42],
  [58, 69, 0.54], [62, 69, 0.36],
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

/** 峰值归一化到 0.85，并做尾部 100ms 淡出消除截断爆音 */
function polish(data: Float32Array, sr: number): void {
  let peak = 0;
  for (let i = 0; i < data.length; i++) {
    const a = Math.abs(data[i]);
    if (a > peak) peak = a;
  }
  const k = peak > 0 ? 0.85 / peak : 1;
  const fade = Math.min(data.length, Math.floor(sr * 0.1));
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
 * 往波形里叠一枚音符：谐波叠加 + 起振 / 指数衰减 / 尾部收音包络。
 * harmonics[k] 是第 k+1 次谐波的幅度；tau 大约等于余音时长。
 */
function addNote(
  data: Float32Array,
  sr: number,
  o: {
    at: number;
    freq: number;
    dur: number;
    vol: number;
    attack: number;
    tau: number;
    harmonics: number[];
    /** 颤音幅度（Hz），军号长音用 */
    vibrato?: number;
    /** 整个音期间的音高滑落（半音数，负为下滑） */
    bend?: number;
  },
): void {
  const start = Math.floor(o.at * sr);
  const n = Math.min(data.length - start, Math.floor(o.dur * sr));
  const relSamples = Math.max(1, Math.floor(sr * 0.035));
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let f = o.freq;
    if (o.bend) f *= Math.pow(2, (o.bend * (t / o.dur)) / 12);
    if (o.vibrato) f += Math.sin(2 * Math.PI * 5.5 * t) * o.vibrato * Math.min(1, t / 0.25);
    phase += (2 * Math.PI * f) / sr;
    let v = 0;
    for (let h = 0; h < o.harmonics.length; h++) {
      if (o.harmonics[h] !== 0) v += o.harmonics[h] * Math.sin((h + 1) * phase);
    }
    const env =
      Math.min(1, t / o.attack) * Math.exp(-t / o.tau) * Math.min(1, (n - i) / relSamples);
    data[start + i] += v * env * o.vol;
  }
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

/** 龙方吃子：E5→A5→E6 三连升调铃音，明亮清脆 */
function renderDragon(c: AudioContext): AudioBuffer {
  const sr = c.sampleRate;
  const out = new Float32Array(Math.floor(sr * 0.55));
  const bell = [1, 0.35, 0.12];
  addNote(out, sr, { at: 0, freq: 659.3, dur: 0.4, vol: 0.7, attack: 0.005, tau: 0.14, harmonics: bell });
  addNote(out, sr, { at: 0.08, freq: 880, dur: 0.4, vol: 0.75, attack: 0.005, tau: 0.14, harmonics: bell });
  addNote(out, sr, { at: 0.16, freq: 1318.5, dur: 0.39, vol: 0.85, attack: 0.005, tau: 0.16, harmonics: bell });
  polish(out, sr);
  return toBuffer(c, out);
}

/** 虎方吃子：A4→D4 两连降调木鱼声，低沉温润，与龙方一升一降 */
function renderTiger(c: AudioContext): AudioBuffer {
  const sr = c.sampleRate;
  const out = new Float32Array(Math.floor(sr * 0.5));
  // 奇次谐波近似木头空腔的音色
  const wood = [1, 0, 0.28, 0, 0.09];
  addNote(out, sr, { at: 0, freq: 440, dur: 0.32, vol: 0.8, attack: 0.004, tau: 0.09, harmonics: wood });
  addNote(out, sr, { at: 0.11, freq: 293.7, dur: 0.38, vol: 0.9, attack: 0.004, tau: 0.12, harmonics: wood });
  // 第一声垫一点低频身体感
  addNote(out, sr, { at: 0, freq: 110, dur: 0.25, vol: 0.5, attack: 0.004, tau: 0.1, harmonics: [1] });
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

/** 玩家获胜：军号上行 G4-C5-E5-G5 胜利号，末音带颤音拉长 */
function renderVictory(c: AudioContext): AudioBuffer {
  const sr = c.sampleRate;
  const out = new Float32Array(Math.floor(sr * 1.5));
  // 亮铜管音色：谐波衰减慢
  const brass = [1, 0.6, 0.45, 0.3, 0.2, 0.12];
  const base = { vol: 0.6, attack: 0.02, tau: 2.5, harmonics: brass };
  addNote(out, sr, { at: 0, freq: 392, dur: 0.18, ...base });
  addNote(out, sr, { at: 0.19, freq: 523.3, dur: 0.18, ...base });
  addNote(out, sr, { at: 0.38, freq: 659.3, dur: 0.18, ...base });
  addNote(out, sr, { at: 0.57, freq: 784, dur: 0.88, vol: 0.65, attack: 0.02, tau: 0.9, harmonics: brass, vibrato: 6 });
  polish(out, sr);
  return toBuffer(c, out);
}

/** 玩家落败：E4-C4-A3 下行三音，柔音色，末音再往下滑半音 */
function renderDefeat(c: AudioContext): AudioBuffer {
  const sr = c.sampleRate;
  const out = new Float32Array(Math.floor(sr * 1.35));
  const soft = [1, 0.3, 0.1];
  addNote(out, sr, { at: 0, freq: 329.6, dur: 0.34, vol: 0.7, attack: 0.04, tau: 0.5, harmonics: soft });
  addNote(out, sr, { at: 0.35, freq: 261.6, dur: 0.34, vol: 0.7, attack: 0.04, tau: 0.5, harmonics: soft });
  addNote(out, sr, { at: 0.7, freq: 220, dur: 0.6, vol: 0.75, attack: 0.04, tau: 0.5, harmonics: soft, bend: -1 });
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
  sfxBuffers.victory = renderVictory(ctx);
  sfxBuffers.defeat = renderDefeat(ctx);
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

/** 播放一枚音效 */
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
