// 自动截取游戏界面，输出到 docs/screenshots/ 供 README 展示。
// 浏览器用系统自带的 Edge，无需下载 Chromium。
// 联机截图需要真实的服务器，因此统一跑在联机服务器上（它同时托管静态页面）。
//
// 用法（三步，最后一步另开窗口）：
//   npm i --no-save playwright-core
//   npm run build && npm run server
//   node scripts/screenshots.mjs
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import sharp from 'sharp';

const BASE = 'http://127.0.0.1:8787';
const RAW = 'scripts/.shots-raw';
const OUT = 'docs/screenshots';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shoot(page, name, opts = {}) {
  await page.screenshot({ path: `${RAW}/${name}.png`, ...opts });
  console.log(`  captured ${name}`);
}

async function backToLobby(page) {
  const back = page.locator('button', { hasText: '返回大厅' }).first();
  if (await back.isVisible().catch(() => false)) {
    await back.click();
    // 对局中途退出会先弹确认框
    const force = page.locator('button', { hasText: '强制退出' });
    if (await force.isVisible().catch(() => false)) await force.click();
  }
  await page.waitForSelector('.lobby', { timeout: 5000 });
  await sleep(400);
}

// 进入在线大厅并改好昵称
async function enterOnline(target, nickname) {
  await target.locator('button', { hasText: '进入在线大厅' }).click();
  await target.waitForSelector('.online-lobby');
  const nameInput = target.locator('.online-name-box .online-input');
  await nameInput.fill(nickname);
  await nameInput.press('Enter');
  await sleep(600);
}

// 联机截图需要两名玩家，第二名玩家用独立的浏览器上下文（localStorage 隔离，才算不同的人）
async function onlineShots(browser, page) {
  await enterOnline(page, '执龙客');

  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
  const pageB = await ctxB.newPage();
  await pageB.goto(BASE, { waitUntil: 'networkidle' });
  await enterOnline(pageB, '执虎客');
  await pageB.locator('button', { hasText: '创建房间' }).click();
  await pageB.waitForSelector('.online-room');
  await sleep(800);

  // 甲方大厅此时能看到乙方开的牌桌
  await page.waitForSelector('.online-room-row', { timeout: 8000 });
  await sleep(400);
  await shoot(page, 'online-lobby');

  await page.locator('.online-room-row button', { hasText: '加入' }).first().click();
  await page.waitForSelector('.online-room');
  await sleep(800);
  // 乙方先准备，甲方界面上会出现 15 秒倒计时
  await pageB.locator('.online-room-actions .btn-primary').click();
  await sleep(1200);
  await shoot(page, 'online-room');

  await ctxB.close();
}

async function main() {
  await mkdir(RAW, { recursive: true });
  await mkdir(OUT, { recursive: true });

  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 860 },
    deviceScaleFactor: 2,
  });

  console.log('大厅');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.lobby');
  await sleep(600);
  await shoot(page, 'lobby', { fullPage: true }); // 面板可能超出一屏

  console.log('纸牌对拼');
  await page.locator('.game-panel', { hasText: '纸牌对拼' }).locator('.panel-start').click();
  await page.waitForSelector('.game-screen');
  await sleep(1200); // 记牌阶段：八张牌明牌展示
  await shoot(page, 'card-preview');

  // 打三个回合，让弃牌区和比分有内容
  for (let round = 0; round < 3; round += 1) {
    const cards = page.locator('.hand-zone.zone-active .hand-cards .card-view');
    await cards.first().waitFor({ timeout: 15000 });
    await cards.nth(round).click();
    await page.locator('.action-bar .btn-primary').click();
    await sleep(2000); // 亮牌动画 + 结果展示
    if (round === 2) await shoot(page, 'card-play');
    await sleep(1600); // 等待自动进入下一回合
  }

  console.log('棋盘翻棋');
  await backToLobby(page);
  const boardPanel = page.locator('.game-panel', { hasText: '棋盘翻棋' });
  await boardPanel.locator('.opt-btn', { hasText: '我先手' }).click(); // 固定先手，便于脚本操作
  await boardPanel.locator('.panel-start').click();
  await page.waitForSelector('.board-grid');
  await sleep(800);

  const faceDown = () => page.locator('.board-cell:has(img[alt="牌背"])');
  for (let i = 0; i < 14; i += 1) {
    const before = await faceDown().count();
    if (before <= 5) break; // 留几张暗牌，画面更像真实中局
    await faceDown().nth(i % before).click();
    // 点击可能落在 AI 思考期间被忽略，轮询到棋盘真的变化为止
    for (let wait = 0; wait < 20; wait += 1) {
      await sleep(400);
      if ((await faceDown().count()) < before) break;
    }
    await sleep(1200); // 等 AI 应手结束
  }
  await sleep(800);
  await shoot(page, 'board');

  console.log('规则页');
  await backToLobby(page);
  await page.locator('button', { hasText: '1分钟掌握游戏规则' }).click();
  await page.waitForSelector('.rules-screen');
  await sleep(600);
  await shoot(page, 'rules');

  console.log('在线大厅与房间');
  await backToLobby(page);
  await onlineShots(browser, page);

  await browser.close();

  console.log('压缩为 webp');
  for (const name of ['lobby', 'card-preview', 'card-play', 'board', 'rules', 'online-lobby', 'online-room']) {
    await sharp(`${RAW}/${name}.png`)
      .resize({ width: 1280 })
      .webp({ quality: 82 })
      .toFile(`${OUT}/${name}.webp`);
    console.log(`  ${OUT}/${name}.webp`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
