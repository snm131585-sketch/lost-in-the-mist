// 物品配置表（配置驱动：新增物品只需在这里加一项 + 一个图标绘制函数）

export type ItemId =
  | 'twigs' | 'grass' | 'log' | 'flint' | 'rock' | 'rope'
  | 'berries' | 'berries_cooked' | 'meat' | 'meat_cooked' | 'glowcap' | 'glowcap_cooked'
  | 'mistdew' | 'moonstone'
  | 'axe' | 'pickaxe' | 'torch' | 'spear' | 'armor' | 'lantern'
  | 'tonic' | 'rune' | 'campfire_kit' | 'chest_kit';

export type ItemKind = 'material' | 'food' | 'tool' | 'weapon' | 'light' | 'armor' | 'consumable' | 'key';
export type ToolType = 'axe' | 'pickaxe';
export type EquipSlot = 'hand' | 'body';

export interface FoodStats { hunger: number; hp: number; sanity: number }

export interface ItemDef {
  id: ItemId;
  name: string;
  desc: string;
  kind: ItemKind;
  stack: number;              // 最大堆叠（耐久物品为 1）
  food?: FoodStats;
  cookTo?: ItemId;            // 放在篝火上烹饪后的产物
  fuel?: number;              // 作为篝火燃料提供的秒数
  equip?: EquipSlot;
  tool?: ToolType;
  damage?: number;            // 近战伤害
  light?: number;             // 装备时的光照半径（像素）
  warmth?: number;            // 装备时提供的温度
  absorb?: number;            // 护甲减伤比例
  durability?: number;        // 最大耐久
  durKind?: 'uses' | 'seconds' | 'damage';
}

const I = (d: ItemDef) => d;

export const ITEMS: Record<ItemId, ItemDef> = {
  twigs: I({ id: 'twigs', name: '树枝', desc: '从枯枝堆或树苗上折下的细枝。制作的基础材料，也能当柴烧。', kind: 'material', stack: 40, fuel: 20 }),
  grass: I({ id: 'grass', name: '干草', desc: '从草丛割下的长草，可以搓成绳子。很好的引火物。', kind: 'material', stack: 40, fuel: 14 }),
  log: I({ id: 'log', name: '木头', desc: '用斧头从树上砍下的木头，耐烧。', kind: 'material', stack: 20, fuel: 55 }),
  flint: I({ id: 'flint', name: '燧石', desc: '边缘锋利的石片，常散落在岩地与路边。工具的刃口。', kind: 'material', stack: 40 }),
  rock: I({ id: 'rock', name: '石块', desc: '用镐从巨石上凿下的石块。', kind: 'material', stack: 40 }),
  rope: I({ id: 'rope', name: '草绳', desc: '三束干草拧成的绳子，结实耐用。', kind: 'material', stack: 20 }),

  berries: I({ id: 'berries', name: '雾莓', desc: '灌木上的浆果，酸甜。生吃能稍微填肚子。', kind: 'food', stack: 20, food: { hunger: 9, hp: 0, sanity: 0 }, cookTo: 'berries_cooked' }),
  berries_cooked: I({ id: 'berries_cooked', name: '烤雾莓', desc: '烤过之后更甜，也更顶饱。', kind: 'food', stack: 20, food: { hunger: 13, hp: 2, sanity: 1 } }),
  meat: I({ id: 'meat', name: '生肉', desc: '生的肉。生吃会让你觉得很不舒服。', kind: 'food', stack: 20, food: { hunger: 20, hp: -3, sanity: -10 }, cookTo: 'meat_cooked' }),
  meat_cooked: I({ id: 'meat_cooked', name: '烤肉', desc: '香气扑鼻的烤肉，非常顶饱。', kind: 'food', stack: 20, food: { hunger: 32, hp: 8, sanity: 2 } }),
  glowcap: I({ id: 'glowcap', name: '萤光蘑菇', desc: '幽暗林里会发光的蘑菇。生吃会让头脑发晕。', kind: 'food', stack: 20, food: { hunger: 8, hp: 0, sanity: -12 }, cookTo: 'glowcap_cooked' }),
  glowcap_cooked: I({ id: 'glowcap_cooked', name: '烤萤光菇', desc: '烤熟后光芒变得温和，吃了让人平静。', kind: 'food', stack: 20, food: { hunger: 10, hp: 1, sanity: 12 } }),
  mistdew: I({ id: 'mistdew', name: '雾露', desc: '雾铃草上的露珠。喝下去能让纷乱的思绪平静一些。', kind: 'food', stack: 20, food: { hunger: 0, hp: 1, sanity: 8 } }),
  moonstone: I({ id: 'moonstone', name: '月光石', desc: '吸收了月光的晶石。需要镐才能开采。', kind: 'material', stack: 20 }),

  axe: I({ id: 'axe', name: '燧石斧', desc: '用来砍树。每次砍伐消耗 1 点耐久。', kind: 'tool', stack: 1, equip: 'hand', tool: 'axe', damage: 20, durability: 40, durKind: 'uses' }),
  pickaxe: I({ id: 'pickaxe', name: '燧石镐', desc: '用来开采巨石与月光石。', kind: 'tool', stack: 1, equip: 'hand', tool: 'pickaxe', damage: 18, durability: 30, durKind: 'uses' }),
  torch: I({ id: 'torch', name: '火把', desc: '装备后照亮周围并带来一点温暖。会慢慢燃尽。', kind: 'light', stack: 1, equip: 'hand', light: 175, warmth: 6, damage: 14, durability: 110, durKind: 'seconds' }),
  spear: I({ id: 'spear', name: '燧石长矛', desc: '基础武器，伤害可观。每次命中消耗 1 点耐久。', kind: 'weapon', stack: 1, equip: 'hand', damage: 34, durability: 120, durKind: 'uses' }),
  armor: I({ id: 'armor', name: '草编护甲', desc: '吸收 60% 的伤害，直到磨损殆尽。', kind: 'armor', stack: 1, equip: 'body', absorb: 0.6, durability: 225, durKind: 'damage' }),
  lantern: I({ id: 'lantern', name: '萤火灯笼', desc: '萤光蘑菇点亮的灯笼，光照范围大，燃烧时间长。', kind: 'light', stack: 1, equip: 'hand', light: 235, warmth: 3, damage: 10, durability: 420, durKind: 'seconds' }),

  tonic: I({ id: 'tonic', name: '雾露药水', desc: '25 秒内移速 +45%、视野扩大，并恢复 25 点精神。', kind: 'consumable', stack: 10 }),
  rune: I({ id: 'rune', name: '月光符文', desc: '刻着古老纹样的月光石片。森林祭坛需要三枚。', kind: 'key', stack: 10 }),
  campfire_kit: I({ id: 'campfire_kit', name: '篝火', desc: '放置后可以取暖、照明、烹饪。需要添加燃料。', kind: 'key', stack: 5 }),
  chest_kit: I({ id: 'chest_kit', name: '储物箱', desc: '放置后可以存放 12 格物品。', kind: 'key', stack: 5 }),
};

export const isEquip = (id: ItemId) => !!ITEMS[id].equip;
