// TimeSystem：一天 = 480 游戏秒；黎明 / 白天 / 黄昏 / 夜晚
import { clamp, lerp } from '../engine/math';

export const DAY_LEN = 480;
export const START_TIME = DAY_LEN * 0.08;
export type Phase = 'dawn' | 'day' | 'dusk' | 'night';

// 一天中的分段（0..1）
const DAWN_END = 0.08, DAY_END = 0.56, DUSK_END = 0.7, NIGHT_END = 0.96;

export const dayOf = (t: number) => Math.floor(t / DAY_LEN) + 1;
export const frac = (t: number) => (t % DAY_LEN) / DAY_LEN;

export function phaseOf(t: number): Phase {
  const f = frac(t);
  if (f < DAWN_END || f >= NIGHT_END) return 'dawn';
  if (f < DAY_END) return 'day';
  if (f < DUSK_END) return 'dusk';
  return 'night';
}

/** 环境亮度 0（漆黑）..1（白天） */
export function lightLevel(t: number): number {
  const f = frac(t);
  if (f < DAWN_END) return lerp(0.35, 1, f / DAWN_END);
  if (f < DAY_END) return 1;
  if (f < DUSK_END) return lerp(1, 0.32, (f - DAY_END) / (DUSK_END - DAY_END));
  if (f < DUSK_END + 0.03) return lerp(0.32, 0.03, (f - DUSK_END) / 0.03);
  if (f < NIGHT_END) return 0.03;
  return lerp(0.03, 0.35, (f - NIGHT_END) / (1 - NIGHT_END));
}

/** 场景色调（叠加在画面上）：[r,g,b,a] */
export function tintOf(t: number): [number, number, number, number] {
  const f = frac(t);
  if (f >= DAY_END - 0.04 && f < DUSK_END) {
    const k = clamp((f - (DAY_END - 0.04)) / 0.08, 0, 1);
    return [230, 120, 60, 0.16 * k];
  }
  if (f < DAWN_END + 0.03 || f >= NIGHT_END) return [240, 170, 150, 0.1];
  return [0, 0, 0, 0];
}

/** 环境温度（摄氏度近似） */
export function ambientTemp(t: number, rain: number): number {
  const L = lightLevel(t);
  return lerp(5, 24, L) - rain * 9;
}

export const PHASE_NAME: Record<Phase, string> = { dawn: '黎明', day: '白天', dusk: '黄昏', night: '夜晚' };
export const PHASE_RANGES = { DAWN_END, DAY_END, DUSK_END, NIGHT_END };
