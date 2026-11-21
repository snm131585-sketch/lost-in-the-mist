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
    for (const id of ['wood', 'glowcap', 'moonstone', 'mistdew', 'lantern', 'pick', 'tonic', 'rune']) {
      const c = paintIcon(id);
      this.set(`icon.${id}`, c);
      this.icons.set(id, c.toDataURL());
    }
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
