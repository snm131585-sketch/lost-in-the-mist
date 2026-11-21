// 地面烘焙：低分辨率色场（柔和过渡） + 全分辨率手绘笔触装饰 + 静态阴影
import { mulberry32, hexToRgb, mixRgb, clamp } from '../engine/math';
import { TILE, MAP_W, MAP_H, T, idx, inBounds, type WorldMap } from './map';
import type { Assets } from '../art/manifest';
import { makeCanvas } from '../art/painters';

export const CHUNK = 768;
const WORLD_W = MAP_W * TILE, WORLD_H = MAP_H * TILE;

const COL: Record<number, [string, string]> = {
  [T.Grass]: ['#2c4632', '#4a6c40'],
  [T.Path]: ['#5e4e3a', '#87725a'],
  [T.Water]: ['#12303a', '#2c6668'],
  [T.Shore]: ['#5f5a44', '#857a5c'],
  [T.Moss]: ['#17282a', '#2a4238'],
  [T.Stone]: ['#4c5652', '#6f7870'],
};

export interface GroundLayer {
  chunks: HTMLCanvasElement[];
  cols: number;
  rows: number;
  minimapBase: HTMLCanvasElement; // 1px = 1 tile
}

export function bakeGround(map: WorldMap, assets: Assets): GroundLayer {
  const S = 8; // 色场采样间距（像素）
  const LW = WORLD_W / S, LH = WORLD_H / S;
  const [low, lg] = makeCanvas(LW, LH);
  const img = lg.createImageData(LW, LH);
  const buf = new Float32Array(LW * LH * 3);
  const nz = map.noise;
  for (let y = 0; y < LH; y++) for (let x = 0; x < LW; x++) {
    const wx = x * S, wy = y * S;
    const tx = Math.floor(wx / TILE), ty = Math.floor(wy / TILE);
    const t = map.ground[idx(tx, ty)];
    const [a, b] = COL[t];
    let v = nz.fbm(wx / 180, wy / 180, 4);
    if (t === T.Water) v = map.waterDepth[idx(tx, ty)] * 0.2 + 0.1 + nz.get(wx / 60, wy / 60) * 0.15;
    if (t === T.Water) v = 1 - clamp(map.waterDepth[idx(tx, ty)] * 1.3, 0, 1) * 0.85;
    let c = mixRgb(hexToRgb(a), hexToRgb(b), clamp(v * 1.25 - 0.1, 0, 1));
    if (t === T.Grass) {
      // 湿度色调：湿处偏青，干处偏暖
      const m = map.moisture[idx(tx, ty)];
      c = mixRgb(c, m > 0.5 ? [40, 84, 74] : [92, 98, 54], Math.abs(m - 0.5) * 0.55);
    }
    const o = (y * LW + x) * 3;
    buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2];
  }
  // 轻度模糊，让地形过渡更像水彩晕染
  const out = new Float32Array(buf.length);
  for (let y = 0; y < LH; y++) for (let x = 0; x < LW; x++) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const xx = clamp(x + ox, 0, LW - 1), yy = clamp(y + oy, 0, LH - 1);
      const o = (yy * LW + xx) * 3;
      r += buf[o]; g += buf[o + 1]; b += buf[o + 2]; n++;
    }
    const o = (y * LW + x) * 3;
    out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;
  }
  for (let i = 0; i < LW * LH; i++) {
    img.data[i * 4] = out[i * 3]; img.data[i * 4 + 1] = out[i * 3 + 1]; img.data[i * 4 + 2] = out[i * 3 + 2]; img.data[i * 4 + 3] = 255;
  }
  lg.putImageData(img, 0, 0);

  const cols = Math.ceil(WORLD_W / CHUNK), rows = Math.ceil(WORLD_H / CHUNK);
  const chunks: HTMLCanvasElement[] = [];
  for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
    const [c, g] = makeCanvas(CHUNK, CHUNK);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(low, (cx * CHUNK) / S, (cy * CHUNK) / S, CHUNK / S, CHUNK / S, 0, 0, CHUNK, CHUNK);
    g.translate(-cx * CHUNK, -cy * CHUNK);
    decorate(g, map, assets, cx * CHUNK, cy * CHUNK);
    chunks.push(c);
  }

  // 小地图底图
  const [mm, mg] = makeCanvas(MAP_W, MAP_H);
  const mimg = mg.createImageData(MAP_W, MAP_H);
  const treeTiles = new Uint8Array(MAP_W * MAP_H);
  for (const o of map.objects) if (o.kind === 'tree' || o.kind === 'pine') treeTiles[idx(Math.floor(o.x / TILE), Math.floor(o.y / TILE))] = 1;
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    const i = idx(x, y);
    let c = hexToRgb(COL[map.ground[i]][1]);
    if (treeTiles[i]) c = [30, 58, 44];
    if (map.ground[i] === T.Path) c = [176, 146, 102];
    if (map.ground[i] === T.Water) c = [52, 112, 128];
    mimg.data.set([c[0], c[1], c[2], 255], i * 4);
  }
  mg.putImageData(mimg, 0, 0);
  return { chunks, cols, rows, minimapBase: mm };
}

function decorate(g: CanvasRenderingContext2D, map: WorldMap, assets: Assets, ox: number, oy: number) {
  const tx0 = Math.max(0, Math.floor(ox / TILE) - 1), ty0 = Math.max(0, Math.floor(oy / TILE) - 1);
  const tx1 = Math.min(MAP_W - 1, Math.floor((ox + CHUNK) / TILE) + 1), ty1 = Math.min(MAP_H - 1, Math.floor((oy + CHUNK) / TILE) + 1);
  const ground = (x: number, y: number) => (inBounds(x, y) ? map.ground[idx(x, y)] : T.Grass);

  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    const rnd = mulberry32(ty * 1009 + tx * 7919);
    const t = ground(tx, ty);
    const bx = tx * TILE, by = ty * TILE;
    if (t === T.Grass || t === T.Moss) {
      const dark = t === T.Moss;
      const n = dark ? 5 : 8;
      for (let i = 0; i < n; i++) {
        const x = bx + rnd() * TILE, y = by + rnd() * TILE;
        const h = 3 + rnd() * 5;
        g.strokeStyle = dark
          ? (rnd() < 0.5 ? 'rgba(70,110,92,.55)' : 'rgba(10,22,22,.5)')
          : (rnd() < 0.55 ? 'rgba(120,160,92,.55)' : 'rgba(22,40,28,.45)');
        g.lineWidth = 1.1;
        g.beginPath();
        g.moveTo(x - 2, y); g.lineTo(x - 1 + rnd(), y - h);
        g.moveTo(x, y); g.lineTo(x + 1.5, y - h * 1.2);
        g.moveTo(x + 2, y); g.lineTo(x + 3 + rnd(), y - h * 0.8);
        g.stroke();
      }
      if (!dark && rnd() < 0.07) {
        const fc = ['#f1e7c4', '#e7a3b8', '#a8c8f0', '#f3d27e'][Math.floor(rnd() * 4)];
        const cx = bx + rnd() * TILE, cy = by + rnd() * TILE;
        for (let k = 0; k < 6; k++) {
          g.fillStyle = 'rgba(40,70,40,.8)';
          const fx = cx + (rnd() - 0.5) * 18, fy = cy + (rnd() - 0.5) * 12;
          g.fillRect(fx, fy, 1, 3);
          g.fillStyle = fc;
          g.beginPath(); g.arc(fx + 0.5, fy, 1.8, 0, Math.PI * 2); g.fill();
        }
      }
      if (dark && rnd() < 0.25) {
        g.fillStyle = rnd() < 0.5 ? 'rgba(164,96,42,.55)' : 'rgba(110,70,50,.5)';
        g.beginPath(); g.ellipse(bx + rnd() * TILE, by + rnd() * TILE, 3, 1.5, rnd() * 3, 0, Math.PI * 2); g.fill();
      }
    } else if (t === T.Path) {
      for (let i = 0; i < 3; i++) {
        g.fillStyle = rnd() < 0.5 ? 'rgba(160,140,110,.55)' : 'rgba(50,40,30,.4)';
        g.beginPath(); g.ellipse(bx + rnd() * TILE, by + rnd() * TILE, 1.5 + rnd() * 2.5, 1 + rnd() * 1.5, rnd() * 3, 0, Math.PI * 2); g.fill();
      }
      // 路边缘的草
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nt = ground(tx + dx, ty + dy);
        if (nt === T.Grass || nt === T.Moss) {
          for (let i = 0; i < 4; i++) {
            const x = bx + (dx === 1 ? TILE - 4 : dx === -1 ? 4 : rnd() * TILE) + (rnd() - 0.5) * 4;
            const y = by + (dy === 1 ? TILE - 2 : dy === -1 ? 6 : rnd() * TILE);
            g.strokeStyle = 'rgba(70,104,62,.7)'; g.lineWidth = 1.1;
            g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 3, y - 4 - rnd() * 3); g.stroke();
          }
        }
      }
    } else if (t === T.Stone) {
      if (rnd() < 0.5) {
        g.strokeStyle = 'rgba(30,34,34,.45)'; g.lineWidth = 1;
        const x = bx + rnd() * TILE, y = by + rnd() * TILE;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + 6 + rnd() * 6, y + (rnd() - 0.5) * 6); g.lineTo(x + 10 + rnd() * 6, y + 3); g.stroke();
      }
      for (let i = 0; i < 3; i++) {
        g.fillStyle = rnd() < 0.5 ? 'rgba(80,120,70,.5)' : 'rgba(150,150,130,.4)';
        g.beginPath(); g.arc(bx + rnd() * TILE, by + rnd() * TILE, 1 + rnd() * 2, 0, Math.PI * 2); g.fill();
      }
    } else if (t === T.Water) {
      // 岸边泡沫
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (ground(tx + dx, ty + dy) !== T.Water) {
          g.strokeStyle = 'rgba(190,220,215,.28)'; g.lineWidth = 1.5;
          g.beginPath();
          const cx = bx + TILE / 2 + dx * 12, cy = by + TILE / 2 + dy * 12;
          if (dx !== 0) { g.moveTo(cx, by + 4); g.quadraticCurveTo(cx - dx * 4, by + 16, cx, by + 28); }
          else { g.moveTo(bx + 4, cy); g.quadraticCurveTo(bx + 16, cy - dy * 4, bx + 28, cy); }
          g.stroke();
        }
      }
      if (map.waterDepth[idx(tx, ty)] < 0.45 && rnd() < 0.18) {
        // 睡莲叶
        const x = bx + 6 + rnd() * 20, y = by + 6 + rnd() * 20, r = 5 + rnd() * 4;
        g.fillStyle = '#3d6f4a';
        g.beginPath(); g.moveTo(x, y); g.arc(x, y, r, 0.3, Math.PI * 2 - 0.1); g.closePath(); g.fill();
        g.fillStyle = 'rgba(160,200,140,.4)';
        g.beginPath(); g.arc(x - 1, y - 1, r * 0.5, 0, Math.PI * 2); g.fill();
        if (rnd() < 0.35) { g.fillStyle = '#f2d8e6'; g.beginPath(); g.arc(x + 2, y - 2, 2.2, 0, Math.PI * 2); g.fill(); }
      }
    } else if (t === T.Shore) {
      for (let i = 0; i < 4; i++) {
        g.fillStyle = rnd() < 0.5 ? 'rgba(170,160,120,.45)' : 'rgba(70,90,60,.4)';
        g.beginPath(); g.arc(bx + rnd() * TILE, by + rnd() * TILE, 1 + rnd() * 1.8, 0, Math.PI * 2); g.fill();
      }
      if (rnd() < 0.3) {
        // 芦苇
        const x = bx + rnd() * TILE, y = by + TILE * 0.8;
        g.strokeStyle = 'rgba(120,140,80,.85)'; g.lineWidth = 1.3;
        for (let k = 0; k < 4; k++) { g.beginPath(); g.moveTo(x + k * 2, y); g.quadraticCurveTo(x + k * 2 - 2, y - 8, x + k * 2 + 1, y - 14 - rnd() * 6); g.stroke(); }
      }
    }
  }

  // 祭坛地台
  const ab = assets.get('altar.base');
  g.drawImage(ab, map.altar.x - ab.width / 2, map.altar.y - ab.height / 2 + 10);

  // 静态投影（树、岩石、石碑）
  for (const o of map.objects) {
    if (o.x < ox - 120 || o.x > ox + CHUNK + 120 || o.y < oy - 120 || o.y > oy + CHUNK + 120) continue;
    let rx = 0, ry = 0, sx = 0;
    if (o.kind === 'tree') { rx = 42; ry = 16; sx = 12; }
    else if (o.kind === 'pine') { rx = 30; ry = 11; sx = 8; }
    else if (o.kind === 'rock') { rx = 20; ry = 7; sx = 4; }
    else if (o.kind === 'stele') { rx = 16; ry = 5; sx = 4; }
    else if (o.kind === 'bush') { rx = 20; ry = 6; sx = 3; }
    else continue;
    const gr = g.createRadialGradient(o.x + sx, o.y, 1, o.x + sx, o.y, rx);
    gr.addColorStop(0, 'rgba(6,14,16,.5)');
    gr.addColorStop(1, 'rgba(6,14,16,0)');
    g.fillStyle = gr;
    g.save(); g.translate(o.x + sx, o.y); g.scale(1, ry / rx); g.translate(-(o.x + sx), -o.y);
    g.beginPath(); g.arc(o.x + sx, o.y, rx, 0, Math.PI * 2); g.fill();
    g.restore();
  }
}
