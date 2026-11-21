// SurvivalSystem：生命 / 饥饿 / 精神 / 体温 及环境影响（纯逻辑）
import { clamp } from '../engine/math';

export const MAX = { hp: 150, hunger: 150, sanity: 200 };
export interface Stats { hp: number; hunger: number; sanity: number; temp: number }
export const newStats = (): Stats => ({ hp: MAX.hp, hunger: MAX.hunger, sanity: MAX.sanity, temp: 30 });

export interface Env {
  ambient: number;     // 环境温度
  heat: number;        // 附近热源加成
  warmth: number;      // 装备保暖
  dark: boolean;       // 处在无光的黑暗中
  night: boolean;
  dusk: boolean;
  rain: number;        // 0..1
  nearFire: boolean;
}

export interface Tick { causes: string[] }

/** 推进 dt 秒，返回本帧造成伤害的原因（用于提示与死亡原因） */
export function tickSurvival(s: Stats, env: Env, dt: number): Tick {
  const causes: string[] = [];
  // 饥饿：约 1.2 天从满到空
  s.hunger = clamp(s.hunger - 0.26 * dt, 0, MAX.hunger);
  if (s.hunger <= 0) { s.hp -= 1.5 * dt; causes.push('饥饿'); }

  // 精神
  let ds = 0;
  if (env.night && !env.nearFire) ds -= 0.18;
  if (env.dusk) ds -= 0.05;
  if (env.dark) ds -= 0.6;
  if (env.rain > 0.2) ds -= 0.12 * env.rain;
  if (env.nearFire) ds += 0.15;
  if (!env.night && !env.dusk && env.rain < 0.2) ds += 0.04;
  s.sanity = clamp(s.sanity + ds * dt, 0, MAX.sanity);

  // 体温趋向「环境 + 热源 + 保暖」
  const target = env.ambient + env.heat + env.warmth;
  const rate = env.heat > 0 ? 0.6 : 0.25;
  s.temp += (target - s.temp) * clamp(rate * dt, 0, 1) * 0.35;
  s.temp = clamp(s.temp, -10, 75);
  if (s.temp < 2) { s.hp -= 1.25 * dt; causes.push('寒冷'); }
  if (s.temp > 68) { s.hp -= 1.0 * dt; causes.push('过热'); }

  // 精神崩溃时缓慢掉血（幻象侵扰）
  if (s.sanity <= 0) { s.hp -= 0.4 * dt; causes.push('疯狂'); }

  // 吃饱、暖和、精神好时缓慢回血
  if (s.hunger > MAX.hunger * 0.6 && s.temp > 8 && s.temp < 60 && s.sanity > MAX.sanity * 0.4) s.hp += 0.12 * dt;
  s.hp = clamp(s.hp, 0, MAX.hp);
  return { causes };
}

export function applyFood(s: Stats, f: { hunger: number; hp: number; sanity: number }) {
  s.hunger = clamp(s.hunger + f.hunger, 0, MAX.hunger);
  s.hp = clamp(s.hp + f.hp, 0, MAX.hp);
  s.sanity = clamp(s.sanity + f.sanity, 0, MAX.sanity);
}
