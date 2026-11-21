// 游戏状态 v2、制作、旅程进度、存档（SaveSystem / CraftingSystem 逻辑部分）
import { ITEMS, type ItemId } from '../data/items';
import { RECIPES, QUESTS, type Goal, type Recipe, type StructureType } from '../data/world';
import { INV_SIZE, addTo, countIn, removeFrom, type Slots, type Equipment } from '../systems/inventory';
import { newStats, type Stats } from '../systems/survival';
import { newWeather, type WeatherState } from '../systems/weather';
import { START_TIME } from '../systems/time';

export interface Structure { id: number; type: StructureType; x: number; y: number; fuel?: number; slots?: Slots }

export interface SaveData {
  version: 2;
  player: { x: number; y: number; dir: string };
  stats: Stats;
  inv: Slots;
  equip: Equipment;
  time: number;
  weather: WeatherState;
  gathered: Partial<Record<ItemId, number>>;
  crafted: Partial<Record<ItemId, number>>;
  built: Partial<Record<StructureType, number>>;
  questIdx: number;
  altarFound: boolean;
  offered: number;
  nodes: Record<number, number>;          // 资源节点 id → 重生时刻（游戏时间）
  structures: Structure[];
  nextStructId: number;
  steleRead: number[];
  playTime: number;
  kills: number;
  fog: string;
  ended: boolean;
  buffLeft: number;
  savedAt: number;
}

export const SAVE_KEY = 'litm.save.v2';
export const OLD_SAVE_KEY = 'litm.save.v1';
export const SETTINGS_KEY = 'litm.settings.v1';

export function newState(start: { x: number; y: number }): SaveData {
  return {
    version: 2,
    player: { x: start.x, y: start.y, dir: 'down' },
    stats: newStats(),
    inv: new Array(INV_SIZE).fill(null),
    equip: { hand: null, body: null },
    time: START_TIME,
    weather: newWeather(),
    gathered: {}, crafted: {}, built: {},
    questIdx: 0, altarFound: false, offered: 0,
    nodes: {}, structures: [], nextStructId: 1,
    steleRead: [], playTime: 0, kills: 0, fog: '', ended: false, buffLeft: 0, savedAt: 0,
  };
}

export const count = (s: SaveData, id: ItemId) =>
  countIn(s.inv, id) + (s.equip.hand?.id === id ? 1 : 0) + (s.equip.body?.id === id ? 1 : 0);

export function addItem(s: SaveData, id: ItemId, n: number): number { return addTo(s.inv, id, n); }
export function removeItem(s: SaveData, id: ItemId, n: number): boolean { return removeFrom(s.inv, id, n); }

export function hasCost(s: SaveData, r: Recipe): boolean {
  return Object.entries(r.cost).every(([k, v]) => countIn(s.inv, k as ItemId) >= (v ?? 0));
}
export function payCost(s: SaveData, r: Recipe) {
  for (const [k, v] of Object.entries(r.cost)) removeFrom(s.inv, k as ItemId, v ?? 0);
}

/** 制作非建筑物品；返回结果 */
export function craft(s: SaveData, id: ItemId): 'ok' | 'lack' | 'full' | 'none' {
  const r = RECIPES.find((x) => x.out === id && !x.build);
  if (!r) return 'none';
  if (!hasCost(s, r)) return 'lack';
  payCost(s, r);
  const left = addTo(s.inv, id, r.n);
  s.crafted[id] = (s.crafted[id] ?? 0) + r.n;
  return left > 0 ? 'full' : 'ok';
}

export function goalProgress(s: SaveData, g: Goal, day: number): number {
  switch (g.type) {
    case 'gather': return Math.min(g.count, s.gathered[g.item!] ?? 0);
    case 'craft': return Math.min(g.count, s.crafted[g.item!] ?? 0);
    case 'build': return Math.min(g.count, s.built[g.build!] ?? 0);
    case 'survive': return Math.min(g.count, day);
    case 'reach': return s.altarFound ? 1 : 0;
    case 'offer': return Math.min(g.count, s.offered);
  }
}
export function advanceQuests(s: SaveData, day: number): number[] {
  const done: number[] = [];
  while (s.questIdx < QUESTS.length && QUESTS[s.questIdx].goals.every((g) => goalProgress(s, g, day) >= g.count)) {
    done.push(s.questIdx); s.questIdx++;
  }
  return done;
}

export function loadSave(): SaveData | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as SaveData;
    if (d.version !== 2 || !Array.isArray(d.inv) || !d.stats) return null;
    const clean = (sl: { id: string } | null) => (sl && sl.id in ITEMS ? sl : null);
    d.inv = d.inv.map((x) => clean(x) as Slots[number]);
    while (d.inv.length < INV_SIZE) d.inv.push(null);
    d.equip = { hand: clean(d.equip?.hand) as Slots[number], body: clean(d.equip?.body) as Slots[number] };
    d.structures = (d.structures ?? []).filter((x) => x && (x.type === 'campfire' || x.type === 'chest'));
    return d;
  } catch { return null; }
}
export function hasOldSave(): boolean { try { return !!localStorage.getItem(OLD_SAVE_KEY); } catch { return false; } }
export function writeSave(s: SaveData): boolean {
  try { s.savedAt = Date.now(); localStorage.setItem(SAVE_KEY, JSON.stringify(s)); return true; } catch { return false; }
}
export function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ } }

export interface Settings { master: number; music: number; sfx: number; touch: 'auto' | 'on' | 'off'; fx: 'high' | 'low' }
export const DEFAULT_SETTINGS: Settings = { master: 80, music: 55, sfx: 80, touch: 'auto', fx: 'high' };
export function loadSettings(): Settings {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch { return { ...DEFAULT_SETTINGS }; }
}
export function saveSettings(s: Settings) { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* ignore */ } }
