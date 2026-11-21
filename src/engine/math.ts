// 数学工具：确定性随机数、值噪声、插值

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (t: number) => t * t * (3 - 2 * t);
export const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);

/** 2D 值噪声（可平铺无关，确定性） */
export class Noise2D {
  private perm: Uint8Array;
  private vals: Float32Array;
  constructor(seed: number) {
    const r = mulberry32(seed);
    this.perm = new Uint8Array(512);
    this.vals = new Float32Array(256);
    const p = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
    for (let i = 0; i < 256; i++) this.vals[i] = r();
  }
  private v(x: number, y: number) {
    return this.vals[this.perm[(this.perm[x & 255] + y) & 511]];
  }
  get(x: number, y: number): number {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = smooth(x - xi), yf = smooth(y - yi);
    const a = this.v(xi, yi), b = this.v(xi + 1, yi);
    const c = this.v(xi, yi + 1), d = this.v(xi + 1, yi + 1);
    return lerp(lerp(a, b, xf), lerp(c, d, xf), yf);
  }
  /** 分形噪声 0..1 */
  fbm(x: number, y: number, oct = 4): number {
    let amp = 0.5, f = 1, s = 0, n = 0;
    for (let i = 0; i < oct; i++) {
      s += this.get(x * f, y * f) * amp;
      n += amp;
      amp *= 0.5;
      f *= 2;
    }
    return s / n;
  }
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
export function mixRgb(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}
