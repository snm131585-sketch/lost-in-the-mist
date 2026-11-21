// 端到端测试：在真实 Chromium 中通过键盘/鼠标/触屏事件完整通关
// 用法：PLAYWRIGHT_BROWSERS_PATH=... node tests/e2e.mjs
// 角色移动全部走真实键盘事件（页面内自动导航只负责「按哪个方向键」），
// 不使用瞬移，因此同时验证了地图可达性与碰撞。
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/npm-tools/node_modules/playwright'); }
const { chromium, devices } = pw;
const OUT = resolve(root, 'tests/output');
mkdirSync(OUT, { recursive: true });
const URL = process.env.GAME_URL || 'file://' + resolve(root, 'dist/index.html');

const results = [];
const errors = [];
const log = (...a) => console.log(...a);
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail: String(detail) });
  log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
const watch = (p, tag) => {
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${tag}] ${m.type()}: ${m.text()}`); });
  p.on('pageerror', (e) => errors.push(`[${tag}] pageerror: ${e.message}`));
};

// ---------- 页面内工具：BFS 寻路 + 键盘自动导航 ----------
const helpers = () => {
  const G = window.__LITM__;
  const TILE = 32, W = 96, H = 72;
  const walk = (x, y) => x >= 0 && y >= 0 && x < W && y < H && !G.map.blocked[y * W + x];
  window.__bfs = (fromPx, goalFn) => {
    const sx = Math.floor(fromPx.x / TILE), sy = Math.floor(fromPx.y / TILE);
    const prev = new Int32Array(W * H).fill(-2);
    const q = [sy * W + sx]; prev[q[0]] = -1;
    let head = 0, found = -1;
    while (head < q.length) {
      const c = q[head++]; const cx = c % W, cy = (c / W) | 0;
      if (goalFn(cx, cy)) { found = c; break; }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (!walk(nx, ny) || prev[ny * W + nx] !== -2) continue;
        prev[ny * W + nx] = c; q.push(ny * W + nx);
      }
    }
    if (found < 0) return null;
    const path = [];
    for (let c = found; c !== -1; c = prev[c]) path.push({ x: (c % W) * TILE + 16, y: ((c / W) | 0) * TILE + 16 });
    return path.reverse();
  };
  const keys = { w: false, a: false, s: false, d: false };
  const setKey = (k, on) => {
    if (keys[k] === on) return;
    keys[k] = on;
    window.dispatchEvent(new KeyboardEvent(on ? 'keydown' : 'keyup', { key: k }));
  };
  window.__releaseKeys = () => ['w', 'a', 's', 'd'].forEach((k) => setKey(k, false));
  window.__drive = (path, finalPt) => new Promise((resolveP) => {
    let i = 1; let lastProg = performance.now(); let best = 1e9;
    const pts = path.slice();
    if (finalPt) pts.push(finalPt);
    const step = () => {
      const p = G.player;
      if (i >= pts.length) { window.__releaseKeys(); resolveP({ ok: true }); return; }
      const t = pts[i];
      const dx = t.x - p.x, dy = t.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d < 7) { i++; best = 1e9; lastProg = performance.now(); requestAnimationFrame(step); return; }
      if (d < best - 1) { best = d; lastProg = performance.now(); }
      if (performance.now() - lastProg > 4000) { window.__releaseKeys(); resolveP({ ok: false, at: { x: p.x, y: p.y }, wp: t, i, n: pts.length }); return; }
      setKey('d', dx > 3); setKey('a', dx < -3); setKey('s', dy > 3); setKey('w', dy < -3);
      requestAnimationFrame(step);
    };
    step();
  });
};

async function walkTo(page, goal) {
  // goal: {x,y} 像素；走到距离 goal 最近的可行走瓦片，再贴近目标
  const r = await page.evaluate(async (g) => {
    const G = window.__LITM__;
    const gx = Math.floor(g.x / 32), gy = Math.floor(g.y / 32);
    const path = window.__bfs(G.player, (x, y) => Math.abs(x - gx) + Math.abs(y - gy) <= (g.near ?? 1) && Math.hypot(x * 32 + 16 - g.x, y * 32 + 16 - g.y) < (g.radius ?? 44));
    if (!path) return { ok: false, reason: 'no path' };
    const res = await window.__drive(path, g.approach ? { x: g.x, y: g.y + 10 } : null);
    return { ...res, len: path.length };
  }, goal);
  return r;
}

async function gatherKind(page, kind, need, item) {
  let trips = 0;
  while (true) {
    const have = await page.evaluate((it) => window.__LITM__.state.gathered[it] ?? 0, item);
    if (have >= need) return { ok: true, trips };
    if (trips > 25) return { ok: false, trips, have };
    const node = await page.evaluate((k) => {
      const G = window.__LITM__;
      const p = G.player;
      const cand = G.resources.filter((o) => o.res === k && G.nodeAvailable(o));
      cand.sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y));
      // 选择真正有路径可达的最近节点
      for (const o of cand.slice(0, 8)) {
        const path = window.__bfs(p, (x, y) => Math.hypot(x * 32 + 16 - o.x, y * 32 + 16 - o.y) < 40);
        if (path) return { id: o.id, x: o.x, y: o.y };
      }
      return null;
    }, kind);
    if (!node) return { ok: false, reason: 'no reachable node', trips };
    const w = await walkTo(page, { x: node.x, y: node.y, near: 2, radius: 40 });
    if (!w.ok) return { ok: false, reason: 'walk failed', w, trips };
    // 确认交互目标就是这个节点
    const tgt = await page.evaluate(() => window.__LITM__.target?.obj?.id ?? null);
    if (tgt !== node.id) {
      // 贴近一点
      await page.evaluate(async (n) => { await window.__drive([window.__LITM__.player, { x: n.x, y: n.y + 14 }]); }, node);
    }
    await page.keyboard.press('e');
    await page.waitForTimeout(1350);
    trips++;
  }
}

async function craftViaUi(page, id) {
  await page.keyboard.press('b');
  await page.waitForTimeout(250);
  const btn = page.locator(`[data-craft="${id}"]`);
  const enabled = await btn.isEnabled();
  if (enabled) await btn.click();
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  return enabled;
}

const state = (page) => page.evaluate(() => {
  const G = window.__LITM__;
  return { mode: G.mode, q: G.state.questIdx, inv: G.state.inv, gathered: G.state.gathered, crafted: G.state.crafted, x: G.player.x, y: G.player.y, offered: G.state.offered, altarFound: G.state.altarFound, ended: G.state.ended, buff: G.state.buffLeft };
});

// ======================================================
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const t0 = Date.now();
try {
  // ---------------- 桌面：完整通关 ----------------
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await ctx.newPage();
  watch(page, 'desktop');
  const bootStart = Date.now();
  await page.goto(URL);
  await page.waitForFunction(() => window.__LITM__ && window.__LITM__.mode === 'menu', null, { timeout: 20000 });
  check('游戏启动并显示主菜单', await page.isVisible('#menu'), `${Date.now() - bootStart} ms`);
  check('无存档时「继续游戏」禁用', await page.isDisabled('#btn-continue'));
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/d01_menu.png` });
  await page.evaluate(helpers);

  // 可达性检查
  const reach = await page.evaluate(() => {
    const G = window.__LITM__;
    const bad = [];
    for (const o of [...G.resources, ...G.steles]) {
      const path = window.__bfs(G.map.start, (x, y) => Math.hypot(x * 32 + 16 - o.x, y * 32 + 16 - o.y) < 40);
      if (!path) bad.push(`${o.kind}:${o.res ?? o.stele}@${Math.round(o.x / 32)},${Math.round(o.y / 32)}`);
    }
    const altar = window.__bfs(G.map.start, (x, y) => Math.hypot(x * 32 + 16 - G.map.altar.x, y * 32 + 16 - G.map.altar.y) < 80);
    return { total: G.resources.length + G.steles.length, bad, altar: !!altar };
  });
  check('所有资源点与石碑可从出生点步行到达', reach.bad.length === 0, `${reach.total - reach.bad.length}/${reach.total} ${reach.bad.slice(0, 5).join(' ')}`);
  check('森林祭坛可步行到达', reach.altar);

  // 操作说明 & 设置
  await page.click('[data-action=howto]');
  check('操作说明可打开', await page.isVisible('#howto'));
  await page.click('[data-action=close-howto]');
  await page.click('#menu [data-action=settings]');
  await page.fill('#set-music', '30');
  await page.dispatchEvent('#set-music', 'input');
  await page.click('[data-action=close-settings]');
  const savedSettings = await page.evaluate(() => JSON.parse(localStorage.getItem('litm.settings.v1') || '{}'));
  check('设置写入 LocalStorage', savedSettings.music === 30, JSON.stringify(savedSettings));

  // 开始
  await page.click('[data-action=new]');
  await page.waitForFunction(() => window.__LITM__.mode === 'play', null, { timeout: 5000 });
  await page.waitForTimeout(700);
  check('开始游戏进入 play 状态，HUD 显示', await page.isVisible('#hud'));
  await page.screenshot({ path: `${OUT}/d02_start.png` });

  // 键盘移动 & 摄像机
  const s0 = await state(page);
  const cam0 = await page.evaluate(() => ({ ...window.__LITM__.cam }));
  await page.keyboard.down('ArrowUp'); await page.waitForTimeout(700); await page.keyboard.up('ArrowUp');
  await page.waitForTimeout(400);
  const s1 = await state(page);
  const cam1 = await page.evaluate(() => ({ ...window.__LITM__.cam }));
  check('方向键移动角色', s1.y < s0.y - 40, `Δy=${(s1.y - s0.y).toFixed(1)}`);
  check('摄像机跟随角色', cam1.y < cam0.y - 20, `Δcam=${(cam1.y - cam0.y).toFixed(1)}`);

  // 碰撞：朝最近的树走，应被挡住
  const coll = await page.evaluate(async () => {
    const G = window.__LITM__;
    const p = G.player;
    const trees = G.map.objects.filter((o) => o.kind === 'tree' || o.kind === 'pine');
    trees.sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y));
    // 找一棵正下方可以站人的树
    for (const t of trees.slice(0, 40)) {
      const tx = Math.floor(t.x / 32), ty = Math.floor(t.y / 32);
      const path = window.__bfs(p, (x, y) => x === tx && y === ty + 1);
      if (!path) continue;
      await window.__drive(path);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }));
      await new Promise((r) => setTimeout(r, 900));
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'w' }));
      const treeBottom = (ty + 1) * 32 - 5;
      return { blocked: G.player.y >= treeBottom + 7, py: G.player.y, treeBottom };
    }
    return { blocked: false, note: 'no tree' };
  });
  check('碰撞：角色无法穿过树干', coll.blocked, JSON.stringify(coll));

  // 迷雾
  const fog0 = await page.evaluate(() => window.__LITM__.fog.exploredPct());

  // 任务 1：灵木枝
  let r = await gatherKind(page, 'branch', 7, 'wood');
  let st = await state(page);
  check('采集灵木枝（键盘 E）', r.ok && (st.inv.wood ?? 0) >= 7, `trips=${r.trips} wood=${st.inv.wood} ${r.reason ?? ''}`);
  check('任务1「林间苏醒」完成', st.q >= 1, `questIdx=${st.q}`);
  await page.screenshot({ path: `${OUT}/d03_gather.png` });

  // 任务 2：萤光蘑菇 + 灯笼
  r = await gatherKind(page, 'mushroom', 6, 'glowcap');
  st = await state(page);
  check('采集萤光蘑菇', r.ok, `trips=${r.trips} glowcap=${st.inv.glowcap} ${r.reason ?? ''}`);
  const vis0 = await page.evaluate(() => window.__LITM__.visionRadius());
  check('通过行囊 UI 制作萤火灯笼', await craftViaUi(page, 'lantern') && (await state(page)).inv.lantern === 1);
  const vis1 = await page.evaluate(() => window.__LITM__.visionRadius());
  check('灯笼扩大视野', vis1 > vis0, `${vis0} → ${vis1}`);
  st = await state(page);
  check('任务2「第一盏微光」完成', st.q >= 2, `questIdx=${st.q}`);
  await page.screenshot({ path: `${OUT}/d04_lantern.png` });

  // 任务 3：雾露 + 镐
  // 没有镐时开采月光石应被拒绝
  r = await gatherKind(page, 'lily', 7, 'mistdew');
  st = await state(page);
  check('采集雾露', r.ok, `trips=${r.trips} mistdew=${st.inv.mistdew} ${r.reason ?? ''}`);
  await page.screenshot({ path: `${OUT}/d05_lake.png` });
  check('制作灵木镐', await craftViaUi(page, 'pick') && (await state(page)).inv.pick === 1);
  st = await state(page);
  check('任务3「湖畔的露水」完成', st.q >= 3, `questIdx=${st.q}`);

  // 药水
  check('制作雾露药水', await craftViaUi(page, 'tonic'));
  await page.keyboard.press('q');
  await page.waitForTimeout(200);
  st = await state(page);
  check('按 Q 使用药水获得增益', st.buff > 20 && !st.inv.tonic, `buff=${st.buff.toFixed(1)}`);

  // 任务 4：月光石
  r = await gatherKind(page, 'crystal', 6, 'moonstone');
  st = await state(page);
  check('开采月光石', r.ok, `trips=${r.trips} moonstone=${st.inv.moonstone} ${r.reason ?? ''}`);
  check('任务4「月光矿脉」完成', st.q >= 4, `questIdx=${st.q}`);
  await page.screenshot({ path: `${OUT}/d06_crystals.png` });

  // 地图
  await page.keyboard.press('m');
  await page.waitForTimeout(300);
  check('M 打开地图', await page.isVisible('#bigmap'));
  await page.screenshot({ path: `${OUT}/d07_map.png` });
  await page.keyboard.press('Escape');
  const fog1 = await page.evaluate(() => window.__LITM__.fog.exploredPct());
  check('迷雾随探索逐步散开', fog1 > fog0 + 0.05, `${(fog0 * 100).toFixed(1)}% → ${(fog1 * 100).toFixed(1)}%`);

  // 任务 5：符文
  let runesOk = true;
  for (let i = 0; i < 3; i++) runesOk = (await craftViaUi(page, 'rune')) && runesOk;
  st = await state(page);
  check('制作 3 枚月光符文', runesOk && st.inv.rune === 3, `rune=${st.inv.rune} inv=${JSON.stringify(st.inv)}`);
  check('任务5「符文之约」完成', st.q >= 5, `questIdx=${st.q}`);

  // 石碑
  const stele = await page.evaluate(() => { const G = window.__LITM__; const p = G.player; const s = [...G.steles].sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0]; return { x: s.x, y: s.y, id: s.id }; });
  await walkTo(page, { x: stele.x, y: stele.y, near: 2, radius: 40 });
  await page.keyboard.press('e');
  await page.waitForTimeout(300);
  check('阅读古老石碑', (await page.evaluate(() => window.__LITM__.state.steleRead.length)) >= 1);

  // 暂停 & 存档 & 读档
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  check('Esc 暂停', await page.isVisible('#pause'));
  await page.screenshot({ path: `${OUT}/d08_pause.png` });
  const posBefore = await state(page);
  await page.waitForTimeout(500);
  const pausedPos = await state(page);
  check('暂停时游戏时间停止', Math.abs(pausedPos.x - posBefore.x) < 0.01);
  await page.click('#pause [data-action=resume]');
  // 刷新页面，继续游戏
  await page.evaluate(() => window.__LITM__.save());
  const before = await state(page);
  await page.reload();
  await page.waitForFunction(() => window.__LITM__ && window.__LITM__.mode === 'menu', null, { timeout: 20000 });
  check('刷新后「继续游戏」可用', await page.isEnabled('#btn-continue'));
  await page.click('[data-action=continue]');
  await page.waitForFunction(() => window.__LITM__.mode === 'play', null, { timeout: 5000 });
  await page.evaluate(helpers);
  const after = await state(page);
  check('读档恢复背包/任务/位置', after.q === before.q && after.inv.rune === before.inv.rune && Math.abs(after.x - before.x) < 2,
    `q ${before.q}/${after.q} rune ${before.inv.rune}/${after.inv.rune} x ${before.x.toFixed(0)}/${after.x.toFixed(0)}`);

  // 任务 6：祭坛
  const altar = await page.evaluate(() => window.__LITM__.map.altar);
  const wa = await walkTo(page, { x: altar.x, y: altar.y + 64, near: 2, radius: 50 });
  st = await state(page);
  check('步行抵达森林祭坛并触发发现', wa.ok && st.altarFound, JSON.stringify(wa));
  await page.screenshot({ path: `${OUT}/d09_altar.png` });
  await page.keyboard.press('e');
  await page.waitForTimeout(500);
  check('献上符文进入结局演出', (await state(page)).mode === 'cutscene');
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${OUT}/d10_cutscene.png` });
  await page.waitForFunction(() => window.__LITM__.mode === 'ending', null, { timeout: 8000 });
  await page.waitForTimeout(5500);
  check('结局画面显示', await page.isVisible('#ending'));
  await page.screenshot({ path: `${OUT}/d11_ending.png` });
  st = await state(page);
  check('全部任务完成', st.q === 6 && st.ended, `questIdx=${st.q}`);
  await page.click('[data-action=free-roam]');
  await page.waitForTimeout(800);
  check('结局后可继续自由漫步（迷雾已散）', (await state(page)).mode === 'play' && (await page.evaluate(() => window.__LITM__.fog.globalClear)) === 1);
  await page.screenshot({ path: `${OUT}/d12_freeroam.png` });
  // 音频上下文
  const audio = await page.evaluate(() => window.__LITM__.audio.ctx?.state ?? 'none');
  check('WebAudio 音效系统已启动', audio === 'running', audio);
  await ctx.close();

  // ---------------- 移动端 ----------------
  const mctx = await browser.newContext({ ...devices['iPhone 13'] });
  const m = await mctx.newPage();
  watch(m, 'mobile');
  await m.goto(URL);
  await m.waitForFunction(() => window.__LITM__ && window.__LITM__.mode === 'menu', null, { timeout: 20000 });
  await m.waitForTimeout(600);
  await m.screenshot({ path: `${OUT}/m01_menu.png` });
  await m.tap('[data-action=new]');
  await m.waitForFunction(() => window.__LITM__.mode === 'play', null, { timeout: 5000 });
  await m.waitForTimeout(800);
  check('移动端显示触屏控件', await m.isVisible('#touch-act') && await m.isVisible('#stick-base'));
  const ms0 = await state(m);
  // 用触摸事件拖动摇杆（CDP 触摸）
  const cdp = await mctx.newCDPSession(m);
  const zone = await m.locator('#stick-zone').boundingBox();
  const sx = zone.x + 90, sy = zone.y + zone.height - 110;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sx, y: sy, id: 1 }] });
  for (let i = 1; i <= 6; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: sx, y: sy - i * 10, id: 1 }] }); await m.waitForTimeout(30); }
  await m.waitForTimeout(900);
  await m.screenshot({ path: `${OUT}/m02_stick.png` });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await m.waitForTimeout(200);
  const ms1 = await state(m);
  check('虚拟摇杆移动角色', ms1.y < ms0.y - 30, `Δy=${(ms1.y - ms0.y).toFixed(1)}`);
  // 走到最近的枯枝并用触屏按钮采集
  await m.evaluate(helpers);
  const node = await m.evaluate(() => { const G = window.__LITM__; const p = G.player; const c = G.resources.filter((o) => o.res === 'branch').sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0]; return { x: c.x, y: c.y }; });
  await walkTo(m, { x: node.x, y: node.y, near: 2, radius: 40 });
  await m.tap('#touch-act');
  await m.waitForTimeout(1300);
  check('触屏按钮采集', ((await state(m)).inv.wood ?? 0) > 0);
  await m.tap('[data-action=bag]');
  await m.waitForTimeout(300);
  check('移动端行囊面板可打开', await m.isVisible('#bag'));
  await m.screenshot({ path: `${OUT}/m03_bag.png` });
  await m.tap('[data-action=close-bag]');
  await m.waitForTimeout(200);
  await m.screenshot({ path: `${OUT}/m04_play.png` });
  // 横屏
  await m.setViewportSize({ width: 844, height: 390 });
  await m.waitForTimeout(500);
  await m.screenshot({ path: `${OUT}/m05_landscape.png` });
  check('横屏重新适配画布', await m.evaluate(() => window.__LITM__.canvas.width > window.__LITM__.canvas.height));
  await mctx.close();
} catch (e) {
  check('测试脚本未抛出异常', false, e.stack);
} finally {
  await browser.close();
}

check('浏览器控制台无错误/警告', errors.length === 0, errors.slice(0, 5).join(' | '));
const pass = results.filter((r) => r.ok).length;
const summary = { date: new Date().toISOString(), url: URL, durationSec: Math.round((Date.now() - t0) / 1000), pass, total: results.length, results, errors };
writeFileSync(`${OUT}/results.json`, JSON.stringify(summary, null, 2));
log(`\n${pass}/${results.length} passed in ${summary.durationSec}s`);
process.exit(pass === results.length ? 0 : 1);
