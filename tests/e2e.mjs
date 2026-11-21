// v2 生存版端到端测试：在真实 Chromium 中用键盘 / 鼠标 / 触屏事件游玩
// 用法：PLAYWRIGHT_BROWSERS_PATH=... node tests/e2e.mjs
//
// 角色移动、采集、制作、建造、战斗全部通过真实输入事件完成（页面内自动导航只决定按哪个方向键）。
// 以下几处使用了测试钩子（window.__LITM__），在报告中会标注为 [钩子]：
//   - 调快时间流速（debug.timeScale），以便在几分钟内测完昼夜；
//   - 直接设置饥饿 / 生命数值，以便验证进食与死亡；
//   - 在玩家附近生成一只雾狼，以便验证战斗；
//   - 强制开始降雨。
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

const results = [], errors = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
const watch = (p, tag) => {
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${tag}] ${m.type()}: ${m.text()}`); });
  p.on('pageerror', (e) => errors.push(`[${tag}] pageerror: ${e.message}`));
};

// ---------- 页面内工具 ----------
const helpers = () => {
  const G = window.__LITM__;
  const TILE = 32, W = 96, H = 72;
  const walk = (x, y) => x >= 0 && y >= 0 && x < W && y < H && !G.map.blocked[y * W + x];
  window.__bfs = (from, goal) => {
    const sx = Math.floor(from.x / TILE), sy = Math.floor(from.y / TILE);
    const prev = new Int32Array(W * H).fill(-2);
    const q = [sy * W + sx]; prev[q[0]] = -1;
    let head = 0, found = -1;
    while (head < q.length) {
      const c = q[head++]; const cx = c % W, cy = (c / W) | 0;
      if (goal(cx, cy)) { found = c; break; }
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
  const setKey = (k, on) => { if (keys[k] === on) return; keys[k] = on; window.dispatchEvent(new KeyboardEvent(on ? 'keydown' : 'keyup', { key: k })); };
  window.__releaseKeys = () => ['w', 'a', 's', 'd'].forEach((k) => setKey(k, false));
  window.__drive = (path, finalPt) => new Promise((res) => {
    let i = 1, lastProg = performance.now(), best = 1e9;
    const pts = path.slice(); if (finalPt) pts.push(finalPt);
    const step = () => {
      const p = G.player;
      if (G.mode !== 'play') { window.__releaseKeys(); res({ ok: false, mode: G.mode }); return; }
      if (i >= pts.length) { window.__releaseKeys(); res({ ok: true }); return; }
      const t = pts[i], dx = t.x - p.x, dy = t.y - p.y, d = Math.hypot(dx, dy);
      if (d < 7) { i++; best = 1e9; lastProg = performance.now(); requestAnimationFrame(step); return; }
      if (d < best - 1) { best = d; lastProg = performance.now(); }
      if (performance.now() - lastProg > 3000) { window.__releaseKeys(); res({ ok: i >= pts.length - 1, stuck: true }); return; }
      setKey('d', dx > 3); setKey('a', dx < -3); setKey('s', dy > 3); setKey('w', dy < -3);
      requestAnimationFrame(step);
    };
    step();
  });
  window.__match = (o, spec) => (spec.kind ? o.kind === spec.kind : true) && (spec.res ? o.res === spec.res : true) && !o.fixed;
};

async function walkTo(page, goal) {
  return page.evaluate(async (g) => {
    const G = window.__LITM__;
    const path = window.__bfs(G.player, (x, y) => Math.hypot(x * 32 + 16 - g.x, y * 32 + 16 - g.y) < (g.radius ?? 44));
    if (!path) return { ok: false, reason: 'no path' };
    return { ...(await window.__drive(path)), len: path.length };
  }, goal);
}

/** 走到某类节点旁并按 E 采集，直到累计采集量达到 need */
async function gatherSpec(page, spec, item, need, maxTrips = 30) {
  let trips = 0;
  while (true) {
    const have = await page.evaluate((it) => window.__LITM__.state.gathered[it] ?? 0, item);
    if (have >= need) return { ok: true, trips, have };
    if (trips >= maxTrips) return { ok: false, trips, have };
    const node = await page.evaluate((sp) => {
      const G = window.__LITM__, p = G.player;
      const c = G.harvestables.filter((o) => window.__match(o, sp) && !G.nodeGone(o));
      c.sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y));
      for (const o of c.slice(0, 10)) {
        const big = o.kind === 'tree' || o.kind === 'pine' || o.kind === 'rock';
        const path = window.__bfs(p, (x, y) => Math.hypot(x * 32 + 16 - o.x, y * 32 + 16 - o.y) < (big ? 34 : 30));
        if (path) return { id: o.id, x: o.x, y: o.y, big };
      }
      return null;
    }, spec);
    if (!node) return { ok: false, reason: 'no reachable node', trips };
    await page.evaluate(async (n) => {
      const G = window.__LITM__;
      const path = window.__bfs(G.player, (x, y) => Math.hypot(x * 32 + 16 - n.x, y * 32 + 16 - n.y) < (n.big ? 34 : 30));
      await window.__drive(path, n.big ? null : { x: n.x, y: n.y + 12 });
    }, node);
    let tgt = await page.evaluate(() => window.__LITM__.target?.obj?.id ?? null);
    if (tgt !== node.id) {
      // 轻点方向键转向目标
      const k = await page.evaluate((n) => { const p = window.__LITM__.player; const dx = n.x - p.x, dy = n.y - p.y; return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'd' : 'a') : (dy > 0 ? 's' : 'w'); }, node);
      await page.keyboard.down(k); await page.waitForTimeout(30); await page.keyboard.up(k);
      await page.waitForTimeout(60);
      tgt = await page.evaluate(() => window.__LITM__.target?.obj?.id ?? null);
    }
    if (tgt === node.id) {
      await page.keyboard.press('e');
      await page.waitForTimeout(1700);
    }
    trips++;
  }
}

async function openCraftTab(page, tab) {
  if (!(await page.isVisible('#bag'))) { await page.keyboard.press('c'); await page.waitForTimeout(200); }
  await page.click(`[data-tab="${tab}"]`);
  await page.waitForTimeout(100);
}
async function craftUi(page, tab, id) {
  await openCraftTab(page, tab);
  const btn = page.locator(`[data-craft="${id}"]`);
  const ok = await btn.isEnabled();
  if (ok) await btn.click();
  await page.waitForTimeout(250);
  if (await page.isVisible('#bag')) { await page.keyboard.press('Escape'); await page.waitForTimeout(150); }
  return ok;
}
const st = (page) => page.evaluate(() => {
  const G = window.__LITM__, s = G.state;
  const cnt = {}; for (const sl of s.inv) if (sl) cnt[sl.id] = (cnt[sl.id] ?? 0) + sl.n;
  return { mode: G.mode, q: s.questIdx, inv: cnt, hand: s.equip.hand, body: s.equip.body, stats: { ...s.stats }, time: s.time, day: G.day(), phase: G.phase(), structures: s.structures.map((x) => ({ ...x, slots: undefined })), kills: s.kills, x: G.player.x, y: G.player.y, gathered: s.gathered };
});
/** 走到离某点至少 dist 像素的可达位置 */
async function walkAway(page, from, dist) {
  return page.evaluate(async ([f, d]) => {
    const G = window.__LITM__;
    const path = window.__bfs(G.player, (x, y) => Math.hypot(x * 32 + 16 - f.x, y * 32 + 16 - f.y) > d);
    if (!path) return { ok: false };
    const r = await window.__drive(path);
    return { ...r, dist: Math.round(Math.hypot(G.player.x - f.x, G.player.y - f.y)) };
  }, [from, dist]);
}
async function slotOf(page, id) { return page.evaluate((i) => window.__LITM__.state.inv.findIndex((s) => s && s.id === i), id); }
async function placeBuild(page, tab, id) {
  // 进入建造模式，然后依次朝四个方向尝试放置
  await openCraftTab(page, tab);
  const btn = page.locator(`[data-craft="${id}"]`);
  if (!(await btn.isEnabled())) return { ok: false, reason: 'cannot afford' };
  await btn.click();
  await page.waitForTimeout(200);
  for (const k of ['s', 'd', 'a', 'w']) {
    await page.keyboard.down(k); await page.waitForTimeout(40); await page.keyboard.up(k);
    await page.waitForTimeout(150);
    const v = await page.evaluate(() => window.__LITM__.build?.valid);
    if (v) { await page.keyboard.press('e'); await page.waitForTimeout(250); return { ok: true }; }
  }
  // 换个空地再试
  await page.keyboard.press('Escape');
  return { ok: false, reason: 'no valid spot' };
}

// ======================================================
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const t0 = Date.now();
try {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await ctx.newPage();
  watch(page, 'desktop');
  // 模拟一个 v1 旧存档，验证兼容提示
  await page.goto(URL);
  await page.evaluate(() => localStorage.setItem('litm.save.v1', JSON.stringify({ version: 1 })));
  await page.reload();
  await page.waitForFunction(() => window.__LITM__ && window.__LITM__.mode === 'menu', null, { timeout: 20000 });
  check('启动并显示主菜单', await page.isVisible('#menu'));
  check('检测到 v1 旧存档时给出不兼容提示', (await page.textContent('#menu-foot')).includes('v1'), await page.textContent('#menu-foot'));
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/v2_01_menu.png` });
  await page.evaluate(helpers);

  const reach = await page.evaluate(() => {
    const G = window.__LITM__;
    const bad = [];
    for (const o of [...G.resources, ...G.steles]) {
      if (!window.__bfs(G.map.start, (x, y) => Math.hypot(x * 32 + 16 - o.x, y * 32 + 16 - o.y) < 40)) bad.push(`${o.res ?? o.kind}@${Math.round(o.x / 32)},${Math.round(o.y / 32)}`);
    }
    return { total: G.resources.length + G.steles.length, bad };
  });
  check('所有资源点与石碑可步行到达', reach.bad.length === 0, `${reach.total - reach.bad.length}/${reach.total} ${reach.bad.slice(0, 5).join(' ')}`);

  await page.click('[data-action=new]');
  await page.waitForFunction(() => window.__LITM__.mode === 'play', null, { timeout: 5000 });
  await page.waitForTimeout(600);
  let s = await st(page);
  check('新游戏：四项生存属性满值、第 1 天白天', s.stats.hp === 150 && s.stats.hunger > 149 && s.stats.sanity === 200 && s.day === 1 && s.phase === 'day', JSON.stringify(s.stats));
  check('HUD 显示属性表盘、时钟与 15 格物品栏', await page.isVisible('#g-hp') && await page.isVisible('#clock') && (await page.locator('#hotbar .hb').count()) === 15);
  const t1 = s.time; await page.waitForTimeout(1000); s = await st(page);
  check('游戏时间持续推进', s.time > t1 + 0.5, `${t1.toFixed(1)} → ${s.time.toFixed(1)}`);
  check('饥饿值随时间下降', s.stats.hunger < 150, s.stats.hunger.toFixed(2));

  // ---------- 移动 / 碰撞 ----------
  const p0 = await st(page);
  await page.keyboard.down('ArrowUp'); await page.waitForTimeout(600); await page.keyboard.up('ArrowUp');
  const p1 = await st(page);
  check('键盘移动', p1.y < p0.y - 30, `Δy=${(p1.y - p0.y).toFixed(1)}`);
  const coll = await page.evaluate(async () => {
    const G = window.__LITM__, p = G.player;
    const trees = G.map.objects.filter((o) => (o.kind === 'tree' || o.kind === 'pine')).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y));
    for (const t of trees.slice(0, 40)) {
      const tx = Math.floor(t.x / 32), ty = Math.floor(t.y / 32);
      const path = window.__bfs(p, (x, y) => x === tx && y === ty + 1);
      if (!path) continue;
      await window.__drive(path);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }));
      await new Promise((r) => setTimeout(r, 800));
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'w' }));
      return { blocked: G.player.y >= (ty + 1) * 32 - 5 + 7 };
    }
    return { blocked: false };
  });
  check('碰撞：不能穿过树干', coll.blocked);

  // ---------- 采集 → 旅程 1 ----------
  let r = await gatherSpec(page, { kind: 'resource', res: 'branch' }, 'twigs', 7);
  if (!r.ok) r = await gatherSpec(page, { kind: 'resource', res: 'sapling' }, 'twigs', 7);
  check('拾取树枝（枯枝堆 / 树苗）', r.ok, JSON.stringify(r));
  r = await gatherSpec(page, { kind: 'resource', res: 'grass' }, 'grass', 9);
  check('采集干草', r.ok, JSON.stringify(r));
  r = await gatherSpec(page, { kind: 'resource', res: 'flint' }, 'flint', 4);
  check('拾取燧石', r.ok, JSON.stringify(r));
  s = await st(page);
  check('旅程 1「林间苏醒」完成', s.q >= 1, `q=${s.q}`);
  await page.screenshot({ path: `${OUT}/v2_02_gather.png` });

  // ---------- 工具 / 砍树 / 耐久 ----------
  check('制作燧石斧（工具页）', await craftUi(page, 'tools', 'axe') && (await st(page)).inv.axe === 1);
  r = await gatherSpec(page, { kind: 'tree' }, 'log', 6, 8);
  if (!r.ok) r = await gatherSpec(page, { kind: 'pine' }, 'log', 6, 8);
  s = await st(page);
  check('用斧头砍树获得木头（自动装备斧头）', r.ok && s.hand?.id === 'axe', `log=${s.inv.log} hand=${s.hand?.id}`);
  check('工具耐久随使用减少', s.hand && s.hand.dur < 40, `dur=${s.hand?.dur}`);
  const stump = await page.evaluate(() => {
    const G = window.__LITM__;
    const o = G.harvestables.find((x) => (x.kind === 'tree' || x.kind === 'pine') && G.state.nodes[x.id] !== undefined);
    return o ? { gone: G.nodeGone(o), passable: !G.map.blocked[Math.floor(o.y / 32) * 96 + Math.floor(o.x / 32)], regrowIn: Math.round(G.state.nodes[o.id] - G.state.time) } : null;
  });
  check('被砍的树变成树桩、可通行、并安排重生', stump && stump.gone && stump.passable && stump.regrowIn > 0, JSON.stringify(stump));
  check('旅程 2「燧石与木头」完成', (await st(page)).q >= 2);
  await page.screenshot({ path: `${OUT}/v2_03_chop.png` });

  // ---------- 火把 ----------
  check('制作火把（照明页）', await craftUi(page, 'light', 'torch'));
  const ti = await slotOf(page, 'torch');
  await page.click(`#hotbar [data-slot="${ti}"]`);
  await page.waitForTimeout(150);
  s = await st(page);
  check('点击物品栏装备火把（斧头回到背包）', s.hand?.id === 'torch' && s.inv.axe === 1, `hand=${s.hand?.id}`);
  const tdur0 = s.hand.dur; await page.waitForTimeout(1200);
  check('火把随时间燃烧消耗', (await st(page)).hand.dur < tdur0 - 0.3);

  // ---------- 建造：非法位置 ----------
  await openCraftTab(page, 'build');
  await page.click('[data-craft="campfire_kit"]');
  await page.waitForTimeout(200);
  check('进入建造模式并显示预览', await page.evaluate(() => !!window.__LITM__.build) && await page.isVisible('#build-bar'));
  const bad = await page.evaluate(() => {
    const G = window.__LITM__, p = G.player;
    const t = G.map.objects.filter((o) => o.kind === 'tree').sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
    const sx = (t.x - (G.cam.x - G.viewW / G.zoom / 2)) * G.zoom, sy = (t.y - (G.cam.y - G.viewH / G.zoom / 2)) * G.zoom;
    return { sx, sy, inView: sx > 0 && sy > 0 && sx < G.viewW && sy < G.viewH };
  });
  if (bad.inView) {
    await page.mouse.move(bad.sx, bad.sy);
    await page.waitForTimeout(150);
    const ghost = await page.evaluate(() => ({ ...window.__LITM__.build }));
    const before = (await st(page)).structures.length;
    await page.mouse.click(bad.sx, bad.sy);
    await page.waitForTimeout(150);
    check('非法位置（树上）预览变红且无法放置', !ghost.valid && (await st(page)).structures.length === before, ghost.reason);
  } else check('非法位置（树上）预览变红且无法放置', false, '附近没有在视野内的树');
  await page.screenshot({ path: `${OUT}/v2_04_ghost_invalid.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  check('Esc 取消建造', !(await page.evaluate(() => !!window.__LITM__.build)));

  // ---------- 建造：篝火 ----------
  // 走到出生点空地上建造
  const start = await page.evaluate(() => window.__LITM__.map.start);
  await walkTo(page, { x: start.x, y: start.y, radius: 20 });
  s = await st(page);
  const before = { log: s.inv.log ?? 0, grass: s.inv.grass ?? 0 };
  const pb = await placeBuild(page, 'build', 'campfire_kit');
  s = await st(page);
  check('放置篝火并扣除材料（木头 2、干草 3）', pb.ok && s.structures.length === 1 && (s.inv.log ?? 0) === before.log - 2 && (s.inv.grass ?? 0) === before.grass - 3, `${JSON.stringify(pb)} log ${before.log}→${s.inv.log} grass ${before.grass}→${s.inv.grass}`);
  const fire = s.structures[0];
  check('篝火占位阻挡通行', await page.evaluate((f) => window.__LITM__.map.blocked[Math.floor(f.y / 32) * 96 + Math.floor(f.x / 32)] === 1, fire));
  await page.screenshot({ path: `${OUT}/v2_05_campfire.png` });

  // ---------- 浆果 / 烹饪 / 进食 ----------
  r = await gatherSpec(page, { kind: 'bush' }, 'berries', 3, 10);
  check('采摘雾莓', r.ok, JSON.stringify(r));
  await walkTo(page, { x: fire.x, y: fire.y + 40, radius: 30 });
  await page.keyboard.down('w'); await page.waitForTimeout(30); await page.keyboard.up('w');
  await page.waitForTimeout(200);
  const tg = await page.evaluate(() => window.__LITM__.target?.kind);
  await page.keyboard.press('e');
  await page.waitForTimeout(250);
  check('靠近篝火按 E 打开篝火面板', tg === 'struct' && await page.isVisible('#station'), `target=${tg}`);
  const fuel0 = await page.evaluate(() => window.__LITM__.state.structures[0].fuel);
  await page.click('[data-cmd="fuel"][data-arg="twigs"]');
  const fuel1 = await page.evaluate(() => window.__LITM__.state.structures[0].fuel);
  check('添加树枝作为燃料', fuel1 > fuel0 + 15, `${fuel0.toFixed(0)} → ${fuel1.toFixed(0)}`);
  await page.click('[data-cmd="cook"][data-arg="berries"]');
  await page.waitForTimeout(100);
  s = await st(page);
  check('在篝火上烹饪雾莓', (s.inv.berries_cooked ?? 0) >= 1);
  await page.screenshot({ path: `${OUT}/v2_06_station.png` });
  await page.keyboard.press('Escape');
  await page.evaluate(() => { window.__LITM__.state.stats.hunger = 60; }); // [钩子]
  const ci = await slotOf(page, 'berries_cooked');
  await page.click(`#hotbar [data-slot="${ci}"]`);
  s = await st(page);
  check('[钩子] 点击物品栏吃烤雾莓恢复饥饿', s.stats.hunger > 70, s.stats.hunger.toFixed(1));

  // ---------- 储物箱 ----------
  check('制作草绳', await craftUi(page, 'tools', 'rope'));
  if (((await st(page)).inv.log ?? 0) < 4) await gatherSpec(page, { kind: 'tree' }, 'log', ((await st(page)).gathered.log ?? 0) + 4, 6);
  await walkTo(page, { x: fire.x + 96, y: fire.y + 32, radius: 20 });
  const pc = await placeBuild(page, 'build', 'chest_kit');
  s = await st(page);
  const chest = s.structures.find((x) => x.type === 'chest');
  check('放置储物箱', pc.ok && !!chest, JSON.stringify(pc));
  if (chest) {
    await page.waitForTimeout(100);
    const nearChest = await page.evaluate((c) => window.__LITM__.target?.st?.id === c.id, chest);
    if (!nearChest) await walkTo(page, { x: chest.x, y: chest.y + 36, radius: 22 });
    await page.keyboard.press('e');
    await page.waitForTimeout(200);
    const fi = await slotOf(page, 'flint');
    const fl0 = (await st(page)).inv.flint ?? 0;
    await page.click(`#station [data-cmd="store"][data-arg="${fi}"]`);
    const stored = await page.evaluate(() => (window.__LITM__.state.structures.find((x) => x.type === 'chest').slots.find((x) => x)?.id));
    check('把物品放进储物箱', stored === 'flint' && !(await st(page)).inv.flint, `stored=${stored}`);
    await page.click('#station [data-cmd="take"][data-arg="0"]');
    check('从储物箱取回物品', ((await st(page)).inv.flint ?? 0) === fl0);
    await page.screenshot({ path: `${OUT}/v2_07_chest.png` });
    await page.keyboard.press('Escape');
  }

  // ---------- 昼夜 / 黑暗 / 体温 ----------
  await walkTo(page, { x: fire.x, y: fire.y + 44, radius: 24 });
  await page.evaluate(() => { const G = window.__LITM__; G.debug.timeScale = 60; }); // [钩子]
  await page.waitForFunction(() => window.__LITM__.phase() === 'dusk', null, { timeout: 30000 });
  await page.screenshot({ path: `${OUT}/v2_08_dusk.png` });
  await page.waitForFunction(() => window.__LITM__.phase() === 'night', null, { timeout: 30000 });
  await page.evaluate(() => { const G = window.__LITM__; G.debug.timeScale = 1; G.state.structures.find((x) => x.type === 'campfire').fuel = 200; });
  await page.waitForTimeout(800);
  s = await st(page);
  check('[钩子] 时间加速后进入黄昏与夜晚', s.phase === 'night', `day=${s.day} phase=${s.phase}`);
  check('夜晚篝火旁不处于黑暗中', !(await page.evaluate(() => window.__LITM__.inDark)));
  await page.screenshot({ path: `${OUT}/v2_09_night_fire.png` });
  // 卸下火把，离开篝火 → 黑暗伤害
  await page.click('#eq-hand');
  const hp0 = (await st(page)).stats.hp;
  const away = await walkAway(page, fire, 420);
  await page.waitForFunction((h) => window.__LITM__.state.stats.hp < h - 20, hp0, { timeout: 20000 }).catch(() => {});
  s = await st(page);
  const dark = await page.evaluate(() => window.__LITM__.inDark);
  check('夜晚无光：进入黑暗并受到雾噬伤害', dark && s.stats.hp < hp0 - 20, `离篝火 ${away.dist}px，hp ${hp0.toFixed(0)} → ${s.stats.hp.toFixed(0)}`);
  await page.screenshot({ path: `${OUT}/v2_10_dark.png` });
  const temp0 = s.stats.temp;
  await walkTo(page, { x: fire.x, y: fire.y + 40, radius: 24 });
  await page.waitForTimeout(3000);
  s = await st(page);
  check('回到篝火旁：体温上升、脱离黑暗', s.stats.temp > temp0 && !(await page.evaluate(() => window.__LITM__.inDark)), `temp ${temp0.toFixed(1)} → ${s.stats.temp.toFixed(1)}`);
  // 撑到第 2 天
  // [钩子] 加速时间；期间持续给篝火补满燃料、保持不挨饿（相当于玩家不断添柴、吃东西）
  await page.evaluate(() => { const G = window.__LITM__; G.debug.timeScale = 60; window.__refuel = setInterval(() => { G.state.structures.find((x) => x.type === 'campfire').fuel = 240; G.state.stats.hunger = Math.max(G.state.stats.hunger, 100); }, 100); });
  await page.waitForFunction(() => window.__LITM__.day() >= 2 || window.__LITM__.mode !== 'play', null, { timeout: 60000 });
  await page.evaluate(() => clearInterval(window.__refuel));
  await page.evaluate(() => { window.__LITM__.debug.timeScale = 1; });
  await page.waitForTimeout(400);
  s = await st(page);
  check('撑过第一夜：旅程 3「第一夜」完成', s.q >= 3 && s.day >= 2 && s.mode === 'play', `q=${s.q} day=${s.day} hp=${s.stats.hp.toFixed(0)}`);

  // ---------- 战斗 ----------
  await gatherSpec(page, { kind: 'resource', res: 'grass' }, 'grass', ((await st(page)).gathered.grass ?? 0) + 3);
  await gatherSpec(page, { kind: 'resource', res: 'flint' }, 'flint', ((await st(page)).gathered.flint ?? 0) + 1);
  const cr = await craftUi(page, 'tools', 'rope');
  check('制作燧石长矛（战斗页）', cr && await craftUi(page, 'fight', 'spear'));
  const si = await slotOf(page, 'spear');
  if (si >= 0) await page.click(`#hotbar [data-slot="${si}"]`);
  await walkAway(page, fire, 300); // 狼不会进入篝火光圈，所以到空旷处迎战
  await page.evaluate(() => { const G = window.__LITM__; G.state.stats.hp = 150; G.state.time = (G.day() - 1) * 480 + 0.6 * 480; const path = window.__bfs(G.player, (x, y) => Math.hypot(x * 32 + 16 - G.player.x, y * 32 + 16 - G.player.y) > 80); const sp = path[path.length - 1]; G.spawn('wolf', sp.x, sp.y); }); // [钩子] 黄昏（狼白天会离开），生成在可达位置
  const hpW = (await st(page)).stats.hp;
  let killed = false;
  for (let i = 0; i < 50 && !killed; i++) {
    await page.evaluate(async () => {
      const G = window.__LITM__, w = G.creatures.find((c) => c.type === 'wolf' && c.hp > 0);
      if (w && Math.hypot(w.x - G.player.x, w.y - G.player.y) > 45) await window.__drive([G.player, { x: (w.x + G.player.x) / 2, y: (w.y + G.player.y) / 2 }]);
    });
    await page.keyboard.press('f');
    await page.waitForTimeout(180);
    killed = await page.evaluate(() => !window.__LITM__.creatures.some((c) => c.type === 'wolf' && c.hp > 0));
  }
  s = await st(page);
  check('[钩子] 生成雾狼后用长矛（F 键）击败它', killed && s.kills >= 1, `kills=${s.kills} 受到伤害 ${(hpW - s.stats.hp).toFixed(0)}`);
  check('武器耐久随命中减少', s.hand?.id === 'spear' && s.hand.dur < 120, `dur=${s.hand?.dur}`);
  await page.waitForTimeout(800);
  const meatOnGround = await page.evaluate(() => window.__LITM__.groundItems.length);
  await page.evaluate(async () => { const G = window.__LITM__; const it = G.groundItems[0]; if (it) await window.__drive([G.player, { x: it.x, y: it.y }]); });
  await page.waitForTimeout(400);
  check('雾狼掉落生肉并可拾取', meatOnGround > 0 && ((await st(page)).inv.meat ?? 0) > 0, `ground=${meatOnGround} meat=${(await st(page)).inv.meat}`);
  await page.screenshot({ path: `${OUT}/v2_11_combat.png` });

  // ---------- 天气 ----------
  await page.evaluate(() => { const w = window.__LITM__.state.weather; w.target = 1; w.rain = 1; w.until = window.__LITM__.state.time + 120; }); // [钩子]
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/v2_12_rain.png` });
  check('[钩子] 降雨：天气状态生效', await page.evaluate(() => window.__LITM__.state.weather.rain > 0.9));

  // ---------- 存档 / 读档 ----------
  await page.evaluate(() => window.__LITM__.save());
  const b4 = await st(page);
  await page.reload();
  await page.waitForFunction(() => window.__LITM__ && window.__LITM__.mode === 'menu', null, { timeout: 20000 });
  await page.click('[data-action=continue]');
  await page.waitForFunction(() => window.__LITM__.mode === 'play', null, { timeout: 5000 });
  await page.evaluate(helpers);
  const af = await st(page);
  check('读档恢复建筑、背包、时间、任务', af.structures.length === b4.structures.length && af.q === b4.q && Math.abs(af.time - b4.time) < 3 && JSON.stringify(af.inv) === JSON.stringify(b4.inv),
    `建筑 ${b4.structures.length}/${af.structures.length} 天 ${b4.day}/${af.day}`);
  check('读档后建筑仍阻挡通行', await page.evaluate((f) => window.__LITM__.map.blocked[Math.floor(f.y / 32) * 96 + Math.floor(f.x / 32)] === 1, fire));

  // ---------- 死亡 ----------
  await page.evaluate(() => { const s = window.__LITM__.state.stats; s.hp = 3; s.hunger = 0; }); // [钩子]
  await page.waitForFunction(() => window.__LITM__.mode === 'dead', null, { timeout: 8000 });
  await page.waitForTimeout(1200);
  check('[钩子] 饥饿致死：显示死亡画面与死因', await page.isVisible('#death') && (await page.textContent('#death-text')).includes('饥饿'), await page.textContent('#death-text'));
  check('死亡后存档被清除（永久死亡）', await page.evaluate(() => !localStorage.getItem('litm.save.v2')));
  await page.screenshot({ path: `${OUT}/v2_13_death.png` });
  await page.click('[data-action=restart]');
  await page.waitForFunction(() => window.__LITM__.mode === 'play', null, { timeout: 5000 });
  s = await st(page);
  check('重新开始：新世界、建筑清空、属性满值', s.structures.length === 0 && s.stats.hp === 150 && s.day === 1, JSON.stringify({ n: s.structures.length, hp: s.stats.hp }));
  check('重新开始后被砍的树恢复为阻挡', await page.evaluate(() => { const G = window.__LITM__; return Object.keys(G.state.nodes).length === 0; }));
  const audio = await page.evaluate(() => window.__LITM__.audio.ctx?.state ?? 'none');
  check('WebAudio 正常运行', audio === 'running', audio);
  await ctx.close();

  // ---------------- 移动端 ----------------
  const mctx = await browser.newContext({ ...devices['iPhone 13'] });
  const m = await mctx.newPage();
  watch(m, 'mobile');
  await m.goto(URL);
  await m.waitForFunction(() => window.__LITM__ && window.__LITM__.mode === 'menu', null, { timeout: 20000 });
  await m.tap('[data-action=new]');
  await m.waitForFunction(() => window.__LITM__.mode === 'play', null, { timeout: 5000 });
  await m.waitForTimeout(800);
  check('移动端显示摇杆、互动、攻击按钮', await m.isVisible('#touch-act') && await m.isVisible('#touch-attack') && await m.isVisible('#stick-base'));
  const box = (sel) => m.locator(sel).boundingBox();
  const [bq, bb, ba] = [await box('#quest'), await box('#hud-buttons'), await box('#bottom-bar')];
  const overlap = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  check('移动端竖屏：任务卡与按钮不重叠，物品栏在屏幕内', !overlap(bq, bb) && ba.x >= 0 && ba.x + ba.width <= 390, `bar=${Math.round(ba.x)}..${Math.round(ba.x + ba.width)}`);
  await m.screenshot({ path: `${OUT}/v2_m01_portrait.png` });
  const ms0 = await st(m);
  const cdp = await mctx.newCDPSession(m);
  const zone = await m.locator('#stick-zone').boundingBox();
  const sx = zone.x + 90, sy = zone.y + zone.height - 150;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sx, y: sy, id: 1 }] });
  for (let i = 1; i <= 6; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: sx, y: sy - i * 10, id: 1 }] }); await m.waitForTimeout(30); }
  await m.waitForTimeout(800);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const ms1 = await st(m);
  check('虚拟摇杆移动角色', ms1.y < ms0.y - 30, `Δy=${(ms1.y - ms0.y).toFixed(1)}`);
  await m.evaluate(helpers);
  const node = await m.evaluate(() => { const G = window.__LITM__, p = G.player; const o = G.harvestables.filter((x) => x.res === 'grass' && !G.nodeGone(x)).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0]; return { x: o.x, y: o.y, id: o.id }; });
  await m.evaluate(async (n) => { const G = window.__LITM__; const path = window.__bfs(G.player, (x, y) => Math.hypot(x * 32 + 16 - n.x, y * 32 + 16 - n.y) < 30); await window.__drive(path, { x: n.x, y: n.y + 12 }); }, node);
  await m.tap('#touch-act');
  await m.waitForTimeout(1200);
  check('触屏「互动」按钮采集', ((await st(m)).inv.grass ?? 0) > 0);
  await m.tap('[data-action=bag]');
  await m.waitForTimeout(300);
  check('移动端制作面板可打开', await m.isVisible('#bag'));
  await m.screenshot({ path: `${OUT}/v2_m02_craft.png` });
  await m.tap('[data-action=close-bag]');
  await m.setViewportSize({ width: 844, height: 390 });
  await m.waitForTimeout(500);
  await m.screenshot({ path: `${OUT}/v2_m03_landscape.png` });
  const lb = await box('#bottom-bar');
  check('横屏：物品栏在屏幕内', lb.x >= 0 && lb.x + lb.width <= 844 && lb.y + lb.height <= 390, JSON.stringify(lb));
  await mctx.close();

  // ---------------- 性能 ----------------
  const pctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const pp = await pctx.newPage();
  await pp.goto(URL);
  await pp.waitForFunction(() => window.__LITM__ && window.__LITM__.mode === 'menu', null, { timeout: 20000 });
  await pp.click('[data-action=new]');
  await pp.waitForFunction(() => window.__LITM__.mode === 'play', null, { timeout: 5000 });
  await pp.waitForTimeout(800);
  // 无头环境的 rAF 间隔受合成器限制（v1 同样约 83 ms），因此直接测量单帧更新+渲染的 CPU 耗时
  const perf = await pp.evaluate(() => {
    const G = window.__LITM__, ts = [];
    for (let i = 0; i < 60; i++) { const t = performance.now(); G.update(1 / 60); G.renderer.render(); ts.push(performance.now() - t); }
    ts.sort((a, b) => a - b);
    return { median: ts[30], p95: ts[56] };
  });
  check('单帧更新+渲染耗时（1366×768）', perf.median < 12, `中位数 ${perf.median.toFixed(1)} ms，P95 ${perf.p95.toFixed(1)} ms`);
  await pctx.close();
} catch (e) {
  check('测试脚本未抛出异常', false, e.stack);
} finally {
  await browser.close();
}
check('浏览器控制台无错误/警告', errors.length === 0, errors.slice(0, 5).join(' | '));
const pass = results.filter((r) => r.ok).length;
const summary = { date: new Date().toISOString(), url: URL, durationSec: Math.round((Date.now() - t0) / 1000), pass, total: results.length, results, errors };
writeFileSync(`${OUT}/results.json`, JSON.stringify(summary, null, 2));
console.log(`\n${pass}/${results.length} passed in ${summary.durationSec}s`);
process.exit(pass === results.length ? 0 : 1);
