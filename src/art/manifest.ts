// 美术资源清单与替换接口
// ------------------------------------------------------------
// 当前版本的所有美术都由 painters.ts 程序化绘制。
// 拿到正式手绘 PNG 后，把文件放到 public/assets/ 下，并在 IMAGE_OVERRIDES
// 里登记「资源键 → 路径」。加载成功即自动替换，失败则保留程序化版本。
// 资源键与尺寸规范见 docs/ART_GUIDE.md。
// ------------------------------------------------------------
import {
  paintTree, paintPine, paintRock, paintBush, paintResource, paintStele,
  paintAltarBase, paintAltarMonolith, paintPlayer, paintIcon, paintMistPuff, type Cnv, type Dir,
} from './painters';
import {
  paintStump, paintRubble, paintBerryBush, paintGrassTuft, paintSapling, paintFlint,
  paintCampfireBase, paintChest, paintRabbit, paintWolf, paintIcon2,
} from './painters2';
import { ITEMS } from '../data/items';

/** 例：'tree.0': 'assets/tree_0.png' */
export const IMAGE_OVERRIDES: Record<string, string> = {};
/** 例：pickup: 'assets/sfx/pickup.ogg' */
export const SFX_OVERRIDES: Record<string, string> = {};

export type Img = HTMLCanvasElement | HTMLImageElement;

export class Assets {
  private map = new Map<string, Img>();
  icons = new Map<string, string>(); // dataURL，用于 DOM UI

  get(key: string): Img {
    const v = this.map.get(key);
    if (!v) throw new Error(`缺少美术资源: ${key}`);
    return v;
  }
  has(key: string) { return this.map.has(key); }
  set(key: string, img: Img) { this.map.set(key, img); }

  /** 生成全部程序化资源 */
  buildProcedural() {
    for (let v = 0; v < 6; v++) this.set(`tree.${v}`, paintTree(v));
    for (let v = 0; v < 4; v++) this.set(`pine.${v}`, paintPine(v));
    for (let v = 0; v < 3; v++) { this.set(`rock.${v}`, paintRock(v)); this.set(`bush.${v}`, paintBush(v)); }
    for (const k of ['branch', 'mushroom', 'crystal', 'lily']) {
      for (let v = 0; v < 3; v++) {
        this.set(`res.${k}.${v}`, paintResource(k, v, false));
        this.set(`res.${k}.${v}.empty`, paintResource(k, v, true));
      }
    }
    for (let v = 0; v < 2; v++) this.set(`stele.${v}`, paintStele(v));
    this.set('altar.base', paintAltarBase());
    for (let s = 0; s <= 3; s++) this.set(`altar.mono.${s}`, paintAltarMonolith(s, false));
    this.set('altar.mono.lit', paintAltarMonolith(3, true));
    const dirs: Dir[] = ['down', 'up', 'side'];
    for (const d of dirs) for (let f = 0; f < 6; f++) this.set(`player.${d}.${f}`, paintPlayer(d, f));
    // 物品图标：优先使用 v2 绘制函数，否则沿用 v1 图标（log←wood，pickaxe←pick）
    const legacy: Record<string, string> = { log: 'wood', pickaxe: 'pick' };
    for (const id of Object.keys(ITEMS)) {
      const c = paintIcon2(id) ?? paintIcon(legacy[id] ?? id);
      this.set(`icon.${id}`, c);
      this.icons.set(id, c.toDataURL());
    }
    // v2 新增世界物件
    this.set('stump.tree', paintStump(false));
    this.set('stump.pine', paintStump(true));
    this.set('rubble', paintRubble());
    for (let v = 0; v < 3; v++) {
      this.set(`berry.${v}`, paintBerryBush(v, true));
      this.set(`berry.${v}.empty`, paintBerryBush(v, false));
      this.set(`res.grass.${v}`, paintGrassTuft(v, false));
      this.set(`res.grass.${v}.empty`, paintGrassTuft(v, true));
      this.set(`res.sapling.${v}`, paintSapling(v, false));
      this.set(`res.sapling.${v}.empty`, paintSapling(v, true));
      this.set(`res.flint.${v}`, paintFlint(v));
      this.set(`res.flint.${v}.empty`, paintFlint(v)); // 不会被绘制（已拾取的燧石隐藏）
    }
    this.set('campfire', paintCampfireBase());
    this.set('chest', paintChest(false));
    this.set('chest.open', paintChest(true));
    for (let f = 0; f < 5; f++) this.set(`rabbit.${f}`, paintRabbit(f));
    for (let f = 0; f < 6; f++) this.set(`wolf.${f}`, paintWolf(f));
    for (let i = 0; i < 4; i++) this.set(`mist.${i}`, paintMistPuff(i));
  }

  /** 加载登记的正式资源（可选） */
  async loadOverrides() {
    const jobs = Object.entries(IMAGE_OVERRIDES).map(([key, url]) => new Promise<void>((resolve) => {
      const img = new Image();
      img.onload = () => {
        this.set(key, img);
        if (key.startsWith('icon.')) this.icons.set(key.slice(5), url);
        resolve();
      };
      img.onerror = () => resolve();
      img.src = url;
    }));
    await Promise.all(jobs);
  }
}

export function iconUrl(assets: Assets, id: string) { return assets.icons.get(id) ?? ''; }
export type { Cnv };
