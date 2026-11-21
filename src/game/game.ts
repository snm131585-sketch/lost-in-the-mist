// 游戏主控：场景状态机 + 各系统调度（渲染在 render.ts，纯逻辑在 systems/）
import { Input } from '../engine/input';
import { AudioEngine } from '../engine/audio';
import { clamp, lerp, mulberry32 } from '../engine/math';
import { Assets, SFX_OVERRIDES } from '../art/manifest';
import type { Dir } from '../art/painters';
import { generateMap, TILE, MAP_W, MAP_H, T, idx, inBounds, type WorldMap, type WorldObj } from '../world/map';
import { bakeGround, type GroundLayer } from '../world/ground';
import { Fog } from '../world/fog';
import { ITEMS, type ItemId } from '../data/items';
import { NODES, STRUCTURES, CREATURES, RECIPES, QUESTS, STELE_TEXTS, ENDING_LINES, type NodeType, type CreatureType, type Drop } from '../data/world';
import {
  newState, loadSave, writeSave, clearSave, hasOldSave, addItem, removeItem, count, craft, advanceQuests, hasCost, payCost,
  loadSettings, saveSettings, type SaveData, type Settings, type Structure,
} from './state';
import { countIn, addTo, canAdd } from '../systems/inventory';
import { tickSurvival, applyFood, MAX } from '../systems/survival';
import { dayOf, phaseOf, lightLevel, ambientTemp, type Phase } from '../systems/time';
import { tickWeather } from '../systems/weather';
import { spawnCreature, updateCreature, knockback, type Creature } from '../systems/creatures';
import { checkPlacement, type BuildGhost } from '../systems/building';
import { UI, type UiAction } from '../ui/ui';
import { Renderer } from './render';

export type Mode = 'menu' | 'play' | 'cutscene' | 'ending' | 'dead';
export interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number; glow: boolean; grav: number }
export interface GroundItem { id: number; item: ItemId; n: number; dur?: number; x: number; y: number; t: number }
export interface Light { x: number; y: number; r: number }

export const WORLD_W = MAP_W * TILE, WORLD_H = MAP_H * TILE;
const BASE_SPEED = 128;
const PLAYER_R = 8;

export class Game {
  canvas: HTMLCanvasElement;
  dpr = 1; viewW = 0; viewH = 0; zoom = 1;
  assets = new Assets();
  map!: WorldMap;
  ground!: GroundLayer;
  fog = new Fog();
  audio = new AudioEngine();
  input = new Input();
  ui: UI;
  renderer!: Renderer;
  settings: Settings = loadSettings();
  mode: Mode = 'menu';
  state!: SaveData;

  player = { x: 0, y: 0, dir: 'down' as Dir, flip: false, anim: 0, moving: false, stepT: 0, attackT: 0, atkCd: 0 };
  cam = { x: 0, y: 0, shake: 0 };
  resources: WorldObj[] = [];
  harvestables: WorldObj[] = [];
  steles: WorldObj[] = [];
  altarObj!: WorldObj;
  creatures: Creature[] = [];
  groundItems: GroundItem[] = [];
  particles: Particle[] = [];
  gather: { node: WorldObj; t: number; dur: number } | null = null;
  target: { kind: 'node' | 'stele' | 'altar' | 'struct'; obj?: WorldObj; st?: Structure } | null = null;
  build: (BuildGhost & { recipe: ItemId }) | null = null;
  station: Structure | null = null;
  lights: Light[] = [];
  time = 0;
  hurtFlash = 0;
  darkT = 0;
  inDark = false;
  debug = { timeScale: 1 };
  cut = { t: 0, from: { x: 0, y: 0 } };
  menuT = 0;
  mouse = { x: 0, y: 0, t: -10 };
  deathCause = '';
  private baseBlocked!: Uint8Array;
  private last = 0;
  private saveTimer = 0;
  private hudTimer = 0;
  private fogTimer = 0;
  private spawnT = { rabbit: 0, wolf: 30, whisper: 0 };
  private gid = 1;
  private lastPhase: Phase = 'day';
  private lastDay = 1;
  rnd = mulberry32(99);

  constructor() {
    this.canvas = document.getElementById('game') as HTMLCanvasElement;
    this.ui = new UI(this.assets);
  }

  // ================= 启动 =================
  async boot() {
    this.assets.buildProcedural();
    await this.assets.loadOverrides();
    this.map = generateMap();
    this.baseBlocked = this.map.blocked.slice();
    this.ground = bakeGround(this.map, this.assets);
    for (const o of this.map.objects) {
      if (o.kind === 'resource') this.resources.push(o);
      else if (o.kind === 'stele') this.steles.push(o);
      else if (o.kind === 'altar') this.altarObj = o;
      if (this.nodeType(o)) this.harvestables.push(o);
    }
    this.renderer = new Renderer(this);
    this.state = newState(this.map.start);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 200));
    this.bindUi();
    this.input.bindTouch(
      document.getElementById('stick-zone')!, document.getElementById('stick-base')!, document.getElementById('stick-knob')!,
      document.getElementById('touch-act')!, document.getElementById('touch-potion')!,
    );
    this.input.bindAttack(document.getElementById('touch-attack')!);
    this.canvas.addEventListener('mousemove', (e) => { this.mouse = { x: e.clientX, y: e.clientY, t: this.time }; });
    this.canvas.addEventListener('mousedown', (e) => {
      if (this.mode !== 'play' || this.modalOpen()) return;
      if (e.button === 2) { if (this.build) this.cancelBuild(); return; }
      this.mouse = { x: e.clientX, y: e.clientY, t: this.time };
      if (this.build) { this.updateBuild(); this.confirmBuild(); } else this.input.tapAttack();
    });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    const unlock = () => {
      this.audio.unlock();
      this.applyAudioSettings();
      for (const [k, url] of Object.entries(SFX_OVERRIDES)) void this.audio.loadOverride(k, url);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.mode === 'play') this.save(); });
    window.addEventListener('beforeunload', () => { if (this.mode === 'play') this.save(true); });
    this.enterMenu();
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
    (window as unknown as { __LITM__: Game }).__LITM__ = this;
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.viewW = window.innerWidth; this.viewH = window.innerHeight;
    this.canvas.width = Math.round(this.viewW * this.dpr);
    this.canvas.height = Math.round(this.viewH * this.dpr);
    this.renderer?.resize();
    const short = Math.min(this.viewW, this.viewH);
    this.zoom = clamp(short / (13 * TILE), 0.9, 2.0);
    this.updateTouchVisibility();
  }

  // ================= UI =================
  private bindUi() {
    const ui = this.ui;
    ui.bindSettings(this.settings);
    ui.onSettings = (s) => { this.settings = s; saveSettings(s); this.applyAudioSettings(); this.updateTouchVisibility(); };
    ui.onCraft = (id) => this.doCraft(id);
    ui.onSlot = (i) => this.useSlot(i);
    ui.onEquipSlot = (k) => this.unequip(k);
    ui.onAction = (a) => this.handleAction(a);
    ui.onStation = (cmd, arg) => this.stationCmd(cmd, arg);
    ui.onBuild = (ok) => (ok ? this.confirmBuild() : this.cancelBuild());
    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (k === 'escape' || k === 'p') { this.onEscape(k); return; }
      if (this.mode !== 'play') return;
      if (k === 'c' || k === 'tab' || k === 'b') { e.preventDefault(); this.toggleBag(); }
      else if (k === 'm') this.toggleMap();
      else if (/^[0-9]$/.test(k) && !this.modalOpen()) this.useSlot(k === '0' ? 9 : Number(k) - 1);
    });
  }

  private handleAction(a: UiAction) {
    this.audio.play('click');
    switch (a) {
      case 'new':
        if (loadSave()) this.ui.confirm('开始新的旅程', '这会覆盖当前存档，确定吗？', () => this.startGame(false));
        else this.startGame(false);
        break;
      case 'continue': this.startGame(true); break;
      case 'howto': this.ui.show('howto'); break;
      case 'close-howto': this.ui.hide('howto'); break;
      case 'settings': this.ui.show('settings'); break;
      case 'close-settings': this.ui.hide('settings'); break;
      case 'bag': this.toggleBag(); break;
      case 'close-bag': this.toggleBag(false); break;
      case 'map': this.toggleMap(); break;
      case 'close-map': this.toggleMap(false); break;
      case 'pause': this.pause(true); break;
      case 'resume': this.pause(false); break;
      case 'close-station': this.closeStation(); break;
      case 'to-menu': this.save(); this.ui.hide('pause'); this.ui.hide('ending'); this.enterMenu(); break;
      case 'to-menu-dead': this.ui.hide('death'); this.enterMenu(); break;
      case 'restart': this.ui.hide('death'); this.startGame(false); break;
      case 'reset-save':
        this.ui.confirm('清除存档', '存档删除后无法恢复。确定清除吗？', () => {
          clearSave(); this.ui.setContinueEnabled(false); this.ui.toast('存档已清除');
          if (this.mode !== 'menu') { this.ui.hide('settings'); this.ui.hide('pause'); this.enterMenu(); }
        });
        break;
      case 'free-roam': this.ui.hide('ending'); this.mode = 'play'; this.audio.musicMood = 'forest'; this.ui.show('hud'); this.updateTouchVisibility(); break;
      default: break;
    }
  }

  private onEscape(k: string) {
    if (this.build && k === 'escape') { this.cancelBuild(); return; }
    for (const id of ['confirm', 'howto', 'settings', 'bag', 'bigmap', 'station']) {
      if (this.ui.isOpen(id)) {
        if (id === 'bag') this.toggleBag(false); else if (id === 'bigmap') this.toggleMap(false); else if (id === 'station') this.closeStation(); else this.ui.hide(id);
        return;
      }
    }
    if (this.mode === 'play') this.pause(!this.ui.isOpen('pause'));
  }

  modalOpen() { return ['pause', 'bag', 'bigmap', 'settings', 'howto', 'confirm', 'station'].some((id) => this.ui.isOpen(id)); }
  pause(on: boolean) {
    if (this.mode !== 'play') return;
    if (on) { this.ui.show('pause'); this.save(); this.audio.play('open'); } else { this.ui.hide('pause'); this.audio.play('close'); }
  }
  toggleBag(force?: boolean) {
    const open = force ?? !this.ui.isOpen('bag');
    if (open) { this.ui.renderCraft(this.state); this.ui.show('bag'); this.audio.play('open'); }
    else if (this.ui.isOpen('bag')) { this.ui.hide('bag'); this.audio.play('close'); }
  }
  toggleMap(force?: boolean) {
    const open = force ?? !this.ui.isOpen('bigmap');
    if (open) { this.renderer.drawBigMap(); this.ui.show('bigmap'); this.audio.play('open'); }
    else if (this.ui.isOpen('bigmap')) { this.ui.hide('bigmap'); this.audio.play('close'); }
  }
  private applyAudioSettings() { const s = this.settings; this.audio.setVolumes(s.master / 100, s.music / 100, s.sfx / 100); }
  updateTouchVisibility() {
    const s = this.settings.touch;
    const coarse = window.matchMedia?.('(pointer: coarse)').matches;
    const on = s === 'on' || (s === 'auto' && (coarse || this.input.touchUsed));
    document.body.classList.toggle('touch-on', on && this.mode === 'play');
    document.getElementById('touch')!.classList.toggle('hidden', !(on && this.mode === 'play'));
  }

  // ================= 场景切换 =================
  enterMenu() {
    this.mode = 'menu';
    this.audio.musicMood = 'menu';
    this.audio.setRain(0);
    for (const id of ['hud', 'ending', 'bag', 'bigmap', 'station', 'death']) this.ui.hide(id);
    this.ui.show('menu');
    const saved = loadSave();
    this.ui.setContinueEnabled(!!saved);
    this.ui.setMenuFoot(!saved && hasOldSave() ? '检测到 v1 探索版存档：生存版玩法不同，无法沿用，将开启新的世界' : 'v2.0 生存版 · 自动存档于本机浏览器');
    this.ui.fx(MAX.sanity, 30, 0, 100);
    this.updateTouchVisibility();
    this.fog.reset();
    this.fog.globalClear = 0.62;
    this.creatures = [];
    this.menuT = 0;
    this.build = null; this.ui.buildBar(null);
  }

  startGame(cont: boolean) {
    const saved = cont ? loadSave() : null;
    this.ui.fade(true);
    setTimeout(() => {
      this.state = saved ?? newState(this.map.start);
      if (!saved) clearSave();
      this.fog.reset();
      if (saved?.fog) this.fog.deserialize(saved.fog);
      this.fog.globalClear = this.state.ended ? 1 : 0;
      this.player.x = this.state.player.x; this.player.y = this.state.player.y;
      this.player.dir = (this.state.player.dir as Dir) || 'down';
      this.cam.x = this.player.x; this.cam.y = this.player.y;
      this.particles = []; this.gather = null; this.creatures = []; this.groundItems = [];
      this.build = null; this.ui.buildBar(null);
      this.darkT = 0; this.hurtFlash = 0; this.deathCause = '';
      this.spawnT = { rabbit: 0, wolf: 30, whisper: 0 };
      this.rebuildBlocked();
      this.mode = 'play';
      this.audio.musicMood = 'forest';
      this.ui.hide('menu'); this.ui.show('hud');
      this.updateTouchVisibility();
      this.lastPhase = phaseOf(this.state.time);
      this.lastDay = dayOf(this.state.time);
      this.updateWorld(0);
      this.fog.reveal(this.player.x, this.player.y - 8, this.visionRadius());
      this.refreshHud();
      this.ui.fade(false);
      if (!saved) setTimeout(() => this.ui.toast('你在迷雾中醒来……天黑之前，要生起火。', { big: true }), 500);
      else this.ui.toast(`欢迎回来 · 第 ${dayOf(this.state.time)} 天`, { big: true });
      this.save();
    }, 450);
  }

  save(silent = false) {
    if (this.mode !== 'play' && this.mode !== 'ending' && this.mode !== 'cutscene') return;
    const s = this.state;
    s.player = { x: Math.round(this.player.x), y: Math.round(this.player.y), dir: this.player.dir };
    s.fog = this.fog.serialize();
    const ok = writeSave(s);
    this.saveTimer = 0;
    if (ok && !silent) this.ui.flashSaved();
  }

  // ================= 世界状态 =================
  nodeType(o: WorldObj): NodeType | null {
    if ((o.kind === 'tree' || o.kind === 'pine') && !o.fixed) return o.kind;
    if (o.kind === 'rock') return 'boulder';
    if (o.kind === 'bush') return 'berrybush';
    if (o.kind === 'resource') return o.res!;
    return null;
  }
  /** 节点当前是否被采空（到期时自动重生） */
  nodeGone(o: WorldObj): boolean {
    const r = this.state.nodes[o.id];
    if (r === undefined) return false;
    if (this.state.time < r) return true;
    const big = o.kind === 'tree' || o.kind === 'pine' || o.kind === 'rock';
    if (big && Math.hypot(this.player.x - o.x, this.player.y - o.y) < 40) return true;
    if (big && this.state.structures.some((st) => Math.hypot(st.x - o.x, st.y - o.y) < 30)) return true;
    delete this.state.nodes[o.id];
    if (big) this.map.blocked[idx(Math.floor(o.x / TILE), Math.floor(o.y / TILE))] = 1;
    return false;
  }
  rebuildBlocked() {
    this.map.blocked.set(this.baseBlocked);
    for (const o of this.harvestables) {
      if ((o.kind === 'tree' || o.kind === 'pine' || o.kind === 'rock') && this.state.nodes[o.id] !== undefined) {
        this.map.blocked[idx(Math.floor(o.x / TILE), Math.floor(o.y / TILE))] = 0;
      }
    }
    for (const s of this.state.structures) if (STRUCTURES[s.type].blocks) this.map.blocked[idx(Math.floor(s.x / TILE), Math.floor(s.y / TILE))] = 1;
  }
  blockedAt = (x: number, y: number) => {
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    return !inBounds(tx, ty) || this.map.blocked[idx(tx, ty)] === 1;
  };
  fireRadius(fuel: number) { return fuel > 0 ? 70 + 150 * Math.min(1, fuel / 120) : 0; }
  phase(): Phase { return phaseOf(this.state.time); }
  day() { return dayOf(this.state.time); }
  handLight() { const h = this.state.equip.hand; return h ? ITEMS[h.id].light ?? 0 : 0; }

  visionRadius() {
    const L = lightLevel(this.state.time);
    const hand = this.handLight();
    let r = Math.max(lerp(60, 175, L), hand);
    if (this.state.buffLeft > 0) r += 60;
    return r;
  }

  // ================= 主循环 =================
  private frame(now: number) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    try { this.update(dt); this.renderer.render(); } catch (err) { console.error(err); }
    this.input.endFrame();
    requestAnimationFrame((t) => this.frame(t));
  }

  private update(dt: number) {
    if (this.mode === 'menu') {
      this.menuT += dt;
      const t = this.menuT * 0.035;
      this.cam.x = WORLD_W / 2 + Math.sin(t) * 700;
      this.cam.y = WORLD_H * 0.55 + Math.sin(t * 0.7 + 1) * 420;
      this.fog.dirty = true;
      this.renderer.updateAmbient(dt);
      return;
    }
    if (this.mode === 'cutscene') { this.updateCutscene(dt); this.renderer.updateAmbient(dt); return; }
    if (this.mode === 'ending' || this.mode === 'dead') {
      if (this.mode === 'ending') {
        this.cam.x = lerp(this.cam.x, this.map.altar.x + Math.sin(this.time * 0.1) * 200, dt * 0.5);
        this.cam.y = lerp(this.cam.y, this.map.altar.y + 120, dt * 0.5);
      }
      this.renderer.updateAmbient(dt);
      return;
    }

    const paused = this.modalOpen();
    this.input.enabled = !paused;
    if (!paused) {
      const gdt = dt * this.debug.timeScale;
      this.state.playTime += dt;
      this.state.time += gdt;
      this.updateWorld(gdt);
      this.updatePlayer(dt);
      this.updateBuild();
      this.updateInteraction(dt);
      this.updateCombat();
      this.updateCreatures(dt);
      this.updateSurvival(gdt);
      if (this.input.wasPressed('q') || this.input.potionTap) this.useTonic();
      this.saveTimer += dt;
      if (this.saveTimer > 20) this.save();
    }
    this.hurtFlash = Math.max(0, this.hurtFlash - dt);
    this.cam.shake = Math.max(0, this.cam.shake - dt * 30);
    this.renderer.updateAmbient(dt);
    const k = 1 - Math.pow(0.0015, dt);
    this.cam.x = lerp(this.cam.x, this.player.x, k);
    this.cam.y = lerp(this.cam.y, this.player.y - 10, k);
    const hw = this.viewW / this.zoom / 2, hh = this.viewH / this.zoom / 2;
    this.cam.x = clamp(this.cam.x, hw, WORLD_W - hw);
    this.cam.y = clamp(this.cam.y, hh, WORLD_H - hh);
    this.fogTimer += dt;
    if (this.fogTimer > 0.06) { this.fogTimer = 0; this.fog.reveal(this.player.x, this.player.y - 8, this.visionRadius()); }
    this.hudTimer += dt;
    if (this.hudTimer > 0.2) { this.hudTimer = 0; this.refreshHud(); }
  }

  // ---------- 时间 / 天气 / 篝火 / 光源 ----------
  private updateWorld(dt: number) {
    const s = this.state;
    tickWeather(s.weather, s.time, dt, this.rnd);
    this.audio.setRain(s.weather.rain);
    const ph = this.phase();
    if (ph !== this.lastPhase) {
      if (ph === 'dusk') this.ui.toast('黄昏降临，天快黑了', { big: true });
      if (ph === 'night') this.ui.toast('夜晚 · 待在光亮里', { big: true, warn: true });
      if (ph === 'dawn') this.ui.toast('黎明 · 黑夜就要过去了', { big: true });
      this.lastPhase = ph;
    }
    if (this.day() !== this.lastDay) {
      this.lastDay = this.day();
      this.ui.toast(`第 ${this.lastDay} 天`, { big: true });
      this.checkQuests();
    }
    for (const st of s.structures) {
      if (st.type !== 'campfire' || !st.fuel) continue;
      st.fuel = Math.max(0, st.fuel - dt * (1 + s.weather.rain * 0.6));
      if (st.fuel === 0 && Math.hypot(st.x - this.player.x, st.y - this.player.y) < 400) this.ui.toast('篝火熄灭了', { warn: true });
    }
    const h = s.equip.hand;
    if (h && ITEMS[h.id].durKind === 'seconds' && h.dur !== undefined) {
      h.dur -= dt;
      if (h.dur <= 0) { this.ui.toast(`${ITEMS[h.id].name}燃尽了`, { warn: true, icon: h.id }); s.equip.hand = null; this.audio.play('break'); }
    }
    if (s.buffLeft > 0) s.buffLeft = Math.max(0, s.buffLeft - dt);
    const L: Light[] = [];
    const hand = this.handLight();
    if (hand) L.push({ x: this.player.x, y: this.player.y - 16, r: hand });
    for (const st of s.structures) if (st.type === 'campfire' && st.fuel) L.push({ x: st.x, y: st.y - 8, r: this.fireRadius(st.fuel) });
    if (s.offered >= 3) L.push({ x: this.map.altar.x, y: this.map.altar.y, r: 330 });
    this.lights = L;
  }

  // ---------- 生存 ----------
  private updateSurvival(dt: number) {
    const s = this.state;
    const p = this.player;
    const L = lightLevel(s.time);
    let heat = 0, nearFire = false;
    for (const st of s.structures) {
      if (st.type !== 'campfire' || !st.fuel) continue;
      const r = this.fireRadius(st.fuel), d = Math.hypot(st.x - p.x, st.y - p.y);
      if (d < r) { heat += 34 * (1 - d / r) + 4; if (d < r * 0.75) nearFire = true; }
    }
    const inLight = L > 0.25 || this.lights.some((l) => Math.hypot(l.x - p.x, l.y - p.y) < l.r * 0.72) ||
      this.resources.some((o) => o.res === 'mushroom' && Math.abs(o.x - p.x) < 40 && Math.abs(o.y - p.y) < 40 && !this.nodeGone(o));
    const ph = this.phase();
    const warmth = (s.equip.hand ? ITEMS[s.equip.hand.id].warmth ?? 0 : 0) + (s.equip.body ? 4 : 0);
    const prevHp = s.stats.hp;
    const tick = tickSurvival(s.stats, {
      ambient: ambientTemp(s.time, s.weather.rain), heat, warmth, dark: !inLight, night: ph === 'night', dusk: ph === 'dusk',
      rain: s.weather.rain, nearFire,
    }, dt);
    if (tick.causes.length && s.stats.hp < prevHp) this.deathCause = tick.causes[0];
    this.inDark = !inLight;
    const rdt = dt / this.debug.timeScale;
    if (!inLight) {
      const before = this.darkT;
      this.darkT += rdt;
      if (before < 1.2 && this.darkT >= 1.2) { this.ui.toast('黑暗中有什么在靠近……', { warn: true, big: true }); this.audio.play('whisper'); }
      if (this.darkT > 4) {
        this.spawnT.whisper -= rdt;
        if (this.spawnT.whisper <= 0) { this.spawnT.whisper = 2.2; this.hurt(28, '黑暗中的雾噬'); }
      }
    } else { this.darkT = 0; this.spawnT.whisper = 0; }
    if (s.stats.sanity < MAX.sanity * 0.3 && this.rnd() < rdt * 0.08) this.audio.play('whisper');
    if (s.stats.hp <= 0) this.die(this.deathCause || '力竭');
  }

  hurt(amount: number, cause: string) {
    if (this.mode !== 'play') return;
    const s = this.state;
    const armor = s.equip.body;
    if (armor && ITEMS[armor.id].absorb) {
      const ab = amount * ITEMS[armor.id].absorb!;
      amount -= ab;
      armor.dur = (armor.dur ?? 0) - ab;
      if (armor.dur <= 0) { s.equip.body = null; this.ui.toast('护甲损坏了', { warn: true, icon: armor.id }); this.audio.play('break'); }
    }
    s.stats.hp = Math.max(0, s.stats.hp - amount);
    this.hurtFlash = 0.35;
    this.cam.shake = 6;
    this.audio.play('hurt');
    this.gather = null;
    this.deathCause = cause;
    if (s.stats.hp <= 0) this.die(cause);
  }

  private die(cause: string) {
    if (this.mode !== 'play') return;
    this.mode = 'dead';
    this.build = null; this.ui.buildBar(null);
    this.audio.play('death');
    for (const id of ['bag', 'station', 'bigmap', 'pause']) this.ui.hide(id);
    this.ui.hide('hud'); this.ui.prompt(null);
    this.updateTouchVisibility();
    clearSave(); // 永久死亡：世界重新开始
    const s = this.state;
    const days = this.day();
    setTimeout(() => this.ui.showDeath(`你在第 ${days} 天倒下了。死因：${cause}。`, [
      { label: '存活天数', value: String(days) },
      { label: '旅程进度', value: `${Math.min(s.questIdx, QUESTS.length)}/${QUESTS.length}` },
      { label: '击败生物', value: String(s.kills) },
      { label: '探索度', value: `${Math.round(this.fog.exploredPct() * 100)}%` },
    ]), 900);
  }

  // ---------- 玩家移动 ----------
  private updatePlayer(dt: number) {
    const p = this.player;
    p.attackT = Math.max(0, p.attackT - dt);
    p.atkCd = Math.max(0, p.atkCd - dt);
    const m = this.input.move();
    const s = this.state;
    const slow = s.stats.hunger <= 0 ? 0.85 : 1;
    let speed = BASE_SPEED * (m.slow ? 0.5 : 1) * (s.buffLeft > 0 ? 1.45 : 1) * slow;
    if (this.gather) speed = 0;
    const moving = (m.x !== 0 || m.y !== 0) && speed > 0;
    if (moving && this.gather) this.gather = null;
    if (moving) {
      this.moveWithCollision(m.x * speed * dt, m.y * speed * dt);
      if (Math.abs(m.x) > Math.abs(m.y) * 0.9) { p.dir = 'side'; p.flip = m.x < 0; } else p.dir = m.y < 0 ? 'up' : 'down';
      p.anim += dt * (speed / BASE_SPEED) * 7.5;
      p.stepT += dt;
      if (p.stepT > 0.33 / (speed / BASE_SPEED)) { p.stepT = 0; this.audio.play('step'); }
    } else p.anim += dt * 1.5;
    p.moving = moving;
    for (let i = this.groundItems.length - 1; i >= 0; i--) {
      const g = this.groundItems[i];
      g.t += dt;
      if (g.t < 0.5 || Math.hypot(g.x - p.x, g.y - p.y) > 26) continue;
      if (!canAdd(s.inv, g.item, g.n)) continue;
      addTo(s.inv, g.item, g.n, g.dur);
      s.gathered[g.item] = (s.gathered[g.item] ?? 0) + g.n;
      this.groundItems.splice(i, 1);
      this.audio.play('pickup');
      this.ui.toast(`+${g.n} ${ITEMS[g.item].name}`, { icon: g.item });
    }
  }
  private moveWithCollision(dx: number, dy: number) {
    const p = this.player;
    const steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 4);
    for (let i = 0; i < steps; i++) { p.x += dx / steps; this.resolve(); p.y += dy / steps; this.resolve(); }
    p.x = clamp(p.x, TILE * 2 + PLAYER_R, WORLD_W - TILE * 2 - PLAYER_R);
    p.y = clamp(p.y, TILE * 2 + PLAYER_R, WORLD_H - TILE * 2 - PLAYER_R);
  }
  private resolve() {
    const p = this.player;
    const tx0 = Math.floor((p.x - PLAYER_R) / TILE), tx1 = Math.floor((p.x + PLAYER_R) / TILE);
    const ty0 = Math.floor((p.y - PLAYER_R) / TILE), ty1 = Math.floor((p.y + PLAYER_R) / TILE);
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      if (inBounds(tx, ty) && !this.map.blocked[idx(tx, ty)]) continue;
      const inset = inBounds(tx, ty) && this.map.ground[idx(tx, ty)] === T.Water ? 2 : 5;
      const bx0 = tx * TILE + inset, bx1 = (tx + 1) * TILE - inset, by0 = ty * TILE + inset, by1 = (ty + 1) * TILE - inset;
      const nx = clamp(p.x, bx0, bx1), ny = clamp(p.y, by0, by1);
      let ddx = p.x - nx, ddy = p.y - ny;
      const d = Math.hypot(ddx, ddy);
      if (d < PLAYER_R) {
        if (d === 0) { ddx = 0; ddy = -1; }
        const push = (PLAYER_R - d) / (d || 1);
        p.x += ddx * push; p.y += ddy * push;
      }
    }
  }

  // ---------- 采集与互动 ----------
  private updateInteraction(dt: number) {
    const p = this.player, s = this.state;
    const fx = p.x, fy = p.y - 6;
    const ad = Math.hypot(this.map.altar.x - p.x, this.map.altar.y - p.y);
    if (!s.altarFound && ad < 270) { s.altarFound = true; this.ui.toast('发现：森林祭坛', { big: true }); this.audio.play('discover'); this.checkQuests(); }

    let best: Game['target'] = null; let bd = 46;
    // 面朝方向的目标优先（键盘 / 触屏玩家无法用鼠标点选具体物件）
    const f = p.dir === 'side' ? { x: p.flip ? -1 : 1, y: 0 } : p.dir === 'up' ? { x: 0, y: -1 } : { x: 0, y: 1 };
    const facing = (x: number, y: number) => { const dx = x - fx, dy = y - fy, l = Math.hypot(dx, dy) || 1; return ((dx * f.x + dy * f.y) / l) * 10; };
    if (!this.build) {
      for (const o of this.harvestables) {
        if (Math.abs(o.x - fx) > 60 || Math.abs(o.y - fy) > 60) continue;
        const big = o.kind === 'tree' || o.kind === 'pine' || o.kind === 'rock';
        const tool = NODES[this.nodeType(o)!].tool;
        const d = Math.hypot(o.x - fx, o.y - (big ? 0 : 6) - fy) - (big ? 6 : 0) + (tool && this.findTool(tool) === null ? 18 : 0) - facing(o.x, o.y);
        if (d < bd && !this.nodeGone(o)) { bd = d; best = { kind: 'node', obj: o }; }
      }
      for (const o of this.steles) { const d = Math.hypot(o.x - fx, o.y - fy); if (d < bd + 4) { bd = d; best = { kind: 'stele', obj: o }; } }
      for (const st of s.structures) { const d = Math.hypot(st.x - fx, st.y - fy) - 16 - facing(st.x, st.y); if (d < bd + 6) { bd = d; best = { kind: 'struct', st }; } }
      if (ad < 92) best = { kind: 'altar', obj: this.altarObj };
    }
    this.target = best;

    if (this.gather) {
      this.gather.t += dt;
      if (this.rnd() < dt * 14) this.renderer.spawnBits(this.gather.node, 1);
      if (this.gather.t >= this.gather.dur) this.finishGather();
    }
    const act = this.input.consumeAction();
    if (act && this.build) { this.confirmBuild(); return; }
    if (act && best && !this.gather) this.interact(best);

    if (this.gather) { this.ui.prompt(null); this.ui.gatherProgress(this.gather.t / this.gather.dur); this.ui.setActLabel('采集中'); return; }
    this.ui.gatherProgress(null);
    if (this.build) { this.ui.prompt(null); this.ui.setActLabel('放置'); return; }
    if (!best) { this.ui.prompt(null); this.ui.setActLabel('互动'); return; }
    let label = '', verb = '互动';
    if (best.kind === 'node') {
      const def = NODES[this.nodeType(best.obj!)!];
      verb = def.verb;
      const lack = def.tool && this.findTool(def.tool) === null;
      label = lack ? `${def.name}（需要${def.tool === 'axe' ? '燧石斧' : '燧石镐'}）` : `${def.verb} ${def.name}`;
    } else if (best.kind === 'stele') { verb = '阅读'; label = '阅读 古老石碑'; }
    else if (best.kind === 'struct') {
      const st = best.st!;
      verb = st.type === 'campfire' ? '篝火' : '打开';
      label = st.type === 'campfire' ? `篝火（${st.fuel ? `燃料 ${Math.ceil(st.fuel)} 秒` : '已熄灭'}）· 添柴 / 烹饪` : '打开 储物箱';
    } else { verb = s.offered >= 3 ? '凝视' : '献上'; label = s.offered >= 3 ? '祭坛正在歌唱' : `献上月光符文（${count(s, 'rune')}/3）`; }
    this.ui.prompt(`<kbd>E</kbd>${label}`);
    this.ui.setActLabel(verb);
  }

  /** 找到可用工具：已装备优先，否则背包中的格子序号 */
  private findTool(tool: 'axe' | 'pickaxe'): 'equipped' | number | null {
    const h = this.state.equip.hand;
    if (h && ITEMS[h.id].tool === tool) return 'equipped';
    const i = this.state.inv.findIndex((sl) => sl && ITEMS[sl.id].tool === tool);
    return i >= 0 ? i : null;
  }

  private interact(t: NonNullable<Game['target']>) {
    const s = this.state;
    if (t.kind === 'node') {
      const def = NODES[this.nodeType(t.obj!)!];
      if (def.tool) {
        const tool = this.findTool(def.tool);
        if (tool === null) { this.ui.toast(`需要先制作「${def.tool === 'axe' ? '燧石斧' : '燧石镐'}」`, { warn: true, icon: def.tool }); this.audio.play('error'); return; }
        if (tool !== 'equipped') this.equipFrom(tool);
      }
      this.gather = { node: t.obj!, t: 0, dur: def.time };
      this.audio.play(def.tool === 'axe' ? 'chop' : def.tool === 'pickaxe' ? 'mine' : 'rustle');
      const dx = t.obj!.x - this.player.x, dy = t.obj!.y - this.player.y;
      if (Math.abs(dx) > Math.abs(dy)) { this.player.dir = 'side'; this.player.flip = dx < 0; } else this.player.dir = dy < 0 ? 'up' : 'down';
    } else if (t.kind === 'stele') {
      const k = t.obj!.stele ?? 0;
      this.ui.toast(STELE_TEXTS[k % STELE_TEXTS.length], { big: true });
      if (!s.steleRead.includes(k)) { s.steleRead.push(k); s.stats.sanity = Math.min(MAX.sanity, s.stats.sanity + 10); this.audio.play('discover'); } else this.audio.play('click');
    } else if (t.kind === 'struct') {
      this.openStation(t.st!);
    } else {
      if (s.offered >= 3) { this.ui.toast('祭坛静静地发着光，迷雾不再回来。'); return; }
      const n = count(s, 'rune');
      if (n >= 3) this.startEnding();
      else { this.ui.toast(`古坛上有三个空着的基座……还需要 ${3 - n} 枚月光符文`, { icon: 'rune' }); this.audio.play('error'); }
    }
  }

  private rollDrops(drops: Drop[]): [ItemId, number][] {
    const out: [ItemId, number][] = [];
    for (const d of drops) {
      if (d.chance !== undefined && this.rnd() > d.chance) continue;
      const n = d.min + Math.floor(this.rnd() * (d.max - d.min + 1));
      if (n > 0) out.push([d.item, n]);
    }
    return out;
  }
  giveOrDrop(item: ItemId, n: number, x: number, y: number) {
    const left = addItem(this.state, item, n);
    if (left > 0) { this.groundItems.push({ id: this.gid++, item, n: left, x: x + (this.rnd() - 0.5) * 20, y: y + 18, t: -3 }); this.ui.toast('背包满了，物品掉在地上', { warn: true }); }
    return n - left;
  }

  private finishGather() {
    const g = this.gather!;
    this.gather = null;
    const s = this.state;
    const def = NODES[this.nodeType(g.node)!];
    for (const [item, n] of this.rollDrops(def.drops)) {
      this.giveOrDrop(item, n, g.node.x, g.node.y);
      s.gathered[item] = (s.gathered[item] ?? 0) + n;
      this.ui.toast(`+${n} ${ITEMS[item].name}`, { icon: item });
    }
    if (def.sanity) s.stats.sanity = Math.min(MAX.sanity, s.stats.sanity + def.sanity);
    s.nodes[g.node.id] = s.time + def.regrow * (0.85 + this.rnd() * 0.3);
    if (g.node.kind === 'tree' || g.node.kind === 'pine' || g.node.kind === 'rock') this.map.blocked[idx(Math.floor(g.node.x / TILE), Math.floor(g.node.y / TILE))] = 0;
    if (def.tool) this.wearHand(1);
    this.renderer.spawnBits(g.node, 10);
    this.audio.play(def.tool === 'axe' ? 'chop' : 'pickup');
    this.checkQuests();
  }

  /** 手持物品按次消耗耐久 */
  private wearHand(n: number) {
    const h = this.state.equip.hand;
    if (!h || ITEMS[h.id].durKind !== 'uses' || h.dur === undefined) return;
    h.dur -= n;
    if (h.dur <= 0) { this.state.equip.hand = null; this.ui.toast(`${ITEMS[h.id].name}坏掉了`, { warn: true, icon: h.id }); this.audio.play('break'); }
  }

  // ---------- 物品使用 / 装备 ----------
  useSlot(i: number) {
    if (this.mode !== 'play') return;
    const s = this.state;
    const sl = s.inv[i];
    if (!sl) return;
    const d = ITEMS[sl.id];
    if (d.food) {
      applyFood(s.stats, d.food);
      sl.n -= 1; if (sl.n <= 0) s.inv[i] = null;
      this.audio.play('eat');
      const f = d.food;
      const parts = [f.hunger ? `饥饿 ${f.hunger > 0 ? '+' : ''}${f.hunger}` : '', f.hp ? `生命 ${f.hp > 0 ? '+' : ''}${f.hp}` : '', f.sanity ? `精神 ${f.sanity > 0 ? '+' : ''}${f.sanity}` : ''].filter(Boolean);
      this.ui.toast(`吃下${d.name}：${parts.join('，')}`, { icon: sl.id });
    } else if (d.equip) this.equipFrom(i);
    else if (sl.id === 'tonic') this.useTonic();
    else this.ui.toast(d.desc, { icon: sl.id });
    this.refreshHud();
  }
  equipFrom(i: number) {
    const s = this.state;
    const sl = s.inv[i];
    if (!sl || !ITEMS[sl.id].equip) return;
    const k = ITEMS[sl.id].equip!;
    const prev = s.equip[k];
    s.equip[k] = sl;
    s.inv[i] = prev;
    this.audio.play('click');
    this.refreshHud();
  }
  unequip(k: 'hand' | 'body') {
    const s = this.state;
    const sl = s.equip[k];
    if (!sl) return;
    const i = s.inv.indexOf(null);
    if (i < 0) { this.ui.toast('背包已满', { warn: true }); return; }
    s.inv[i] = sl; s.equip[k] = null;
    this.audio.play('click');
    this.refreshHud();
  }
  useTonic() {
    const s = this.state;
    if (countIn(s.inv, 'tonic') <= 0) { if (this.mode === 'play') { this.ui.toast('没有雾露药水。可以在「制作 → 生存」中制作。', { warn: true }); this.audio.play('error'); } return; }
    removeItem(s, 'tonic', 1);
    s.buffLeft = 25;
    s.stats.sanity = Math.min(MAX.sanity, s.stats.sanity + 25);
    this.audio.play('potion');
    this.ui.toast('饮下雾露药水：步伐轻盈，目光清明', { icon: 'tonic' });
    this.refreshHud();
  }

  // ---------- 制作 ----------
  doCraft(id: ItemId) {
    const r = RECIPES.find((x) => x.out === id);
    if (!r) return;
    if (r.build) {
      if (!hasCost(this.state, r)) { this.audio.play('error'); return; }
      this.toggleBag(false);
      this.build = { type: r.build, recipe: id, x: this.player.x, y: this.player.y + 50, valid: false, reason: '' };
      this.ui.toast(`选择位置放置${STRUCTURES[r.build].name}`);
      return;
    }
    const res = craft(this.state, id);
    if (res === 'lack' || res === 'none') { this.audio.play('error'); return; }
    this.audio.play('craft');
    this.ui.toast(`制作完成：${ITEMS[id].name}`, { icon: id, big: true });
    if (res === 'full') this.ui.toast('背包已满', { warn: true });
    this.renderer.burst(this.player.x, this.player.y - 20, '#ffe6a8', 16);
    this.checkQuests();
    this.ui.renderCraft(this.state);
    this.refreshHud();
    this.save();
  }

  // ---------- 建造 ----------
  private updateBuild() {
    const b = this.build;
    if (!b) return;
    const p = this.player;
    let x: number, y: number;
    const useMouse = this.time - this.mouse.t < 3 && !this.input.touchUsed;
    if (useMouse) {
      const w = this.renderer.screenToWorld(this.mouse.x, this.mouse.y);
      const d = Math.hypot(w.x - p.x, w.y - p.y), max = 150;
      x = d > max ? p.x + ((w.x - p.x) / d) * max : w.x;
      y = d > max ? p.y + ((w.y - p.y) / d) * max : w.y;
    } else {
      const f = p.dir === 'side' ? { x: p.flip ? -1 : 1, y: 0 } : p.dir === 'up' ? { x: 0, y: -1 } : { x: 0, y: 1 };
      x = p.x + f.x * 54; y = p.y + f.y * 54;
    }
    b.x = Math.floor(x / TILE) * TILE + TILE / 2;
    b.y = Math.floor(y / TILE) * TILE + TILE / 2;
    const r = checkPlacement(b.type, b.x, b.y, this.map, this.state.structures, this.map.objects, p,
      (o) => (o.kind === 'tree' || o.kind === 'pine' || o.kind === 'rock') && this.state.nodes[o.id] !== undefined);
    b.valid = r.valid; b.reason = r.reason;
    this.ui.buildBar(b.valid ? `放置${STRUCTURES[b.type].name}` : r.reason, b.valid);
  }
  confirmBuild() {
    const b = this.build;
    if (!b) return;
    const r = RECIPES.find((x) => x.out === b.recipe)!;
    if (!b.valid) { this.audio.play('error'); this.ui.toast(b.reason || '这里不能建造', { warn: true }); return; }
    if (!hasCost(this.state, r)) { this.audio.play('error'); this.ui.toast('材料不足', { warn: true }); this.cancelBuild(); return; }
    payCost(this.state, r);
    const def = STRUCTURES[b.type];
    const st: Structure = { id: this.state.nextStructId++, type: b.type, x: b.x, y: b.y };
    if (def.maxFuel) st.fuel = def.startFuel;
    if (def.slots) st.slots = new Array(def.slots).fill(null);
    this.state.structures.push(st);
    if (def.blocks) this.map.blocked[idx(Math.floor(b.x / TILE), Math.floor(b.y / TILE))] = 1;
    this.state.built[b.type] = (this.state.built[b.type] ?? 0) + 1;
    this.audio.play(b.type === 'campfire' ? 'fire' : 'build');
    this.renderer.burst(b.x, b.y - 10, b.type === 'campfire' ? '#ffb060' : '#c99a62', 18);
    this.ui.toast(`${def.name}建好了`, { big: true });
    this.build = null; this.ui.buildBar(null);
    this.checkQuests();
    this.refreshHud();
    this.save();
  }
  cancelBuild() { this.build = null; this.ui.buildBar(null); this.audio.play('close'); }

  // ---------- 篝火 / 储物箱 ----------
  private openStation(st: Structure) {
    this.station = st;
    this.renderStation();
    this.ui.show('station');
    this.audio.play('open');
  }
  private renderStation() {
    const st = this.station!;
    if (st.type === 'campfire') this.ui.renderCampfire(this.state, st, STRUCTURES.campfire.maxFuel!);
    else this.ui.renderChest(this.state, st);
  }
  closeStation() { this.station = null; this.ui.hide('station'); this.audio.play('close'); }
  stationCmd(cmd: string, arg: string) {
    const st = this.station, s = this.state;
    if (!st) return;
    if (cmd === 'fuel') {
      const id = arg as ItemId;
      if (!removeItem(s, id, 1)) return;
      const was = st.fuel ?? 0;
      st.fuel = Math.min(STRUCTURES.campfire.maxFuel!, was + (ITEMS[id].fuel ?? 0));
      this.audio.play('fire');
      if (was === 0) this.ui.toast('篝火重新燃起来了');
    } else if (cmd === 'cook') {
      const id = arg as ItemId;
      const to = ITEMS[id].cookTo;
      if (!to || !st.fuel || !removeItem(s, id, 1)) return;
      this.giveOrDrop(to, 1, st.x, st.y);
      this.audio.play('fire');
      this.ui.toast(`烤好了：${ITEMS[to].name}`, { icon: to });
    } else if (cmd === 'take' || cmd === 'store') {
      const i = Number(arg);
      const from = cmd === 'take' ? st.slots! : s.inv, to = cmd === 'take' ? s.inv : st.slots!;
      const sl = from[i];
      if (!sl) return;
      const left = addTo(to, sl.id, sl.n, sl.dur);
      if (left === sl.n) { this.ui.toast(cmd === 'take' ? '背包已满' : '箱子满了', { warn: true }); return; }
      if (left > 0) sl.n = left; else from[i] = null;
      this.audio.play('click');
    }
    this.renderStation();
    this.refreshHud();
  }

  // ---------- 战斗 ----------
  private updateCombat() {
    const p = this.player;
    const wants = this.input.consumeAttack();
    if (!wants || p.atkCd > 0 || this.gather || this.build) return;
    p.atkCd = 0.55; p.attackT = 0.25;
    this.audio.play('swing');
    const reach = 50;
    const f = p.dir === 'side' ? { x: p.flip ? -1 : 1, y: 0 } : p.dir === 'up' ? { x: 0, y: -1 } : { x: 0, y: 1 };
    let best: Creature | null = null, bd = 1e9;
    for (const c of this.creatures) {
      if (c.state === 'leave' || c.hp <= 0) continue;
      const dx = c.x - p.x, dy = c.y - p.y, d = Math.hypot(dx, dy);
      if (d > reach + CREATURES[c.type].radius) continue;
      const facing = (dx * f.x + dy * f.y) / (d || 1);
      const score = d - facing * 20;
      if (facing > -0.3 && score < bd) { bd = score; best = c; }
    }
    if (!best) return;
    const dx = best.x - p.x, dy = best.y - p.y;
    if (Math.abs(dx) > Math.abs(dy)) { p.dir = 'side'; p.flip = dx < 0; } else p.dir = dy < 0 ? 'up' : 'down';
    const h = this.state.equip.hand;
    const dmg = h ? ITEMS[h.id].damage ?? 10 : 10;
    best.hp -= dmg;
    knockback(best, p.x, p.y, 14, this.blockedAt);
    this.audio.play('hit');
    this.renderer.burst(best.x, best.y - 12, '#ffffff', 6);
    if (h && ITEMS[h.id].durKind === 'uses') this.wearHand(1);
    if (best.type === 'rabbit') best.state = 'flee';
    if (best.type === 'wolf' && best.state === 'wander') best.state = 'chase';
    if (best.hp <= 0) this.killCreature(best);
  }
  private killCreature(c: Creature) {
    c.hp = 0;
    this.state.kills++;
    for (const [item, n] of this.rollDrops(CREATURES[c.type].drops)) this.groundItems.push({ id: this.gid++, item, n, x: c.x, y: c.y, t: 0 });
    this.renderer.burst(c.x, c.y - 10, c.type === 'wolf' ? '#a9c3c0' : '#f2f1ea', 14);
    this.ui.toast(`击败了${CREATURES[c.type].name}`);
  }

  // ---------- 生物 ----------
  spawn(type: CreatureType, x: number, y: number) { const c = spawnCreature(type, x, y); c.alpha = 1; this.creatures.push(c); return c; }

  private findSpawnPoint(minD: number, maxD: number, pred: (tx: number, ty: number) => boolean): { x: number; y: number } | null {
    for (let k = 0; k < 20; k++) {
      const a = this.rnd() * Math.PI * 2, d = minD + this.rnd() * (maxD - minD);
      const x = this.player.x + Math.cos(a) * d, y = this.player.y + Math.sin(a) * d;
      const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
      if (tx < 3 || ty < 3 || tx >= MAP_W - 3 || ty >= MAP_H - 3) continue;
      if (this.map.blocked[idx(tx, ty)] || !pred(tx, ty)) continue;
      return { x: tx * TILE + 16, y: ty * TILE + 16 };
    }
    return null;
  }

  private updateCreatures(dt: number) {
    const s = this.state, p = this.player;
    const ph = this.phase();
    this.spawnT.rabbit -= dt;
    if (this.spawnT.rabbit <= 0) {
      this.spawnT.rabbit = 4;
      const n = this.creatures.filter((c) => c.type === 'rabbit').length;
      if (n < 5 && (ph === 'day' || ph === 'dawn')) {
        const pt = this.findSpawnPoint(360, 620, (tx, ty) => { const i = idx(tx, ty); return (this.map.zone[i] === 0 || this.map.zone[i] === 3) && this.map.ground[i] === T.Grass; });
        if (pt) { const c = spawnCreature('rabbit', pt.x, pt.y); this.creatures.push(c); }
      }
    }
    const wolfTime = (ph === 'night' || ph === 'dusk') && this.day() >= 2 && !s.ended;
    if (wolfTime) {
      this.spawnT.wolf -= dt * this.debug.timeScale;
      if (this.spawnT.wolf <= 0) {
        this.spawnT.wolf = 55 + this.rnd() * 35;
        const n = this.creatures.filter((c) => c.type === 'wolf' && c.state !== 'leave').length;
        const pack = Math.min(3 - n, 1 + (this.day() >= 4 ? 1 : 0) + (this.rnd() < 0.3 ? 1 : 0));
        let spawned = 0;
        for (let i = 0; i < pack; i++) {
          const pt = this.findSpawnPoint(480, 640, () => true);
          if (pt) { this.creatures.push(spawnCreature('wolf', pt.x, pt.y)); spawned++; }
        }
        if (spawned) { this.audio.play('howl'); this.ui.toast('远处传来狼嚎……', { warn: true }); }
      }
    } else this.spawnT.wolf = Math.min(this.spawnT.wolf, 25);
    const fires = s.structures.filter((st) => st.type === 'campfire' && st.fuel).map((st) => ({ x: st.x, y: st.y, r: this.fireRadius(st.fuel!) * 0.55 }));
    const ctx = {
      px: p.x, py: p.y, dt, blocked: this.blockedAt, fires, leave: ph === 'day' || ph === 'dawn', rnd: this.rnd,
      onAttack: (c: Creature) => this.hurt(CREATURES[c.type].damage, `被${CREATURES[c.type].name}袭击`),
    };
    this.creatures = this.creatures.filter((c) => {
      if (Math.hypot(c.x - p.x, c.y - p.y) > 1500) return false;
      return updateCreature(c, ctx);
    });
  }

  // ---------- 旅程 ----------
  checkQuests() {
    const done = advanceQuests(this.state, this.day());
    for (const qi of done) {
      this.audio.play('quest');
      this.ui.toast(`旅程完成：${QUESTS[qi].title}`, { big: true });
      const next = QUESTS[qi + 1];
      if (next) setTimeout(() => this.ui.toast(`新的目标：${next.title}`), 1400);
    }
    if (done.length) this.save();
  }

  refreshHud() {
    const s = this.state;
    this.ui.updateQuest(s, this.day());
    this.ui.updateBar(s);
    this.ui.updateStats(s);
    this.ui.drawClock(s.time);
    this.ui.buff(s.buffLeft);
    this.ui.setTouchPotion(countIn(s.inv, 'tonic'));
    this.ui.fx(s.stats.sanity, s.stats.temp, this.hurtFlash, s.stats.hunger);
    this.renderer.drawMinimap();
    if (this.ui.isOpen('bag')) this.ui.renderCraft(s, false);
  }

  // ================= 结局 =================
  private startEnding() {
    removeItem(this.state, 'rune', 3);
    this.state.offered = 3;
    this.checkQuests();
    this.mode = 'cutscene';
    this.cut = { t: 0, from: { x: this.cam.x, y: this.cam.y } };
    this.gather = null;
    this.creatures.forEach((c) => { if (c.type === 'wolf') c.state = 'leave'; });
    this.ui.prompt(null);
    this.ui.hide('hud');
    this.updateTouchVisibility();
    this.audio.play('altar');
    this.audio.musicMood = 'ending';
  }
  private updateCutscene(dt: number) {
    const c = this.cut;
    c.t += dt;
    const k = clamp(c.t / 2.2, 0, 1);
    const e = k * k * (3 - 2 * k);
    this.cam.x = lerp(c.from.x, this.map.altar.x, e);
    this.cam.y = lerp(c.from.y, this.map.altar.y - 20, e);
    this.fog.globalClear = clamp((c.t - 1.4) / 3.2, 0, 1);
    this.fog.dirty = true;
    if (c.t > 1 && this.rnd() < dt * 40) {
      const a = this.rnd() * Math.PI * 2, r = this.rnd() * 120;
      this.particles.push({ x: this.map.altar.x + Math.cos(a) * r, y: this.map.altar.y + Math.sin(a) * r * 0.6, vx: 0, vy: -20 - this.rnd() * 40, life: 2.5, max: 2.5, color: this.rnd() < 0.5 ? '#bff8e8' : '#ffe6a8', size: 2 + this.rnd() * 2, glow: true, grav: -4 });
    }
    if (c.t > 6) {
      this.mode = 'ending';
      this.state.ended = true;
      this.save(true);
      const s = this.state;
      this.ui.showEnding(ENDING_LINES, [
        { label: '存活天数', value: String(this.day()) },
        { label: '探索度', value: `${Math.round(this.fog.exploredPct() * 100)}%` },
        { label: '击败生物', value: String(s.kills) },
        { label: '阅读石碑', value: `${s.steleRead.length}/${STELE_TEXTS.length}` },
      ]);
    }
  }

  have(id: ItemId) { return count(this.state, id); }
}
