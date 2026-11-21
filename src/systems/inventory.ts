// InventorySystem：格子背包、堆叠、耐久、装备（纯逻辑，可单独测试）
import { ITEMS, type ItemId, type EquipSlot } from '../data/items';

export interface Slot { id: ItemId; n: number; dur?: number }
export type Slots = (Slot | null)[];
export const INV_SIZE = 15;

export function makeSlot(id: ItemId, n = 1): Slot {
  const d = ITEMS[id];
  return d.durability ? { id, n: 1, dur: d.durability } : { id, n };
}

export function countIn(slots: Slots, id: ItemId): number {
  let c = 0;
  for (const s of slots) if (s && s.id === id) c += s.n;
  return c;
}

/** 放入物品，返回放不下的数量 */
export function addTo(slots: Slots, id: ItemId, n: number, dur?: number): number {
  const def = ITEMS[id];
  if (def.stack > 1) {
    for (const s of slots) {
      if (n <= 0) break;
      if (s && s.id === id && s.n < def.stack) { const k = Math.min(n, def.stack - s.n); s.n += k; n -= k; }
    }
  }
  for (let i = 0; i < slots.length && n > 0; i++) {
    if (slots[i]) continue;
    if (def.stack > 1) { const k = Math.min(n, def.stack); slots[i] = { id, n: k }; n -= k; }
    else { slots[i] = { id, n: 1, dur: dur ?? def.durability }; n -= 1; }
  }
  return n;
}

/** 移除物品，返回是否足够 */
export function removeFrom(slots: Slots, id: ItemId, n: number): boolean {
  if (countIn(slots, id) < n) return false;
  for (let i = slots.length - 1; i >= 0 && n > 0; i--) {
    const s = slots[i];
    if (!s || s.id !== id) continue;
    const k = Math.min(n, s.n);
    s.n -= k; n -= k;
    if (s.n <= 0) slots[i] = null;
  }
  return true;
}

export function canAdd(slots: Slots, id: ItemId, n: number): boolean {
  const copy = slots.map((s) => (s ? { ...s } : null));
  return addTo(copy, id, n) === 0;
}

export interface Equipment { hand: Slot | null; body: Slot | null }
export const slotOf = (id: ItemId): EquipSlot | null => ITEMS[id].equip ?? null;
