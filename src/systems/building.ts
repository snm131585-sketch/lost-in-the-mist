// BuildingSystem：建筑预览与合法位置检测（纯逻辑）
import { STRUCTURES, type StructureType } from '../data/world';
import { TILE, MAP_W, MAP_H, T, idx, type WorldMap, type WorldObj } from '../world/map';
import type { Structure } from '../game/state';

export interface BuildGhost { type: StructureType; x: number; y: number; valid: boolean; reason: string }

export function checkPlacement(
  type: StructureType, x: number, y: number,
  map: WorldMap, structures: Structure[], objects: WorldObj[],
  player: { x: number; y: number }, isGone: (o: WorldObj) => boolean,
): { valid: boolean; reason: string } {
  const def = STRUCTURES[type];
  const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
  if (tx < 3 || ty < 3 || tx >= MAP_W - 3 || ty >= MAP_H - 3) return { valid: false, reason: '太靠近森林边缘' };
  const g = map.ground[idx(tx, ty)];
  if (g === T.Water) return { valid: false, reason: '不能建在水上' };
  if (map.blocked[idx(tx, ty)]) return { valid: false, reason: '这里被挡住了' };
  for (const s of structures) {
    if (Math.hypot(s.x - x, s.y - y) < def.radius + STRUCTURES[s.type].radius + 6) return { valid: false, reason: '离其他建筑太近' };
  }
  for (const o of objects) {
    if (Math.abs(o.x - x) > 60 || Math.abs(o.y - y) > 60) continue;
    if (isGone(o)) continue;
    const r = o.kind === 'altar' ? 120 : o.kind === 'tree' || o.kind === 'pine' || o.kind === 'rock' || o.kind === 'stele' ? 26 : 18;
    if (Math.hypot(o.x - x, o.y - y) < r + def.radius * 0.5) return { valid: false, reason: '离树木或资源太近' };
  }
  if (Math.hypot(player.x - x, player.y - y) < def.radius + 12) return { valid: false, reason: '离自己太近' };
  return { valid: true, reason: '' };
}
