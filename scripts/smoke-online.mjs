/**
 * 联机服务器端到端冒烟测试：
 * 模拟两名玩家完成 建房 → 房间码入座 → 双方准备开局 → 打一回合 → 认输 → 战绩 全流程。
 * 用法：先启动服务器（npm run server），再运行 node scripts/smoke-online.mjs
 */
import WebSocket from 'ws';

const URL = 'ws://127.0.0.1:8787/ws';
const timeoutAt = Date.now() + 25000;

function connect(clientId, name) {
  const ws = new WebSocket(URL);
  const inbox = [];
  ws.on('message', (raw) => inbox.push(JSON.parse(String(raw))));
  const client = {
    ws,
    inbox,
    send: (msg) => ws.send(JSON.stringify(msg)),
    async wait(predicate, label) {
      for (;;) {
        const found = inbox.find(predicate);
        if (found) return found;
        if (Date.now() > timeoutAt) throw new Error(`等待超时：${label}`);
        await new Promise((r) => setTimeout(r, 30));
      }
    },
  };
  return new Promise((resolve, reject) => {
    ws.on('open', () => {
      client.send({ type: 'hello', clientId, name });
      resolve(client);
    });
    ws.on('error', reject);
  });
}

const steps = [];
function ok(label) {
  steps.push(label);
  console.log(`  [OK] ${label}`);
}

try {
  const a = await connect('smoke-a', '甲');
  const b = await connect('smoke-b', '乙');
  await a.wait((m) => m.type === 'helloOk', 'A helloOk');
  await b.wait((m) => m.type === 'helloOk', 'B helloOk');
  ok('双方连接并完成握手');

  a.send({ type: 'createRoom', gameType: 'card' });
  const roomMsg = await a.wait((m) => m.type === 'roomUpdate', 'A roomUpdate');
  const code = roomMsg.room.code;
  ok(`甲创建纸牌房间，房间码 ${code}`);

  const listMsg = await b.wait((m) => m.type === 'roomList' && m.rooms.length > 0, 'B 大厅列表');
  if (listMsg.rooms[0].code !== code) throw new Error('大厅列表中的房间码不一致');
  ok('乙在大厅列表中看到该房间');

  b.send({ type: 'joinByCode', code });
  await b.wait((m) => m.type === 'roomUpdate' && m.room.seats[1] !== null, 'B 入座');
  ok('乙凭房间码入座');

  a.send({ type: 'setReady', ready: true });
  await b.wait((m) => m.type === 'roomUpdate' && m.room.status === 'countdown', '倒计时启动');
  ok('甲准备后倒计时启动');

  b.send({ type: 'setReady', ready: true });
  const va = (await a.wait((m) => m.type === 'cardState', 'A 对局视图')).view;
  const vb = (await b.wait((m) => m.type === 'cardState', 'B 对局视图')).view;
  if (va.yourFaction === vb.yourFaction) throw new Error('双方阵营相同');
  ok(`对局开始：甲执${va.yourFaction === 'dragon' ? '龙' : '虎'}，乙执${vb.yourFaction === 'dragon' ? '龙' : '虎'}`);

  a.send({ type: 'cardPick', rank: 3 });
  const committed = (
    await b.wait((m) => m.type === 'cardState' && m.view.opponentCommitted, 'B 看到对方扣牌')
  ).view;
  if (committed.history.length !== 0) throw new Error('对方出牌提前泄露');
  ok('甲扣牌后乙只看到"已扣牌"，牌面未泄露');

  b.send({ type: 'cardPick', rank: 5 });
  const resolved = (
    await a.wait((m) => m.type === 'cardState' && m.view.history.length === 1, '回合结算')
  ).view;
  ok(`回合揭示并结算：龙出 ${resolved.history[0].dragon}，虎出 ${resolved.history[0].tiger}`);

  b.send({ type: 'surrender' });
  const over = (await a.wait((m) => m.type === 'cardState' && m.view.outcome !== null, '对局结束')).view;
  if (over.endReason !== 'surrender') throw new Error('结束原因不是认输');
  const finished = (
    await a.wait((m) => m.type === 'roomUpdate' && m.room.status === 'finished', '房间结算')
  ).room;
  if (finished.wins[0] !== 1) throw new Error('比分未正确累计');
  if (finished.seriesOver) throw new Error('1 胜不应结束三局两胜系列');
  if (finished.nextGameRemainingMs === null) throw new Error('系列未定却没有局间倒计时');
  ok(`乙认输，甲获胜，比分 ${finished.wins[0]}:${finished.wins[1]}，局间倒计时已启动`);

  // 等待 5 秒局间倒计时结束，自动开始第 2 局（阵营互换、全新一局）
  const game2 = (
    await a.wait(
      (m) => m.type === 'cardState' && m.view.gameIndex === 1 && m.view.outcome === null,
      '自动开始第 2 局',
    )
  ).view;
  if (game2.yourFaction !== 'tiger') throw new Error('第 2 局阵营未互换');
  if (game2.history.length !== 0) throw new Error('第 2 局不是全新一局');
  ok('5 秒后自动开始第 2 局，阵营已互换');

  a.ws.close();
  b.ws.close();
  console.log(`\n冒烟测试全部通过（${steps.length} 步）`);
  process.exit(0);
} catch (err) {
  console.error(`\n冒烟测试失败：${err.message}`);
  process.exit(1);
}
