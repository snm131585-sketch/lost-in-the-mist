// CreatureSystem：生物 AI（游荡 / 逃跑 / 追击 / 攻击）与生成规则
import { CREATURES, type CreatureType } from '../data/world';
import { clamp } from '../engine/math';

export interface Creature {
  id: number;
  type: CreatureType;
  x: number; y: number;
  hp: number;
  state: 'wander' | 'flee' | 'chase' | 'windup' | 'leave';
  t: number;            // 状态计时
  dir: number;          // 游荡方向（弧度）
  atkCd: number;
  flip: boolean;
  anim: number;
  moving: boolean;
  hurt: number;         // 受击闪白计时
  alpha: number;        // 出现 / 离开时的淡入淡出
}

export interface CreatureCtx {
  px: number; py: number;          // 玩家位置
  dt: number;
  blocked: (x: number, y: number) => boolean;
  fires: { x: number; y: number; r: number }[];  // 燃烧中的篝火（狼不会靠近）
  leave: boolean;                  // 天亮了：狼离开
  rnd: () => number;
  onAttack: (c: Creature) => void;
}

let nextId = 1;
export function spawnCreature(type: CreatureType, x: number, y: number): Creature {
  return { id: nextId++, type, x, y, hp: CREATURES[type].hp, state: 'wander', t: 0, dir: Math.random() * Math.PI * 2, atkCd: 0, flip: false, anim: 0, moving: false, hurt: 0, alpha: 0 };
}

function move(c: Creature, dx: number, dy: number, ctx: CreatureCtx) {
  const r = CREATURES[c.type].radius * 0.6;
  const nx = c.x + dx, ny = c.y + dy;
  if (!ctx.blocked(nx + Math.sign(dx) * r, c.y)) c.x = nx; else c.dir += Math.PI * (0.5 + ctx.rnd());
  if (!ctx.blocked(c.x, ny + Math.sign(dy) * r)) c.y = ny; else c.dir += Math.PI * (0.5 + ctx.rnd());
  if (Math.abs(dx) > 0.01) c.flip = dx < 0;
  c.moving = Math.hypot(dx, dy) > 0.01;
}

/** 返回 false 表示该生物应被移除 */
export function updateCreature(c: Creature, ctx: CreatureCtx): boolean {
  const def = CREATURES[c.type];
  const { dt } = ctx;
  c.t += dt;
  c.atkCd = Math.max(0, c.atkCd - dt);
  c.hurt = Math.max(0, c.hurt - dt);
  c.anim += dt * (c.moving ? 10 : 2);
  const dx = ctx.px - c.x, dy = ctx.py - c.y;
  const d = Math.hypot(dx, dy) || 1;

  if (c.state === 'leave') {
    c.alpha -= dt * 0.6;
    move(c, -dx / d * def.speed * 0.6 * dt, -dy / d * def.speed * 0.6 * dt, ctx);
    return c.alpha > 0;
  }
  c.alpha = Math.min(1, c.alpha + dt * 1.5);
  if (ctx.leave && c.type === 'wolf') { c.state = 'leave'; return true; }

  // 状态切换
  if (def.flee && d < def.flee) c.state = 'flee';
  else if (c.state === 'flee' && d > def.flee * 1.8) c.state = 'wander';
  if (def.aggro && d < def.aggro && c.state === 'wander') c.state = 'chase';
  if (c.state === 'chase' && d > def.aggro * 2) c.state = 'wander';

  switch (c.state) {
    case 'wander': {
      if (c.t > 1.5 + ctx.rnd() * 2) { c.t = 0; c.dir = ctx.rnd() * Math.PI * 2; }
      const walking = (c.t % 3) < 1.6;
      const sp = def.speed * 0.25;
      if (walking) move(c, Math.cos(c.dir) * sp * dt, Math.sin(c.dir) * sp * dt, ctx);
      else c.moving = false;
      break;
    }
    case 'flee':
      move(c, -dx / d * def.speed * dt, -dy / d * def.speed * dt, ctx);
      break;
    case 'chase': {
      // 不进入燃烧篝火的光圈：在边缘徘徊
      let vx = dx / d, vy = dy / d;
      for (const f of ctx.fires) {
        const fd = Math.hypot(c.x + vx * 20 - f.x, c.y + vy * 20 - f.y);
        if (fd < f.r) {
          const ax = c.x - f.x, ay = c.y - f.y, al = Math.hypot(ax, ay) || 1;
          vx = -ay / al; vy = ax / al; // 沿切线绕行
          if (fd < f.r * 0.8) { vx = ax / al; vy = ay / al; }
        }
      }
      if (d > def.attackRange * 0.8) move(c, vx * def.speed * dt, vy * def.speed * dt, ctx);
      else { c.moving = false; c.flip = dx < 0; }
      if (d < def.attackRange && c.atkCd <= 0) { c.state = 'windup'; c.t = 0; }
      break;
    }
    case 'windup':
      c.moving = false; c.flip = dx < 0;
      if (c.t > 0.38) {
        if (d < def.attackRange + 10) ctx.onAttack(c);
        c.atkCd = def.attackCooldown;
        c.state = 'chase';
      }
      break;
  }
  return c.hp > 0;
}

export function knockback(c: Creature, fromX: number, fromY: number, dist: number, blocked: (x: number, y: number) => boolean) {
  const dx = c.x - fromX, dy = c.y - fromY, l = Math.hypot(dx, dy) || 1;
  const nx = c.x + (dx / l) * dist, ny = c.y + (dy / l) * dist;
  if (!blocked(nx, ny)) { c.x = nx; c.y = ny; }
  c.hurt = 0.18;
}

export const creatureFrame = (c: Creature) =>
  c.state === 'windup' && c.type === 'wolf' ? 5 : c.moving ? Math.floor(c.anim) % 4 : 4;

export const clampAlpha = (c: Creature) => clamp(c.alpha, 0, 1);
