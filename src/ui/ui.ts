// UIManager：DOM 界面（菜单、HUD、物品栏、制作、篝火/储物箱、地图、暂停、设置、死亡、结局）
import { ITEMS, type ItemId } from '../data/items';
import { RECIPES, QUESTS, TABS, type RecipeTab } from '../data/world';
import { goalProgress, hasCost, type SaveData, type Settings, type Structure } from '../game/state';
import { MAX } from '../systems/survival';
import { countIn, type Slot } from '../systems/inventory';
import { frac, dayOf, PHASE_RANGES } from '../systems/time';
import type { Assets } from '../art/manifest';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export type UiAction =
  | 'new' | 'continue' | 'howto' | 'close-howto' | 'settings' | 'close-settings' | 'bag' | 'close-bag'
  | 'map' | 'close-map' | 'pause' | 'resume' | 'to-menu' | 'reset-save' | 'confirm-yes' | 'confirm-no' | 'free-roam'
  | 'close-station' | 'restart' | 'to-menu-dead';

export class UI {
  onAction: (a: UiAction) => void = () => {};
  onCraft: (id: ItemId) => void = () => {};
  onSlot: (i: number) => void = () => {};
  onEquipSlot: (slot: 'hand' | 'body') => void = () => {};
  onSettings: (s: Settings) => void = () => {};
  onStation: (cmd: string, arg: string) => void = () => {};
  onBuild: (ok: boolean) => void = () => {};
  private confirmCb: (() => void) | null = null;
  private lastQuestKey = '';
  private tab: RecipeTab = 'tools';
  private barKey = '';

  constructor(private assets: Assets) {
    document.querySelectorAll<HTMLElement>('[data-action]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const a = el.dataset.action as UiAction;
        if (a === 'confirm-yes') { const cb = this.confirmCb; this.hide('confirm'); this.confirmCb = null; cb?.(); return; }
        if (a === 'confirm-no') { this.hide('confirm'); this.confirmCb = null; return; }
        this.onAction(a);
      });
    });
    $('hotbar').addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-slot]');
      if (el) this.onSlot(Number(el.dataset.slot));
    });
    $('eq-hand').addEventListener('click', () => this.onEquipSlot('hand'));
    $('eq-body').addEventListener('click', () => this.onEquipSlot('body'));
    $('build-ok').addEventListener('click', (e) => { e.stopPropagation(); this.onBuild(true); });
    $('build-cancel').addEventListener('click', (e) => { e.stopPropagation(); this.onBuild(false); });
    $('station-body').addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-cmd]');
      if (el && !(el as HTMLButtonElement).disabled) this.onStation(el.dataset.cmd!, el.dataset.arg ?? '');
    });
  }

  show(id: string) { $(id).classList.remove('hidden'); }
  hide(id: string) { $(id).classList.add('hidden'); }
  isOpen(id: string) { return !$(id).classList.contains('hidden'); }
  setContinueEnabled(on: boolean) { ($('btn-continue') as HTMLButtonElement).disabled = !on; }
  setMenuFoot(t: string) { $('menu-foot').textContent = t; }

  confirm(title: string, text: string, cb: () => void) {
    $('confirm-title').textContent = title;
    $('confirm-text').textContent = text;
    this.confirmCb = cb;
    this.show('confirm');
  }

  bindSettings(s: Settings) {
    const m = $<HTMLInputElement>('set-master'), mu = $<HTMLInputElement>('set-music'), sf = $<HTMLInputElement>('set-sfx');
    const tc = $<HTMLSelectElement>('set-touch'), fx = $<HTMLSelectElement>('set-fx');
    m.value = String(s.master); mu.value = String(s.music); sf.value = String(s.sfx); tc.value = s.touch; fx.value = s.fx;
    const emit = () => this.onSettings({ master: +m.value, music: +mu.value, sfx: +sf.value, touch: tc.value as Settings['touch'], fx: fx.value as Settings['fx'] });
    [m, mu, sf].forEach((el) => el.addEventListener('input', emit));
    [tc, fx].forEach((el) => el.addEventListener('change', emit));
  }

  toast(text: string, opts: { icon?: ItemId; big?: boolean; warn?: boolean } = {}) {
    const el = document.createElement('div');
    el.className = 'toast' + (opts.big ? ' big' : '') + (opts.warn ? ' warn' : '');
    if (opts.icon) { const im = document.createElement('img'); im.src = this.assets.icons.get(opts.icon) ?? ''; el.appendChild(im); }
    el.appendChild(document.createTextNode(text));
    const box = $('toasts');
    box.appendChild(el);
    while (box.children.length > 4) box.firstChild!.remove();
    setTimeout(() => el.remove(), 3200);
  }
  prompt(html: string | null) {
    const p = $('prompt');
    if (!html) { p.classList.add('hidden'); return; }
    if (p.innerHTML !== html) p.innerHTML = html;
    p.classList.remove('hidden');
  }
  gatherProgress(t: number | null) {
    const b = $('gather-bar');
    if (t === null) { b.classList.add('hidden'); return; }
    b.classList.remove('hidden');
    $('gather-fill').style.width = `${Math.round(t * 100)}%`;
  }
  buff(sec: number) {
    const b = $('buff');
    if (sec <= 0) { b.classList.add('hidden'); return; }
    b.classList.remove('hidden');
    b.textContent = `雾露药水 · ${Math.ceil(sec)} 秒`;
  }
  flashSaved() { const s = $('save-indicator'); s.classList.add('show'); setTimeout(() => s.classList.remove('show'), 1400); }
  setTouchPotion(n: number) { const b = $('touch-potion'); b.classList.toggle('dim', n <= 0); b.textContent = n > 0 ? `药×${n}` : '药'; }
  setActLabel(t: string) { const b = $('touch-act'); if (b.textContent !== t) b.textContent = t; }
  buildBar(msg: string | null, valid = false) {
    if (msg === null) { this.hide('build-bar'); return; }
    this.show('build-bar');
    $('build-msg').textContent = msg;
    ($('build-ok') as HTMLButtonElement).disabled = !valid;
  }

  // ---------- 生存属性 ----------
  updateStats(s: SaveData) {
    const st = s.stats;
    const set = (id: string, v: number, txt: string) => {
      const el = $(id);
      el.style.setProperty('--v', String(Math.max(0, Math.min(1, v))));
      const b = el.querySelector('b')!;
      if (b.textContent !== txt) b.textContent = txt;
      el.classList.toggle('low', v < 0.25);
    };
    set('g-hp', st.hp / MAX.hp, String(Math.ceil(st.hp)));
    set('g-hunger', st.hunger / MAX.hunger, String(Math.ceil(st.hunger)));
    set('g-sanity', st.sanity / MAX.sanity, String(Math.ceil(st.sanity)));
    set('g-temp', (st.temp + 10) / 80, `${Math.round(st.temp)}°`);
    $('g-temp').classList.toggle('low', st.temp < 6 || st.temp > 64);
  }

  drawClock(t: number) {
    const c = $<HTMLCanvasElement>('clock');
    const g = c.getContext('2d')!;
    const W = c.width, R = W / 2 - 4, cx = W / 2;
    g.clearRect(0, 0, W, W);
    const seg = (a0: number, a1: number, col: string) => {
      g.fillStyle = col; g.beginPath(); g.moveTo(cx, cx);
      g.arc(cx, cx, R, -Math.PI / 2 + a0 * Math.PI * 2, -Math.PI / 2 + a1 * Math.PI * 2); g.closePath(); g.fill();
    };
    const P = PHASE_RANGES;
    seg(0, P.DAWN_END, '#c9907a');
    seg(P.DAWN_END, P.DAY_END, '#e8c46a');
    seg(P.DAY_END, P.DUSK_END, '#c9792f');
    seg(P.DUSK_END, P.NIGHT_END, '#27345a');
    seg(P.NIGHT_END, 1, '#c9907a');
    g.fillStyle = '#0e1c18'; g.beginPath(); g.arc(cx, cx, R * 0.52, 0, Math.PI * 2); g.fill();
    const a = -Math.PI / 2 + frac(t) * Math.PI * 2;
    g.strokeStyle = '#fff6dc'; g.lineWidth = 4; g.lineCap = 'round';
    g.beginPath(); g.moveTo(cx, cx); g.lineTo(cx + Math.cos(a) * R, cx + Math.sin(a) * R); g.stroke();
    g.strokeStyle = 'rgba(242,196,109,.6)'; g.lineWidth = 3; g.beginPath(); g.arc(cx, cx, R + 1, 0, Math.PI * 2); g.stroke();
    const day = `第 ${dayOf(t)} 天`;
    if ($('clock-day').textContent !== day) $('clock-day').textContent = day;
  }

  fx(sanity: number, temp: number, hurt: number, hunger: number) {
    const o = $('fx-overlay');
    const insane = Math.max(0, 1 - sanity / (MAX.sanity * 0.3));
    const cold = Math.max(0, Math.min(1, (6 - temp) / 8));
    const starving = hunger <= 0 ? 0.5 : 0;
    const shadows: string[] = [];
    if (cold > 0) shadows.push(`inset 0 0 ${80 + cold * 120}px rgba(170,220,255,${0.25 + cold * 0.35})`);
    if (insane > 0) shadows.push(`inset 0 0 ${100 + insane * 160}px rgba(60,20,90,${0.35 + insane * 0.45})`);
    if (starving) shadows.push('inset 0 0 120px rgba(140,80,20,.35)');
    if (hurt > 0) shadows.push(`inset 0 0 160px rgba(200,30,20,${Math.min(0.75, hurt * 2.5)})`);
    o.style.boxShadow = shadows.join(',') || 'none';
  }

  // ---------- 旅程 ----------
  updateQuest(s: SaveData, day: number) {
    const qi = s.questIdx;
    const q = QUESTS[qi];
    const key = q ? `${qi}|` + q.goals.map((g) => goalProgress(s, g, day)).join(',') : `done|${s.ended}`;
    if (key === this.lastQuestKey) return;
    const changed = this.lastQuestKey.split('|')[0] !== key.split('|')[0];
    this.lastQuestKey = key;
    if (!q) {
      $('quest-title').textContent = s.ended ? '迷雾已散' : '唤醒祭坛';
      $('quest-desc').textContent = s.ended ? '森林恢复了清明。继续生存下去，看看你能活多少天。' : '';
      $('quest-goals').innerHTML = '';
    } else {
      $('quest-title').textContent = q.title;
      $('quest-desc').textContent = q.desc;
      $('quest-goals').innerHTML = q.goals.map((g) => {
        const p = goalProgress(s, g, day);
        const done = p >= g.count;
        const right = g.type === 'reach' ? (done ? '已找到' : '') : g.type === 'survive' ? `第 ${Math.min(day, g.count)}/${g.count} 天` : `${p}/${g.count}`;
        return `<li class="${done ? 'done' : ''}"><span>${g.label}</span><span>${right}</span></li>`;
      }).join('');
    }
    if (changed) { const c = $('quest'); c.classList.remove('quest-flash'); void c.offsetWidth; c.classList.add('quest-flash'); }
  }

  // ---------- 物品栏 ----------
  private slotHtml(sl: Slot | null, attrs: string, key?: string) {
    if (!sl) return `<div class="hb" ${attrs}>${key ? `<span class="key">${key}</span>` : ''}</div>`;
    const d = ITEMS[sl.id];
    let dur = '';
    if (d.durability && sl.dur !== undefined) {
      const f = Math.max(0, sl.dur / d.durability);
      dur = `<div class="dur ${f < 0.2 ? 'low' : f < 0.5 ? 'mid' : ''}"><i style="width:${Math.round(f * 100)}%"></i></div>`;
    }
    const cnt = d.stack > 1 ? `<span class="cnt">${sl.n}</span>` : '';
    return `<div class="hb" ${attrs} title="${d.name}">${key ? `<span class="key">${key}</span>` : ''}<img src="${this.assets.icons.get(sl.id)}" alt="${d.name}"/>${cnt}${dur}</div>`;
  }
  updateBar(s: SaveData) {
    const key = JSON.stringify([s.inv, s.equip]);
    if (key === this.barKey) return;
    this.barKey = key;
    $('hotbar').innerHTML = s.inv.map((sl, i) => this.slotHtml(sl, `data-slot="${i}"`, i < 10 ? String((i + 1) % 10) : undefined)).join('');
    for (const k of ['hand', 'body'] as const) {
      const el = $(`eq-${k}`);
      const sl = s.equip[k];
      // 复用格子 HTML 的内部内容（图标 + 耐久条）
      const inner = sl ? this.slotHtml(sl, '').replace(/^<div[^>]*>/, '').replace(/<\/div>$/, '') : '';
      el.innerHTML = `<span class="eq-lbl">${k === 'hand' ? '手' : '身'}</span>` + inner;
      el.title = sl ? `${ITEMS[sl.id].name}（点击卸下）` : (k === 'hand' ? '手持' : '身体');
    }
  }

  // ---------- 制作 ----------
  renderCraft(s: SaveData) {
    $('craft-tabs').innerHTML = TABS.map((t) => `<button class="tab${t.id === this.tab ? ' on' : ''}" data-tab="${t.id}">${t.name}</button>`).join('');
    $('craft-tabs').querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.addEventListener('click', () => { this.tab = b.dataset.tab as RecipeTab; this.renderCraft(s); }));
    const rec = $('recipes');
    rec.innerHTML = RECIPES.filter((r) => r.tab === this.tab).map((r) => {
      const it = ITEMS[r.out];
      const ok = hasCost(s, r);
      const cost = Object.entries(r.cost).map(([k, v]) => {
        const have = countIn(s.inv, k as ItemId);
        return `<span class="${have >= (v ?? 0) ? 'have' : 'lack'}"><img src="${this.assets.icons.get(k)}" alt=""/>${ITEMS[k as ItemId].name} ${have}/${v}</span>`;
      }).join('');
      return `<div class="recipe${ok ? ' ready' : ''}">
        <img class="main" src="${this.assets.icons.get(r.out)}" alt="${it.name}"/>
        <div><div class="r-name">${it.name}${r.n > 1 ? ` ×${r.n}` : ''}</div><div class="r-desc">${it.desc}</div><div class="r-cost">${cost}</div></div>
        <button class="btn${ok ? ' btn-primary' : ''}" data-craft="${r.out}" ${ok ? '' : 'disabled'}>${r.build ? '建造' : '制作'}</button>
      </div>`;
    }).join('');
    rec.querySelectorAll<HTMLButtonElement>('[data-craft]').forEach((b) => b.addEventListener('click', () => this.onCraft(b.dataset.craft as ItemId)));
  }

  // ---------- 篝火 / 储物箱 ----------
  renderCampfire(s: SaveData, st: Structure, maxFuel: number) {
    $('station-title').textContent = '篝火';
    const fuels = (['log', 'twigs', 'grass'] as ItemId[]).filter((id) => countIn(s.inv, id) > 0);
    const raws = (Object.keys(ITEMS) as ItemId[]).filter((id) => ITEMS[id].cookTo && countIn(s.inv, id) > 0);
    const lit = (st.fuel ?? 0) > 0;
    const row = (id: ItemId, label: string, cmd: string, btn: string, disabled = false) =>
      `<div class="act-row"><img src="${this.assets.icons.get(id)}" alt=""/><span>${label}</span><button class="btn btn-primary" data-cmd="${cmd}" data-arg="${id}" ${disabled ? 'disabled' : ''}>${btn}</button></div>`;
    $('station-body').innerHTML = `<div class="station-grid">
      <div><h3>燃料</h3>
        <div class="muted small">${lit ? `还能燃烧约 ${Math.ceil(st.fuel!)} 秒` : '火已经熄灭，添加燃料重新点燃'}</div>
        <div class="fuel"><i style="width:${Math.round(((st.fuel ?? 0) / maxFuel) * 100)}%"></i></div>
        <div class="act-list">${fuels.length ? fuels.map((id) => row(id, `${ITEMS[id].name} ×${countIn(s.inv, id)}（+${ITEMS[id].fuel} 秒）`, 'fuel', '添柴')).join('') : '<p class="muted">没有可以烧的东西。木头、树枝、干草都能当燃料。</p>'}</div>
      </div>
      <div><h3>烹饪</h3>
        <div class="act-list">${raws.length ? raws.map((id) => row(id, `${ITEMS[id].name} ×${countIn(s.inv, id)} → ${ITEMS[ITEMS[id].cookTo!].name}`, 'cook', '烹饪', !lit)).join('') : '<p class="muted">背包里没有可以烹饪的食物。</p>'}</div>
        ${!lit && raws.length ? '<p class="muted small">需要先点燃篝火。</p>' : ''}
      </div></div>`;
  }

  renderChest(s: SaveData, st: Structure) {
    $('station-title').textContent = '储物箱';
    const grid = (slots: (Slot | null)[], cmd: string) => `<div class="grid6">${slots.map((sl, i) => {
      if (!sl) return '<div class="slot empty"></div>';
      const d = ITEMS[sl.id];
      return `<div class="slot" data-cmd="${cmd}" data-arg="${i}" title="${d.name}"><img src="${this.assets.icons.get(sl.id)}" alt="${d.name}"/><span class="cnt">${d.stack > 1 ? sl.n : ''}</span></div>`;
    }).join('')}</div>`;
    $('station-body').innerHTML = `<div class="station-grid">
      <div><h3>储物箱</h3>${grid(st.slots ?? [], 'take')}<p class="muted small">点击物品取回背包</p></div>
      <div><h3>背包</h3>${grid(s.inv, 'store')}<p class="muted small">点击物品放进箱子</p></div></div>`;
  }

  // ---------- 死亡 / 结局 ----------
  showDeath(text: string, stats: { label: string; value: string }[]) {
    $('death-text').textContent = text;
    $('death-stats').innerHTML = stats.map((s) => `<div><b>${s.value}</b>${s.label}</div>`).join('');
    this.show('death');
  }
  showEnding(lines: string[], stats: { label: string; value: string }[]) {
    $('ending-text').innerHTML = lines.map((l, i) => `<p style="animation-delay:${0.8 + i * 1.3}s">${l}</p>`).join('');
    $('ending-stats').innerHTML = stats.map((s) => `<div><b>${s.value}</b>${s.label}</div>`).join('');
    this.show('ending');
  }
  fade(on: boolean) { $('fade').classList.toggle('on', on); }
}
