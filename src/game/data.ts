// 游戏数据：物品、配方、任务、碑文（纯数据，引擎无关）

export type ItemId = 'wood' | 'glowcap' | 'moonstone' | 'mistdew' | 'lantern' | 'pick' | 'tonic' | 'rune';
export type ResourceKind = 'branch' | 'mushroom' | 'crystal' | 'lily';

export interface ItemDef {
  id: ItemId;
  name: string;
  desc: string;
  kind: 'material' | 'tool' | 'consumable' | 'key';
}

export const ITEMS: Record<ItemId, ItemDef> = {
  wood: { id: 'wood', name: '灵木枝', desc: '老树自然脱落的枝条，轻而坚韧，带着淡淡的松香。', kind: 'material' },
  glowcap: { id: 'glowcap', name: '萤光蘑菇', desc: '生长在幽暗林地的蘑菇，伞盖会发出柔和的青绿色微光。', kind: 'material' },
  moonstone: { id: 'moonstone', name: '月光石', desc: '吸收了月光的晶石，在雾中也能看见它冷冷的光。需要镐才能开采。', kind: 'material' },
  mistdew: { id: 'mistdew', name: '雾露', desc: '清晨凝结在雾铃草上的露珠，据说是迷雾本身的眼泪。', kind: 'material' },
  lantern: { id: 'lantern', name: '萤火灯笼', desc: '用萤光蘑菇点亮的灯笼。随身携带可大幅扩大视野、驱散周围的迷雾。', kind: 'tool' },
  pick: { id: 'pick', name: '灵木镐', desc: '浸过雾露的灵木制成的镐，能凿开月光石。', kind: 'tool' },
  tonic: { id: 'tonic', name: '雾露药水', desc: '饮下后 25 秒内步伐轻盈、目光清明（移速与视野提升）。按 Q 使用。', kind: 'consumable' },
  rune: { id: 'rune', name: '月光符文', desc: '刻着古老纹样的月光石片。森林祭坛需要三枚才能被唤醒。', kind: 'key' },
};

export const ITEM_ORDER: ItemId[] = ['wood', 'glowcap', 'mistdew', 'moonstone', 'lantern', 'pick', 'tonic', 'rune'];

export interface ResourceDef {
  kind: ResourceKind;
  item: ItemId;
  name: string;
  yield: [number, number];
  needs?: ItemId;
  gatherTime: number;
  respawn: number;
}

export const RESOURCES: Record<ResourceKind, ResourceDef> = {
  branch: { kind: 'branch', item: 'wood', name: '枯枝堆', yield: [1, 2], gatherTime: 0.55, respawn: 90 },
  mushroom: { kind: 'mushroom', item: 'glowcap', name: '萤光蘑菇丛', yield: [1, 2], gatherTime: 0.6, respawn: 100 },
  crystal: { kind: 'crystal', item: 'moonstone', name: '月光石矿', yield: [2, 2], needs: 'pick', gatherTime: 1.0, respawn: 120 },
  lily: { kind: 'lily', item: 'mistdew', name: '雾铃草', yield: [1, 1], gatherTime: 0.7, respawn: 90 },
};

export interface Recipe {
  id: ItemId;
  cost: Partial<Record<ItemId, number>>;
  unique?: boolean;
  unlockQuest?: number; // 达到该任务序号后才显示
}

export const RECIPES: Recipe[] = [
  { id: 'lantern', cost: { wood: 3, glowcap: 2 }, unique: true },
  { id: 'pick', cost: { wood: 4, mistdew: 2 }, unique: true },
  { id: 'tonic', cost: { mistdew: 2, glowcap: 1 } },
  { id: 'rune', cost: { moonstone: 2, mistdew: 1, glowcap: 1 } },
];

export type GoalType = 'gather' | 'craft' | 'reach' | 'offer';
export interface Goal {
  type: GoalType;
  item?: ItemId;
  count: number;
  label: string;
  target?: 'altar';
}
export interface QuestDef {
  id: string;
  title: string;
  desc: string;
  goals: Goal[];
  hint: { x: number; y: number } | 'altar' | null; // 地图上的大致方向（瓦片坐标）
}

export const QUESTS: QuestDef[] = [
  {
    id: 'wake', title: '林间苏醒',
    desc: '你在雾中醒来，记不起来时的路。先在空地附近拾些灵木枝。',
    goals: [{ type: 'gather', item: 'wood', count: 5, label: '收集灵木枝' }],
    hint: null,
  },
  {
    id: 'light', title: '第一盏微光',
    desc: '迷雾吞噬了视线。东边幽暗的林地里长着会发光的蘑菇。',
    goals: [
      { type: 'gather', item: 'glowcap', count: 2, label: '采集萤光蘑菇' },
      { type: 'craft', item: 'lantern', count: 1, label: '制作萤火灯笼' },
    ],
    hint: { x: 72, y: 42 },
  },
  {
    id: 'dew', title: '湖畔的露水',
    desc: '西边的雾湖旁开着雾铃草。用雾露浸润灵木，做一把能凿开晶石的镐。',
    goals: [
      { type: 'gather', item: 'mistdew', count: 2, label: '收集雾露' },
      { type: 'craft', item: 'pick', count: 1, label: '制作灵木镐' },
    ],
    hint: { x: 21, y: 38 },
  },
  {
    id: 'ore', title: '月光矿脉',
    desc: '北方的岩地上，月光石在雾中闪烁。西北与东北各有一片矿脉。',
    goals: [{ type: 'gather', item: 'moonstone', count: 6, label: '开采月光石' }],
    hint: { x: 20, y: 16 },
  },
  {
    id: 'rune', title: '符文之约',
    desc: '石碑上记载：三枚月光符文，可以唤醒沉睡的祭坛。',
    goals: [{ type: 'craft', item: 'rune', count: 3, label: '制作月光符文' }],
    hint: null,
  },
  {
    id: 'altar', title: '森林祭坛',
    desc: '沿着石径向北，找到被迷雾环绕的森林祭坛，献上三枚符文。',
    goals: [
      { type: 'reach', count: 1, label: '找到森林祭坛', target: 'altar' },
      { type: 'offer', item: 'rune', count: 3, label: '献上月光符文' },
    ],
    hint: 'altar',
  },
];

export const STELE_TEXTS: string[] = [
  '「雾不是敌人。它只是森林闭上的眼睛。」',
  '「灯火所至之处，迷途者便不再迷途。」',
  '「三枚月光，一座古坛。当古坛再次歌唱，林中的雾会退回湖底。」',
  '「拾荒者啊，你带走的每一根枝条，森林都会再长出来。」',
  '「北方的石径，是第一位守林人用脚步踩出来的。」',
];

export const ENDING_LINES = [
  '三枚符文嵌入古坛，石缝间涌出温暖的光。',
  '低沉的歌声从地底升起，迷雾像潮水一样退回湖心。',
  '你第一次看清了这片森林——高大的灵木、发光的蘑菇、远处闪烁的晶石。',
  '原来你从未迷路。你只是在等待雾散的那一刻。',
];
