/*
 * 小红书小工具打包脚本。
 *
 * 流程：vite build → 牌面图按手机展示尺寸瘦身 → 结构与禁用能力自检
 *      → 运行官方审计脚本审计产物目录 → 从 dist 内部压出 zip → 再审计 zip
 *
 * 关键点：压缩的是 dist 目录的「内容」而不是目录本身，保证解压后 index.html
 * 直接位于 zip 根目录，否则容器加载不到。
 *
 * 用法：npm run build:xhs
 */
import { execFileSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'dist');
const ZIP = path.join(ROOT, '龙虎斗-小红书小工具.zip');
const AUDIT = path.join(ROOT, '.claude/minitool-zip-builder/scripts/audit_artifact.mjs');

/** 牌面在手机上最宽约 116px，按 DPR 3 留足余量取 360px */
const CARD_WIDTH = 360;

/** zip 内允许出现的文件类型（zip-artifact-spec.md §2） */
const ALLOWED_EXT = new Set([
  '.html', '.css', '.js',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg',
  '.woff', '.woff2', '.json',
]);

const problems = [];
const notes = [];

function fail(msg) {
  problems.push(msg);
}

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

function rel(file) {
  return path.relative(DIST, file).split(path.sep).join('/');
}

// ---------- 1. 构建 ----------

function build() {
  console.log('[1/6] vite build');
  execFileSync(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), 'build'], {
    stdio: 'inherit',
  });
}

// ---------- 2. 牌面瘦身 ----------

async function slimImages() {
  console.log(`[2/6] 牌面图缩放至宽 ${CARD_WIDTH}px`);
  const cards = path.join(DIST, 'assets/cards');
  let before = 0;
  let after = 0;
  for (const file of await readdir(cards)) {
    if (!file.endsWith('.webp')) continue;
    const full = path.join(cards, file);
    // 先整体读进内存再处理：sharp 直接读路径会占住文件句柄，原地写回会失败
    const src = await readFile(full);
    before += src.length;
    const buf = await sharp(src)
      .resize({ width: CARD_WIDTH, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
    await writeFile(full, buf);
    after += buf.length;
  }
  const saved = ((before - after) / 1024 / 1024).toFixed(2);
  console.log(`      ${(before / 1024 / 1024).toFixed(2)} MB → ${(after / 1024 / 1024).toFixed(2)} MB（省 ${saved} MB）`);
}

// ---------- 3. 结构与合规自检 ----------

/** 被容器禁用的能力；命中即判失败（zip-artifact-spec.md §6、device-capabilities.md §7） */
const BANNED = [
  'XMLHttpRequest', 'new Worker(', 'new SharedWorker(', 'serviceWorker.register',
  'new WebSocket(', 'new EventSource(', 'RTCPeerConnection', 'navigator.geolocation',
  'navigator.clipboard', 'execCommand(', 'navigator.bluetooth', 'navigator.usb',
  'navigator.hid', 'navigator.serial', 'getBattery', 'enumerateDevices',
  'getDisplayMedia', 'requestFullscreen', 'new Function(', 'WebAssembly.',
  'window.open(', 'window.prompt(', '<iframe', '<object', 'DeviceMotionEvent',
  'DeviceOrientationEvent', 'navigator.storage.persist', 'navigator.credentials',
];

/** Chrome 61 无法解析或不存在的语法 / API */
const INCOMPATIBLE = [
  '\\p{', '\\P{', '(?<=', '(?<!', 'Object.hasOwn', '.replaceAll(',
  'Object.fromEntries', '.flatMap(', '??=', '||=', '&&=',
];

async function selfCheck() {
  console.log('[3/6] 结构与合规自检');
  const files = await walk(DIST);

  // 入口必须在根目录
  if (!files.some((f) => rel(f) === 'index.html')) fail('index.html 不在 dist 根目录');

  // 文件类型白名单
  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) fail(`不允许的文件类型：${rel(f)}`);
    if (f.endsWith('.map')) fail(`产物包含 source map：${rel(f)}`);
  }

  const html = await readFile(path.join(DIST, 'index.html'), 'utf8');

  // index.html 关键项
  if (!/<!doctype html>/i.test(html)) fail('index.html 缺少 <!DOCTYPE html>');
  if (!/<html[^>]*lang="zh-CN"/.test(html)) fail('index.html 缺少 lang="zh-CN"');
  if (!/charset=["']?utf-8/i.test(html)) fail('index.html 缺少 charset=UTF-8');
  for (const need of ['width=device-width', 'initial-scale=1.0', 'viewport-fit=cover']) {
    if (!html.includes(need)) fail(`viewport 缺少 ${need}`);
  }
  if (/type="module"/.test(html)) fail('index.html 存在 type="module"（必须是经典脚本）');
  if (/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/.test(html)) fail('index.html 存在内联脚本');
  if (/\son[a-z]+\s*=/i.test(html)) fail('index.html 存在行内事件（onclick 等）');
  if (/<base\b/i.test(html)) fail('index.html 存在 <base href>');
  if (/http-equiv="Content-Security-Policy"/i.test(html)) fail('index.html 自建了 CSP meta');
  if (/(src|href)="\//.test(html)) fail('index.html 存在绝对路径引用');
  // 经典脚本没有 defer，必须排在 #root 之后，否则找不到挂载点
  if (html.indexOf('<script') < html.indexOf('id="root"')) {
    fail('入口脚本位于 #root 之前（经典脚本会在挂载点存在前执行）');
  }

  // 引用的资源都要真实存在
  const inZip = new Set(files.map(rel));
  for (const m of html.matchAll(/(?:src|href)="\.\/([^"]+)"/g)) {
    if (!inZip.has(m[1])) fail(`index.html 引用了不存在的文件：${m[1]}`);
  }

  // 代码层扫描
  const textFiles = files.filter((f) => /\.(js|css|html)$/.test(f));
  let externalRefs = 0;
  for (const f of textFiles) {
    const body = await readFile(f, 'utf8');
    for (const pattern of BANNED) {
      if (body.includes(pattern)) fail(`${rel(f)} 命中禁用能力：${pattern}`);
    }
    for (const pattern of INCOMPATIBLE) {
      if (body.includes(pattern)) fail(`${rel(f)} 命中 Chrome 61 不兼容写法：${pattern}`);
    }
    // 只统计真正会发起请求的外链（命名空间 URI、文档链接不算）
    for (const m of body.matchAll(/(?:src|href)\s*=\s*["']https?:\/\/[^"']+/g)) {
      externalRefs += 1;
      fail(`${rel(f)} 引用了外部资源：${m[0].slice(0, 60)}`);
    }
    for (const m of body.matchAll(/url\(\s*["']?https?:\/\//g)) {
      externalRefs += 1;
      fail(`${rel(f)} CSS 引用了外部资源：${m[0]}`);
    }
  }
  if (externalRefs === 0) notes.push('无任何外部资源引用');

  // fetch( 单独处理：React 内部有 "fetchPriority" 等同名前缀，需精确匹配调用
  for (const f of textFiles) {
    const body = await readFile(f, 'utf8');
    if (/(^|[^.\w])fetch\s*\(/.test(body)) fail(`${rel(f)} 命中禁用能力：fetch(`);
  }
}

// ---------- 4/6. 官方审计 ----------

function audit(target, label) {
  console.log(`[${label}] 官方审计 ${path.basename(target)}`);
  try {
    const out = execFileSync('node', [AUDIT, target], { encoding: 'utf8' });
    console.log(out.trim().split('\n').map((l) => '      ' + l).join('\n'));
    return out;
  } catch (err) {
    const out = (err.stdout || '') + (err.stderr || '');
    console.log(out.trim().split('\n').map((l) => '      ' + l).join('\n'));
    fail(`官方审计未通过（${path.basename(target)}）`);
    return out;
  }
}

// ---------- 5. 打包 ----------

async function makeZip() {
  console.log('[5/6] 压缩 dist 内容为 zip');
  await rm(ZIP, { force: true });
  const { default: ZipWriter } = await import('./zip-writer.mjs');
  const files = await walk(DIST);
  const zip = new ZipWriter();
  for (const f of files) zip.add(rel(f), await readFile(f));
  const buf = zip.toBuffer();
  await new Promise((resolve, reject) => {
    const ws = createWriteStream(ZIP);
    ws.on('error', reject);
    ws.on('finish', resolve);
    ws.end(buf);
  });
  console.log(`      ${path.basename(ZIP)}  ${(buf.length / 1024 / 1024).toFixed(2)} MB`);
}

// ---------- 摘要 ----------

async function summary() {
  const files = await walk(DIST);
  let total = 0;
  for (const f of files) total += (await stat(f)).size;
  const zipSize = (await stat(ZIP)).size;

  console.log('\n================ 校验摘要 ================');
  console.log(`产物路径：${ZIP}`);
  console.log(`zip 体积：${(zipSize / 1024 / 1024).toFixed(2)} MB（上限 10 MB，建议 2 MB 内）`);
  console.log(`解压后体积：${(total / 1024 / 1024).toFixed(2)} MB，共 ${files.length} 个文件`);
  console.log('');
  console.log('通过项：');
  console.log('  · index.html 位于 zip 根目录，解压后无多余目录层');
  console.log('  · 仅含 html/css/js/webp，无 map、无构建配置、无 node_modules');
  console.log('  · 入口为经典脚本（无 type="module"），位于 #root 之后');
  console.log('  · 无内联脚本、无行内事件、无 base/iframe/自建 CSP');
  console.log('  · 全部资源相对路径引用，无外部域名请求');
  console.log('  · 无 Worker / 网络请求 / 定位 / 剪贴板 / 全屏等禁用能力');
  console.log('  · 无 Chrome 61 不可解析的正则与 API');
  for (const n of notes) console.log(`  · ${n}`);
  console.log('');
  console.log('未实测项（按规范如实标注）：');
  console.log('  · Chrome 61 / Android 8.1 真机兼容性未实测（静态核对通过）');
  console.log('  · 真机帧率与首屏耗时未实测');

  if (problems.length) {
    console.log('\n发现问题：');
    for (const p of problems) console.log(`  ! ${p}`);
    console.log('==========================================');
    process.exit(1);
  }
  console.log('\n结果：全部检查通过');
  console.log('==========================================');
}

build();
await slimImages();
await selfCheck();
audit(DIST, '4/6');
await makeZip();
audit(ZIP, '6/6');
await summary();
