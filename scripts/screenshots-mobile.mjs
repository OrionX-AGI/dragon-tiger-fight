// 手机竖屏视口下的界面核对截图，输出到 docs/screenshots-mobile/。
// 浏览器用系统自带的 Edge，无需下载 Chromium。
//
// 用法（三步，最后一步另开窗口）：
//   npm i --no-save playwright-core
//   npm run build:xhs && npx vite preview --port 4173 --host 127.0.0.1
//   node scripts/screenshots-mobile.mjs
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import sharp from 'sharp';

const BASE = 'http://127.0.0.1:4173';
const RAW = 'scripts/.shots-raw';
const OUT = 'docs/screenshots-mobile';

// iPhone 12/13 一档（390×844）与最小常见档（360×640）
const VIEWPORTS = [
  { tag: '390', width: 390, height: 844 },
  { tag: '360', width: 360, height: 640 },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shoot(page, name) {
  await page.screenshot({ path: `${RAW}/${name}.png`, fullPage: true });
  console.log(`  captured ${name}`);
}

/** 横向溢出是竖屏适配最容易翻车的地方，直接读文档宽度判断 */
async function checkOverflow(page, label, width) {
  const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
  const flag = scrollW > width ? `横向溢出 ${scrollW - width}px` : 'OK';
  console.log(`  [${label}] 文档宽 ${scrollW} / 视口 ${width} → ${flag}`);
  return scrollW <= width;
}

/** 纵向能否一屏看完（本轮优化的核心目标） */
async function checkHeight(page, label, height) {
  const scrollH = await page.evaluate(() => document.documentElement.scrollHeight);
  const over = scrollH - height;
  console.log(
    `  [${label}] 文档高 ${scrollH} / 视口 ${height} → ${over > 0 ? `需滑动 ${over}px` : '一屏可见'}`,
  );
  return over;
}

/**
 * 关键文案不折行。用 getClientRects().length 判断：行内元素每换一行多一个 rect，
 * 所以 >1 就是折行了。块级元素改用高度与行高的比值判断。
 */
async function checkNoWrap(page, label, selectors) {
  const results = await page.evaluate((sels) => {
    const out = [];
    for (const sel of sels) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const style = getComputedStyle(el);
      const lineH = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
      const inline = style.display.indexOf('inline') === 0;
      // 块级元素要扣掉自身内边距，否则 padding 会被误算成多出来的一行
      const contentH =
        el.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      const lines = inline ? el.getClientRects().length : Math.round(contentH / lineH);
      out.push({ sel, lines, text: (el.textContent || '').trim().slice(0, 24) });
    }
    return out;
  }, selectors);

  let ok = true;
  for (const r of results) {
    if (r.lines > 1) {
      ok = false;
      console.log(`  [${label}] 折行 ${r.lines} 行：${r.sel}  "${r.text}"`);
    }
  }
  return ok;
}

/** 损失面板必须与棋盘同宽，否则视觉上是两块不相干的东西 */
async function checkCapturedWidth(page, label) {
  const r = await page.evaluate(() => {
    const grid = document.querySelector('.board-grid');
    const cols = Array.from(document.querySelectorAll('.captured-col'));
    if (!grid || cols.length === 0) return null;
    return { grid: grid.offsetWidth, cols: cols.map((c) => c.offsetWidth) };
  });
  if (!r) {
    console.log(`  [${label}] 暂无损失面板，跳过同宽检查`);
    return true;
  }
  const bad = r.cols.filter((w) => w !== r.grid);
  console.log(`  [${label}] 棋盘宽 ${r.grid} / 损失面板 ${r.cols.join(',')} → ${bad.length ? '不一致' : 'OK'}`);
  return bad.length === 0;
}

async function backToLobby(page) {
  const back = page.locator('button', { hasText: '返回大厅' }).first();
  if (await back.isVisible().catch(() => false)) {
    await back.click();
    const force = page.locator('button', { hasText: '强制退出' });
    if (await force.isVisible().catch(() => false)) await force.click();
  }
  await page.waitForSelector('.lobby', { timeout: 5000 });
  await sleep(400);
}

async function runViewport(browser, vp) {
  console.log(`\n== 视口 ${vp.width}×${vp.height} ==`);
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  let ok = true;

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.lobby');
  await sleep(500);
  ok = (await checkOverflow(page, '大厅', vp.width)) && ok;
  await checkHeight(page, '大厅', vp.height);
  ok = (await checkNoWrap(page, '大厅', ['.lobby-subtitle'])) && ok;
  await shoot(page, `lobby-${vp.tag}`);

  await page.locator('.game-panel', { hasText: '纸牌对拼' }).locator('.panel-start').click();
  await page.waitForSelector('.game-screen');
  await sleep(1200);
  ok = (await checkOverflow(page, '纸牌', vp.width)) && ok;
  await checkHeight(page, '纸牌·记牌', vp.height);
  ok = (await checkNoWrap(page, '纸牌·记牌', ['.score-tag', '.center-note'])) && ok;
  await shoot(page, `card-${vp.tag}`);

  // 打一个回合，核对揭示阶段的"X 吃掉 Y"整宽行不折行。
  // 必须等 zone-active 出现：记牌阶段手牌还不可点，确认按钮也是 disabled。
  await page.waitForSelector('.hand-zone.zone-active', { timeout: 15000 });
  const cards = page.locator('.hand-zone.zone-active .hand-cards .card-view');
  await cards.nth(0).click();
  await page.locator('.action-bar .btn-primary:not([disabled])').click();
  await page.waitForSelector('.center-note', { timeout: 15000 });
  await sleep(1400);
  ok = (await checkOverflow(page, '纸牌·揭示', vp.width)) && ok;
  await checkHeight(page, '纸牌·揭示', vp.height);
  ok = (await checkNoWrap(page, '纸牌·揭示', ['.center-note', '.score-tag'])) && ok;
  await shoot(page, `card-reveal-${vp.tag}`);

  await backToLobby(page);
  const boardPanel = page.locator('.game-panel', { hasText: '棋盘翻棋' });
  await boardPanel.locator('.opt-btn', { hasText: '我先手' }).click();
  await boardPanel.locator('.panel-start').click();
  await page.waitForSelector('.board-grid');
  await sleep(700);
  const faceDown = () => page.locator('.board-cell:has(img[alt="牌背"])');
  const captured = () => page.locator('.captured-col');
  // 翻到两侧损失面板都有牌就停：同宽检查需要面板存在，多翻只是白等 AI 思考
  for (let i = 0; i < 12; i += 1) {
    if ((await captured().count()) >= 2) break;
    const before = await faceDown().count();
    if (before <= 4) break;
    await faceDown().nth(i % before).click();
    for (let w = 0; w < 16; w += 1) {
      await sleep(300);
      if ((await faceDown().count()) < before) break;
    }
    await sleep(600);
  }
  ok = (await checkOverflow(page, '棋盘', vp.width)) && ok;
  await checkHeight(page, '棋盘', vp.height);
  ok = (await checkCapturedWidth(page, '棋盘')) && ok;
  ok =
    (await checkNoWrap(page, '棋盘', [
      '.status-row .tag-seat',
      '.score-row .score-tag',
      '.turn-banner',
    ])) && ok;
  await shoot(page, `board-${vp.tag}`);

  await backToLobby(page);
  await page.locator('button', { hasText: '1分钟掌握游戏规则' }).click();
  await page.waitForSelector('.rules-screen');
  await sleep(500);
  ok = (await checkOverflow(page, '规则', vp.width)) && ok;
  await shoot(page, `rules-${vp.tag}`);

  await ctx.close();
  return ok;
}

const SHOT_NAMES = ['lobby', 'card', 'card-reveal', 'board', 'rules'];

async function main() {
  await mkdir(RAW, { recursive: true });
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge' });

  let allOk = true;
  const names = [];
  for (const vp of VIEWPORTS) {
    allOk = (await runViewport(browser, vp)) && allOk;
    for (const p of SHOT_NAMES) names.push(`${p}-${vp.tag}`);
  }
  await browser.close();

  console.log('\n压缩为 webp');
  for (const name of names) {
    await sharp(`${RAW}/${name}.png`).resize({ width: 420 }).webp({ quality: 80 })
      .toFile(`${OUT}/${name}.webp`);
  }
  console.log(allOk ? '\n布局检查全部通过' : '\n存在布局问题，见上方输出');
  if (!allOk) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
