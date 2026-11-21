// 渲染管线：地面 → 水面 → y 排序物体（树木/资源/建筑/生物/角色）→ 粒子 → 迷雾 → 雨 → 昼夜光照 → 屏幕效果
import { clamp, lerp } from '../engine/math';
import { makeCanvas } from '../art/painters';
import { TILE, MAP_W, MAP_H, idx, type WorldObj } from '../world/map';
import { CHUNK } from '../world/ground';
import { FW, FH } from '../world/fog';
import { ITEMS } from '../data/items';
import { QUESTS, STRUCTURES } from '../data/world';
import { lightLevel, tintOf } from '../systems/time';
import { MAX } from '../systems/survival';
import { creatureFrame, clampAlpha } from '../systems/creatures';
import type { Game, Particle } from './game';
import { WORLD_W, WORLD_H } from './game';

type G = CanvasRenderingContext2D;
interface Puff { x: number; y: number; vx: number; img: number; s: number }
interface Fly { x: number; y: number; ph: number; sp: number }
interface Drop { x: number; y: number; v: number; l: number }

export class Renderer {
  private ctx: G;
  private light: HTMLCanvasElement;
  private lg: G;
  private fogMask: HTMLCanvasElement;
  private puffs: Puff[] = [];
  private flies: Fly[] = [];
  private rain: Drop[] = [];
  private flySprite: HTMLCanvasElement;

  constructor(private game: Game) {
    this.ctx = game.canvas.getContext('2d')!;
    [this.light, this.lg] = makeCanvas(4, 4);
    [this.fogMask] = makeCanvas(FW, FH);
    const r = game.rnd;
    for (let i = 0; i < 16; i++) this.puffs.push({ x: r() * 1400, y: r() * 1000, vx: 6 + r() * 10, img: i % 4, s: 1.2 + r() * 1.4 });
    for (let i = 0; i < 46; i++) this.flies.push({ x: r() * 1600, y: r() * 1000, ph: r() * 10, sp: 0.5 + r() });
    for (let i = 0; i < 160; i++) this.rain.push({ x: r(), y: r(), v: 0.8 + r() * 0.5, l: 10 + r() * 12 });
    const [c, g] = makeCanvas(16, 16);
    const gr = g.createRadialGradient(8, 8, 0, 8, 8, 8);
    gr.addColorStop(0, 'rgba(230,255,180,.45)'); gr.addColorStop(1, 'rgba(230,255,180,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 16, 16);
    this.flySprite = c;
  }

  /** 光照层用半分辨率绘制（柔和渐变，放大后看不出差别，填充开销降为 1/4） */
  private LS = 0.5;
  resize() { this.light.width = Math.ceil(this.game.canvas.width * this.LS); this.light.height = Math.ceil(this.game.canvas.height * this.LS); }

  screenToWorld(sx: number, sy: number) {
    const g = this.game;
    return { x: g.cam.x - g.viewW / g.zoom / 2 + sx / g.zoom, y: g.cam.y - g.viewH / g.zoom / 2 + sy / g.zoom };
  }

  // ---------------- 粒子 ----------------
  spawnBits(o: WorldObj, n: number) {
    const map: Record<string, string> = { mushroom: '#9ff5d6', crystal: '#cfe0ff', lily: '#e8f4ff', grass: '#c9b46a', flint: '#9aa4b4' };
    const col = o.kind === 'tree' || o.kind === 'pine' ? '#c99a62' : o.kind === 'rock' ? '#959a8a' : o.kind === 'bush' ? '#b65fc4' : map[o.res ?? ''] ?? '#c99a62';
    const glow = o.res === 'mushroom' || o.res === 'crystal' || o.res === 'lily';
    for (let i = 0; i < n; i++) {
      this.game.particles.push({ x: o.x + (Math.random() - 0.5) * 16, y: o.y - (o.kind === 'tree' ? 30 : 10), vx: (Math.random() - 0.5) * 70, vy: -40 - Math.random() * 60, life: 0.8, max: 0.8, color: col, size: 1.5 + Math.random() * 1.5, glow, grav: 160 });
    }
  }
  burst(x: number, y: number, color: string, n: number) {
    for (let i = 0; i < n; i++) this.game.particles.push({ x, y, vx: (Math.random() - 0.5) * 90, vy: -30 - Math.random() * 70, life: 0.9, max: 0.9, color, size: 1.6 + Math.random() * 1.4, glow: true, grav: 60 });
  }

  updateAmbient(dt: number) {
    const g = this.game;
    for (const p of g.particles) { p.life -= dt; p.vy += p.grav * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
    g.particles = g.particles.filter((p) => p.life > 0);
    if (g.particles.length > 500) g.particles.splice(0, g.particles.length - 500);
    const hw = g.viewW / g.zoom / 2 + 200, hh = g.viewH / g.zoom / 2 + 160;
    const wrap = (o: { x: number; y: number }) => {
      if (o.x - g.cam.x > hw) o.x -= hw * 2; if (o.x - g.cam.x < -hw) o.x += hw * 2;
      if (o.y - g.cam.y > hh) o.y -= hh * 2; if (o.y - g.cam.y < -hh) o.y += hh * 2;
    };
    for (const m of this.puffs) { m.x += m.vx * dt; wrap(m); }
    for (const f of this.flies) { f.ph += dt * f.sp; f.x += Math.cos(f.ph * 1.3) * 12 * dt; f.y += Math.sin(f.ph) * 9 * dt; wrap(f); }
    // 篝火火星
    if (g.mode === 'play' || g.mode === 'menu') {
      for (const st of g.state.structures) {
        if (st.type !== 'campfire' || !st.fuel || Math.random() > dt * 8) continue;
        g.particles.push({ x: st.x + (Math.random() - 0.5) * 10, y: st.y - 16, vx: (Math.random() - 0.5) * 16, vy: -40 - Math.random() * 40, life: 1.2, max: 1.2, color: '#ffb060', size: 1.2, glow: true, grav: -10 });
      }
    }
  }

  // ---------------- 主渲染 ----------------
  render() {
    const game = this.game;
    const g = this.ctx;
    const z = game.zoom * game.dpr;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#0b1714';
    g.fillRect(0, 0, game.canvas.width, game.canvas.height);
    const vw = game.viewW / game.zoom, vh = game.viewH / game.zoom;
    const shx = game.cam.shake ? (Math.random() - 0.5) * game.cam.shake : 0, shy = game.cam.shake ? (Math.random() - 0.5) * game.cam.shake : 0;
    const left = game.cam.x - vw / 2 + shx, top = game.cam.y - vh / 2 + shy;
    const ox = Math.round(-left * z) / z, oy = Math.round(-top * z) / z;
    g.setTransform(z, 0, 0, z, ox * z, oy * z);
    g.imageSmoothingEnabled = true;

    const gr = game.ground;
    const c0 = Math.max(0, Math.floor(left / CHUNK)), c1 = Math.min(gr.cols - 1, Math.floor((left + vw) / CHUNK));
    const r0 = Math.max(0, Math.floor(top / CHUNK)), r1 = Math.min(gr.rows - 1, Math.floor((top + vh) / CHUNK));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) g.drawImage(gr.chunks[r * gr.cols + c], c * CHUNK, r * CHUNK);
    this.drawWater(g, left, top, vw, vh);

    const s = game.state;
    if (s.offered >= 3 || game.mode === 'cutscene') {
      const a = game.map.altar;
      const pulse = 0.75 + Math.sin(game.time * 2) * 0.1;
      const rg = g.createRadialGradient(a.x, a.y, 10, a.x, a.y, 190);
      rg.addColorStop(0, `rgba(190,255,230,${0.35 * pulse})`); rg.addColorStop(1, 'rgba(190,255,230,0)');
      g.fillStyle = rg; g.fillRect(a.x - 200, a.y - 200, 400, 400);
    }

    // 地面上的掉落物
    const inPlay = game.mode !== 'menu';
    if (inPlay) for (const it of game.groundItems) {
      if (it.x < left - 40 || it.x > left + vw + 40 || it.y < top - 40 || it.y > top + vh + 40) continue;
      const bob = Math.sin(game.time * 3 + it.id) * 2;
      g.fillStyle = 'rgba(6,14,16,.35)'; g.beginPath(); g.ellipse(it.x, it.y + 2, 9, 3, 0, 0, Math.PI * 2); g.fill();
      g.drawImage(game.assets.get(`icon.${it.item}`), it.x - 13, it.y - 26 + bob, 26, 26);
    }

    // y 排序
    const list: { y: number; draw: () => void }[] = [];
    const margin = 140;
    for (const o of game.map.objects) {
      if (o.x < left - margin || o.x > left + vw + margin || o.y < top - 40 || o.y > top + vh + 170) continue;
      list.push({ y: o.y, draw: () => this.drawObj(g, o, inPlay) });
    }
    if (inPlay) {
      for (const st of s.structures) {
        if (st.x < left - 80 || st.x > left + vw + 80 || st.y < top - 60 || st.y > top + vh + 80) continue;
        list.push({ y: st.y, draw: () => this.drawStructure(g, st) });
      }
      for (const c of game.creatures) list.push({ y: c.y, draw: () => this.drawCreature(g, c) });
      list.push({ y: game.player.y, draw: () => this.drawPlayer(g) });
    }
    list.sort((a, b) => a.y - b.y);
    for (const it of list) it.draw();
    if (game.build) this.drawGhost(g);

    this.drawParticles(g, game.particles);

    if (game.fog.globalClear < 1) {
      game.fog.render();
      g.imageSmoothingQuality = 'high';
      g.drawImage(game.fog.canvas, 0, 0, WORLD_W, WORLD_H);
      const low = game.settings.fx === 'low';
      for (let i = 0; i < this.puffs.length; i += low ? 2 : 1) {
        const m = this.puffs[i];
        const a = 0.06 + game.fog.densityAt(m.x, m.y) * 0.9;
        const img = game.assets.get(`mist.${m.img}`);
        g.globalAlpha = a * (1 - game.fog.globalClear);
        g.drawImage(img, m.x - (img.width * m.s) / 2, m.y - (img.height * m.s) / 2, img.width * m.s, img.height * m.s);
      }
      g.globalAlpha = 1;
    }

    // 萤火虫（夜里更亮更多）
    const L = inPlay ? lightLevel(s.time) : 0.6;
    g.globalCompositeOperation = 'lighter';
    const nf = game.settings.fx === 'low' ? 16 : Math.round(lerp(this.flies.length, 14, L));
    for (let i = 0; i < nf; i++) {
      const f = this.flies[i];
      const tw = 0.5 + 0.5 * Math.sin(game.time * 3 + f.ph * 4);
      g.globalAlpha = tw;
      g.drawImage(this.flySprite, f.x - 8, f.y - 8);
      g.globalAlpha = 1;
      g.fillStyle = `rgba(240,255,200,${0.8 * tw})`;
      g.beginPath(); g.arc(f.x, f.y, 1.4, 0, Math.PI * 2); g.fill();
    }
    g.globalCompositeOperation = 'source-over';

    // 屏幕空间
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (inPlay && s.weather.rain > 0.02) this.drawRain(g, s.weather.rain);
    this.drawLighting(left, top);
    g.imageSmoothingEnabled = true;
    g.drawImage(this.light, 0, 0, game.canvas.width, game.canvas.height);
    if (inPlay) {
      const [tr, tg, tb, ta] = tintOf(s.time);
      if (ta > 0) { g.fillStyle = `rgba(${tr},${tg},${tb},${ta})`; g.fillRect(0, 0, game.canvas.width, game.canvas.height); }
      if (s.stats.sanity < MAX.sanity * 0.3 && game.mode === 'play') this.drawShadows(g);
    }
    if (game.mode === 'play') this.drawQuestArrow(g, left, top);
  }

  private drawParticles(g: G, ps: Particle[]) {
    for (const pt of ps) {
      const a = clamp(pt.life / pt.max, 0, 1);
      if (pt.glow) {
        g.globalCompositeOperation = 'lighter';
        g.fillStyle = pt.color; g.globalAlpha = a * 0.35;
        g.beginPath(); g.arc(pt.x, pt.y, pt.size * 3, 0, Math.PI * 2); g.fill();
      }
      g.globalAlpha = a; g.fillStyle = pt.color;
      g.beginPath(); g.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2); g.fill();
      g.globalCompositeOperation = 'source-over';
    }
    g.globalAlpha = 1;
  }

  private drawWater(g: G, left: number, top: number, vw: number, vh: number) {
    const game = this.game;
    const tx0 = Math.max(0, Math.floor(left / TILE)), tx1 = Math.min(MAP_W - 1, Math.floor((left + vw) / TILE));
    const ty0 = Math.max(0, Math.floor(top / TILE)), ty1 = Math.min(MAP_H - 1, Math.floor((top + vh) / TILE));
    g.strokeStyle = 'rgba(200,235,230,.16)'; g.lineWidth = 1.4; g.lineCap = 'round';
    g.beginPath();
    const rain = game.mode === 'menu' ? 0 : game.state.weather.rain;
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      if (game.map.ground[idx(tx, ty)] !== 2) continue;
      const h = (tx * 73856093) ^ (ty * 19349663);
      const s = Math.sin(game.time * 1.2 + (h & 255) / 40);
      if (s < 0.2) continue;
      const x = tx * TILE + ((h >> 8) & 15) + 4, y = ty * TILE + ((h >> 12) & 15) + 8;
      const w = 6 + s * 6;
      g.moveTo(x, y); g.quadraticCurveTo(x + w / 2, y - 2, x + w, y);
    }
    g.stroke();
    if (rain > 0.1) {
      g.strokeStyle = `rgba(210,235,240,${0.35 * rain})`; g.lineWidth = 1;
      for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
        if (game.map.ground[idx(tx, ty)] !== 2) continue;
        const h = (tx * 2654435761) >>> 0;
        const ph = ((game.time * 1.7 + (h % 100) / 100) % 1);
        const r = ph * 7;
        g.globalAlpha = 1 - ph;
        g.beginPath(); g.ellipse(tx * TILE + (h % 24) + 4, ty * TILE + ((h >> 5) % 24) + 4, r, r * 0.5, 0, 0, Math.PI * 2); g.stroke();
      }
      g.globalAlpha = 1;
    }
  }

  private highlight(g: G, img: CanvasImageSource, x: number, y: number) {
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 0.22 + Math.sin(this.game.time * 5) * 0.08;
    g.drawImage(img, x, y);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  private drawObj(g: G, o: WorldObj, inPlay: boolean) {
    const game = this.game;
    const A = game.assets;
    const p = game.player;
    const gone = inPlay && !!game.nodeType(o) && game.nodeGone(o);
    const targeted = game.target?.obj === o;
    switch (o.kind) {
      case 'tree': case 'pine': {
        if (gone) { const img = A.get(`stump.${o.kind}`); g.drawImage(img, o.x - img.width / 2, o.y - img.height + 8); break; }
        const img = A.get(`${o.kind}.${o.variant}`);
        const behind = inPlay && p.y < o.y - 4 && p.y > o.y - 120 && Math.abs(p.x - o.x) < (o.kind === 'tree' ? 46 : 30);
        const chopping = game.gather?.node === o;
        const sway = Math.sin(game.time * 0.8 + o.id) * 0.012 + (chopping ? Math.sin(game.time * 30) * 0.01 : 0)
          + (inPlay ? game.state.weather.rain * Math.sin(game.time * 1.7 + o.id) * 0.02 : 0);
        g.save(); g.translate(o.x, o.y); g.transform(1, 0, sway, 1, 0, 0);
        if (behind) g.globalAlpha = 0.5;
        g.drawImage(img, -img.width / 2, -img.height + 10);
        if (targeted) this.highlight(g, img, -img.width / 2, -img.height + 10);
        g.restore();
        break;
      }
      case 'rock': {
        const img = A.get(gone ? 'rubble' : `rock.${o.variant}`);
        g.drawImage(img, o.x - img.width / 2, o.y - img.height + 8);
        if (targeted) this.highlight(g, img, o.x - img.width / 2, o.y - img.height + 8);
        break;
      }
      case 'bush': {
        const img = A.get(`berry.${o.variant}${gone ? '.empty' : ''}`);
        g.drawImage(img, o.x - img.width / 2, o.y - img.height + 8);
        if (targeted) this.highlight(g, img, o.x - img.width / 2, o.y - img.height + 8);
        break;
      }
      case 'stele': {
        const img = A.get(`stele.${o.variant}`);
        g.drawImage(img, o.x - img.width / 2, o.y - img.height + 8);
        if (targeted) this.highlight(g, img, o.x - img.width / 2, o.y - img.height + 8);
        break;
      }
      case 'altar': {
        const lit = game.state.offered >= 3 || (game.mode === 'cutscene' && game.cut.t > 1);
        const img = A.get(lit ? 'altar.mono.lit' : 'altar.mono.0');
        g.drawImage(img, o.x - img.width / 2, o.y - img.height + 34);
        break;
      }
      case 'resource': {
        if (gone && o.res === 'flint') break;
        const img = A.get(`res.${o.res}.${o.variant}${gone ? '.empty' : ''}`);
        const x = o.x - img.width / 2, y = o.y - img.height + 8;
        if (!gone && (o.res === 'mushroom' || o.res === 'crystal')) {
          const pulse = 0.6 + 0.4 * Math.sin(game.time * 2 + o.id);
          const col = o.res === 'mushroom' ? '159,245,214' : '169,194,238';
          const rg = g.createRadialGradient(o.x, o.y - 12, 2, o.x, o.y - 12, 34);
          rg.addColorStop(0, `rgba(${col},${0.35 * pulse})`); rg.addColorStop(1, `rgba(${col},0)`);
          g.globalCompositeOperation = 'lighter'; g.fillStyle = rg; g.fillRect(o.x - 36, o.y - 48, 72, 72); g.globalCompositeOperation = 'source-over';
        }
        const sway = o.res === 'grass' || o.res === 'sapling' || o.res === 'lily' ? Math.sin(game.time * 1.6 + o.id) * 0.06 : 0;
        if (sway) { g.save(); g.translate(o.x, o.y + 8); g.transform(1, 0, sway, 1, 0, 0); g.drawImage(img, -img.width / 2, -img.height); g.restore(); }
        else g.drawImage(img, x, y);
        if (!gone && inPlay && (o.res === 'branch' || o.res === 'flint' || o.res === 'lily' || o.res === 'crystal' || o.res === 'mushroom')) {
          const tw = Math.sin(game.time * 3 + o.id * 1.7);
          if (tw > 0.7) {
            g.globalCompositeOperation = 'lighter';
            g.fillStyle = `rgba(255,240,200,${(tw - 0.7) * 2})`;
            const sx = o.x + Math.sin(o.id) * 10, sy = o.y - 14 + Math.cos(o.id) * 5;
            g.beginPath(); g.moveTo(sx, sy - 4); g.lineTo(sx + 1, sy - 1); g.lineTo(sx + 4, sy); g.lineTo(sx + 1, sy + 1); g.lineTo(sx, sy + 4); g.lineTo(sx - 1, sy + 1); g.lineTo(sx - 4, sy); g.lineTo(sx - 1, sy - 1); g.closePath(); g.fill();
            g.globalCompositeOperation = 'source-over';
          }
        }
        if (targeted) this.highlight(g, img, x, y);
        if (game.gather?.node === o) { g.globalAlpha = 0.5; g.drawImage(img, x + Math.sin(game.time * 40) * 1.2, y); g.globalAlpha = 1; }
        break;
      }
    }
  }

  private drawStructure(g: G, st: { type: string; x: number; y: number; fuel?: number }) {
    const game = this.game;
    const targeted = game.target?.st === st;
    if (st.type === 'chest') {
      const open = game.station === st;
      const img = game.assets.get(open ? 'chest.open' : 'chest');
      g.drawImage(img, st.x - img.width / 2, st.y - img.height + 10);
      if (targeted) this.highlight(g, img, st.x - img.width / 2, st.y - img.height + 10);
      return;
    }
    const img = game.assets.get('campfire');
    g.drawImage(img, st.x - img.width / 2, st.y - img.height + 14);
    if (targeted) this.highlight(g, img, st.x - img.width / 2, st.y - img.height + 14);
    const f = st.fuel ?? 0;
    if (f <= 0) {
      // 余烬
      g.fillStyle = `rgba(255,120,40,${0.3 + Math.sin(game.time * 2) * 0.1})`;
      g.beginPath(); g.ellipse(st.x, st.y - 6, 6, 2.5, 0, 0, Math.PI * 2); g.fill();
      return;
    }
    const k = Math.min(1, 0.35 + f / 150);
    const t = game.time;
    const glow = g.createRadialGradient(st.x, st.y - 14, 2, st.x, st.y - 14, 60 * k + 20);
    glow.addColorStop(0, `rgba(255,170,80,${0.5 * k})`); glow.addColorStop(1, 'rgba(255,170,80,0)');
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = glow; g.fillRect(st.x - 90, st.y - 100, 180, 180);
    // 多层火焰
    const layers: [string, number, number][] = [['rgba(220,80,30,.85)', 1, 0], ['rgba(255,150,50,.9)', 0.72, 1.7], ['rgba(255,230,150,.95)', 0.42, 3.1]];
    for (const [col, sc, ph] of layers) {
      const h = (30 + Math.sin(t * 9 + ph) * 4 + Math.sin(t * 13.7 + ph) * 3) * k * sc;
      const w = 11 * k * sc + 3;
      const sw = Math.sin(t * 5 + ph) * 3 * sc;
      g.fillStyle = col;
      g.beginPath();
      g.moveTo(st.x - w, st.y - 8);
      g.quadraticCurveTo(st.x - w * 0.9, st.y - 8 - h * 0.6, st.x + sw, st.y - 8 - h);
      g.quadraticCurveTo(st.x + w * 0.9, st.y - 8 - h * 0.55, st.x + w, st.y - 8);
      g.closePath(); g.fill();
    }
    g.globalCompositeOperation = 'source-over';
  }

  private drawCreature(g: G, c: import('../systems/creatures').Creature) {
    const game = this.game;
    const img = game.assets.get(`${c.type}.${creatureFrame(c)}`);
    g.save();
    g.globalAlpha = clampAlpha(c);
    g.translate(c.x, c.y);
    if (c.flip) g.scale(-1, 1);
    g.drawImage(img, -img.width / 2, -img.height + 6);
    if (c.hurt > 0) { g.globalCompositeOperation = 'lighter'; g.globalAlpha = c.hurt * 4; g.drawImage(img, -img.width / 2, -img.height + 6); }
    g.restore();
    // 血条
    const def = c.type === 'wolf' ? 100 : 25;
    if (c.hp < def && c.hp > 0) {
      g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(c.x - 14, c.y - (c.type === 'wolf' ? 50 : 32), 28, 3);
      g.fillStyle = '#e0705e'; g.fillRect(c.x - 14, c.y - (c.type === 'wolf' ? 50 : 32), 28 * (c.hp / def), 3);
    }
    // 狼在夜里的眼睛
    if (c.type === 'wolf' && lightLevel(game.state.time) < 0.5) {
      g.globalCompositeOperation = 'lighter';
      g.fillStyle = 'rgba(190,255,235,.8)';
      const ex = c.x + (c.flip ? -1 : 1) * 20, ey = c.y - 22;
      g.beginPath(); g.arc(ex, ey, 2, 0, Math.PI * 2); g.fill();
      g.globalCompositeOperation = 'source-over';
    }
  }

  private drawGhost(g: G) {
    const game = this.game;
    const b = game.build!;
    const img = game.assets.get(b.type === 'campfire' ? 'campfire' : 'chest');
    g.save();
    g.globalAlpha = 0.6 + Math.sin(game.time * 6) * 0.1;
    g.fillStyle = b.valid ? 'rgba(140,230,140,.25)' : 'rgba(230,90,70,.3)';
    g.strokeStyle = b.valid ? 'rgba(160,240,160,.9)' : 'rgba(240,110,90,.9)';
    g.lineWidth = 1.5;
    g.beginPath(); g.ellipse(b.x, b.y, STRUCTURES[b.type].radius + 6, (STRUCTURES[b.type].radius + 6) * 0.45, 0, 0, Math.PI * 2); g.fill(); g.stroke();
    g.drawImage(img, b.x - img.width / 2, b.y - img.height + (b.type === 'campfire' ? 14 : 10));
    g.restore();
  }

  private drawPlayer(g: G) {
    const game = this.game;
    const p = game.player;
    const s = game.state;
    g.fillStyle = 'rgba(6,12,14,.45)';
    g.beginPath(); g.ellipse(p.x, p.y + 1, 11, 4.5, 0, 0, Math.PI * 2); g.fill();
    const frame = p.moving ? Math.floor(p.anim) % 4 : 4 + (Math.floor(p.anim) % 5 === 0 ? 1 : 0);
    const img = game.assets.get(`player.${p.dir}.${frame}`);
    const hand = s.equip.hand;
    const drawHeld = () => {
      if (!hand) return;
      const side = p.dir === 'side' ? (p.flip ? -1 : 1) : 1;
      const swing = p.attackT > 0 ? Math.sin((1 - p.attackT / 0.25) * Math.PI) : 0;
      const chop = game.gather && (ITEMS[hand.id].tool) ? Math.abs(Math.sin(game.time * 12)) : 0;
      const hx = p.x + (p.dir === 'side' ? side * 10 : 11), hy = p.y - 16;
      const id = hand.id;
      if (id === 'torch' || id === 'lantern') {
        const bob = Math.sin(p.anim * (p.moving ? 1.6 : 0.6)) * (p.moving ? 2 : 0.6);
        const lx = hx + bob * 0.4, ly = hy + Math.abs(bob) * 0.3;
        const fl = 0.85 + Math.sin(game.time * 13) * 0.08 + Math.sin(game.time * 7.3) * 0.07;
        if (id === 'lantern') {
          g.strokeStyle = '#3a2a1e'; g.lineWidth = 1; g.beginPath(); g.moveTo(lx, ly - 8); g.lineTo(lx, ly - 4); g.stroke();
          g.fillStyle = '#5a3c26'; g.fillRect(lx - 3.5, ly - 5, 7, 2); g.fillRect(lx - 3.5, ly + 5, 7, 2);
          g.fillStyle = `rgba(200,255,230,${fl})`; g.fillRect(lx - 3, ly - 3, 6, 8);
        } else {
          g.save(); g.translate(lx, ly + 4); g.rotate(side * 0.25 - swing * side * 1.2);
          g.fillStyle = '#6e4a2e'; g.fillRect(-1.5, -10, 3, 16);
          g.fillStyle = `rgba(255,140,40,${fl})`; g.beginPath(); g.ellipse(0, -13, 3.5, 5.5 + Math.sin(game.time * 15) * 1, 0, 0, Math.PI * 2); g.fill();
          g.fillStyle = 'rgba(255,230,150,.95)'; g.beginPath(); g.ellipse(0, -12, 1.8, 3, 0, 0, Math.PI * 2); g.fill();
          g.restore();
        }
        g.globalCompositeOperation = 'lighter';
        const col = id === 'lantern' ? '180,255,220' : '255,190,110';
        const rg = g.createRadialGradient(lx, ly - 4, 1, lx, ly - 4, 30);
        rg.addColorStop(0, `rgba(${col},${0.5 * fl})`); rg.addColorStop(1, `rgba(${col},0)`);
        g.fillStyle = rg; g.fillRect(lx - 30, ly - 34, 60, 60);
        g.globalCompositeOperation = 'source-over';
        return;
      }
      // 斧 / 镐 / 长矛
      const ang = side * (0.4 - swing * 1.8 - chop * 1.1);
      g.save(); g.translate(hx, hy + 6); g.rotate(ang);
      if (p.dir === 'side' && p.flip) g.scale(-1, 1);
      const icon = game.assets.get(`icon.${id}`);
      g.drawImage(icon, -6, -24, 22, 22);
      g.restore();
    };
    if (p.dir === 'up') drawHeld();
    g.save(); g.translate(p.x, p.y);
    if (p.dir === 'side' && p.flip) g.scale(-1, 1);
    g.drawImage(img, -img.width / 2, -img.height + 4);
    // 护甲：在斗篷上叠一层草编纹理
    if (s.equip.body) {
      g.globalAlpha = 0.55; g.strokeStyle = '#c9b46a'; g.lineWidth = 1;
      for (let y = -22; y < -6; y += 3) { g.beginPath(); g.moveTo(-8, y); g.lineTo(8, y + 1); g.stroke(); }
      g.globalAlpha = 1;
    }
    if (game.hurtFlash > 0) { g.globalCompositeOperation = 'source-atop'; g.globalAlpha = game.hurtFlash * 1.6; g.globalCompositeOperation = 'lighter'; g.drawImage(img, -img.width / 2, -img.height + 4); }
    g.restore();
    if (p.dir !== 'up') drawHeld();
    if (s.buffLeft > 0 && Math.random() < 0.3) {
      game.particles.push({ x: p.x + (Math.random() - 0.5) * 14, y: p.y - Math.random() * 30, vx: 0, vy: -20, life: 0.7, max: 0.7, color: '#bfeff0', size: 1.4, glow: true, grav: -10 });
    }
  }

  private drawRain(g: G, rain: number) {
    const game = this.game;
    const W = game.canvas.width, H = game.canvas.height;
    const n = Math.floor(this.rain.length * rain * (game.settings.fx === 'low' ? 0.5 : 1));
    g.strokeStyle = 'rgba(190,215,230,.35)';
    g.lineWidth = 1.2 * game.dpr;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const d = this.rain[i];
      d.y += 0.022 * d.v; d.x -= 0.004 * d.v;
      if (d.y > 1) { d.y -= 1; d.x = Math.random(); }
      if (d.x < 0) d.x += 1;
      const x = d.x * W, y = d.y * H, l = d.l * game.dpr;
      g.moveTo(x, y); g.lineTo(x - l * 0.25, y + l);
    }
    g.stroke();
    g.fillStyle = `rgba(30,45,60,${0.18 * rain})`;
    g.fillRect(0, 0, W, H);
  }

  /** 低精神时，视野边缘出现游荡的影子 */
  private drawShadows(g: G) {
    const game = this.game;
    const W = game.canvas.width, H = game.canvas.height;
    const k = 1 - game.state.stats.sanity / (MAX.sanity * 0.3);
    for (let i = 0; i < 3; i++) {
      const a = game.time * 0.2 + i * 2.1;
      const x = W / 2 + Math.cos(a) * W * 0.42, y = H / 2 + Math.sin(a * 1.3) * H * 0.38;
      const rg = g.createRadialGradient(x, y, 0, x, y, 90 * game.dpr);
      rg.addColorStop(0, `rgba(10,0,20,${0.55 * k})`); rg.addColorStop(1, 'rgba(10,0,20,0)');
      g.fillStyle = rg; g.fillRect(x - 100 * game.dpr, y - 100 * game.dpr, 200 * game.dpr, 200 * game.dpr);
      g.fillStyle = `rgba(230,220,255,${0.6 * k})`;
      g.beginPath(); g.arc(x - 6 * game.dpr, y - 8 * game.dpr, 2 * game.dpr, 0, Math.PI * 2); g.arc(x + 6 * game.dpr, y - 8 * game.dpr, 2 * game.dpr, 0, Math.PI * 2); g.fill();
    }
  }

  private drawLighting(left: number, top: number) {
    const game = this.game;
    const l = this.lg;
    const W = this.light.width, H = this.light.height;
    const z = game.zoom * game.dpr * this.LS;
    l.setTransform(1, 0, 0, 1, 0, 0);
    l.globalCompositeOperation = 'source-over';
    l.clearRect(0, 0, W, H);
    const s = game.state;
    const menu = game.mode === 'menu';
    const L = menu ? 0.75 : lightLevel(s.time);
    const clear = game.fog.globalClear;
    const dark = menu ? 0.38 : clamp(lerp(0.965, lerp(0.42, 0.1, clear), L) + (game.mode === 'play' ? s.weather.rain * 0.08 : 0), 0, 0.97);
    const night = 1 - L;
    l.fillStyle = `rgba(${Math.round(lerp(4, 6, L))},${Math.round(lerp(8, 12, L))},${Math.round(lerp(26, 18, L))},${dark})`;
    l.fillRect(0, 0, W, H);
    l.globalCompositeOperation = 'destination-out';
    const hole = (wx: number, wy: number, r: number, st = 1) => {
      const sx = (wx - left) * z, sy = (wy - top) * z, sr = r * z;
      if (sx < -sr || sy < -sr || sx > W + sr || sy > H + sr) return;
      const gr = l.createRadialGradient(sx, sy, 0, sx, sy, sr);
      gr.addColorStop(0, `rgba(0,0,0,${st})`); gr.addColorStop(0.55, `rgba(0,0,0,${st * 0.7})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
      l.fillStyle = gr; l.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
    };
    if (!menu) {
      // 白天：以角色为中心的视野；夜里：角色自身只有一圈极弱的微光
      hole(game.player.x, game.player.y - 14, lerp(70, game.visionRadius() * 1.25, L), lerp(0.35, 1, L));
      for (const lt of game.lights) {
        const flick = 1 + Math.sin(game.time * 11 + lt.x) * 0.025 + Math.sin(game.time * 17 + lt.y) * 0.02;
        hole(lt.x, lt.y, lt.r * flick, 1);
      }
    }
    const vw = game.viewW / game.zoom, vh = game.viewH / game.zoom;
    for (const o of game.resources) {
      if ((o.res !== 'mushroom' && o.res !== 'crystal') || o.x < left - 60 || o.x > left + vw + 60 || o.y < top - 60 || o.y > top + vh + 60) continue;
      if (!menu && game.nodeGone(o)) continue;
      hole(o.x, o.y - 12, 54, 0.7);
    }
    if (s.offered >= 3 || game.mode === 'cutscene') hole(game.map.altar.x, game.map.altar.y, 330, 0.9);
    // 暖色光晕（篝火 / 火把）
    if (!menu && night > 0.2) {
      l.globalCompositeOperation = 'source-over';
      for (const lt of game.lights) {
        const sx = (lt.x - left) * z, sy = (lt.y - top) * z, sr = lt.r * z * 0.8;
        const gr = l.createRadialGradient(sx, sy, 0, sx, sy, sr);
        gr.addColorStop(0, `rgba(255,150,60,${0.12 * night})`); gr.addColorStop(1, 'rgba(255,150,60,0)');
        l.fillStyle = gr; l.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
      }
    }
    l.globalCompositeOperation = 'source-over';
    const vg = l.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, `rgba(2,6,10,${menu ? 0.65 : 0.4})`);
    l.fillStyle = vg; l.fillRect(0, 0, W, H);
  }

  private questTarget(): { x: number; y: number } | null {
    const game = this.game;
    const q = QUESTS[game.state.questIdx];
    if (!q || !q.hint) return null;
    if (q.hint === 'altar') return game.map.altar;
    if (q.id === 'ore') {
      const a = { x: 20 * TILE, y: 16 * TILE }, b = { x: 76 * TILE, y: 16 * TILE };
      const p = game.player;
      return Math.hypot(a.x - p.x, a.y - p.y) < Math.hypot(b.x - p.x, b.y - p.y) ? a : b;
    }
    return { x: q.hint.x * TILE, y: q.hint.y * TILE };
  }

  private drawQuestArrow(g: G, left: number, top: number) {
    const game = this.game;
    const t = this.questTarget();
    if (!t) return;
    const z = game.zoom;
    const sx = (t.x - left) * z, sy = (t.y - top) * z;
    const W = game.viewW, H = game.viewH;
    const pad = 70;
    const onScreen = sx > pad && sy > pad && sx < W - pad && sy < H - pad;
    if (onScreen && Math.hypot(t.x - game.player.x, t.y - game.player.y) < 200) return;
    const cx = W / 2, cy = H / 2;
    const ang = Math.atan2(sy - cy, sx - cx);
    const k = Math.min((W / 2 - pad) / Math.abs(Math.cos(ang) || 1e-6), (H / 2 - pad) / Math.abs(Math.sin(ang) || 1e-6));
    const ax = onScreen ? sx : cx + Math.cos(ang) * k, ay = onScreen ? sy - 30 : cy + Math.sin(ang) * k;
    g.setTransform(game.dpr, 0, 0, game.dpr, 0, 0);
    g.save(); g.translate(ax, ay); g.rotate(onScreen ? Math.PI / 2 : ang); g.translate(Math.sin(game.time * 4) * 3, 0);
    g.fillStyle = 'rgba(242,196,109,.9)'; g.strokeStyle = 'rgba(20,12,4,.6)'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(14, 0); g.lineTo(-6, -9); g.lineTo(-2, 0); g.lineTo(-6, 9); g.closePath(); g.fill(); g.stroke();
    g.restore();
    g.setTransform(1, 0, 0, 1, 0, 0);
  }

  // ---------------- 地图 ----------------
  private buildFogMask(): HTMLCanvasElement {
    const game = this.game;
    const g = this.fogMask.getContext('2d')!;
    const img = g.createImageData(FW, FH);
    const ex = game.fog.explored;
    const clear = game.state.ended ? 1 : 0;
    for (let i = 0; i < FW * FH; i++) {
      img.data[i * 4] = 70; img.data[i * 4 + 1] = 88; img.data[i * 4 + 2] = 96;
      img.data[i * 4 + 3] = (1 - ex[i] / 255) * 235 * (1 - clear);
    }
    g.putImageData(img, 0, 0);
    return this.fogMask;
  }
  private drawMarkers(g: G, sc: number) {
    const game = this.game;
    const s = game.state;
    if (s.altarFound || s.ended) {
      const a = game.map.altar;
      g.fillStyle = s.offered >= 3 ? '#bff8e8' : '#f2c46d';
      g.beginPath(); g.moveTo(a.x * sc, a.y * sc - 6); g.lineTo(a.x * sc + 5, a.y * sc + 4); g.lineTo(a.x * sc - 5, a.y * sc + 4); g.closePath(); g.fill();
    }
    for (const st of s.structures) {
      g.fillStyle = st.type === 'campfire' ? (st.fuel ? '#ff9a40' : '#8a5a3a') : '#c99a62';
      g.beginPath(); g.arc(st.x * sc, st.y * sc, 2.5, 0, Math.PI * 2); g.fill();
    }
    const t = this.questTarget();
    if (t) {
      g.strokeStyle = 'rgba(242,196,109,.85)'; g.lineWidth = 1.5; g.setLineDash([3, 3]);
      g.beginPath(); g.arc(t.x * sc, t.y * sc, 7 + Math.sin(game.time * 3) * 1.5, 0, Math.PI * 2); g.stroke();
      g.setLineDash([]);
    }
    g.fillStyle = '#fff3cf'; g.strokeStyle = '#7a4a1a'; g.lineWidth = 1.2;
    g.beginPath(); g.arc(game.player.x * sc, game.player.y * sc, 3.5, 0, Math.PI * 2); g.fill(); g.stroke();
  }
  drawMinimap() {
    const game = this.game;
    const c = document.getElementById('minimap') as HTMLCanvasElement | null;
    if (!c || game.mode !== 'play' || c.offsetParent === null) return;
    const g = c.getContext('2d')!;
    const sc = c.width / WORLD_W;
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(game.ground.minimapBase, 0, 0, c.width, c.height);
    g.drawImage(this.buildFogMask(), 0, 0, c.width, c.height);
    this.drawMarkers(g, sc);
  }
  drawBigMap() {
    const game = this.game;
    const c = document.getElementById('bigmap-canvas') as HTMLCanvasElement;
    const g = c.getContext('2d')!;
    const sc = c.width / WORLD_W;
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(game.ground.minimapBase, 0, 0, c.width, c.height);
    g.fillStyle = 'rgba(18,40,32,.55)';
    for (const o of game.map.objects) {
      if ((o.kind === 'tree' || o.kind === 'pine') && !(game.state.nodes[o.id] !== undefined)) { g.beginPath(); g.arc(o.x * sc, o.y * sc - 6, o.kind === 'tree' ? 6 : 4, 0, Math.PI * 2); g.fill(); }
    }
    g.drawImage(this.buildFogMask(), 0, 0, c.width, c.height);
    for (const o of game.steles) {
      if (game.fog.densityAt(o.x, o.y) > 0.6 && !game.state.ended) continue;
      g.fillStyle = game.state.steleRead.includes(o.stele ?? -1) ? '#a9c3c0' : '#e9e4cf';
      g.fillRect(o.x * sc - 2, o.y * sc - 4, 4, 7);
    }
    this.drawMarkers(g, sc);
    const pct = document.getElementById('explore-pct');
    if (pct) pct.textContent = `· 已探索 ${Math.round(game.fog.exploredPct() * 100)}%`;
  }
}
