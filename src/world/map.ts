// 森林地图生成（固定种子，确定性 —— 存档只需保存动态状态）
import { mulberry32, Noise2D, clamp } from '../engine/math';
import type { NodeType } from '../data/world';
export type ResourceKind = NodeType;

export const TILE = 32;
export const MAP_W = 96;
export const MAP_H = 72;
export const WORLD_SEED = 20261121;

export enum T { Grass = 0, Path = 1, Water = 2, Shore = 3, Moss = 4, Stone = 5 }

export interface Pt { x: number; y: number }

export type ObjKind = 'tree' | 'pine' | 'rock' | 'bush' | 'stele' | 'altar' | 'resource';
export interface WorldObj {
  id: number;
  kind: ObjKind;
  x: number; // 世界像素坐标（脚底中心）
  y: number;
  variant: number;
  res?: ResourceKind;
  stele?: number;
  fixed?: boolean; // 边界树：不可砍伐
}

export interface WorldMap {
  ground: Uint8Array;   // T
  blocked: Uint8Array;  // 1 = 不可通行
  moisture: Float32Array;
  waterDepth: Float32Array; // 0..1，用于水面渐变
  objects: WorldObj[];
  start: Pt;            // 像素
  altar: Pt;            // 像素（祭坛中心）
  noise: Noise2D;
  zone: Uint8Array;     // 0 普通 1 幽暗林 2 岩地 3 湖畔
}

export const idx = (x: number, y: number) => y * MAP_W + x;
export const inBounds = (x: number, y: number) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;

export function generateMap(): WorldMap {
  const rnd = mulberry32(WORLD_SEED);
  const noise = new Noise2D(WORLD_SEED ^ 0x9e3779b9);
  const n2 = new Noise2D(WORLD_SEED + 77);
  const N = MAP_W * MAP_H;
  const ground = new Uint8Array(N);
  const blocked = new Uint8Array(N);
  const moisture = new Float32Array(N);
  const waterDepth = new Float32Array(N);
  const zone = new Uint8Array(N);
  const reserved = new Uint8Array(N); // 不放树（路径、空地）

  const start: Pt = { x: 48, y: 62 };
  const altarT: Pt = { x: 48, y: 10 };

  // ----- 区域划分 -----
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    const i = idx(x, y);
    moisture[i] = noise.fbm(x / 14, y / 14, 3);
    const dark = x > 58 && y > 28 && y < 58 && n2.fbm(x / 9, y / 9) > 0.35;
    const rockyNW = Math.hypot(x - 20, y - 15) < 11 + n2.get(x / 4, y / 4) * 4;
    const rockyNE = Math.hypot(x - 76, y - 15) < 10 + n2.get(x / 4 + 9, y / 4) * 4;
    if (dark) { zone[i] = 1; ground[i] = T.Moss; }
    if (rockyNW || rockyNE) { zone[i] = 2; ground[i] = T.Stone; }
  }

  // ----- 湖泊 -----
  const lakes: { c: Pt; r: number }[] = [{ c: { x: 19, y: 39 }, r: 6.2 }, { c: { x: 77, y: 27 }, r: 3.4 }, { c: { x: 33, y: 58 }, r: 2.6 }];
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    const i = idx(x, y);
    for (const L of lakes) {
      const ang = Math.atan2(y - L.c.y, x - L.c.x);
      const rr = L.r + Math.sin(ang * 3 + L.c.x) * 0.9 + (noise.get(x / 3, y / 3) - 0.5) * 1.6;
      const d = Math.hypot((x - L.c.x) * 0.92, y - L.c.y);
      if (d < rr) { ground[i] = T.Water; waterDepth[i] = clamp(1 - d / rr, 0, 1); }
      else if (d < rr + 1.6 && ground[i] !== T.Water) { ground[i] = T.Shore; zone[i] = 3; }
      else if (d < rr + 5 && zone[i] === 0) zone[i] = 3;
    }
  }

  // ----- 路径 -----
  const carve = (pts: Pt[], width: number) => {
    for (let s = 0; s < pts.length - 1; s++) {
      const a = pts[s], b = pts[s + 1];
      const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 3);
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const wob = (noise.get((a.x + b.x) * 0.1 + t * 4, s * 3.1) - 0.5) * 3;
        const dx = b.y - a.y, dy = -(b.x - a.x); const dl = Math.hypot(dx, dy) || 1;
        const px = a.x + (b.x - a.x) * t + (dx / dl) * wob * Math.sin(t * Math.PI);
        const py = a.y + (b.y - a.y) * t + (dy / dl) * wob * Math.sin(t * Math.PI);
        for (let oy = -3; oy <= 3; oy++) for (let ox = -3; ox <= 3; ox++) {
          const tx = Math.round(px + ox), ty = Math.round(py + oy);
          if (!inBounds(tx, ty)) continue;
          const d = Math.hypot(tx - px, ty - py);
          const i = idx(tx, ty);
          if (d <= width && ground[i] !== T.Water) { ground[i] = T.Path; }
          if (d <= width + 1.8) reserved[i] = 1;
        }
      }
    }
  };
  carve([start, { x: 45, y: 51 }, { x: 52, y: 39 }, { x: 47, y: 26 }, { x: 48, y: 17 }, altarT], 1.3);
  carve([{ x: 45, y: 51 }, { x: 34, y: 46 }, { x: 26, y: 41 }], 0.9);
  carve([{ x: 52, y: 39 }, { x: 62, y: 41 }, { x: 72, y: 42 }], 0.9);
  carve([{ x: 47, y: 26 }, { x: 35, y: 21 }, { x: 22, y: 16 }], 0.9);
  carve([{ x: 47, y: 26 }, { x: 61, y: 21 }, { x: 75, y: 16 }], 0.9);
  carve([{ x: 62, y: 41 }, { x: 70, y: 30 }, { x: 76, y: 24 }], 0.7);

  // ----- 空地 -----
  const clear = (c: Pt, r: number, g?: T) => {
    for (let y = c.y - r - 2; y <= c.y + r + 2; y++) for (let x = c.x - r - 2; x <= c.x + r + 2; x++) {
      if (!inBounds(x, y)) continue;
      const d = Math.hypot(x - c.x, y - c.y) + (noise.get(x / 2, y / 2) - 0.5) * 1.5;
      const i = idx(x, y);
      if (d < r) { reserved[i] = 1; if (g !== undefined && ground[i] !== T.Water) ground[i] = g; }
    }
  };
  clear(start, 5.5);
  clear(altarT, 6.5, T.Stone);
  clear({ x: 72, y: 42 }, 3.5);
  clear({ x: 22, y: 16 }, 3.5);
  clear({ x: 75, y: 16 }, 3.5);

  // ----- 边界与水体阻挡 -----
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    const i = idx(x, y);
    if (ground[i] === T.Water) blocked[i] = 1;
  }

  const objects: WorldObj[] = [];
  let oid = 1;
  const occupied = new Uint8Array(N);
  const place = (kind: ObjKind, tx: number, ty: number, variant: number, block: boolean, extra: Partial<WorldObj> = {}) => {
    const i = idx(tx, ty);
    occupied[i] = 1;
    if (block) blocked[i] = 1;
    const jx = kind === 'altar' ? 0 : (rnd() - 0.5) * 10;
    const jy = kind === 'altar' ? 0 : (rnd() - 0.5) * 8;
    const o: WorldObj = { id: oid++, kind, x: tx * TILE + TILE / 2 + jx, y: ty * TILE + TILE / 2 + jy, variant, ...extra };
    objects.push(o);
    return o;
  };

  // 祭坛（占 3x2 中心不可通行）
  const altarObj = place('altar', altarT.x, altarT.y, 0, true);
  altarObj.y = altarT.y * TILE + TILE / 2;
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [-1, -1], [1, -1], [0, 1]]) blocked[idx(altarT.x + dx, altarT.y + dy)] = 1;
  occupied[idx(altarT.x, altarT.y + 1)] = 1;

  // ----- 树木 -----
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    const i = idx(x, y);
    if (ground[i] === T.Water || ground[i] === T.Shore || occupied[i]) continue;
    const edge = Math.min(x, y, MAP_W - 1 - x, MAP_H - 1 - y);
    const border = edge < 3;
    if (reserved[i] && !border) continue;
    let dens = noise.fbm(x / 7 + 3, y / 7 + 5, 4);
    if (zone[i] === 1) dens += 0.12;
    if (zone[i] === 2) dens -= 0.18;
    if (zone[i] === 3) dens -= 0.1;
    const want = border ? 0.92 : dens > 0.5 ? 0.42 : dens > 0.42 ? 0.12 : 0.03;
    if (rnd() < want && !occupied[idx(Math.max(0, x - 1), y)] && !occupied[idx(x, Math.max(0, y - 1))]) {
      const pine = zone[i] === 2 || (rnd() < 0.28 && zone[i] !== 1);
      const variant = Math.floor(rnd() * 4);
      place(pine ? 'pine' : 'tree', x, y, zone[i] === 1 ? variant % 2 + 4 : variant, true, edge < 4 ? { fixed: true } : {});
    }
  }
  // 边界兜底：最外两圈全部阻挡（视觉上由树覆盖）
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    if (Math.min(x, y, MAP_W - 1 - x, MAP_H - 1 - y) < 2) blocked[idx(x, y)] = 1;
  }

  // ----- 岩石与灌木 -----
  for (let y = 3; y < MAP_H - 3; y++) for (let x = 3; x < MAP_W - 3; x++) {
    const i = idx(x, y);
    if (occupied[i] || ground[i] === T.Water || ground[i] === T.Path || reserved[i]) continue;
    const r = rnd();
    if (zone[i] === 2 && r < 0.07) place('rock', x, y, Math.floor(rnd() * 3), true);
    else if (r < 0.025) place('rock', x, y, Math.floor(rnd() * 3), true);
    else if (r < 0.075) place('bush', x, y, Math.floor(rnd() * 3), false);
  }

  // ----- 可达性（BFS），资源只放在可达位置 -----
  const reach = new Uint8Array(N);
  const q: number[] = [idx(start.x, start.y)];
  reach[q[0]] = 1;
  while (q.length) {
    const c = q.pop()!;
    const cx = c % MAP_W, cy = (c / MAP_W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (!inBounds(nx, ny)) continue;
      const ni = idx(nx, ny);
      if (reach[ni] || blocked[ni]) continue;
      reach[ni] = 1; q.push(ni);
    }
  }
  // 确保祭坛前的位置可达
  const nearWater = (x: number, y: number) => {
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      if (inBounds(x + ox, y + oy) && ground[idx(x + ox, y + oy)] === T.Water) return true;
    }
    return false;
  };
  const candidates = (pred: (x: number, y: number, i: number) => boolean) => {
    const out: Pt[] = [];
    for (let y = 3; y < MAP_H - 3; y++) for (let x = 3; x < MAP_W - 3; x++) {
      const i = idx(x, y);
      if (!reach[i] || occupied[i] || blocked[i] || ground[i] === T.Path) continue;
      if (Math.hypot(x - start.x, y - start.y) < 2.5) continue;
      if (pred(x, y, i)) out.push({ x, y });
    }
    return out;
  };
  const scatter = (pts: Pt[], n: number, minGap: number, cb: (p: Pt) => void) => {
    const chosen: Pt[] = [];
    let guard = 0;
    while (chosen.length < n && guard++ < 4000 && pts.length) {
      const p = pts[Math.floor(rnd() * pts.length)];
      if (chosen.some((c) => Math.hypot(c.x - p.x, c.y - p.y) < minGap)) continue;
      if (occupied[idx(p.x, p.y)]) continue;
      chosen.push(p); cb(p);
    }
  };
  const res = (kind: ResourceKind) => (p: Pt) => { place('resource', p.x, p.y, Math.floor(rnd() * 3), kind === 'crystal', { res: kind }); };

  // 灵木枝：起点附近较多，全图分布
  scatter(candidates((x, y) => Math.hypot(x - start.x, y - start.y) < 13), 9, 2.5, res('branch'));
  scatter(candidates((_x, _y, i) => zone[i] === 0), 22, 4, res('branch'));
  // 萤光蘑菇：幽暗林
  scatter(candidates((_x, _y, i) => zone[i] === 1), 18, 2.6, res('mushroom'));
  scatter(candidates((x, y, i) => zone[i] === 0 && x > 52 && y > 30 && y < 60), 4, 5, res('mushroom'));
  // 雾铃草：湖畔
  scatter(candidates((x, y) => nearWater(x, y)), 18, 2.2, res('lily'));
  // 月光石：岩地
  scatter(candidates((_x, _y, i) => zone[i] === 2), 16, 2.6, res('crystal'));

  // 石碑
  const stelePos: Pt[] = [{ x: 51, y: 59 }, { x: 27, y: 43 }, { x: 44, y: 14 }, { x: 69, y: 44 }, { x: 25, y: 19 }];
  stelePos.forEach((p, k) => {
    // 就近找一个可达且未占用的位置
    let best: Pt | null = null; let bd = 1e9;
    for (let oy = -3; oy <= 3; oy++) for (let ox = -3; ox <= 3; ox++) {
      const x = p.x + ox, y = p.y + oy;
      if (!inBounds(x, y)) continue;
      const i = idx(x, y);
      if (!reach[i] || occupied[i] || blocked[i] || ground[i] === T.Path) continue;
      const d = Math.hypot(ox, oy);
      if (d < bd) { bd = d; best = { x, y }; }
    }
    if (best) place('stele', best.x, best.y, k % 2, true, { stele: k });
  });

  // ---- v2 生存版新增资源（追加在随机序列末尾，不改变原有地形与物件位置）----
  scatter(candidates((x, y) => Math.hypot(x - start.x, y - start.y) < 12), 7, 2.2, res('grass'));
  scatter(candidates((x, y) => Math.hypot(x - start.x, y - start.y) < 12), 6, 2.2, res('sapling'));
  scatter(candidates((x, y) => Math.hypot(x - start.x, y - start.y) < 10), 5, 2.5, res('flint'));
  scatter(candidates((_x, _y, i) => zone[i] === 0 || zone[i] === 3), 70, 3, res('grass'));
  scatter(candidates((_x, _y, i) => zone[i] === 0 || zone[i] === 1), 45, 3.5, res('sapling'));
  scatter(candidates((_x, _y, i) => zone[i] === 2), 22, 2.5, res('flint'));
  scatter(candidates((_x, _y, i) => zone[i] === 0), 16, 6, res('flint'));

  return {
    ground, blocked, moisture, waterDepth, objects, zone, noise,
    start: { x: start.x * TILE + TILE / 2, y: start.y * TILE + TILE / 2 },
    altar: { x: altarT.x * TILE + TILE / 2, y: altarT.y * TILE + TILE / 2 },
  };
}

export function isBlockedPx(map: WorldMap, px: number, py: number): boolean {
  const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
  if (!inBounds(tx, ty)) return true;
  return map.blocked[idx(tx, ty)] === 1;
}
