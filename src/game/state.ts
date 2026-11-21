// 游戏状态、背包、制作、任务进度、存档（引擎无关）
import { ITEMS, RECIPES, QUESTS, type ItemId, type Goal, type Recipe } from './data';

export interface SaveData {
  version: 1;
  player: { x: number; y: number; dir: string };
  inv: Partial<Record<ItemId, number>>;
  gathered: Partial<Record<ItemId, number>>;
  crafted: Partial<Record<ItemId, number>>;
  questIdx: number;
  altarFound: boolean;
  offered: number;
  nodes: Record<number, number>; // 资源节点 id → 重生时刻（playTime 秒）
  steleRead: number[];
  playTime: number;
  fog: string;
  ended: boolean;
  buffLeft: number;
  savedAt: number;
}

export const SAVE_KEY = 'litm.save.v1';
export const SETTINGS_KEY = 'litm.settings.v1';

export function newState(start: { x: number; y: number }): SaveData {
  return {
    version: 1,
    player: { x: start.x, y: start.y, dir: 'down' },
    inv: {}, gathered: {}, crafted: {},
    questIdx: 0, altarFound: false, offered: 0,
    nodes: {}, steleRead: [], playTime: 0, fog: '', ended: false, buffLeft: 0, savedAt: 0,
  };
}

export const count = (s: SaveData, id: ItemId) => s.inv[id] ?? 0;
export function addItem(s: SaveData, id: ItemId, n: number) {
  s.inv[id] = count(s, id) + n;
  if (s.inv[id]! <= 0) delete s.inv[id];
}
export function canCraft(s: SaveData, r: Recipe): { ok: boolean; reason?: string } {
  if (r.unique && count(s, r.id) > 0) return { ok: false, reason: '已拥有' };
  for (const [k, v] of Object.entries(r.cost)) if (count(s, k as ItemId) < (v ?? 0)) return { ok: false, reason: '材料不足' };
  return { ok: true };
}
export function craft(s: SaveData, id: ItemId): boolean {
  const r = RECIPES.find((x) => x.id === id);
  if (!r || !canCraft(s, r).ok) return false;
  for (const [k, v] of Object.entries(r.cost)) addItem(s, k as ItemId, -(v ?? 0));
  addItem(s, id, 1);
  s.crafted[id] = (s.crafted[id] ?? 0) + 1;
  return true;
}

export function goalProgress(s: SaveData, goal: Goal): number {
  switch (goal.type) {
    case 'gather': return Math.min(goal.count, s.gathered[goal.item!] ?? 0);
    case 'craft': return Math.min(goal.count, s.crafted[goal.item!] ?? 0);
    case 'reach': return s.altarFound ? 1 : 0;
    case 'offer': return Math.min(goal.count, s.offered);
  }
}
export function questComplete(s: SaveData, qi: number): boolean {
  const q = QUESTS[qi];
  return !!q && q.goals.every((g) => goalProgress(s, g) >= g.count);
}
/** 推进任务链，返回本次完成的任务序号列表 */
export function advanceQuests(s: SaveData): number[] {
  const done: number[] = [];
  while (s.questIdx < QUESTS.length && questComplete(s, s.questIdx)) {
    done.push(s.questIdx);
    s.questIdx++;
  }
  return done;
}

export function loadSave(): SaveData | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as SaveData;
    if (d.version !== 1 || typeof d.player?.x !== 'number') return null;
    // 过滤未知物品
    for (const k of Object.keys(d.inv)) if (!(k in ITEMS)) delete d.inv[k as ItemId];
    return d;
  } catch { return null; }
}
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
