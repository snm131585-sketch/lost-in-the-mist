// v2 生存版新增的程序化资源。规则与 painters.ts 一致：光源左上、无黑描边、同色系收边。
import { mulberry32 } from '../engine/math';
import { makeCanvas, PAL, type Cnv } from './painters';

type Ctx = CanvasRenderingContext2D;
const TAU = Math.PI * 2;

function ell(g: Ctx, x: number, y: number, rx: number, ry: number, fill: string, rot = 0) {
  g.fillStyle = fill; g.beginPath(); g.ellipse(x, y, rx, ry, rot, 0, TAU); g.fill();
}

// ---------- 树桩 / 碎石 ----------
export function paintStump(pine: boolean): Cnv {
  const [c, g] = makeCanvas(48, 36);
  const w = pine ? 9 : 12;
  ell(g, 24, 30, w + 6, 5, 'rgba(6,14,16,.35)');
  const gr = g.createLinearGradient(24 - w, 0, 24 + w, 0);
  gr.addColorStop(0, PAL.trunk[3]); gr.addColorStop(0.5, PAL.trunk[2]); gr.addColorStop(1, PAL.trunk[0]);
  g.fillStyle = gr;
  g.beginPath(); g.moveTo(24 - w - 3, 30); g.lineTo(24 - w, 18); g.lineTo(24 + w, 18); g.lineTo(24 + w + 4, 30); g.closePath(); g.fill();
  ell(g, 24, 18, w, 4.5, '#c99a62');
  g.strokeStyle = '#8a6440'; g.lineWidth = 1;
  g.beginPath(); g.ellipse(24, 18, w * 0.6, 2.6, 0, 0, TAU); g.stroke();
  g.beginPath(); g.ellipse(24, 18, w * 0.25, 1.1, 0, 0, TAU); g.stroke();
  return c;
}
export function paintRubble(): Cnv {
  const [c, g] = makeCanvas(48, 30);
  const rnd = mulberry32(31);
  for (let i = 0; i < 6; i++) {
    const x = 8 + rnd() * 32, y = 16 + rnd() * 10, r = 3 + rnd() * 4;
    ell(g, x, y, r, r * 0.7, PAL.stone[1 + (i % 3)]);
    ell(g, x - r * 0.3, y - r * 0.3, r * 0.4, r * 0.25, 'rgba(255,250,230,.15)');
  }
  return c;
}

// ---------- 雾莓灌木 ----------
export function paintBerryBush(variant: number, ripe: boolean): Cnv {
  const [c, g] = makeCanvas(56, 46);
  const rnd = mulberry32(4100 + variant * 7);
  const pal = [PAL.leafTeal, PAL.leafOlive, PAL.leafBlue][variant % 3];
  const blob = (x: number, y: number, r: number, a: string, b: string) => {
    const gr = g.createRadialGradient(x - r * 0.4, y - r * 0.5, 1, x, y, r);
    gr.addColorStop(0, b); gr.addColorStop(1, a);
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  };
  for (let i = 0; i < 9; i++) blob(14 + rnd() * 28, 28 + rnd() * 8, 9 + rnd() * 5, pal[0], pal[2]);
  for (let i = 0; i < 6; i++) blob(16 + rnd() * 22, 24 + rnd() * 6, 6 + rnd() * 4, pal[1], pal[3]);
  g.strokeStyle = pal[4] + '66'; g.lineWidth = 1.2;
  for (let i = 0; i < 16; i++) { const x = 12 + rnd() * 32, y = 18 + rnd() * 16; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 3, y - 2); g.stroke(); }
  if (ripe) {
    for (let i = 0; i < 9; i++) {
      const x = 13 + rnd() * 30, y = 20 + rnd() * 16;
      ell(g, x, y, 2.6, 2.6, '#7a3a8f');
      ell(g, x, y, 2.1, 2.1, '#b65fc4');
      ell(g, x - 0.8, y - 0.9, 0.8, 0.8, '#f3d6ff');
    }
  }
  return c;
}

// ---------- 草丛 / 树苗 / 燧石 ----------
export function paintGrassTuft(variant: number, cut: boolean): Cnv {
  const [c, g] = makeCanvas(40, 40);
  const rnd = mulberry32(4300 + variant * 5);
  ell(g, 20, 36, 12, 3.5, 'rgba(6,14,16,.3)');
  const n = cut ? 9 : 14;
  for (let i = 0; i < n; i++) {
    const x = 10 + rnd() * 20;
    const h = cut ? 4 + rnd() * 3 : 18 + rnd() * 14;
    const lean = (x - 20) * 0.5 + (rnd() - 0.5) * 6;
    g.strokeStyle = i % 3 === 0 ? '#c9b46a' : i % 3 === 1 ? '#9aa85a' : '#6f8a46';
    g.lineWidth = 1.8; g.lineCap = 'round';
    g.beginPath(); g.moveTo(x, 36); g.quadraticCurveTo(x + lean * 0.3, 36 - h * 0.6, x + lean, 36 - h); g.stroke();
  }
  return c;
}
export function paintSapling(variant: number, picked: boolean): Cnv {
  const [c, g] = makeCanvas(36, 48);
  const rnd = mulberry32(4500 + variant);
  ell(g, 18, 44, 9, 3, 'rgba(6,14,16,.3)');
  g.strokeStyle = PAL.trunk[2]; g.lineWidth = 2.2; g.lineCap = 'round';
  g.beginPath(); g.moveTo(18, 44); g.quadraticCurveTo(16, 30, picked ? 18 : 19, picked ? 34 : 14); g.stroke();
  if (picked) return c;
  g.lineWidth = 1.4;
  for (let i = 0; i < 4; i++) {
    const y = 18 + i * 6, s = i % 2 ? 1 : -1;
    g.beginPath(); g.moveTo(18, y); g.lineTo(18 + s * (7 + rnd() * 4), y - 5); g.stroke();
    ell(g, 18 + s * (9 + rnd() * 3), y - 6, 3.5, 2, i % 2 ? '#6f9f62' : '#4b7d55', s * 0.5);
  }
  ell(g, 19, 12, 4, 3, '#86b06a');
  return c;
}
export function paintFlint(variant: number): Cnv {
  const [c, g] = makeCanvas(28, 20);
  ell(g, 14, 16, 8, 2.5, 'rgba(6,14,16,.35)');
  const off = variant * 2;
  g.fillStyle = '#3d4450';
  g.beginPath(); g.moveTo(6 + off, 15); g.lineTo(11, 5 + off); g.lineTo(21 - off, 8); g.lineTo(22, 15); g.closePath(); g.fill();
  g.fillStyle = '#7c8796';
  g.beginPath(); g.moveTo(8 + off, 14); g.lineTo(11, 6 + off); g.lineTo(15, 9); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(230,240,255,.6)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(11, 6 + off); g.lineTo(20 - off, 8.5); g.stroke();
  return c;
}

// ---------- 篝火（底座；火焰在运行时绘制） ----------
export function paintCampfireBase(): Cnv {
  const [c, g] = makeCanvas(64, 44);
  ell(g, 32, 32, 26, 9, 'rgba(6,14,16,.4)');
  // 灰烬
  ell(g, 32, 30, 15, 5.5, '#2a2422');
  ell(g, 32, 29, 11, 3.5, '#4a3a30');
  // 石圈
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU;
    const x = 32 + Math.cos(a) * 20, y = 30 + Math.sin(a) * 8;
    ell(g, x, y, 5.2, 3.8, PAL.stone[1 + (i % 2)]);
    ell(g, x - 1.2, y - 1.3, 2.4, 1.4, PAL.stone[3]);
  }
  // 柴
  g.lineCap = 'round';
  for (const [x1, y1, x2, y2] of [[22, 33, 40, 24], [42, 33, 24, 24], [32, 34, 32, 22]]) {
    g.strokeStyle = PAL.trunk[0]; g.lineWidth = 5; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
    g.strokeStyle = PAL.trunk[2]; g.lineWidth = 3; g.beginPath(); g.moveTo(x1, y1 - 0.5); g.lineTo(x2, y2 - 0.5); g.stroke();
  }
  return c;
}

// ---------- 储物箱 ----------
export function paintChest(open: boolean): Cnv {
  const [c, g] = makeCanvas(48, 44);
  ell(g, 24, 39, 19, 4.5, 'rgba(6,14,16,.4)');
  const body = g.createLinearGradient(0, 18, 0, 40);
  body.addColorStop(0, '#9a6d43'); body.addColorStop(1, '#5a3c26');
  g.fillStyle = body; g.fillRect(7, 19, 34, 20);
  g.fillStyle = '#4a3020';
  for (const y of [24, 30, 36]) g.fillRect(7, y, 34, 1);
  if (open) {
    g.fillStyle = '#2a1c16'; g.fillRect(8, 15, 32, 5);
    g.fillStyle = '#7a5434'; g.beginPath(); g.moveTo(7, 15); g.lineTo(11, 3); g.lineTo(37, 3); g.lineTo(41, 15); g.closePath(); g.fill();
  } else {
    const lid = g.createLinearGradient(0, 8, 0, 20);
    lid.addColorStop(0, '#b7875a'); lid.addColorStop(1, '#7a5434');
    g.fillStyle = lid;
    g.beginPath(); g.moveTo(6, 20); g.lineTo(6, 14); g.quadraticCurveTo(24, 6, 42, 14); g.lineTo(42, 20); g.closePath(); g.fill();
  }
  g.fillStyle = '#c9a24a'; g.fillRect(6, 19, 2, 20); g.fillRect(40, 19, 2, 20);
  g.fillStyle = '#e0c070'; g.fillRect(21, open ? 18 : 17, 6, 6);
  g.fillStyle = '#5a4020'; g.fillRect(23, open ? 20 : 19, 2, 3);
  return c;
}

// ---------- 生物 ----------
/** 雾兔：frame 0-3 跑 / 4 待机；朝右 */
export function paintRabbit(frame: number): Cnv {
  const [c, g] = makeCanvas(36, 30);
  const run = frame < 4;
  const ph = (frame / 4) * TAU;
  const hop = run ? Math.abs(Math.sin(ph)) * 4 : 0;
  const by = 22 - hop;
  ell(g, 18, 26, 9, 2.5, 'rgba(6,14,16,.35)');
  // 后腿
  ell(g, 12, by + 2, 5, 3.5, '#9fa8a8');
  // 身体
  const gr = g.createRadialGradient(15, by - 6, 1, 17, by - 2, 11);
  gr.addColorStop(0, '#f2f1ea'); gr.addColorStop(1, '#a9b3b2');
  g.fillStyle = gr; g.beginPath(); g.ellipse(17, by - 2, 10, 7, run ? -0.15 : 0, 0, TAU); g.fill();
  // 尾巴
  ell(g, 7, by - 3, 3, 3, '#ffffff');
  // 头
  ell(g, 26, by - 7, 5.5, 5, '#e4e4dc');
  // 耳朵
  g.fillStyle = '#d9d9cf';
  g.beginPath(); g.ellipse(24, by - 15, 1.8, 5.5, -0.3 - (run ? 0.4 : 0), 0, TAU); g.fill();
  g.beginPath(); g.ellipse(27, by - 15, 1.8, 5.5, 0.1 - (run ? 0.4 : 0), 0, TAU); g.fill();
  g.fillStyle = '#e8b4b4';
  g.beginPath(); g.ellipse(27, by - 15, 0.8, 3.8, 0.1 - (run ? 0.4 : 0), 0, TAU); g.fill();
  // 眼睛 / 鼻子
  ell(g, 28, by - 8, 1.1, 1.3, '#1a1a2a');
  ell(g, 31, by - 6, 0.9, 0.7, '#d98a8a');
  // 前腿
  ell(g, 22 + (run ? Math.cos(ph) * 2 : 0), by + 3, 2, 2.5, '#c4c9c6');
  return c;
}

/** 雾狼：frame 0-3 跑 / 4 待机 / 5 攻击；朝右 */
export function paintWolf(frame: number): Cnv {
  const [c, g] = makeCanvas(64, 48);
  const run = frame < 4;
  const ph = (frame / 4) * TAU;
  const atk = frame === 5;
  const by = 34 - (run ? Math.abs(Math.sin(ph)) * 2 : 0);
  ell(g, 32, 42, 20, 4, 'rgba(6,14,16,.4)');
  const legs = [[18, 0], [24, Math.PI], [38, Math.PI * 0.5], [44, Math.PI * 1.5]];
  for (const [x, o] of legs) {
    const sw = run ? Math.sin(ph + o) * 4 : 0;
    g.strokeStyle = '#2b3438'; g.lineWidth = 4; g.lineCap = 'round';
    g.beginPath(); g.moveTo(x, by - 2); g.lineTo(x + sw, 41); g.stroke();
  }
  // 尾巴
  g.fillStyle = '#3d4a50';
  g.beginPath(); g.moveTo(14, by - 8); g.quadraticCurveTo(2, by - 14, 4, by - 2); g.quadraticCurveTo(8, by - 6, 14, by - 4); g.fill();
  // 身体
  const gr = g.createLinearGradient(0, by - 18, 0, by + 2);
  gr.addColorStop(0, '#66787e'); gr.addColorStop(1, '#2e3a3f');
  g.fillStyle = gr;
  g.beginPath(); g.ellipse(31, by - 8, 19, 10, 0, 0, TAU); g.fill();
  // 鬃毛（雾）
  g.fillStyle = 'rgba(190,215,220,.45)';
  for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(22 + i * 4, by - 16 + Math.sin(i) * 1.5, 3.2, 0, TAU); g.fill(); }
  // 头
  const hx = atk ? 52 : 49, hy = by - 13 + (atk ? 3 : 0);
  g.fillStyle = '#4b5a60';
  g.beginPath(); g.ellipse(hx, hy, 9, 7.5, atk ? 0.3 : 0, 0, TAU); g.fill();
  g.beginPath(); g.moveTo(hx + 4, hy - 3); g.lineTo(hx + 15, hy + 1 + (atk ? 2 : 0)); g.lineTo(hx + 4, hy + 4); g.fill();
  if (atk) { g.fillStyle = '#e9e4cf'; g.beginPath(); g.moveTo(hx + 7, hy + 2); g.lineTo(hx + 9, hy + 5); g.lineTo(hx + 11, hy + 2.5); g.fill(); }
  // 耳朵
  g.fillStyle = '#3a474c';
  g.beginPath(); g.moveTo(hx - 5, hy - 5); g.lineTo(hx - 3, hy - 14); g.lineTo(hx + 1, hy - 6); g.fill();
  // 发光的眼睛
  ell(g, hx + 3, hy - 2, 1.8, 1.4, '#bff8e8');
  return c;
}

// ---------- 新物品图标（64×64） ----------
export function paintIcon2(id: string): Cnv | null {
  const [c, g] = makeCanvas(64, 64);
  const glowBg = (rgb: string) => {
    const gr = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    gr.addColorStop(0, `rgba(${rgb},.45)`); gr.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  };
  switch (id) {
    case 'twigs':
      g.lineCap = 'round';
      for (let i = 0; i < 4; i++) {
        g.strokeStyle = PAL.trunk[i % 2 ? 2 : 3]; g.lineWidth = 3.5;
        g.beginPath(); g.moveTo(10 + i * 3, 52 - i * 2); g.lineTo(52 - i * 2, 12 + i * 4); g.stroke();
        g.lineWidth = 2; g.beginPath(); g.moveTo(30 + i, 32 - i); g.lineTo(38 + i, 34 + i * 2); g.stroke();
      }
      break;
    case 'grass':
      g.lineCap = 'round';
      for (let i = 0; i < 14; i++) {
        g.strokeStyle = ['#c9b46a', '#9aa85a', '#e0cf8a'][i % 3]; g.lineWidth = 2.4;
        g.beginPath(); g.moveTo(26 + i, 56); g.quadraticCurveTo(20 + i * 1.5, 30, 10 + i * 3.4, 8 + (i % 4) * 3); g.stroke();
      }
      g.fillStyle = '#8a6a3a'; g.fillRect(22, 40, 22, 5);
      break;
    case 'flint': {
      const f = paintFlint(1);
      g.drawImage(f, 0, 0, 28, 20, 4, 10, 56, 40);
      break;
    }
    case 'rock':
      ell(g, 30, 40, 20, 14, PAL.stone[1]); ell(g, 27, 36, 16, 11, PAL.stone[2]); ell(g, 22, 31, 7, 4, PAL.stone[3]);
      ell(g, 44, 46, 9, 6, PAL.stone[2]);
      break;
    case 'rope':
      g.strokeStyle = '#b29069'; g.lineWidth = 6;
      g.beginPath(); g.ellipse(32, 34, 18, 13, 0, 0, TAU); g.stroke();
      g.strokeStyle = '#d6b88a'; g.lineWidth = 2; g.setLineDash([3, 4]);
      g.beginPath(); g.ellipse(32, 34, 18, 13, 0, 0, TAU); g.stroke(); g.setLineDash([]);
      g.strokeStyle = '#b29069'; g.lineWidth = 5; g.beginPath(); g.moveTo(46, 42); g.lineTo(56, 56); g.stroke();
      break;
    case 'berries':
    case 'berries_cooked': {
      const ck = id === 'berries_cooked';
      for (const [x, y] of [[24, 30], [38, 28], [31, 40], [20, 44], [42, 42]]) {
        ell(g, x, y, 8, 8, ck ? '#6a2a3a' : '#7a3a8f'); ell(g, x, y, 6.5, 6.5, ck ? '#a8485a' : '#b65fc4'); ell(g, x - 2.5, y - 2.5, 2, 2, ck ? '#f0c0a0' : '#f3d6ff');
      }
      if (ck) { g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 1.5; for (const x of [24, 34, 44]) { g.beginPath(); g.moveTo(x, 18); g.quadraticCurveTo(x - 4, 12, x, 6); g.stroke(); } }
      else { g.strokeStyle = '#4f7d52'; g.lineWidth = 2; g.beginPath(); g.moveTo(31, 22); g.lineTo(34, 12); g.stroke(); ell(g, 38, 13, 6, 3, '#6f9f62', -0.4); }
      break;
    }
    case 'meat':
    case 'meat_cooked': {
      const ck = id === 'meat_cooked';
      ell(g, 30, 34, 20, 15, ck ? '#7a3c1c' : '#c2495a');
      ell(g, 27, 31, 15, 10, ck ? '#a85a2a' : '#e07080');
      g.strokeStyle = ck ? '#5a2a10' : '#f4d6d6'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(18, 30); g.quadraticCurveTo(28, 24, 40, 32); g.stroke();
      g.fillStyle = '#ece4d0'; g.fillRect(46, 38, 12, 5); ell(g, 58, 38, 3.5, 3.5, '#ece4d0'); ell(g, 58, 43, 3.5, 3.5, '#ece4d0');
      if (ck) { g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 1.5; for (const x of [22, 32]) { g.beginPath(); g.moveTo(x, 16); g.quadraticCurveTo(x - 4, 10, x, 4); g.stroke(); } }
      break;
    }
    case 'glowcap_cooked':
      glowBg('255,200,140');
      g.fillStyle = '#d9c9a0'; g.fillRect(28, 30, 8, 20);
      ell(g, 32, 30, 18, 11, '#c98a5a'); ell(g, 28, 26, 9, 5, '#f0c890');
      break;
    case 'axe':
      g.save(); g.translate(30, 34); g.rotate(-0.6);
      g.fillStyle = PAL.trunk[2]; g.fillRect(-3, -22, 6, 46); g.fillStyle = PAL.trunk[3]; g.fillRect(-3, -22, 2, 46);
      g.restore();
      g.fillStyle = '#4a5260';
      g.beginPath(); g.moveTo(28, 14); g.quadraticCurveTo(44, 4, 52, 16); g.quadraticCurveTo(48, 28, 36, 28); g.closePath(); g.fill();
      g.fillStyle = '#9aa4b4'; g.beginPath(); g.moveTo(44, 8); g.quadraticCurveTo(54, 14, 50, 24); g.lineTo(47, 22); g.quadraticCurveTo(50, 15, 43, 10); g.fill();
      g.fillStyle = '#b29069'; g.fillRect(27, 18, 8, 7);
      break;
    case 'torch': {
      const gr = g.createRadialGradient(36, 16, 2, 36, 16, 22);
      gr.addColorStop(0, 'rgba(255,200,100,.8)'); gr.addColorStop(1, 'rgba(255,200,100,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      g.save(); g.translate(32, 38); g.rotate(0.35);
      g.fillStyle = PAL.trunk[2]; g.fillRect(-3, -14, 6, 36); g.fillStyle = '#b29069'; g.fillRect(-4.5, -16, 9, 8);
      g.restore();
      g.fillStyle = '#f08a2a'; g.beginPath(); g.moveTo(30, 22); g.quadraticCurveTo(28, 10, 38, 4); g.quadraticCurveTo(36, 12, 44, 14); g.quadraticCurveTo(42, 22, 34, 24); g.fill();
      g.fillStyle = '#ffe08a'; g.beginPath(); g.moveTo(33, 20); g.quadraticCurveTo(33, 13, 38, 10); g.quadraticCurveTo(38, 16, 40, 17); g.quadraticCurveTo(38, 21, 34, 22); g.fill();
      break;
    }
    case 'spear':
      g.save(); g.translate(32, 32); g.rotate(-0.78);
      g.fillStyle = PAL.trunk[2]; g.fillRect(-2.5, -6, 5, 34);
      g.fillStyle = '#b29069'; g.fillRect(-3.5, -8, 7, 6);
      g.fillStyle = '#5a6270'; g.beginPath(); g.moveTo(0, -30); g.lineTo(6, -9); g.lineTo(-6, -9); g.closePath(); g.fill();
      g.fillStyle = '#a9b3c2'; g.beginPath(); g.moveTo(0, -30); g.lineTo(-6, -9); g.lineTo(0, -11); g.closePath(); g.fill();
      g.restore();
      break;
    case 'armor': {
      g.fillStyle = '#9a8a4a';
      g.beginPath(); g.moveTo(16, 14); g.lineTo(26, 10); g.quadraticCurveTo(32, 16, 38, 10); g.lineTo(48, 14); g.lineTo(46, 30); g.lineTo(50, 54); g.lineTo(14, 54); g.lineTo(18, 30); g.closePath(); g.fill();
      g.strokeStyle = '#c9b46a'; g.lineWidth = 1.5;
      for (let y = 20; y < 54; y += 5) { g.beginPath(); g.moveTo(18, y); g.lineTo(46, y + 1); g.stroke(); }
      g.strokeStyle = '#6a5a2a'; g.lineWidth = 3; g.beginPath(); g.moveTo(16, 36); g.lineTo(48, 36); g.stroke();
      break;
    }
    case 'campfire_kit': {
      const b = paintCampfireBase();
      g.drawImage(b, 0, 6, 64, 44);
      g.fillStyle = '#f08a2a'; g.beginPath(); g.moveTo(24, 34); g.quadraticCurveTo(22, 16, 32, 8); g.quadraticCurveTo(34, 20, 42, 22); g.quadraticCurveTo(42, 32, 34, 36); g.fill();
      g.fillStyle = '#ffe08a'; g.beginPath(); g.moveTo(29, 33); g.quadraticCurveTo(28, 24, 33, 18); g.quadraticCurveTo(34, 26, 38, 28); g.quadraticCurveTo(37, 33, 33, 34); g.fill();
      break;
    }
    case 'chest_kit': g.drawImage(paintChest(false), 4, 8, 56, 51); break;
    default: return null;
  }
  return c;
}
