// WeatherSystem：随机降雨（强度平滑变化）
import { clamp } from '../engine/math';

export interface WeatherState { rain: number; target: number; until: number; next: number }
export const newWeather = (): WeatherState => ({ rain: 0, target: 0, until: 0, next: 700 });

/** t = 游戏时间 */
export function tickWeather(w: WeatherState, t: number, dt: number, rnd: () => number) {
  if (w.target > 0 && t >= w.until) { w.target = 0; w.next = t + 400 + rnd() * 500; }
  else if (w.target === 0 && t >= w.next) { w.target = 0.55 + rnd() * 0.45; w.until = t + 90 + rnd() * 120; }
  const sp = 0.06 * dt;
  w.rain = clamp(w.rain + clamp(w.target - w.rain, -sp, sp), 0, 1);
}
