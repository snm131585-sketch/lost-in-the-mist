// DOM UI：菜单、HUD、行囊（背包+制作）、地图、暂停、设置、结局、提示
import { ITEMS, ITEM_ORDER, RECIPES, QUESTS, type ItemId } from '../game/data';
import { canCraft, count, goalProgress, type SaveData, type Settings } from '../game/state';
import type { Assets } from '../art/manifest';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export type UiAction =
  | 'new' | 'continue' | 'howto' | 'close-howto' | 'settings' | 'close-settings' | 'bag' | 'close-bag'
  | 'map' | 'close-map' | 'pause' | 'resume' | 'to-menu' | 'reset-save' | 'confirm-yes' | 'confirm-no' | 'free-roam';

export class UI {
  onAction: (a: UiAction) => void = () => {};
  onCraft: (id: ItemId) => void = () => {};
  onUse: (id: ItemId) => void = () => {};
  onSettings: (s: Settings) => void = () => {};
  private selected: ItemId | null = null;
  private confirmCb: (() => void) | null = null;
  private lastQuestKey = '';
  private hotbarCounts = new Map<string, number>();

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
  }

  show(id: string) { $(id).classList.remove('hidden'); }
  hide(id: string) { $(id).classList.add('hidden'); }
  isOpen(id: string) { return !$(id).classList.contains('hidden'); }

  setContinueEnabled(on: boolean) { ($('btn-continue') as HTMLButtonElement).disabled = !on; }

  confirm(title: string, text: string, cb: () => void) {
    $('confirm-title').textContent = title;
    $('confirm-text').textContent = text;
    this.confirmCb = cb;
    this.show('confirm');
  }

  // ---------- 设置 ----------
  bindSettings(s: Settings) {
    const m = $<HTMLInputElement>('set-master'), mu = $<HTMLInputElement>('set-music'), sf = $<HTMLInputElement>('set-sfx');
    const tc = $<HTMLSelectElement>('set-touch'), fx = $<HTMLSelectElement>('set-fx');
    m.value = String(s.master); mu.value = String(s.music); sf.value = String(s.sfx); tc.value = s.touch; fx.value = s.fx;
    const emit = () => this.onSettings({ master: +m.value, music: +mu.value, sfx: +sf.value, touch: tc.value as Settings['touch'], fx: fx.value as Settings['fx'] });
    [m, mu, sf].forEach((el) => el.addEventListener('input', emit));
    [tc, fx].forEach((el) => el.addEventListener('change', emit));
  }

  // ---------- 提示 ----------
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
  flashSaved() {
    const s = $('save-indicator');
    s.classList.add('show');
    setTimeout(() => s.classList.remove('show'), 1400);
  }
  setTouchPotion(n: number) {
    const b = $('touch-potion');
    b.classList.toggle('dim', n <= 0);
    b.textContent = n > 0 ? `药×${n}` : '药';
  }

  // ---------- HUD ----------
  updateQuest(s: SaveData) {
    const qi = s.questIdx;
    const q = QUESTS[qi];
    const key = q ? `${qi}|` + q.goals.map((g) => goalProgress(s, g)).join(',') : `done|${s.ended}`;
    if (key === this.lastQuestKey) return;
    const changedQuest = this.lastQuestKey.split('|')[0] !== key.split('|')[0];
    this.lastQuestKey = key;
    if (!q) {
      $('quest-title').textContent = s.ended ? '迷雾已散' : '唤醒祭坛';
      $('quest-desc').textContent = s.ended ? '森林恢复了清明。你可以自由漫步，看看迷雾散去后的风景。' : '';
      $('quest-goals').innerHTML = '';
    } else {
      $('quest-title').textContent = q.title;
      $('quest-desc').textContent = q.desc;
      $('quest-goals').innerHTML = q.goals.map((g) => {
        const p = goalProgress(s, g);
        const done = p >= g.count;
        const right = g.type === 'reach' ? (done ? '已找到' : '') : `${p}/${g.count}`;
        return `<li class="${done ? 'done' : ''}"><span>${g.label}</span><span>${right}</span></li>`;
      }).join('');
    }
    if (changedQuest) {
      const card = $('quest');
      card.classList.remove('quest-flash'); void card.offsetWidth; card.classList.add('quest-flash');
    }
  }

  updateHotbar(s: SaveData) {
    const hb = $('hotbar');
    const shown: ItemId[] = ITEM_ORDER.filter((id) => count(s, id) > 0);
    const key = shown.map((id) => `${id}:${count(s, id)}`).join('|');
    if (hb.dataset.key === key) return;
    hb.dataset.key = key;
    hb.innerHTML = shown.map((id) => {
      const n = count(s, id);
      const prev = this.hotbarCounts.get(id) ?? 0;
      const bump = n > prev ? ' bump' : '';
      return `<div class="hb${bump}" title="${ITEMS[id].name}"><img src="${this.assets.icons.get(id)}" alt="${ITEMS[id].name}"/>${ITEMS[id].kind === 'tool' ? '' : `<span class="cnt">${n}</span>`}</div>`;
    }).join('');
    this.hotbarCounts.clear();
    shown.forEach((id) => this.hotbarCounts.set(id, count(s, id)));
  }

  // ---------- 行囊 ----------
  renderBag(s: SaveData) {
    const grid = $('inv-grid');
    const items = ITEM_ORDER.filter((id) => count(s, id) > 0);
    const slots = Math.max(12, Math.ceil(items.length / 4) * 4);
    let html = '';
    for (let i = 0; i < slots; i++) {
      const id = items[i];
      if (!id) { html += '<div class="slot empty"></div>'; continue; }
      const it = ITEMS[id];
      html += `<div class="slot${this.selected === id ? ' sel' : ''}" data-item="${id}" title="${it.name}"><img src="${this.assets.icons.get(id)}" alt="${it.name}"/><span class="cnt">${it.kind === 'tool' ? '' : count(s, id)}</span></div>`;
    }
    grid.innerHTML = html;
    grid.querySelectorAll<HTMLElement>('[data-item]').forEach((el) => el.addEventListener('click', () => {
      this.selected = el.dataset.item as ItemId;
      this.renderBag(s);
    }));
    const det = $('inv-detail');
    if (this.selected && count(s, this.selected) > 0) {
      const it = ITEMS[this.selected];
      const kindLabel = { material: '材料', tool: '工具 · 持有即生效', consumable: '消耗品', key: '关键物品' }[it.kind];
      det.innerHTML = `<b>${it.name}</b> <span class="small">· ${kindLabel}</span><br/>${it.desc}` +
        (it.kind === 'consumable' ? `<br/><button class="btn use-btn" id="use-item">使用</button>` : '');
      const ub = document.getElementById('use-item');
      ub?.addEventListener('click', () => this.onUse(this.selected!));
    } else {
      det.innerHTML = items.length ? '选择一件物品查看说明' : '行囊还是空的。靠近发光的东西按 <kbd>E</kbd> 采集。';
    }

    const rec = $('recipes');
    rec.innerHTML = RECIPES.map((r) => {
      const it = ITEMS[r.id];
      const st = canCraft(s, r);
      const owned = r.unique && count(s, r.id) > 0;
      const cost = Object.entries(r.cost).map(([k, v]) => {
        const have = count(s, k as ItemId);
        return `<span class="${have >= (v ?? 0) ? 'have' : 'lack'}"><img src="${this.assets.icons.get(k)}" alt=""/>${ITEMS[k as ItemId].name} ${have}/${v}</span>`;
      }).join('');
      return `<div class="recipe${st.ok ? ' ready' : ''}">
        <img class="main" src="${this.assets.icons.get(r.id)}" alt="${it.name}"/>
        <div><div class="r-name">${it.name}</div><div class="r-desc">${it.desc}</div><div class="r-cost">${cost}</div></div>
        <button class="btn${st.ok ? ' btn-primary' : ''}" data-craft="${r.id}" ${st.ok ? '' : 'disabled'}>${owned ? '已拥有' : '制作'}</button>
      </div>`;
    }).join('');
    rec.querySelectorAll<HTMLButtonElement>('[data-craft]').forEach((b) => b.addEventListener('click', () => this.onCraft(b.dataset.craft as ItemId)));
  }

  // ---------- 结局 ----------
  showEnding(lines: string[], stats: { label: string; value: string }[]) {
    $('ending-text').innerHTML = lines.map((l, i) => `<p style="animation-delay:${0.8 + i * 1.3}s">${l}</p>`).join('');
    $('ending-stats').innerHTML = stats.map((s) => `<div><b>${s.value}</b>${s.label}</div>`).join('');
    this.show('ending');
  }

  fade(on: boolean) { $('fade').classList.toggle('on', on); }
}
