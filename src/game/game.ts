// 游戏主控：场景状态机、世界模拟、渲染管线
import { Input } from '../engine/input';
import { AudioEngine } from '../engine/audio';
import { clamp, lerp, mulberry32 } from '../engine/math';
import { Assets, SFX_OVERRIDES } from '../art/manifest';
import { makeCanvas, type Dir } from '../art/painters';
import { generateMap, TILE, MAP_W, MAP_H, idx, inBounds, type WorldMap, type WorldObj } from '../world/map';
import { bakeGround, CHUNK, type GroundLayer } from '../world/ground';
import { Fog, FW, FH } from '../world/fog';
import { ITEMS, RESOURCES, QUESTS, STELE_TEXTS, ENDING_LINES, type ItemId } from './data';
import {
  newState, loadSave, writeSave, clearSave, addItem, count, craft, advanceQuests,
  loadSettings, saveSettings, type SaveData, type Settings,
} from './state';
import { UI, type UiAction } from '../ui/ui';

type Mode = 'menu' | 'play' | 'cutscene' | 'ending';

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number; glow: boolean; grav: number }
interface Puff { x: number; y: number; vx: number; img: number; s: number }
interface Fly { x: number; y: number; ph: number; sp: number }

const WORLD_W = MAP_W * TILE, WORLD_H = MAP_H * TILE;
const BASE_SPEED = 128;
const PLAYER_R = 8;

export class Game {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  dpr = 1; viewW = 0; viewH = 0; zoom = 1;
  assets = new Assets();
  map!: WorldMap;
  ground!: GroundLayer;
  fog = new Fog();
  audio = new AudioEngine();
  input = new Input();
  ui: UI;
  settings: Settings = loadSettings();
  mode: Mode = 'menu';
  state!: SaveData;

  player = { x: 0, y: 0, dir: 'down' as Dir, flip: false, anim: 0, moving: false, stepT: 0 };
  cam = { x: 0, y: 0 };
  private resources: WorldObj[] = [];
  private steles: WorldObj[] = [];
  private altarObj!: WorldObj;
  private particles: Particle[] = [];
  private puffs: Puff[] = [];
  private flies: Fly[] = [];
  private gather: { node: WorldObj; t: number; dur: number } | null = null;
  private target: { kind: 'res' | 'stele' | 'altar'; obj: WorldObj } | null = null;
  private time = 0;
  private last = 0;
  private saveTimer = 0;
  private hudTimer = 0;
  private fogTimer = 0;
  private cut = { t: 0, from: { x: 0, y: 0 } };
  private light!: HTMLCanvasElement;
  private lg!: CanvasRenderingContext2D;
  private menuT = 0;
  private fogMask!: HTMLCanvasElement;
  private rnd = mulberry32(99);
  private flySprite = (() => {
    const [c, g] = makeCanvas(16, 16);
    const gr = g.createRadialGradient(8, 8, 0, 8, 8, 8);
    gr.addColorStop(0, 'rgba(230,255,180,.45)'); gr.addColorStop(1, 'rgba(230,255,180,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 16, 16);
    return c;
  })();

  constructor() {
    this.canvas = document.getElementById('game') as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d')!;
    this.ui = new UI(this.assets);
  }

  // ================= 启动 =================
  async boot() {
    this.assets.buildProcedural();
    await this.assets.loadOverrides();
    this.map = generateMap();
    this.ground = bakeGround(this.map, this.assets);
    for (const o of this.map.objects) {
      if (o.kind === 'resource') this.resources.push(o);
      else if (o.kind === 'stele') this.steles.push(o);
      else if (o.kind === 'altar') this.altarObj = o;
    }
    const [l, lg] = makeCanvas(4, 4);
    this.light = l; this.lg = lg;
    const [fm] = makeCanvas(FW, FH);
    this.fogMask = fm;
    for (let i = 0; i < 16; i++) this.puffs.push({ x: this.rnd() * 1400, y: this.rnd() * 1000, vx: 6 + this.rnd() * 10, img: i % 4, s: 1.2 + this.rnd() * 1.4 });
    for (let i = 0; i < 46; i++) this.flies.push({ x: this.rnd() * 1600, y: this.rnd() * 1000, ph: this.rnd() * 10, sp: 0.5 + this.rnd() });

    this.state = newState(this.map.start);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 200));

    this.bindUi();
    this.input.bindTouch(
      document.getElementById('stick-zone')!, document.getElementById('stick-base')!, document.getElementById('stick-knob')!,
      document.getElementById('touch-act')!, document.getElementById('touch-potion')!,
    );
    // 首次用户手势解锁音频
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
    this.light.width = this.canvas.width; this.light.height = this.canvas.height;
    // 视野：短边约 13~15 个瓦片
    const short = Math.min(this.viewW, this.viewH);
    this.zoom = clamp(short / (13 * TILE), 0.9, 2.0);
    this.updateTouchVisibility();
  }

  // ================= UI 绑定 =================
  private bindUi() {
    const ui = this.ui;
    ui.bindSettings(this.settings);
    ui.onSettings = (s) => { this.settings = s; saveSettings(s); this.applyAudioSettings(); this.updateTouchVisibility(); };
    ui.onCraft = (id) => this.doCraft(id);
    ui.onUse = (id) => { if (id === 'tonic') this.useTonic(); };
    ui.onAction = (a) => this.handleAction(a);
    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (k === 'escape' || k === 'p') this.onEscape(k);
      else if (this.mode === 'play' && (k === 'b' || k === 'tab')) { e.preventDefault(); this.toggleBag(); }
      else if (this.mode === 'play' && k === 'm') this.toggleMap();
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
      case 'to-menu': this.save(); this.ui.hide('pause'); this.ui.hide('ending'); this.enterMenu(); break;
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
    for (const id of ['confirm', 'howto', 'settings', 'bag', 'bigmap']) {
      if (this.ui.isOpen(id)) {
        if (id === 'bag') this.toggleBag(false); else if (id === 'bigmap') this.toggleMap(false); else this.ui.hide(id);
        return;
      }
    }
    if (this.mode !== 'play') return;
    if (k === 'p' || k === 'escape') this.pause(!this.ui.isOpen('pause'));
  }

  private modalOpen() {
    return ['pause', 'bag', 'bigmap', 'settings', 'howto', 'confirm'].some((id) => this.ui.isOpen(id));
  }

  pause(on: boolean) {
    if (this.mode !== 'play') return;
    if (on) { this.ui.show('pause'); this.save(); this.audio.play('open'); }
    else { this.ui.hide('pause'); this.audio.play('close'); }
  }
  toggleBag(force?: boolean) {
    const open = force ?? !this.ui.isOpen('bag');
    if (open) { this.ui.renderBag(this.state); this.ui.show('bag'); this.audio.play('open'); }
    else if (this.ui.isOpen('bag')) { this.ui.hide('bag'); this.audio.play('close'); }
  }
  toggleMap(force?: boolean) {
    const open = force ?? !this.ui.isOpen('bigmap');
    if (open) { this.drawBigMap(); this.ui.show('bigmap'); this.audio.play('open'); }
    else if (this.ui.isOpen('bigmap')) { this.ui.hide('bigmap'); this.audio.play('close'); }
  }

  private applyAudioSettings() {
    const s = this.settings;
    this.audio.setVolumes(s.master / 100, s.music / 100, s.sfx / 100);
  }
  private updateTouchVisibility() {
    const s = this.settings.touch;
    const coarse = window.matchMedia?.('(pointer: coarse)').matches;
    const on = s === 'on' || (s === 'auto' && (coarse || this.input.touchUsed));
    document.body.classList.toggle('touch-on', on && this.mode === 'play');
    const t = document.getElementById('touch')!;
    t.classList.toggle('hidden', !(on && this.mode === 'play'));
  }

  // ================= 场景切换 =================
  enterMenu() {
    this.mode = 'menu';
    this.audio.musicMood = 'menu';
    this.ui.hide('hud'); this.ui.hide('ending'); this.ui.hide('bag'); this.ui.hide('bigmap');
    this.ui.show('menu');
    this.ui.setContinueEnabled(!!loadSave());
    this.updateTouchVisibility();
    this.fog.reset();
    this.fog.globalClear = 0.62;
    this.menuT = 0;
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
      this.particles = []; this.gather = null;
      this.mode = 'play';
      this.audio.musicMood = 'forest';
      this.ui.hide('menu'); this.ui.show('hud');
      this.updateTouchVisibility();
      this.fog.reveal(this.player.x, this.player.y - 8, this.visionRadius());
      this.refreshHud(true);
      this.ui.fade(false);
      if (!saved) setTimeout(() => this.ui.toast('你在迷雾中醒来……', { big: true }), 500);
      else this.ui.toast('欢迎回来，拾荒者', { big: true });
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

  // ================= 主循环 =================
  private frame(now: number) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    try {
      this.update(dt);
      this.render();
    } catch (err) {
      console.error(err);
    }
    this.input.endFrame();
    requestAnimationFrame((t) => this.frame(t));
  }

  private update(dt: number) {
    if (this.mode === 'menu') {
      this.menuT += dt;
      // 主菜单：镜头沿林间缓慢漂移
      const t = this.menuT * 0.035;
      this.cam.x = WORLD_W / 2 + Math.sin(t) * 700;
      this.cam.y = WORLD_H * 0.55 + Math.sin(t * 0.7 + 1) * 420;
      this.fog.dirty = true;
      this.updateAmbient(dt);
      return;
    }
    if (this.mode === 'cutscene') { this.updateCutscene(dt); this.updateAmbient(dt); return; }
    if (this.mode === 'ending') {
      this.cam.x = lerp(this.cam.x, this.map.altar.x + Math.sin(this.time * 0.1) * 200, dt * 0.5);
      this.cam.y = lerp(this.cam.y, this.map.altar.y + 120, dt * 0.5);
      this.updateAmbient(dt);
      return;
    }

    // ---- play ----
    const paused = this.modalOpen();
    this.input.enabled = !paused;
    if (!paused) {
      this.state.playTime += dt;
      this.updatePlayer(dt);
      this.updateInteraction(dt);
      if (this.input.wasPressed('q') || this.input.potionTap) this.useTonic();
      if (this.state.buffLeft > 0) { this.state.buffLeft = Math.max(0, this.state.buffLeft - dt); }
      this.saveTimer += dt;
      if (this.saveTimer > 20) this.save();
    }
    this.updateAmbient(dt);
    // 摄像机平滑跟随
    const k = 1 - Math.pow(0.0015, dt);
    this.cam.x = lerp(this.cam.x, this.player.x, k);
    this.cam.y = lerp(this.cam.y, this.player.y - 10, k);
    const hw = this.viewW / this.zoom / 2, hh = this.viewH / this.zoom / 2;
    this.cam.x = clamp(this.cam.x, hw, WORLD_W - hw);
    this.cam.y = clamp(this.cam.y, hh, WORLD_H - hh);

    this.fogTimer += dt;
    if (this.fogTimer > 0.06) { this.fogTimer = 0; this.fog.reveal(this.player.x, this.player.y - 8, this.visionRadius()); }
    this.hudTimer += dt;
    if (this.hudTimer > 0.25) { this.hudTimer = 0; this.refreshHud(); }
  }

  visionRadius() {
    let r = 140;
    if (count(this.state, 'lantern') > 0) r = 235;
    if (this.state.buffLeft > 0) r += 60;
    return r;
  }

  private updatePlayer(dt: number) {
    const p = this.player;
    const m = this.input.move();
    let speed = BASE_SPEED * (m.slow ? 0.5 : 1) * (this.state.buffLeft > 0 ? 1.45 : 1);
    if (this.gather) speed = 0;
    const moving = (m.x !== 0 || m.y !== 0) && speed > 0;
    if (moving && this.gather) this.gather = null;
    if (moving) {
      this.moveWithCollision(m.x * speed * dt, m.y * speed * dt);
      if (Math.abs(m.x) > Math.abs(m.y) * 0.9) { p.dir = 'side'; p.flip = m.x < 0; }
      else p.dir = m.y < 0 ? 'up' : 'down';
      p.anim += dt * (speed / BASE_SPEED) * 7.5;
      p.stepT += dt;
      if (p.stepT > 0.33 / (speed / BASE_SPEED)) { p.stepT = 0; this.audio.play('step'); }
    } else {
      p.anim += dt * 1.5;
    }
    p.moving = moving;
  }

  private moveWithCollision(dx: number, dy: number) {
    const p = this.player;
    const steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 4);
    for (let s = 0; s < steps; s++) {
      p.x += dx / steps; this.resolve();
      p.y += dy / steps; this.resolve();
    }
    p.x = clamp(p.x, TILE * 2 + PLAYER_R, WORLD_W - TILE * 2 - PLAYER_R);
    p.y = clamp(p.y, TILE * 2 + PLAYER_R, WORLD_H - TILE * 2 - PLAYER_R);
  }
  private resolve() {
    const p = this.player;
    const tx0 = Math.floor((p.x - PLAYER_R) / TILE), tx1 = Math.floor((p.x + PLAYER_R) / TILE);
    const ty0 = Math.floor((p.y - PLAYER_R) / TILE), ty1 = Math.floor((p.y + PLAYER_R) / TILE);
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      if (inBounds(tx, ty) && !this.map.blocked[idx(tx, ty)]) continue;
      // 树干/岩石的碰撞盒略小于瓦片，走位更顺滑
      const inset = inBounds(tx, ty) && this.map.ground[idx(tx, ty)] === 2 ? 2 : 5;
      const bx0 = tx * TILE + inset, bx1 = (tx + 1) * TILE - inset;
      const by0 = ty * TILE + inset, by1 = (ty + 1) * TILE - inset;
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

  private nodeAvailable(o: WorldObj) {
    const r = this.state.nodes[o.id];
    if (r === undefined) return true;
    if (this.state.playTime >= r) { delete this.state.nodes[o.id]; return true; }
    return false;
  }

  private updateInteraction(dt: number) {
    const p = this.player;
    const fx = p.x, fy = p.y - 6;
    // 祭坛发现
    const ad = Math.hypot(this.map.altar.x - p.x, this.map.altar.y - p.y);
    if (!this.state.altarFound && ad < 270) {
      this.state.altarFound = true;
      this.ui.toast('发现：森林祭坛', { big: true });
      this.audio.play('discover');
      this.checkQuests();
    }
    // 寻找最近的可互动目标
    let best: Game['target'] = null; let bd = 46;
    for (const o of this.resources) {
      const d = Math.hypot(o.x - fx, o.y - 6 - fy);
      if (d < bd && this.nodeAvailable(o)) { bd = d; best = { kind: 'res', obj: o }; }
    }
    for (const o of this.steles) {
      const d = Math.hypot(o.x - fx, o.y - fy);
      if (d < bd + 4) { bd = d; best = { kind: 'stele', obj: o }; }
    }
    if (ad < 92) best = { kind: 'altar', obj: this.altarObj };
    this.target = best;

    // 采集进度
    if (this.gather) {
      this.gather.t += dt;
      if (Math.random() < dt * 14) this.spawnBits(this.gather.node, 1);
      if (this.gather.t >= this.gather.dur) this.finishGather();
    }

    const act = this.input.consumeAction();
    if (act && best && !this.gather) this.interact(best);

    // 提示
    const actBtn = document.getElementById('touch-act')!;
    if (this.gather) { this.ui.prompt(null); this.ui.gatherProgress(this.gather.t / this.gather.dur); actBtn.textContent = '采集中'; }
    else {
      this.ui.gatherProgress(null);
      if (best) {
        let label = '', verb = '互动';
        if (best.kind === 'res') {
          const def = RESOURCES[best.obj.res!];
          verb = def.kind === 'crystal' ? '开采' : '采集';
          const lack = def.needs && count(this.state, def.needs) === 0;
          label = lack ? `${def.name}（需要${ITEMS[def.needs!].name}）` : `${verb} ${def.name}`;
        } else if (best.kind === 'stele') { verb = '阅读'; label = '阅读 古老石碑'; }
        else { verb = this.state.offered >= 3 ? '凝视' : '献上'; label = this.state.offered >= 3 ? '祭坛正在歌唱' : `献上月光符文（${count(this.state, 'rune')}/3）`; }
        this.ui.prompt(`<kbd>E</kbd>${label}`);
        actBtn.textContent = verb;
      } else { this.ui.prompt(null); actBtn.textContent = '采集'; }
    }
  }

  private interact(t: NonNullable<Game['target']>) {
    if (t.kind === 'res') {
      const def = RESOURCES[t.obj.res!];
      if (def.needs && count(this.state, def.needs) === 0) {
        this.ui.toast(`需要先制作「${ITEMS[def.needs].name}」`, { warn: true, icon: def.needs });
        this.audio.play('error');
        return;
      }
      this.gather = { node: t.obj, t: 0, dur: def.gatherTime };
      this.audio.play(def.kind === 'crystal' ? 'gather' : 'rustle');
      // 面向目标
      const dx = t.obj.x - this.player.x, dy = t.obj.y - this.player.y;
      if (Math.abs(dx) > Math.abs(dy)) { this.player.dir = 'side'; this.player.flip = dx < 0; } else this.player.dir = dy < 0 ? 'up' : 'down';
    } else if (t.kind === 'stele') {
      const k = t.obj.stele ?? 0;
      this.ui.toast(STELE_TEXTS[k % STELE_TEXTS.length], { big: true });
      if (!this.state.steleRead.includes(k)) { this.state.steleRead.push(k); this.audio.play('discover'); }
      else this.audio.play('click');
    } else {
      if (this.state.offered >= 3) { this.ui.toast('祭坛静静地发着光，迷雾不再回来。'); return; }
      const n = count(this.state, 'rune');
      if (n >= 3) this.startEnding();
      else { this.ui.toast(`古坛上有三个空着的基座……还需要 ${3 - n} 枚月光符文`, { icon: 'rune' }); this.audio.play('error'); }
    }
  }

  private finishGather() {
    const g = this.gather!;
    this.gather = null;
    const def = RESOURCES[g.node.res!];
    const n = def.yield[0] + Math.floor(Math.random() * (def.yield[1] - def.yield[0] + 1));
    addItem(this.state, def.item, n);
    this.state.gathered[def.item] = (this.state.gathered[def.item] ?? 0) + n;
    this.state.nodes[g.node.id] = this.state.playTime + def.respawn;
    this.spawnBits(g.node, 10);
    this.audio.play('pickup');
    this.ui.toast(`+${n} ${ITEMS[def.item].name}`, { icon: def.item });
    this.checkQuests();
    this.refreshHud();
  }

  doCraft(id: ItemId) {
    if (!craft(this.state, id)) { this.audio.play('error'); return; }
    this.audio.play('craft');
    this.ui.toast(`制作完成：${ITEMS[id].name}`, { icon: id, big: true });
    if (id === 'lantern') setTimeout(() => this.ui.toast('灯笼亮起来了，视野变得开阔'), 600);
    for (let i = 0; i < 18; i++) this.particles.push({ x: this.player.x, y: this.player.y - 20, vx: (Math.random() - 0.5) * 80, vy: -30 - Math.random() * 60, life: 1, max: 1, color: '#ffe6a8', size: 2, glow: true, grav: 40 });
    this.checkQuests();
    this.ui.renderBag(this.state);
    this.refreshHud();
    this.save();
  }

  useTonic() {
    if (count(this.state, 'tonic') <= 0) { if (this.mode === 'play') { this.ui.toast('没有雾露药水。可以在行囊中制作。', { warn: true }); this.audio.play('error'); } return; }
    addItem(this.state, 'tonic', -1);
    this.state.buffLeft = 25;
    this.audio.play('potion');
    this.ui.toast('饮下雾露药水：步伐轻盈，目光清明', { icon: 'tonic' });
    if (this.ui.isOpen('bag')) this.ui.renderBag(this.state);
    this.refreshHud();
  }

  private checkQuests() {
    const done = advanceQuests(this.state);
    for (const qi of done) {
      const q = QUESTS[qi];
      this.audio.play('quest');
      this.ui.toast(`任务完成：${q.title}`, { big: true });
      const next = QUESTS[qi + 1];
      if (next) setTimeout(() => this.ui.toast(`新任务：${next.title}`), 1400);
    }
    if (done.length) this.save();
  }

  refreshHud(force = false) {
    void force;
    this.ui.updateQuest(this.state);
    this.ui.updateHotbar(this.state);
    this.ui.buff(this.state.buffLeft);
    this.ui.setTouchPotion(count(this.state, 'tonic'));
    this.drawMinimap();
  }

  // ================= 结局 =================
  private startEnding() {
    addItem(this.state, 'rune', -3);
    this.state.offered = 3;
    this.checkQuests();
    this.mode = 'cutscene';
    this.cut = { t: 0, from: { x: this.cam.x, y: this.cam.y } };
    this.gather = null;
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
    if (c.t > 1 && Math.random() < dt * 40) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * 120;
      this.particles.push({ x: this.map.altar.x + Math.cos(a) * r, y: this.map.altar.y + Math.sin(a) * r * 0.6, vx: 0, vy: -20 - Math.random() * 40, life: 2.5, max: 2.5, color: Math.random() < 0.5 ? '#bff8e8' : '#ffe6a8', size: 2 + Math.random() * 2, glow: true, grav: -4 });
    }
    if (c.t > 6) {
      this.mode = 'ending';
      this.state.ended = true;
      this.save(true);
      const mins = Math.floor(this.state.playTime / 60), secs = Math.floor(this.state.playTime % 60);
      const gathered = Object.values(this.state.gathered).reduce((a, b) => a + (b ?? 0), 0);
      this.ui.showEnding(ENDING_LINES, [
        { label: '旅程时长', value: `${mins}:${String(secs).padStart(2, '0')}` },
        { label: '探索度', value: `${Math.round(this.fog.exploredPct() * 100)}%` },
        { label: '拾取材料', value: String(gathered) },
        { label: '阅读石碑', value: `${this.state.steleRead.length}/${STELE_TEXTS.length}` },
      ]);
    }
  }

  // ================= 环境与粒子 =================
  private spawnBits(o: WorldObj, n: number) {
    const col = { branch: '#c99a62', mushroom: '#9ff5d6', crystal: '#cfe0ff', lily: '#e8f4ff' }[o.res!] ?? '#fff';
    for (let i = 0; i < n; i++) {
      this.particles.push({ x: o.x + (Math.random() - 0.5) * 16, y: o.y - 10, vx: (Math.random() - 0.5) * 70, vy: -40 - Math.random() * 60, life: 0.8, max: 0.8, color: col, size: 1.5 + Math.random() * 1.5, glow: o.res !== 'branch', grav: 160 });
    }
  }

  private updateAmbient(dt: number) {
    for (const p of this.particles) { p.life -= dt; p.vy += p.grav * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
    this.particles = this.particles.filter((p) => p.life > 0);
    if (this.particles.length > 400) this.particles.splice(0, this.particles.length - 400);
    const hw = this.viewW / this.zoom / 2 + 200, hh = this.viewH / this.zoom / 2 + 160;
    for (const m of this.puffs) {
      m.x += m.vx * dt;
      if (m.x - this.cam.x > hw) m.x -= hw * 2;
      if (m.x - this.cam.x < -hw) m.x += hw * 2;
      if (m.y - this.cam.y > hh) m.y -= hh * 2;
      if (m.y - this.cam.y < -hh) m.y += hh * 2;
    }
    for (const f of this.flies) {
      f.ph += dt * f.sp;
      f.x += Math.cos(f.ph * 1.3) * 12 * dt;
      f.y += Math.sin(f.ph) * 9 * dt;
      if (f.x - this.cam.x > hw) f.x -= hw * 2;
      if (f.x - this.cam.x < -hw) f.x += hw * 2;
      if (f.y - this.cam.y > hh) f.y -= hh * 2;
      if (f.y - this.cam.y < -hh) f.y += hh * 2;
    }
  }

  // ================= 渲染 =================
  private render() {
    const g = this.ctx;
    const z = this.zoom * this.dpr;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#0b1714';
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const vw = this.viewW / this.zoom, vh = this.viewH / this.zoom;
    const left = this.cam.x - vw / 2, top = this.cam.y - vh / 2;
    // 像素对齐防抖
    const ox = Math.round(-left * z) / z, oy = Math.round(-top * z) / z;
    g.setTransform(z, 0, 0, z, ox * z, oy * z);
    g.imageSmoothingEnabled = true;

    // 地面
    const c0 = Math.max(0, Math.floor(left / CHUNK)), c1 = Math.min(this.ground.cols - 1, Math.floor((left + vw) / CHUNK));
    const r0 = Math.max(0, Math.floor(top / CHUNK)), r1 = Math.min(this.ground.rows - 1, Math.floor((top + vh) / CHUNK));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) g.drawImage(this.ground.chunks[r * this.ground.cols + c], c * CHUNK, r * CHUNK);

    this.drawWater(g, left, top, vw, vh);

    // 祭坛光晕
    if (this.state.offered >= 3 || this.mode === 'cutscene') {
      const a = this.map.altar;
      const pulse = 0.75 + Math.sin(this.time * 2) * 0.1;
      const gr = g.createRadialGradient(a.x, a.y, 10, a.x, a.y, 190);
      gr.addColorStop(0, `rgba(190,255,230,${0.35 * pulse})`); gr.addColorStop(1, 'rgba(190,255,230,0)');
      g.fillStyle = gr; g.fillRect(a.x - 200, a.y - 200, 400, 400);
    }

    // y 排序的物体
    const list: { y: number; draw: () => void }[] = [];
    const margin = 140;
    const p = this.player;
    const inPlay = this.mode !== 'menu';
    for (const o of this.map.objects) {
      if (o.x < left - margin || o.x > left + vw + margin || o.y < top - 40 || o.y > top + vh + 170) continue;
      list.push({ y: o.y, draw: () => this.drawObj(g, o, inPlay) });
    }
    if (inPlay) list.push({ y: p.y, draw: () => this.drawPlayer(g) });
    list.sort((a, b) => a.y - b.y);
    for (const it of list) it.draw();

    // 粒子
    for (const pt of this.particles) {
      const a = clamp(pt.life / pt.max, 0, 1);
      if (pt.glow) {
        g.globalCompositeOperation = 'lighter';
        g.fillStyle = pt.color; g.globalAlpha = a * 0.35;
        g.beginPath(); g.arc(pt.x, pt.y, pt.size * 3, 0, Math.PI * 2); g.fill();
      }
      g.globalAlpha = a;
      g.fillStyle = pt.color;
      g.beginPath(); g.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2); g.fill();
      g.globalCompositeOperation = 'source-over';
    }
    g.globalAlpha = 1;

    // 迷雾（世界坐标，低分辨率网格平滑放大）
    if (this.fog.globalClear < 1) {
      this.fog.render();
      g.imageSmoothingQuality = 'high';
      g.drawImage(this.fog.canvas, 0, 0, WORLD_W, WORLD_H);
      // 飘动的雾团
      const low = this.settings.fx === 'low';
      for (let i = 0; i < this.puffs.length; i += low ? 2 : 1) {
        const m = this.puffs[i];
        const dens = this.fog.densityAt(m.x, m.y);
        const a = 0.06 + dens * 0.9;
        if (a < 0.05) continue;
        const img = this.assets.get(`mist.${m.img}`);
        g.globalAlpha = a * (1 - this.fog.globalClear);
        g.drawImage(img, m.x - (img.width * m.s) / 2, m.y - (img.height * m.s) / 2, img.width * m.s, img.height * m.s);
      }
      g.globalAlpha = 1;
    }

    // 萤火虫
    g.globalCompositeOperation = 'lighter';
    const nf = this.settings.fx === 'low' ? 16 : this.flies.length;
    for (let i = 0; i < nf; i++) {
      const f = this.flies[i];
      const tw = 0.5 + 0.5 * Math.sin(this.time * 3 + f.ph * 4);
      g.globalAlpha = tw;
      g.drawImage(this.flySprite, f.x - 8, f.y - 8);
      g.globalAlpha = 1;
      g.fillStyle = `rgba(240,255,200,${0.8 * tw})`;
      g.beginPath(); g.arc(f.x, f.y, 1.4, 0, Math.PI * 2); g.fill();
    }
    g.globalCompositeOperation = 'source-over';

    // 屏幕空间光照
    this.drawLighting(left, top);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(this.light, 0, 0);

    if (this.mode === 'play') this.drawQuestArrow(g, left, top);
  }

  private drawWater(g: CanvasRenderingContext2D, left: number, top: number, vw: number, vh: number) {
    const tx0 = Math.max(0, Math.floor(left / TILE)), tx1 = Math.min(MAP_W - 1, Math.floor((left + vw) / TILE));
    const ty0 = Math.max(0, Math.floor(top / TILE)), ty1 = Math.min(MAP_H - 1, Math.floor((top + vh) / TILE));
    g.strokeStyle = 'rgba(200,235,230,.16)';
    g.lineWidth = 1.4;
    g.lineCap = 'round';
    g.beginPath();
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      if (this.map.ground[idx(tx, ty)] !== 2) continue;
      const h = (tx * 73856093) ^ (ty * 19349663);
      const ph = (h & 255) / 40;
      const s = Math.sin(this.time * 1.2 + ph);
      if (s < 0.2) continue;
      const x = tx * TILE + ((h >> 8) & 15) + 4, y = ty * TILE + ((h >> 12) & 15) + 8;
      const w = 6 + s * 6;
      g.moveTo(x, y); g.quadraticCurveTo(x + w / 2, y - 2, x + w, y);
    }
    g.stroke();
  }

  private drawObj(g: CanvasRenderingContext2D, o: WorldObj, inPlay: boolean) {
    const p = this.player;
    switch (o.kind) {
      case 'tree': case 'pine': {
        const img = this.assets.get(`${o.kind}.${o.variant}`);
        const behind = inPlay && p.y < o.y - 4 && p.y > o.y - 120 && Math.abs(p.x - o.x) < (o.kind === 'tree' ? 46 : 30);
        // 风吹微摆
        const sway = Math.sin(this.time * 0.8 + o.id) * 0.012;
        g.save();
        g.translate(o.x, o.y);
        g.transform(1, 0, sway, 1, 0, 0);
        if (behind) g.globalAlpha = 0.5;
        g.drawImage(img, -img.width / 2, -img.height + 10);
        g.restore();
        break;
      }
      case 'rock': { const img = this.assets.get(`rock.${o.variant}`); g.drawImage(img, o.x - img.width / 2, o.y - img.height + 8); break; }
      case 'bush': { const img = this.assets.get(`bush.${o.variant}`); g.drawImage(img, o.x - img.width / 2, o.y - img.height + 8); break; }
      case 'stele': {
        const img = this.assets.get(`stele.${o.variant}`);
        g.drawImage(img, o.x - img.width / 2, o.y - img.height + 8);
        if (this.target?.obj === o) this.highlight(g, img, o.x - img.width / 2, o.y - img.height + 8);
        break;
      }
      case 'altar': {
        const lit = this.state.offered >= 3 || (this.mode === 'cutscene' && this.cut.t > 1);
        const key = lit ? 'altar.mono.lit' : 'altar.mono.0';
        const img = this.assets.get(key);
        g.drawImage(img, o.x - img.width / 2, o.y - img.height + 34);
        break;
      }
      case 'resource': {
        const avail = !inPlay || this.nodeAvailable(o);
        const img = this.assets.get(`res.${o.res}.${o.variant}${avail ? '' : '.empty'}`);
        const x = o.x - img.width / 2, y = o.y - img.height + 8;
        if (avail && (o.res === 'mushroom' || o.res === 'crystal')) {
          const pulse = 0.6 + 0.4 * Math.sin(this.time * 2 + o.id);
          const col = o.res === 'mushroom' ? '159,245,214' : '169,194,238';
          const gr = g.createRadialGradient(o.x, o.y - 12, 2, o.x, o.y - 12, 34);
          gr.addColorStop(0, `rgba(${col},${0.35 * pulse})`); gr.addColorStop(1, `rgba(${col},0)`);
          g.globalCompositeOperation = 'lighter';
          g.fillStyle = gr; g.fillRect(o.x - 36, o.y - 48, 72, 72);
          g.globalCompositeOperation = 'source-over';
        }
        g.drawImage(img, x, y);
        if (avail && inPlay) {
          // 微光闪烁，提示可采集
          const tw = Math.sin(this.time * 3 + o.id * 1.7);
          if (tw > 0.7) {
            g.globalCompositeOperation = 'lighter';
            g.fillStyle = `rgba(255,240,200,${(tw - 0.7) * 2})`;
            const sx = o.x + Math.sin(o.id) * 10, sy = o.y - 18 + Math.cos(o.id) * 6;
            g.beginPath(); g.moveTo(sx, sy - 4); g.lineTo(sx + 1, sy - 1); g.lineTo(sx + 4, sy); g.lineTo(sx + 1, sy + 1); g.lineTo(sx, sy + 4); g.lineTo(sx - 1, sy + 1); g.lineTo(sx - 4, sy); g.lineTo(sx - 1, sy - 1); g.closePath(); g.fill();
            g.globalCompositeOperation = 'source-over';
          }
        }
        if (this.target?.obj === o) this.highlight(g, img, x, y);
        if (this.gather?.node === o) {
          const sh = Math.sin(this.time * 40) * 1.2;
          g.globalAlpha = 0.5; g.drawImage(img, x + sh, y); g.globalAlpha = 1;
        }
        break;
      }
    }
  }

  private highlight(g: CanvasRenderingContext2D, img: CanvasImageSource, x: number, y: number) {
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 0.22 + Math.sin(this.time * 5) * 0.08;
    g.drawImage(img, x, y);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  private drawPlayer(g: CanvasRenderingContext2D) {
    const p = this.player;
    // 影子
    g.fillStyle = 'rgba(6,12,14,.45)';
    g.beginPath(); g.ellipse(p.x, p.y + 1, 11, 4.5, 0, 0, Math.PI * 2); g.fill();
    const frame = p.moving ? Math.floor(p.anim) % 4 : 4 + (Math.floor(p.anim) % 5 === 0 ? 1 : 0);
    const img = this.assets.get(`player.${p.dir}.${frame}`);
    const hasLantern = count(this.state, 'lantern') > 0;
    const drawLantern = () => {
      if (!hasLantern) return;
      const side = p.dir === 'side' ? (p.flip ? -1 : 1) : 1;
      const swing = Math.sin(p.anim * (p.moving ? 1.6 : 0.6)) * (p.moving ? 3 : 1);
      const lx = p.x + (p.dir === 'side' ? side * 10 : 11) + swing * 0.4, ly = p.y - 16 + Math.abs(swing) * 0.3;
      g.strokeStyle = '#3a2a1e'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(lx, ly - 8); g.lineTo(lx, ly - 4); g.stroke();
      g.fillStyle = '#5a3c26'; g.fillRect(lx - 3.5, ly - 5, 7, 2); g.fillRect(lx - 3.5, ly + 5, 7, 2);
      const fl = 0.85 + Math.sin(this.time * 13) * 0.08 + Math.sin(this.time * 7.3) * 0.07;
      g.fillStyle = `rgba(255,226,150,${fl})`; g.fillRect(lx - 3, ly - 3, 6, 8);
      g.globalCompositeOperation = 'lighter';
      const gr = g.createRadialGradient(lx, ly, 1, lx, ly, 30);
      gr.addColorStop(0, `rgba(255,210,130,${0.5 * fl})`); gr.addColorStop(1, 'rgba(255,210,130,0)');
      g.fillStyle = gr; g.fillRect(lx - 30, ly - 30, 60, 60);
      g.globalCompositeOperation = 'source-over';
    };
    if (p.dir === 'up') drawLantern();
    g.save();
    g.translate(p.x, p.y);
    if (p.dir === 'side' && p.flip) g.scale(-1, 1);
    g.drawImage(img, -img.width / 2, -img.height + 4);
    g.restore();
    if (p.dir !== 'up') drawLantern();
    if (this.state.buffLeft > 0 && Math.random() < 0.3) {
      this.particles.push({ x: p.x + (Math.random() - 0.5) * 14, y: p.y - Math.random() * 30, vx: 0, vy: -20, life: 0.7, max: 0.7, color: '#bfeff0', size: 1.4, glow: true, grav: -10 });
    }
  }

  private drawLighting(left: number, top: number) {
    const l = this.lg;
    const W = this.light.width, H = this.light.height;
    const z = this.zoom * this.dpr;
    l.setTransform(1, 0, 0, 1, 0, 0);
    l.globalCompositeOperation = 'source-over';
    l.clearRect(0, 0, W, H);
    const clear = this.fog.globalClear;
    const dark = this.mode === 'menu' ? 0.38 : lerp(0.5, 0.12, clear);
    l.fillStyle = `rgba(4,10,18,${dark})`;
    l.fillRect(0, 0, W, H);
    l.globalCompositeOperation = 'destination-out';
    const hole = (wx: number, wy: number, r: number, s = 1) => {
      const sx = (wx - left) * z, sy = (wy - top) * z, sr = r * z;
      if (sx < -sr || sy < -sr || sx > W + sr || sy > H + sr) return;
      const gr = l.createRadialGradient(sx, sy, 0, sx, sy, sr);
      gr.addColorStop(0, `rgba(0,0,0,${s})`); gr.addColorStop(0.6, `rgba(0,0,0,${s * 0.55})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
      l.fillStyle = gr;
      l.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
    };
    if (this.mode !== 'menu') hole(this.player.x, this.player.y - 14, this.visionRadius() * 1.25);
    const vw = this.viewW / this.zoom, vh = this.viewH / this.zoom;
    for (const o of this.resources) {
      if ((o.res !== 'mushroom' && o.res !== 'crystal') || o.x < left - 60 || o.x > left + vw + 60 || o.y < top - 60 || o.y > top + vh + 60) continue;
      if (this.mode !== 'menu' && !this.nodeAvailable(o)) continue;
      hole(o.x, o.y - 12, 54, 0.7);
    }
    if (this.state.offered >= 3 || this.mode === 'cutscene') hole(this.map.altar.x, this.map.altar.y, 330, 0.9);
    // 暗角
    l.globalCompositeOperation = 'source-over';
    const vg = l.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, `rgba(2,6,10,${this.mode === 'menu' ? 0.65 : 0.45})`);
    l.fillStyle = vg; l.fillRect(0, 0, W, H);
  }

  private questTarget(): { x: number; y: number } | null {
    const q = QUESTS[this.state.questIdx];
    if (!q || !q.hint) return null;
    if (q.hint === 'altar') return this.map.altar;
    // 月光矿脉：在西北与东北之间选较近的一个
    if (q.id === 'ore') {
      const a = { x: 20 * TILE, y: 16 * TILE }, b = { x: 76 * TILE, y: 16 * TILE };
      return Math.hypot(a.x - this.player.x, a.y - this.player.y) < Math.hypot(b.x - this.player.x, b.y - this.player.y) ? a : b;
    }
    return { x: q.hint.x * TILE, y: q.hint.y * TILE };
  }

  private drawQuestArrow(g: CanvasRenderingContext2D, left: number, top: number) {
    const t = this.questTarget();
    if (!t) return;
    const z = this.zoom;
    const sx = (t.x - left) * z, sy = (t.y - top) * z;
    const W = this.viewW, H = this.viewH;
    const pad = 70;
    const onScreen = sx > pad && sy > pad && sx < W - pad && sy < H - pad;
    if (onScreen && Math.hypot(t.x - this.player.x, t.y - this.player.y) < 200) return;
    const cx = W / 2, cy = H / 2;
    const ang = Math.atan2(sy - cy, sx - cx);
    const rx = W / 2 - pad, ry = H / 2 - pad;
    const k = Math.min(rx / Math.abs(Math.cos(ang) || 1e-6), ry / Math.abs(Math.sin(ang) || 1e-6));
    const ax = onScreen ? sx : cx + Math.cos(ang) * k, ay = onScreen ? sy - 30 : cy + Math.sin(ang) * k;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.save();
    g.translate(ax, ay);
    g.rotate(onScreen ? Math.PI / 2 : ang);
    const bob = Math.sin(this.time * 4) * 3;
    g.translate(bob, 0);
    g.fillStyle = 'rgba(242,196,109,.9)';
    g.strokeStyle = 'rgba(20,12,4,.6)'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(14, 0); g.lineTo(-6, -9); g.lineTo(-2, 0); g.lineTo(-6, 9); g.closePath(); g.fill(); g.stroke();
    g.restore();
    g.setTransform(1, 0, 0, 1, 0, 0);
  }

  // ================= 地图 =================
  private buildFogMask(): HTMLCanvasElement {
    const fm = this.fogMask;
    const g = fm.getContext('2d')!;
    const img = g.createImageData(FW, FH);
    const ex = this.fog.explored;
    const clear = this.state.ended ? 1 : 0;
    for (let i = 0; i < FW * FH; i++) {
      img.data[i * 4] = 70; img.data[i * 4 + 1] = 88; img.data[i * 4 + 2] = 96;
      img.data[i * 4 + 3] = (1 - ex[i] / 255) * 235 * (1 - clear);
    }
    g.putImageData(img, 0, 0);
    return fm;
  }

  private drawMarkers(g: CanvasRenderingContext2D, sc: number) {
    // 祭坛
    if (this.state.altarFound || this.state.ended) {
      const a = this.map.altar;
      g.fillStyle = this.state.offered >= 3 ? '#bff8e8' : '#f2c46d';
      g.beginPath(); g.moveTo(a.x * sc, a.y * sc - 6); g.lineTo(a.x * sc + 5, a.y * sc + 4); g.lineTo(a.x * sc - 5, a.y * sc + 4); g.closePath(); g.fill();
    }
    // 任务目标
    const t = this.questTarget();
    if (t) {
      g.strokeStyle = 'rgba(242,196,109,.85)'; g.lineWidth = 1.5;
      g.setLineDash([3, 3]);
      g.beginPath(); g.arc(t.x * sc, t.y * sc, 7 + Math.sin(this.time * 3) * 1.5, 0, Math.PI * 2); g.stroke();
      g.setLineDash([]);
    }
    // 玩家
    g.fillStyle = '#fff3cf';
    g.strokeStyle = '#7a4a1a'; g.lineWidth = 1.2;
    g.beginPath(); g.arc(this.player.x * sc, this.player.y * sc, 3.5, 0, Math.PI * 2); g.fill(); g.stroke();
  }

  private drawMinimap() {
    const c = document.getElementById('minimap') as HTMLCanvasElement | null;
    if (!c || this.mode !== 'play') return;
    const g = c.getContext('2d')!;
    const sc = c.width / WORLD_W;
    g.clearRect(0, 0, c.width, c.height);
    g.imageSmoothingEnabled = true;
    g.drawImage(this.ground.minimapBase, 0, 0, c.width, c.height);
    g.drawImage(this.buildFogMask(), 0, 0, c.width, c.height);
    this.drawMarkers(g, sc);
  }

  drawBigMap() {
    const c = document.getElementById('bigmap-canvas') as HTMLCanvasElement;
    const g = c.getContext('2d')!;
    const sc = c.width / WORLD_W;
    g.clearRect(0, 0, c.width, c.height);
    g.imageSmoothingEnabled = true;
    g.drawImage(this.ground.minimapBase, 0, 0, c.width, c.height);
    // 树冠点
    g.fillStyle = 'rgba(18,40,32,.55)';
    for (const o of this.map.objects) if (o.kind === 'tree' || o.kind === 'pine') { g.beginPath(); g.arc(o.x * sc, o.y * sc - 6, o.kind === 'tree' ? 6 : 4, 0, Math.PI * 2); g.fill(); }
    g.drawImage(this.buildFogMask(), 0, 0, c.width, c.height);
    for (const o of this.steles) {
      if (this.fog.densityAt(o.x, o.y) > 0.6 && !this.state.ended) continue;
      g.fillStyle = this.state.steleRead.includes(o.stele ?? -1) ? '#a9c3c0' : '#e9e4cf';
      g.fillRect(o.x * sc - 2, o.y * sc - 4, 4, 7);
    }
    this.drawMarkers(g, sc);
    const pct = document.getElementById('explore-pct');
    if (pct) pct.textContent = `· 已探索 ${Math.round(this.fog.exploredPct() * 100)}%`;
  }
}
