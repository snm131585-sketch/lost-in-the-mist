// 迷雾探索：16px 精度的探索度网格；未探索=浓雾，已探索=薄雾，视野内=清晰
import { TILE, MAP_W, MAP_H } from './map';
import { makeCanvas } from '../art/painters';
import { clamp, Noise2D } from '../engine/math';

export const FOG_CELL = 16;
export const FW = (MAP_W * TILE) / FOG_CELL;
export const FH = (MAP_H * TILE) / FOG_CELL;

export class Fog {
  explored = new Uint8Array(FW * FH);
  private vis = new Float32Array(FW * FH);
  canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private img: ImageData;
  private tint = new Float32Array(FW * FH);
  /** 0..1，结局时淡出全部迷雾 */
  globalClear = 0;
  dirty = true;

  constructor() {
    const [c, g] = makeCanvas(FW, FH);
    this.canvas = c; this.g = g;
    this.img = g.createImageData(FW, FH);
    const n = new Noise2D(4242);
    for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) this.tint[y * FW + x] = n.fbm(x / 10, y / 10, 3);
  }

  reset() { this.explored.fill(0); this.dirty = true; }

  /** 以像素坐标 + 视野半径（像素）更新 */
  reveal(px: number, py: number, radius: number) {
    const cx = px / FOG_CELL, cy = py / FOG_CELL, r = radius / FOG_CELL;
    this.vis.fill(0);
    const x0 = Math.max(0, Math.floor(cx - r - 1)), x1 = Math.min(FW - 1, Math.ceil(cx + r + 1));
    const y0 = Math.max(0, Math.floor(cy - r - 1)), y1 = Math.min(FH - 1, Math.ceil(cy + r + 1));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const v = clamp(1 - (d - r * 0.68) / (r * 0.32), 0, 1);
      if (v <= 0) continue;
      const i = y * FW + x;
      this.vis[i] = v;
      const e = Math.round(v * 255);
      if (e > this.explored[i]) this.explored[i] = e;
    }
    this.dirty = true;
  }

  render() {
    if (!this.dirty) return;
    const d = this.img.data;
    const k = 1 - this.globalClear;
    for (let i = 0; i < FW * FH; i++) {
      const e = this.explored[i] / 255;
      const v = this.vis[i];
      const t = this.tint[i];
      // 未探索：浓雾；探索过但不在视野：薄雾；视野内：清晰
      const a = ((1 - e) * 0.93 + e * (1 - v) * 0.42) * k;
      d[i * 4] = 84 + t * 46;
      d[i * 4 + 1] = 104 + t * 44;
      d[i * 4 + 2] = 112 + t * 38;
      d[i * 4 + 3] = a * 255;
    }
    this.g.putImageData(this.img, 0, 0);
    this.dirty = false;
  }

  /** 某像素位置的雾浓度 0..1 */
  densityAt(px: number, py: number): number {
    const x = Math.floor(px / FOG_CELL), y = Math.floor(py / FOG_CELL);
    if (x < 0 || y < 0 || x >= FW || y >= FH) return 1;
    const i = y * FW + x;
    const e = this.explored[i] / 255;
    return ((1 - e) * 0.93 + e * (1 - this.vis[i]) * 0.42) * (1 - this.globalClear);
  }

  exploredPct(): number {
    let s = 0;
    for (let i = 0; i < this.explored.length; i++) if (this.explored[i] > 128) s++;
    return s / this.explored.length;
  }

  /** 行程编码保存 */
  serialize(): string {
    const out: number[] = [];
    let prev = this.explored[0] >> 4, run = 0;
    for (let i = 0; i < this.explored.length; i++) {
      const v = this.explored[i] >> 4;
      if (v === prev && run < 255) run++;
      else { out.push(prev, run); prev = v; run = 1; }
    }
    out.push(prev, run);
    let s = '';
    for (const b of out) s += String.fromCharCode(b);
    return btoa(s);
  }
  deserialize(data: string) {
    try {
      const s = atob(data);
      let p = 0;
      for (let i = 0; i + 1 < s.length; i += 2) {
        const v = s.charCodeAt(i), run = s.charCodeAt(i + 1);
        for (let k = 0; k < run && p < this.explored.length; k++) this.explored[p++] = v * 17;
      }
      this.dirty = true;
    } catch { this.reset(); }
  }
}
