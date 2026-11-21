// 程序化手绘风美术资源
// 所有资源都在启动时绘制到离屏 Canvas，可被 manifest.ts 中的正式 PNG 覆盖。
// 统一规则（详见 docs/ART_GUIDE.md）：光源来自左上；暗部偏青紫、亮部偏暖黄；
// 轮廓不描黑线，用更深的同色系收边；叶片/苔藓用小笔触点出质感。
import { mulberry32 } from '../engine/math';

export type Cnv = HTMLCanvasElement;
export function makeCanvas(w: number, h: number): [Cnv, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  return [c, g];
}

export const PAL = {
  trunk: ['#2a1c16', '#4a3020', '#6e4a2e', '#9a6d43'],
  leafTeal: ['#14302b', '#22493d', '#3a6c50', '#6f9f62', '#b7cf86'],
  leafOlive: ['#1f2f1c', '#334d26', '#557533', '#86a14a', '#c8d27a'],
  leafBlue: ['#142a30', '#1f4146', '#336461', '#5d927f', '#a5c9a3'],
  leafAmber: ['#3a2216', '#6a3a1e', '#a4602a', '#d99744', '#f3d27e'],
  leafDark: ['#0f1d20', '#18302f', '#25463f', '#3f6a5a', '#7fa68a'],
  leafDark2: ['#141a26', '#202d3a', '#2f4650', '#4d6f6e', '#8fb0a0'],
  stone: ['#2a2f30', '#454c4a', '#686f68', '#959a8a', '#c9c6ae'],
  cloak: ['#173430', '#24504a', '#337065', '#5b9886'],
  scarf: ['#8e4d1f', '#c9792f', '#f0b45a'],
  skin: ['#c9946e', '#e6bd96', '#f6d9b8'],
  glow: '#9ff5d6',
  moon: ['#3a3f6b', '#6a78b6', '#a9c2ee', '#e8f4ff'],
};

type Ctx = CanvasRenderingContext2D;

function blob(g: Ctx, x: number, y: number, r: number, dark: string, light: string) {
  const gr = g.createRadialGradient(x - r * 0.45, y - r * 0.5, r * 0.1, x, y, r);
  gr.addColorStop(0, light);
  gr.addColorStop(1, dark);
  g.fillStyle = gr;
  g.beginPath();
  // 微微不规则的圆
  const n = 9;
  for (let k = 0; k <= n; k++) {
    const a = (k / n) * Math.PI * 2;
    const rr = r * (0.9 + 0.1 * Math.sin(a * 3 + x));
    const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
    if (k === 0) g.moveTo(px, py); else g.lineTo(px, py);
  }
  g.closePath();
  g.fill();
}

function leafStrokes(g: Ctx, cx: number, cy: number, rx: number, ry: number, n: number, color: string, rnd: () => number, upBias = 0.5) {
  g.strokeStyle = color;
  g.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2;
    const d = Math.sqrt(rnd());
    const x = cx + Math.cos(a) * rx * d;
    const y = cy + Math.sin(a) * ry * d - upBias * ry * 0.3;
    g.lineWidth = 1.2 + rnd() * 1.6;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + 2 + rnd() * 2, y - 2, x + 3 + rnd() * 3, y + 1 - rnd() * 2);
    g.stroke();
  }
}

// ---------------- 树 ----------------
export function paintTree(variant: number): Cnv {
  const W = 128, H = 150;
  const [c, g] = makeCanvas(W, H);
  const rnd = mulberry32(1000 + variant * 31);
  const pal = [PAL.leafTeal, PAL.leafOlive, PAL.leafBlue, PAL.leafAmber, PAL.leafDark, PAL.leafDark2][variant % 6];
  const fx = W / 2, fy = H - 10;
  // 树根与树干
  g.fillStyle = PAL.trunk[0];
  g.beginPath();
  g.moveTo(fx - 13, fy);
  g.quadraticCurveTo(fx - 7, fy - 8, fx - 6, fy - 40);
  g.lineTo(fx + 6, fy - 40);
  g.quadraticCurveTo(fx + 7, fy - 8, fx + 14, fy);
  g.quadraticCurveTo(fx, fy - 4, fx - 13, fy);
  g.fill();
  const tg = g.createLinearGradient(fx - 7, 0, fx + 7, 0);
  tg.addColorStop(0, PAL.trunk[3]); tg.addColorStop(0.45, PAL.trunk[2]); tg.addColorStop(1, PAL.trunk[0]);
  g.fillStyle = tg;
  g.beginPath();
  g.moveTo(fx - 9, fy - 2);
  g.quadraticCurveTo(fx - 5, fy - 10, fx - 5, fy - 44);
  g.lineTo(fx + 5, fy - 44);
  g.quadraticCurveTo(fx + 5, fy - 10, fx + 10, fy - 2);
  g.closePath();
  g.fill();
  // 树皮纹理
  g.strokeStyle = 'rgba(30,18,12,.55)'; g.lineWidth = 1;
  for (let i = 0; i < 6; i++) {
    const x = fx - 4 + rnd() * 8, y = fy - 6 - rnd() * 30;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 2, y - 6 - rnd() * 6); g.stroke();
  }
  // 树冠
  const cx = fx, cy = fy - 76, rx = 50, ry = 44;
  // 深色底层
  for (let i = 0; i < 16; i++) {
    const a = rnd() * Math.PI * 2, d = 0.55 + rnd() * 0.45;
    blob(g, cx + Math.cos(a) * rx * d * 0.85, cy + Math.sin(a) * ry * d * 0.8 + 6, 16 + rnd() * 10, pal[0], pal[1]);
  }
  // 中间层
  for (let i = 0; i < 14; i++) {
    const a = rnd() * Math.PI * 2, d = rnd() * 0.75;
    blob(g, cx + Math.cos(a) * rx * d * 0.8 - 3, cy + Math.sin(a) * ry * d * 0.7 - 4, 14 + rnd() * 9, pal[1], pal[2]);
  }
  // 亮部（左上）
  for (let i = 0; i < 10; i++) {
    const a = Math.PI * (1.05 + rnd() * 0.7), d = 0.15 + rnd() * 0.6;
    blob(g, cx + Math.cos(a) * rx * d * 0.8, cy + Math.sin(a) * ry * d * 0.75 - 6, 8 + rnd() * 8, pal[2], pal[3]);
  }
  leafStrokes(g, cx - 8, cy - 8, rx * 0.7, ry * 0.6, 22, pal[4] + '77', rnd);
  leafStrokes(g, cx + 6, cy + 10, rx * 0.8, ry * 0.6, 30, pal[0] + 'aa', rnd, -0.2);
  // 底部投影（树冠压在树干上）
  g.globalCompositeOperation = 'source-atop';
  const sh = g.createLinearGradient(0, cy, 0, cy + ry + 10);
  sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(8,16,24,.35)');
  g.fillStyle = sh; g.fillRect(0, cy, W, ry + 30);
  g.globalCompositeOperation = 'source-over';
  return c;
}

export function paintPine(variant: number): Cnv {
  const W = 96, H = 156;
  const [c, g] = makeCanvas(W, H);
  const rnd = mulberry32(2000 + variant * 17);
  const pal = [PAL.leafBlue, PAL.leafTeal, PAL.leafDark, PAL.leafOlive][variant % 4];
  const fx = W / 2, fy = H - 8;
  g.fillStyle = PAL.trunk[1];
  g.fillRect(fx - 4, fy - 26, 8, 26);
  g.fillStyle = PAL.trunk[0];
  g.fillRect(fx + 1, fy - 26, 3, 26);
  const tiers = 5;
  for (let t = 0; t < tiers; t++) {
    const k = t / (tiers - 1);
    const ty = fy - 22 - t * 24;
    const w = 42 - k * 26;
    const h = 40;
    const grad = g.createLinearGradient(fx - w, 0, fx + w, 0);
    grad.addColorStop(0, pal[2]); grad.addColorStop(0.45, pal[1]); grad.addColorStop(1, pal[0]);
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(fx, ty - h);
    const teeth = 7;
    for (let i = 0; i <= teeth; i++) {
      const u = i / teeth;
      const x = fx + w - u * w * 2;
      const y = ty + (i % 2 ? -5 : 2) + rnd() * 3;
      if (i === 0) g.lineTo(fx + w, ty); else g.lineTo(x, y);
    }
    g.closePath();
    g.fill();
    // 层次高光
    g.strokeStyle = pal[3] + 'aa'; g.lineWidth = 1.5; g.lineCap = 'round';
    for (let i = 0; i < 7; i++) {
      const x = fx - w * 0.7 + rnd() * w * 0.8, y = ty - 4 - rnd() * h * 0.6;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x - 4, y + 4); g.stroke();
    }
    g.fillStyle = 'rgba(5,12,18,.25)';
    g.beginPath(); g.ellipse(fx + w * 0.2, ty, w * 0.8, 3, 0, 0, Math.PI * 2); g.fill();
  }
  // 顶部一点暖光
  g.fillStyle = pal[4] + '55';
  g.beginPath(); g.ellipse(fx - 6, fy - 22 - (tiers - 1) * 24 - 24, 5, 9, -0.4, 0, Math.PI * 2); g.fill();
  return c;
}

// ---------------- 岩石 / 灌木 ----------------
export function paintRock(variant: number): Cnv {
  const [c, g] = makeCanvas(56, 46);
  const rnd = mulberry32(3000 + variant * 13);
  const cx = 28, by = 40;
  const pts: [number, number][] = [];
  const n = 9;
  const w = 20 + variant * 2, h = 16 + variant * 3;
  for (let i = 0; i < n; i++) {
    const a = Math.PI + (i / (n - 1)) * Math.PI;
    pts.push([cx + Math.cos(a) * w * (0.85 + rnd() * 0.25), by - 4 + Math.sin(a) * h * (0.8 + rnd() * 0.3)]);
  }
  const grad = g.createLinearGradient(cx - w, by - h, cx + w, by);
  grad.addColorStop(0, PAL.stone[3]); grad.addColorStop(0.5, PAL.stone[2]); grad.addColorStop(1, PAL.stone[0]);
  g.fillStyle = grad;
  g.beginPath(); g.moveTo(pts[0][0], by);
  pts.forEach(([x, y]) => g.lineTo(x, y));
  g.lineTo(cx + w, by); g.quadraticCurveTo(cx, by + 4, pts[0][0], by); g.fill();
  // 切面
  g.fillStyle = 'rgba(255,250,230,.12)';
  g.beginPath(); g.moveTo(cx - w * 0.6, by - h * 0.6); g.lineTo(cx - w * 0.1, by - h * 0.95); g.lineTo(cx + w * 0.1, by - h * 0.45); g.closePath(); g.fill();
  // 苔藓
  for (let i = 0; i < 14; i++) {
    g.fillStyle = rnd() < 0.5 ? '#4f7a45' : '#6f9a52';
    g.beginPath(); g.arc(cx - w * 0.5 + rnd() * w, by - h * 0.7 + rnd() * h * 0.35, 1.5 + rnd() * 2.5, 0, Math.PI * 2); g.fill();
  }
  return c;
}

export function paintBush(variant: number): Cnv {
  const [c, g] = makeCanvas(56, 44);
  const rnd = mulberry32(4000 + variant * 7);
  const pal = [PAL.leafTeal, PAL.leafOlive, PAL.leafBlue][variant % 3];
  for (let i = 0; i < 9; i++) blob(g, 14 + rnd() * 28, 26 + rnd() * 8, 9 + rnd() * 5, pal[0], pal[2]);
  for (let i = 0; i < 6; i++) blob(g, 16 + rnd() * 22, 22 + rnd() * 6, 6 + rnd() * 4, pal[1], pal[3]);
  leafStrokes(g, 28, 26, 18, 10, 22, pal[4] + 'aa', rnd);
  // 小花/浆果
  const berry = ['#e7a3b8', '#f3e1a0', '#a8c8f0'][variant % 3];
  for (let i = 0; i < 6; i++) {
    g.fillStyle = berry;
    g.beginPath(); g.arc(14 + rnd() * 28, 20 + rnd() * 14, 1.8, 0, Math.PI * 2); g.fill();
  }
  return c;
}

// ---------------- 资源节点 ----------------
export function paintResource(kind: string, variant: number, depleted: boolean): Cnv {
  const rnd = mulberry32(5000 + variant * 11 + kind.length * 101 + (depleted ? 7 : 0));
  if (kind === 'branch') {
    const [c, g] = makeCanvas(48, 34);
    if (!depleted) {
      for (let i = 0; i < 4; i++) {
        const x1 = 6 + rnd() * 10, y1 = 18 + rnd() * 12, x2 = 32 + rnd() * 12, y2 = 10 + rnd() * 16;
        g.strokeStyle = PAL.trunk[0]; g.lineWidth = 5; g.lineCap = 'round';
        g.beginPath(); g.moveTo(x1, y1 + 1); g.lineTo(x2, y2 + 1); g.stroke();
        g.strokeStyle = PAL.trunk[2 + (i % 2)]; g.lineWidth = 3.4;
        g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
        g.strokeStyle = PAL.trunk[1]; g.lineWidth = 1.6;
        const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
        g.beginPath(); g.moveTo(mx, my); g.lineTo(mx + 4, my - 6); g.stroke();
      }
    }
    for (let i = 0; i < (depleted ? 4 : 7); i++) {
      g.fillStyle = ['#a4602a', '#d99744', '#6f9f62'][i % 3];
      g.beginPath(); g.ellipse(8 + rnd() * 32, 20 + rnd() * 10, 3, 1.6, rnd() * 3, 0, Math.PI * 2); g.fill();
    }
    return c;
  }
  if (kind === 'mushroom') {
    const [c, g] = makeCanvas(44, 40);
    const n = depleted ? 2 : 4 + (variant % 2);
    for (let i = 0; i < n; i++) {
      const x = 8 + rnd() * 28, h = depleted ? 3 : 8 + rnd() * 10, y = 36 - rnd() * 4, r = depleted ? 2.5 : 5 + rnd() * 5;
      g.fillStyle = '#d9d3bc'; g.fillRect(x - 1.6, y - h, 3.2, h);
      if (depleted) continue;
      const gr = g.createRadialGradient(x - r * 0.3, y - h - r * 0.4, 1, x, y - h, r * 1.2);
      gr.addColorStop(0, '#e9fff5'); gr.addColorStop(0.4, PAL.glow); gr.addColorStop(1, '#2f8f84');
      g.fillStyle = gr;
      g.beginPath(); g.ellipse(x, y - h, r, r * 0.65, 0, Math.PI, 0); g.closePath(); g.fill();
      g.fillStyle = 'rgba(255,255,255,.75)';
      g.beginPath(); g.arc(x - r * 0.4, y - h - r * 0.3, 1, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(x + r * 0.2, y - h - r * 0.45, 0.8, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = '#2a4a3a';
    for (let i = 0; i < 8; i++) { g.beginPath(); g.ellipse(6 + rnd() * 32, 36 + rnd() * 2, 3, 1.5, 0, 0, Math.PI * 2); g.fill(); }
    return c;
  }
  if (kind === 'crystal') {
    const [c, g] = makeCanvas(56, 60);
    // 岩基
    g.fillStyle = PAL.stone[1];
    g.beginPath(); g.ellipse(28, 50, 22, 9, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = PAL.stone[2];
    g.beginPath(); g.ellipse(25, 48, 18, 6, 0, 0, Math.PI * 2); g.fill();
    if (!depleted) {
      const n = 4 + (variant % 2);
      for (let i = 0; i < n; i++) {
        const x = 12 + (i / (n - 1)) * 32 + (rnd() - 0.5) * 4;
        const h = 18 + rnd() * 24 - Math.abs(i - n / 2) * 4;
        const w = 5 + rnd() * 3;
        const lean = (x - 28) * 0.25;
        const top = { x: x + lean, y: 48 - h };
        // 左面（亮）
        g.fillStyle = PAL.moon[2];
        g.beginPath(); g.moveTo(x - w, 48); g.lineTo(top.x - w * 0.6, top.y + 6); g.lineTo(top.x, top.y); g.lineTo(x, 48); g.closePath(); g.fill();
        // 右面（暗）
        g.fillStyle = PAL.moon[1];
        g.beginPath(); g.moveTo(x, 48); g.lineTo(top.x, top.y); g.lineTo(top.x + w * 0.6, top.y + 6); g.lineTo(x + w, 48); g.closePath(); g.fill();
        g.strokeStyle = PAL.moon[3]; g.lineWidth = 1;
        g.beginPath(); g.moveTo(top.x, top.y + 1); g.lineTo(x - 0.5, 46); g.stroke();
      }
    } else {
      for (let i = 0; i < 3; i++) {
        g.fillStyle = PAL.moon[0];
        const x = 16 + i * 11;
        g.beginPath(); g.moveTo(x - 3, 48); g.lineTo(x, 42); g.lineTo(x + 3, 48); g.fill();
      }
    }
    return c;
  }
  // lily 雾铃草
  const [c, g] = makeCanvas(40, 46);
  const n = 3 + (variant % 2);
  for (let i = 0; i < n; i++) {
    const x = 8 + i * (24 / (n - 1)) + (rnd() - 0.5) * 3;
    const h = 18 + rnd() * 14;
    g.strokeStyle = '#3f6a4a'; g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(x, 44); g.quadraticCurveTo(x - 3, 44 - h * 0.6, x + 2, 44 - h); g.stroke();
    g.fillStyle = '#4f7d52';
    g.beginPath(); g.ellipse(x - 3, 40, 5, 2, -0.7, 0, Math.PI * 2); g.fill();
    if (depleted) continue;
    // 铃铛花
    const bx = x + 3, by = 44 - h + 3;
    const gr = g.createLinearGradient(bx, by - 4, bx, by + 6);
    gr.addColorStop(0, '#f4f1ff'); gr.addColorStop(1, '#a9b8e8');
    g.fillStyle = gr;
    g.beginPath(); g.moveTo(bx - 4, by + 4); g.quadraticCurveTo(bx - 4, by - 4, bx, by - 4); g.quadraticCurveTo(bx + 4, by - 4, bx + 4, by + 4);
    g.quadraticCurveTo(bx, by + 2, bx - 4, by + 4); g.fill();
    // 露珠
    g.fillStyle = 'rgba(200,240,255,.95)';
    g.beginPath(); g.arc(bx, by + 7, 1.8, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(bx - 0.6, by + 6.4, 0.6, 0, Math.PI * 2); g.fill();
  }
  return c;
}

// ---------------- 石碑 / 祭坛 ----------------
export function paintStele(variant: number): Cnv {
  const [c, g] = makeCanvas(40, 60);
  const rnd = mulberry32(6000 + variant);
  const grad = g.createLinearGradient(6, 0, 34, 0);
  grad.addColorStop(0, PAL.stone[3]); grad.addColorStop(0.6, PAL.stone[2]); grad.addColorStop(1, PAL.stone[1]);
  g.fillStyle = PAL.stone[0];
  g.beginPath(); g.ellipse(20, 55, 15, 4, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(8, 55); g.lineTo(8, 16); g.quadraticCurveTo(20, 2 + variant * 3, 32, 16); g.lineTo(32, 55); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(160,220,210,.75)'; g.lineWidth = 1.4;
  for (let r = 0; r < 4; r++) {
    const y = 22 + r * 7;
    g.beginPath(); g.moveTo(13, y);
    for (let k = 0; k < 4; k++) g.lineTo(14 + k * 4 + rnd() * 2, y + (rnd() - 0.5) * 4);
    g.stroke();
  }
  for (let i = 0; i < 12; i++) {
    g.fillStyle = rnd() < 0.5 ? '#4f7a45' : '#6f9a52';
    g.beginPath(); g.arc(8 + rnd() * 24, 44 + rnd() * 11, 1.4 + rnd() * 2, 0, Math.PI * 2); g.fill();
  }
  return c;
}

/** 祭坛地台（地面层） */
export function paintAltarBase(): Cnv {
  const [c, g] = makeCanvas(260, 200);
  const cx = 130, cy = 100;
  const rnd = mulberry32(7000);
  for (let ring = 0; ring < 3; ring++) {
    const rx = 120 - ring * 30, ry = 86 - ring * 22;
    g.fillStyle = [PAL.stone[1], PAL.stone[2], PAL.stone[3]][ring];
    g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); g.fill();
    // 石板缝
    g.strokeStyle = 'rgba(20,24,24,.45)'; g.lineWidth = 1.2;
    const segs = 14 - ring * 3;
    for (let k = 0; k < segs; k++) {
      const a = (k / segs) * Math.PI * 2 + ring * 0.3;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * (rx - 30 + ring * 8), cy + Math.sin(a) * (ry - 22 + ring * 6));
      g.lineTo(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry);
      g.stroke();
    }
    g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); g.stroke();
  }
  // 中心纹章
  g.strokeStyle = 'rgba(160,220,210,.55)'; g.lineWidth = 2;
  g.beginPath(); g.ellipse(cx, cy, 40, 28, 0, 0, Math.PI * 2); g.stroke();
  for (let k = 0; k < 3; k++) {
    const a = -Math.PI / 2 + (k / 3) * Math.PI * 2;
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * 40, cy + Math.sin(a) * 28); g.stroke();
  }
  for (let i = 0; i < 60; i++) {
    const a = rnd() * Math.PI * 2, d = 0.7 + rnd() * 0.32;
    g.fillStyle = rnd() < 0.5 ? '#4f7a45' : '#6f9a52';
    g.beginPath(); g.arc(cx + Math.cos(a) * 120 * d, cy + Math.sin(a) * 86 * d, 1.5 + rnd() * 3, 0, Math.PI * 2); g.fill();
  }
  return c;
}

/** 祭坛主体（方尖碑 + 三个符文基座），lit = 已唤醒 */
export function paintAltarMonolith(sockets: number, lit: boolean): Cnv {
  const [c, g] = makeCanvas(200, 176);
  const cx = 100, by = 146;
  // 三个基座：左、右、后
  const pedestals = [{ x: cx - 64, y: by - 14 }, { x: cx + 64, y: by - 14 }, { x: cx, y: by + 12 }];
  const drawPed = (p: { x: number; y: number }, k: number) => {
    g.fillStyle = PAL.stone[0];
    g.beginPath(); g.ellipse(p.x, p.y, 15, 6, 0, 0, Math.PI * 2); g.fill();
    const gr = g.createLinearGradient(p.x - 11, 0, p.x + 11, 0);
    gr.addColorStop(0, PAL.stone[3]); gr.addColorStop(1, PAL.stone[1]);
    g.fillStyle = gr;
    g.fillRect(p.x - 10, p.y - 26, 20, 26);
    g.fillStyle = PAL.stone[3];
    g.beginPath(); g.ellipse(p.x, p.y - 26, 12, 5, 0, 0, Math.PI * 2); g.fill();
    if (k < sockets) {
      g.fillStyle = PAL.moon[2];
      g.beginPath(); g.moveTo(p.x, p.y - 44); g.lineTo(p.x + 6, p.y - 30); g.lineTo(p.x, p.y - 26); g.lineTo(p.x - 6, p.y - 30); g.closePath(); g.fill();
      g.fillStyle = PAL.moon[3];
      g.beginPath(); g.moveTo(p.x, p.y - 44); g.lineTo(p.x - 6, p.y - 30); g.lineTo(p.x, p.y - 32); g.closePath(); g.fill();
    } else {
      g.fillStyle = 'rgba(10,14,20,.6)';
      g.beginPath(); g.ellipse(p.x, p.y - 26, 6, 2.5, 0, 0, Math.PI * 2); g.fill();
    }
  };
  // 方尖碑
  const gr = g.createLinearGradient(cx - 18, 0, cx + 18, 0);
  gr.addColorStop(0, PAL.stone[3]); gr.addColorStop(0.5, PAL.stone[2]); gr.addColorStop(1, PAL.stone[0]);
  g.fillStyle = PAL.stone[0];
  g.beginPath(); g.ellipse(cx, by - 20, 26, 9, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = gr;
  g.beginPath(); g.moveTo(cx - 18, by - 20); g.lineTo(cx - 12, by - 120); g.lineTo(cx, by - 140); g.lineTo(cx + 12, by - 120); g.lineTo(cx + 18, by - 20); g.closePath(); g.fill();
  // 符文刻痕
  g.strokeStyle = lit ? '#bff8e8' : 'rgba(140,190,180,.55)';
  g.lineWidth = lit ? 2.4 : 1.6;
  g.beginPath(); g.arc(cx, by - 92, 9, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.moveTo(cx, by - 112); g.lineTo(cx, by - 40); g.stroke();
  g.beginPath(); g.moveTo(cx - 8, by - 60); g.lineTo(cx, by - 52); g.lineTo(cx + 8, by - 60); g.stroke();
  if (lit) {
    g.globalCompositeOperation = 'lighter';
    const glow = g.createRadialGradient(cx, by - 92, 2, cx, by - 92, 50);
    glow.addColorStop(0, 'rgba(180,255,230,.7)'); glow.addColorStop(1, 'rgba(180,255,230,0)');
    g.fillStyle = glow; g.fillRect(0, 0, 200, 170);
    g.globalCompositeOperation = 'source-over';
  }
  drawPed(pedestals[0], 0);
  drawPed(pedestals[1], 1);
  drawPed(pedestals[2], 2);
  return c;
}

// ---------------- 玩家角色 ----------------
export type Dir = 'down' | 'up' | 'side';
/** frame 0-3 行走，4-5 待机 */
export function paintPlayer(dir: Dir, frame: number): Cnv {
  const W = 44, H = 54;
  const [c, g] = makeCanvas(W, H);
  const walking = frame < 4;
  const ph = walking ? (frame / 4) * Math.PI * 2 : 0;
  const bob = walking ? Math.abs(Math.sin(ph)) * -1.6 : (frame === 5 ? -0.8 : 0);
  const legA = walking ? Math.sin(ph) * 3.2 : 0;
  const cx = W / 2, fy = H - 4;
  const C = PAL.cloak, S = PAL.scarf, K = PAL.skin;

  const boots = (x: number, y: number) => {
    g.fillStyle = '#2b1d17';
    g.beginPath(); g.ellipse(x, y, 3.4, 2.4, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#4a3326'; g.fillRect(x - 2.6, y - 7, 5.2, 6);
  };

  if (dir === 'side') {
    boots(cx - 2 + legA, fy - 1);
    boots(cx + 2 - legA, fy - 1.5);
  } else {
    boots(cx - 4, fy - 1 + (dir === 'down' ? legA * 0.5 : -legA * 0.5));
    boots(cx + 4, fy - 1 - (dir === 'down' ? legA * 0.5 : -legA * 0.5));
  }

  const by = fy - 6 + bob; // 斗篷下摆
  const sway = walking ? Math.sin(ph) * 1.2 : 0;

  // 背包（背面/侧面可见）
  if (dir === 'up' || dir === 'side') {
    const px = dir === 'side' ? cx - 7 : cx;
    g.fillStyle = '#5a3c26';
    g.beginPath(); g.ellipse(px, by - 17, dir === 'side' ? 6 : 9, 9, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#7a5434';
    g.beginPath(); g.ellipse(px - 1, by - 19, dir === 'side' ? 4 : 7, 6, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#b29069'; // 卷起的毯子
    g.beginPath(); g.ellipse(px, by - 27, dir === 'side' ? 5 : 9, 3.2, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#3a2a1e'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(px - 4, by - 27); g.lineTo(px - 4, by - 24); g.stroke();
  }

  // 斗篷
  const cg = g.createLinearGradient(cx - 11, 0, cx + 11, 0);
  cg.addColorStop(0, C[3]); cg.addColorStop(0.4, C[2]); cg.addColorStop(1, C[0]);
  g.fillStyle = cg;
  g.beginPath();
  g.moveTo(cx - 6, by - 26);
  g.quadraticCurveTo(cx - 12 + sway, by - 8, cx - 11 + sway, by);
  g.quadraticCurveTo(cx, by + 3, cx + 11 + sway, by);
  g.quadraticCurveTo(cx + 12 + sway, by - 8, cx + 6, by - 26);
  g.closePath(); g.fill();
  // 褶皱
  g.strokeStyle = C[0]; g.lineWidth = 1.2;
  g.beginPath(); g.moveTo(cx - 3, by - 18); g.quadraticCurveTo(cx - 4 + sway, by - 8, cx - 5 + sway, by); g.stroke();
  g.beginPath(); g.moveTo(cx + 4, by - 16); g.quadraticCurveTo(cx + 5 + sway, by - 6, cx + 6 + sway, by); g.stroke();

  // 围巾
  if (dir !== 'up') {
    g.fillStyle = S[1];
    g.beginPath(); g.ellipse(cx + (dir === 'side' ? 2 : 0), by - 25, 8, 3.6, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = S[2];
    g.beginPath(); g.ellipse(cx - 2 + (dir === 'side' ? 2 : 0), by - 26, 4, 1.6, 0, 0, Math.PI * 2); g.fill();
    // 飘带
    g.fillStyle = S[0];
    const tx = dir === 'side' ? cx - 8 : cx + 4;
    g.beginPath(); g.moveTo(tx, by - 24); g.lineTo(tx + (dir === 'side' ? -4 - sway : 2), by - 14); g.lineTo(tx + (dir === 'side' ? -1 : 5), by - 15); g.closePath(); g.fill();
  } else {
    g.fillStyle = S[0];
    g.beginPath(); g.ellipse(cx, by - 25, 7, 3, 0, 0, Math.PI * 2); g.fill();
  }

  // 头（兜帽）
  const hy = by - 34;
  const hx = cx + (dir === 'side' ? 1.5 : 0);
  const hg = g.createRadialGradient(hx - 4, hy - 5, 1, hx, hy, 12);
  hg.addColorStop(0, C[3]); hg.addColorStop(1, C[1]);
  g.fillStyle = hg;
  g.beginPath();
  if (dir === 'side') {
    g.moveTo(hx - 9, hy + 6);
    g.quadraticCurveTo(hx - 11, hy - 8, hx - 2, hy - 11);
    g.quadraticCurveTo(hx - 9, hy - 16, hx - 12, hy - 15); // 兜帽尖
    g.quadraticCurveTo(hx + 6, hy - 14, hx + 9, hy - 2);
    g.quadraticCurveTo(hx + 9, hy + 6, hx - 9, hy + 6);
  } else {
    g.ellipse(hx, hy, 10, 10.5, 0, 0, Math.PI * 2);
  }
  g.fill();
  if (dir === 'down') {
    // 面部
    g.fillStyle = K[1];
    g.beginPath(); g.ellipse(hx, hy + 2, 6.4, 6, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = K[0];
    g.beginPath(); g.ellipse(hx, hy + 6, 5.5, 2, 0, 0, Math.PI); g.fill();
    g.fillStyle = C[0];
    g.beginPath(); g.ellipse(hx, hy - 3.5, 7, 2.5, 0, Math.PI, 0); g.fill();
    // 眼睛
    const blink = frame === 5;
    g.fillStyle = '#1c1612';
    if (blink) { g.fillRect(hx - 3.6, hy + 2, 2.4, 0.9); g.fillRect(hx + 1.2, hy + 2, 2.4, 0.9); }
    else {
      g.beginPath(); g.ellipse(hx - 2.4, hy + 2, 1.1, 1.5, 0, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.ellipse(hx + 2.4, hy + 2, 1.1, 1.5, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#fff';
      g.fillRect(hx - 2.8, hy + 1.2, 0.7, 0.7); g.fillRect(hx + 2, hy + 1.2, 0.7, 0.7);
    }
    g.fillStyle = 'rgba(220,120,100,.35)';
    g.beginPath(); g.arc(hx - 4, hy + 4.5, 1.3, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(hx + 4, hy + 4.5, 1.3, 0, Math.PI * 2); g.fill();
  } else if (dir === 'side') {
    g.fillStyle = K[1];
    g.beginPath(); g.ellipse(hx + 4, hy + 2, 4, 5.4, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#1c1612';
    if (frame === 5) g.fillRect(hx + 4.2, hy + 1.6, 2, 0.9);
    else { g.beginPath(); g.ellipse(hx + 5, hy + 1.6, 1, 1.4, 0, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = C[0];
    g.beginPath(); g.ellipse(hx + 2, hy - 3, 5, 2, 0.2, Math.PI, 0); g.fill();
  } else {
    // 背面：兜帽缝线
    g.strokeStyle = C[0]; g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(hx, hy - 10); g.quadraticCurveTo(hx + 1, hy, hx, hy + 8); g.stroke();
  }
  // 兜帽边缘高光
  g.strokeStyle = 'rgba(200,240,220,.25)'; g.lineWidth = 1;
  g.beginPath(); g.arc(hx - 1, hy - 1, 9.5, Math.PI * 1.05, Math.PI * 1.55); g.stroke();

  // 手臂
  g.fillStyle = C[1];
  if (dir === 'side') {
    g.beginPath(); g.ellipse(cx + 2 - legA * 0.6, by - 13, 2.6, 6, 0.2, 0, Math.PI * 2); g.fill();
  } else {
    g.beginPath(); g.ellipse(cx - 9, by - 14 + legA * 0.4, 2.6, 5.6, 0.15, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(cx + 9, by - 14 - legA * 0.4, 2.6, 5.6, -0.15, 0, Math.PI * 2); g.fill();
    g.fillStyle = K[1];
    g.beginPath(); g.arc(cx - 9.5, by - 9 + legA * 0.4, 2, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(cx + 9.5, by - 9 - legA * 0.4, 2, 0, Math.PI * 2); g.fill();
  }
  return c;
}

// ---------------- 物品图标 64x64 ----------------
export function paintIcon(id: string): Cnv {
  const [c, g] = makeCanvas(64, 64);
  const rnd = mulberry32(8000 + id.length * 13 + id.charCodeAt(0));
  switch (id) {
    case 'wood': {
      for (let i = 0; i < 3; i++) {
        const y = 22 + i * 9;
        g.save(); g.translate(32, y); g.rotate(-0.5 + i * 0.25);
        g.fillStyle = PAL.trunk[1]; g.fillRect(-22, -4.5, 44, 9);
        g.fillStyle = PAL.trunk[2]; g.fillRect(-22, -4.5, 44, 4);
        g.fillStyle = '#c99a62'; g.beginPath(); g.ellipse(22, 0, 3, 4.5, 0, 0, Math.PI * 2); g.fill();
        g.strokeStyle = '#7a5434'; g.beginPath(); g.ellipse(22, 0, 1.5, 2.5, 0, 0, Math.PI * 2); g.stroke();
        g.restore();
      }
      g.fillStyle = '#6f9f62'; g.beginPath(); g.ellipse(18, 16, 6, 3, -0.6, 0, Math.PI * 2); g.fill();
      break;
    }
    case 'glowcap': {
      const glow = g.createRadialGradient(32, 28, 2, 32, 28, 30);
      glow.addColorStop(0, 'rgba(159,245,214,.55)'); glow.addColorStop(1, 'rgba(159,245,214,0)');
      g.fillStyle = glow; g.fillRect(0, 0, 64, 64);
      g.fillStyle = '#e4dcc2'; g.fillRect(28, 30, 8, 22);
      g.fillStyle = '#c2b898'; g.fillRect(33, 30, 3, 22);
      const gr = g.createRadialGradient(26, 20, 2, 32, 28, 22);
      gr.addColorStop(0, '#f0fff8'); gr.addColorStop(0.45, PAL.glow); gr.addColorStop(1, '#2a8a80');
      g.fillStyle = gr; g.beginPath(); g.ellipse(32, 30, 20, 15, 0, Math.PI, 0); g.closePath(); g.fill();
      g.fillStyle = 'rgba(255,255,255,.85)';
      [[24, 22], [33, 19], [40, 25]].forEach(([x, y]) => { g.beginPath(); g.arc(x, y, 2, 0, Math.PI * 2); g.fill(); });
      break;
    }
    case 'moonstone': {
      const glow = g.createRadialGradient(32, 32, 2, 32, 32, 30);
      glow.addColorStop(0, 'rgba(169,194,238,.45)'); glow.addColorStop(1, 'rgba(169,194,238,0)');
      g.fillStyle = glow; g.fillRect(0, 0, 64, 64);
      const pts = [[32, 8], [46, 22], [42, 52], [22, 52], [18, 22]];
      g.fillStyle = PAL.moon[1]; g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); g.fill();
      g.fillStyle = PAL.moon[2]; g.beginPath(); g.moveTo(32, 8); g.lineTo(18, 22); g.lineTo(22, 52); g.lineTo(32, 40); g.closePath(); g.fill();
      g.fillStyle = PAL.moon[3]; g.beginPath(); g.moveTo(32, 8); g.lineTo(26, 22); g.lineTo(32, 26); g.closePath(); g.fill();
      break;
    }
    case 'mistdew': {
      const gr = g.createRadialGradient(28, 30, 2, 32, 36, 22);
      gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.35, '#d6f2ff'); gr.addColorStop(1, '#5d8fb8');
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(32, 8); g.bezierCurveTo(40, 22, 50, 32, 50, 40); g.arc(32, 40, 18, 0, Math.PI); g.bezierCurveTo(14, 32, 24, 22, 32, 8); g.fill();
      g.fillStyle = 'rgba(255,255,255,.9)'; g.beginPath(); g.ellipse(25, 38, 3, 6, 0.4, 0, Math.PI * 2); g.fill();
      break;
    }
    case 'lantern': {
      const glow = g.createRadialGradient(32, 38, 2, 32, 38, 30);
      glow.addColorStop(0, 'rgba(255,214,130,.7)'); glow.addColorStop(1, 'rgba(255,214,130,0)');
      g.fillStyle = glow; g.fillRect(0, 0, 64, 64);
      g.strokeStyle = PAL.trunk[1]; g.lineWidth = 3; g.beginPath(); g.arc(32, 16, 8, Math.PI, 0); g.stroke();
      g.fillStyle = PAL.trunk[2]; g.fillRect(20, 18, 24, 6); g.fillRect(20, 50, 24, 6);
      const lg = g.createLinearGradient(0, 24, 0, 50); lg.addColorStop(0, '#fff2c0'); lg.addColorStop(1, '#f2b04c');
      g.fillStyle = lg; g.fillRect(22, 24, 20, 26);
      g.fillStyle = PAL.glow; g.beginPath(); g.ellipse(32, 40, 5, 4, 0, Math.PI, 0); g.fill();
      g.fillStyle = PAL.trunk[1]; g.fillRect(31, 24, 2, 26); g.fillRect(22, 24, 2, 26); g.fillRect(40, 24, 2, 26);
      break;
    }
    case 'pick': {
      g.save(); g.translate(32, 34); g.rotate(-0.75);
      g.fillStyle = PAL.trunk[2]; g.fillRect(-3, -4, 6, 34);
      g.fillStyle = PAL.trunk[3]; g.fillRect(-3, -4, 2, 34);
      g.restore();
      g.fillStyle = '#9fc6c8';
      g.beginPath(); g.moveTo(12, 22); g.quadraticCurveTo(28, 6, 52, 14); g.lineTo(48, 20); g.quadraticCurveTo(30, 14, 16, 28); g.closePath(); g.fill();
      g.fillStyle = '#e3f4f4'; g.beginPath(); g.moveTo(14, 22); g.quadraticCurveTo(28, 9, 48, 14); g.lineTo(46, 15); g.quadraticCurveTo(28, 12, 16, 24); g.closePath(); g.fill();
      g.fillStyle = '#d99744'; g.fillRect(28, 13, 7, 7);
      break;
    }
    case 'tonic': {
      g.fillStyle = '#7a5434'; g.fillRect(27, 8, 10, 8);
      g.fillStyle = 'rgba(220,240,255,.35)';
      g.beginPath(); g.moveTo(26, 16); g.lineTo(38, 16); g.lineTo(38, 24); g.quadraticCurveTo(52, 30, 50, 44); g.arc(32, 44, 18, 0, Math.PI); g.quadraticCurveTo(12, 30, 26, 24); g.closePath(); g.fill();
      const lg = g.createLinearGradient(0, 30, 0, 62); lg.addColorStop(0, '#9ee9e0'); lg.addColorStop(1, '#2f7f8f');
      g.fillStyle = lg; g.beginPath(); g.moveTo(15, 40); g.quadraticCurveTo(32, 34, 49, 40); g.arc(32, 44, 17, 0.25, Math.PI - 0.25); g.closePath(); g.fill();
      g.fillStyle = 'rgba(255,255,255,.7)'; g.beginPath(); g.ellipse(22, 40, 2.5, 6, 0.3, 0, Math.PI * 2); g.fill();
      [[30, 48], [38, 44], [34, 54]].forEach(([x, y]) => { g.beginPath(); g.arc(x, y, 1.5, 0, Math.PI * 2); g.fill(); });
      break;
    }
    case 'rune': {
      const glow = g.createRadialGradient(32, 32, 2, 32, 32, 30);
      glow.addColorStop(0, 'rgba(180,255,230,.5)'); glow.addColorStop(1, 'rgba(180,255,230,0)');
      g.fillStyle = glow; g.fillRect(0, 0, 64, 64);
      const gr = g.createLinearGradient(14, 10, 50, 54); gr.addColorStop(0, PAL.moon[3]); gr.addColorStop(1, PAL.moon[1]);
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(32, 6); g.lineTo(52, 32); g.lineTo(32, 58); g.lineTo(12, 32); g.closePath(); g.fill();
      g.strokeStyle = '#2e6f6a'; g.lineWidth = 2.4; g.lineCap = 'round';
      g.beginPath(); g.arc(32, 28, 6, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.moveTo(32, 18); g.lineTo(32, 46); g.moveTo(25, 40); g.lineTo(32, 46); g.lineTo(39, 40); g.stroke();
      break;
    }
  }
  void rnd;
  return c;
}

/** 柔和雾团精灵 */
export function paintMistPuff(seed: number): Cnv {
  const [c, g] = makeCanvas(320, 200);
  const rnd = mulberry32(9000 + seed);
  for (let i = 0; i < 22; i++) {
    const x = 60 + rnd() * 200, y = 60 + rnd() * 80, r = 30 + rnd() * 50;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(150,172,178,.20)');
    gr.addColorStop(1, 'rgba(214,228,226,0)');
    g.fillStyle = gr;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  return c;
}
