// 资源节点、建筑、生物、配方、任务的配置表
import type { ItemId, ToolType } from './items';

// ---------------- 资源节点 ----------------
export type NodeType =
  | 'tree' | 'pine' | 'boulder' | 'berrybush'
  | 'branch' | 'grass' | 'sapling' | 'flint' | 'mushroom' | 'crystal' | 'lily';

export interface Drop { item: ItemId; min: number; max: number; chance?: number }
export interface NodeDef {
  type: NodeType;
  name: string;
  verb: string;
  tool?: ToolType;
  time: number;          // 采集耗时（秒）
  drops: Drop[];
  regrow: number;        // 重生时间（游戏秒）；0 = 不重生
  sanity?: number;       // 采集时精神变化
}

export const NODES: Record<NodeType, NodeDef> = {
  tree: { type: 'tree', name: '灵木', verb: '砍伐', tool: 'axe', time: 1.4, drops: [{ item: 'log', min: 2, max: 3 }], regrow: 1200 },
  pine: { type: 'pine', name: '雾松', verb: '砍伐', tool: 'axe', time: 1.2, drops: [{ item: 'log', min: 2, max: 2 }, { item: 'twigs', min: 0, max: 1 }], regrow: 1100 },
  boulder: { type: 'boulder', name: '巨石', verb: '开采', tool: 'pickaxe', time: 1.4, drops: [{ item: 'rock', min: 2, max: 3 }, { item: 'flint', min: 1, max: 2 }], regrow: 2400 },
  berrybush: { type: 'berrybush', name: '雾莓灌木', verb: '采摘', time: 0.5, drops: [{ item: 'berries', min: 1, max: 2 }], regrow: 360 },
  branch: { type: 'branch', name: '枯枝堆', verb: '拾取', time: 0.5, drops: [{ item: 'twigs', min: 1, max: 2 }], regrow: 300 },
  grass: { type: 'grass', name: '草丛', verb: '采集', time: 0.45, drops: [{ item: 'grass', min: 1, max: 1 }], regrow: 240 },
  sapling: { type: 'sapling', name: '树苗', verb: '采集', time: 0.45, drops: [{ item: 'twigs', min: 1, max: 1 }], regrow: 240 },
  flint: { type: 'flint', name: '燧石', verb: '拾取', time: 0.3, drops: [{ item: 'flint', min: 1, max: 1 }], regrow: 900 },
  mushroom: { type: 'mushroom', name: '萤光蘑菇丛', verb: '采集', time: 0.6, drops: [{ item: 'glowcap', min: 1, max: 2 }], regrow: 420 },
  crystal: { type: 'crystal', name: '月光石矿', verb: '开采', tool: 'pickaxe', time: 1.0, drops: [{ item: 'moonstone', min: 2, max: 2 }], regrow: 900 },
  lily: { type: 'lily', name: '雾铃草', verb: '采集', time: 0.6, drops: [{ item: 'mistdew', min: 1, max: 1 }], regrow: 360, sanity: 3 },
};

// ---------------- 建筑 ----------------
export type StructureType = 'campfire' | 'chest';
export interface StructureDef {
  type: StructureType;
  name: string;
  item: ItemId;          // 对应的放置物品
  radius: number;        // 占地半径（像素），用于合法位置检测
  blocks: boolean;
  maxFuel?: number;
  startFuel?: number;
  slots?: number;
}
export const STRUCTURES: Record<StructureType, StructureDef> = {
  campfire: { type: 'campfire', name: '篝火', item: 'campfire_kit', radius: 20, blocks: true, maxFuel: 240, startFuel: 120 },
  chest: { type: 'chest', name: '储物箱', item: 'chest_kit', radius: 16, blocks: true, slots: 12 },
};

// ---------------- 生物 ----------------
export type CreatureType = 'rabbit' | 'wolf';
export interface CreatureDef {
  type: CreatureType;
  name: string;
  hp: number;
  speed: number;
  damage: number;
  attackRange: number;
  attackCooldown: number;
  aggro: number;         // 主动攻击距离；0 = 不主动
  flee: number;          // 逃跑距离；0 = 不逃
  drops: Drop[];
  radius: number;
}
export const CREATURES: Record<CreatureType, CreatureDef> = {
  rabbit: { type: 'rabbit', name: '雾兔', hp: 25, speed: 150, damage: 0, attackRange: 0, attackCooldown: 0, aggro: 0, flee: 120, drops: [{ item: 'meat', min: 1, max: 1 }], radius: 9 },
  wolf: { type: 'wolf', name: '雾狼', hp: 100, speed: 112, damage: 18, attackRange: 34, attackCooldown: 1.4, aggro: 260, flee: 0, drops: [{ item: 'meat', min: 1, max: 2 }], radius: 14 },
};

// ---------------- 配方 ----------------
export type RecipeTab = 'tools' | 'light' | 'survival' | 'build' | 'fight' | 'magic';
export const TABS: { id: RecipeTab; name: string }[] = [
  { id: 'tools', name: '工具' }, { id: 'light', name: '照明' }, { id: 'survival', name: '生存' },
  { id: 'build', name: '建造' }, { id: 'fight', name: '战斗' }, { id: 'magic', name: '月光' },
];
export interface Recipe {
  out: ItemId;
  n: number;
  tab: RecipeTab;
  cost: Partial<Record<ItemId, number>>;
  build?: StructureType;  // 建筑配方：放置成功时才扣材料
}
export const RECIPES: Recipe[] = [
  { out: 'axe', n: 1, tab: 'tools', cost: { twigs: 1, flint: 1 } },
  { out: 'pickaxe', n: 1, tab: 'tools', cost: { twigs: 2, flint: 2 } },
  { out: 'rope', n: 1, tab: 'tools', cost: { grass: 3 } },
  { out: 'torch', n: 1, tab: 'light', cost: { twigs: 2, grass: 2 } },
  { out: 'lantern', n: 1, tab: 'light', cost: { twigs: 3, glowcap: 2, rope: 1 } },
  { out: 'campfire_kit', n: 1, tab: 'build', cost: { log: 2, grass: 3 }, build: 'campfire' },
  { out: 'chest_kit', n: 1, tab: 'build', cost: { log: 4, rope: 1 }, build: 'chest' },
  { out: 'spear', n: 1, tab: 'fight', cost: { twigs: 2, rope: 1, flint: 1 } },
  { out: 'armor', n: 1, tab: 'fight', cost: { grass: 8, rope: 2 } },
  { out: 'tonic', n: 1, tab: 'survival', cost: { mistdew: 2, glowcap: 1 } },
  { out: 'rune', n: 1, tab: 'magic', cost: { moonstone: 2, mistdew: 1, glowcap: 1 } },
];

// ---------------- 旅程（长线目标） ----------------
export type GoalType = 'gather' | 'craft' | 'build' | 'survive' | 'reach' | 'offer';
export interface Goal { type: GoalType; item?: ItemId; build?: StructureType; count: number; label: string }
export interface QuestDef { id: string; title: string; desc: string; goals: Goal[]; hint: { x: number; y: number } | 'altar' | null }

export const QUESTS: QuestDef[] = [
  { id: 'wake', title: '林间苏醒', desc: '你在雾中醒来。先拾些树枝、割些干草，再在岩地和路边找燧石。', hint: null,
    goals: [{ type: 'gather', item: 'twigs', count: 4, label: '收集树枝' }, { type: 'gather', item: 'grass', count: 4, label: '收集干草' }, { type: 'gather', item: 'flint', count: 2, label: '收集燧石' }] },
  { id: 'tools', title: '燧石与木头', desc: '做一把燧石斧，砍些木头。天黑前你会需要它们。', hint: null,
    goals: [{ type: 'craft', item: 'axe', count: 1, label: '制作燧石斧' }, { type: 'gather', item: 'log', count: 4, label: '收集木头' }] },
  { id: 'night', title: '第一夜', desc: '黑暗里有东西。在天黑前生起篝火，撑到第二天清晨。', hint: null,
    goals: [{ type: 'build', build: 'campfire', count: 1, label: '建造篝火' }, { type: 'survive', count: 2, label: '活到第 2 天' }] },
  { id: 'light', title: '萤火', desc: '东边幽暗的林地长着会发光的蘑菇。做一盏能走夜路的灯笼。', hint: { x: 72, y: 42 },
    goals: [{ type: 'craft', item: 'lantern', count: 1, label: '制作萤火灯笼' }] },
  { id: 'ore', title: '月光矿脉', desc: '做一把燧石镐，到北方岩地开采月光石。', hint: { x: 20, y: 16 },
    goals: [{ type: 'craft', item: 'pickaxe', count: 1, label: '制作燧石镐' }, { type: 'gather', item: 'moonstone', count: 6, label: '开采月光石' }] },
  { id: 'rune', title: '符文之约', desc: '石碑上记载：三枚月光符文，可以唤醒沉睡的祭坛。', hint: null,
    goals: [{ type: 'craft', item: 'rune', count: 3, label: '制作月光符文' }] },
  { id: 'altar', title: '森林祭坛', desc: '沿着石径向北，找到森林祭坛，献上三枚符文。', hint: 'altar',
    goals: [{ type: 'reach', count: 1, label: '找到森林祭坛' }, { type: 'offer', item: 'rune', count: 3, label: '献上月光符文' }] },
];

export const STELE_TEXTS: string[] = [
  '「雾不是敌人。它只是森林闭上的眼睛。」',
  '「天黑以前，要有火。没有火的人，会被黑暗记住。」',
  '「三枚月光，一座古坛。当古坛再次歌唱，林中的雾会退回湖底。」',
  '「拾荒者啊，你带走的每一根枝条，森林都会再长出来。」',
  '「雾狼只在暮色里出没。它们怕火，却不怕孤身一人的旅人。」',
];

export const ENDING_LINES = [
  '三枚符文嵌入古坛，石缝间涌出温暖的光。',
  '低沉的歌声从地底升起，迷雾像潮水一样退回湖心。',
  '你第一次看清了这片森林——它并不仁慈，但它一直在呼吸。',
  '而你，已经学会了在这里活下去。',
];
