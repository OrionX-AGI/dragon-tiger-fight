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
  await shoot(page, `lobby-${vp.tag}`);

  await page.locator('.game-panel', { hasText: '纸牌对拼' }).locator('.panel-start').click();
  await page.waitForSelector('.game-screen');
  await sleep(1200);
  ok = (await checkOverflow(page, '纸牌', vp.width)) && ok;
  await shoot(page, `card-${vp.tag}`);

  await backToLobby(page);
  const boardPanel = page.locator('.game-panel', { hasText: '棋盘翻棋' });
  await boardPanel.locator('.opt-btn', { hasText: '我先手' }).click();
  await boardPanel.locator('.panel-start').click();
  await page.waitForSelector('.board-grid');
  await sleep(700);
  const faceDown = () => page.locator('.board-cell:has(img[alt="牌背"])');
  for (let i = 0; i < 8; i += 1) {
    const before = await faceDown().count();
    if (before <= 8) break;
    await faceDown().nth(i % before).click();
    for (let w = 0; w < 20; w += 1) {
      await sleep(400);
      if ((await faceDown().count()) < before) break;
    }
    await sleep(900);
  }
  ok = (await checkOverflow(page, '棋盘', vp.width)) && ok;
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

async function main() {
  await mkdir(RAW, { recursive: true });
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge' });

  let allOk = true;
  const names = [];
  for (const vp of VIEWPORTS) {
    allOk = (await runViewport(browser, vp)) && allOk;
    for (const p of ['lobby', 'card', 'board', 'rules']) names.push(`${p}-${vp.tag}`);
  }
  await browser.close();

  console.log('\n压缩为 webp');
  for (const name of names) {
    await sharp(`${RAW}/${name}.png`).resize({ width: 420 }).webp({ quality: 80 })
      .toFile(`${OUT}/${name}.webp`);
  }
  console.log(allOk ? '\n所有视口无横向溢出' : '\n存在横向溢出，需修正样式');
  if (!allOk) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
