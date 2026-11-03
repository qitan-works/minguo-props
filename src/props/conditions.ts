// 四種道具共用的「紙張狀況」欄位與情境預設。純邏輯。

import { EDGE_STYLES, FOLD_STYLES, WATER_REGIONS } from '../lib/effects.ts';
import { AGING_OPTIONS } from './common.ts';
import type { DataOf, Field, FieldValue } from './schema.ts';

export const PRESETS = [
  { value: 'custom', label: '自訂（不套用情境）' },
  { value: 'fire-letter', label: '火場搶出的信' },
  { value: 'sea-diary', label: '泡過海水的日記' },
  { value: 'pocket-telegram', label: '死者口袋裡揉爛的電報' },
  { value: 'cellar-deed', label: '地窖發霉的契據' },
  { value: 'torn-notes', label: '被撕掉一半的筆記' },
  { value: 'library-clipping', label: '塵封圖書館的剪報' },
] as const;
export type PresetKey = (typeof PRESETS)[number]['value'];

const WATER_ON = { key: 'water', in: ['corner', 'half', 'whole'] } as const;

export function conditionFields<G1 extends string, G2 extends string>(group: G1, more: G2) {
  return [
    {
      key: 'preset',
      type: 'select',
      label: '情境預設',
      group,
      options: PRESETS,
      hint: '選了會一次套用一組狀況，之後可以再微調。',
    },
    { key: 'aging', type: 'select', label: '泛黃程度', options: AGING_OPTIONS, group },
    { key: 'edge', type: 'select', label: '紙邊', options: EDGE_STYLES, group },
    { key: 'edgeDepth', type: 'range', label: '紙邊損傷深度', min: 0, max: 20, step: 0.5, unit: 'mm', group, showIf: { key: 'edge', in: ['torn', 'burnt', 'mouse', 'half'] } },
    { key: 'burnHoles', type: 'range', label: '燒穿的洞', min: 0, max: 6, step: 1, unit: '個', group },
    { key: 'water', type: 'select', label: '浸水', options: WATER_REGIONS, group },
    { key: 'waterStrength', type: 'range', label: '浸水程度', min: 0, max: 100, step: 5, unit: '%', group, showIf: WATER_ON, hint: '越高墨水暈得越開，部分字會無法辨識。' },
    {
      key: 'waterTint',
      type: 'select',
      label: '暈開的墨色',
      group,
      showIf: WATER_ON,
      options: [
        { value: 'brown', label: '偏褐（墨汁、舊墨水）' },
        { value: 'blue', label: '偏藍（藍黑墨水）' },
      ],
    },
    { key: 'folds', type: 'checkbox', label: '摺痕', group },
    { key: 'foldStyle', type: 'select', label: '摺法', options: FOLD_STYLES, group, showIf: { key: 'folds', in: [true] } },
    { key: 'crumple', type: 'range', label: '揉皺後攤平', min: 0, max: 100, step: 5, unit: '%', group },
    { key: 'cutGuide', type: 'checkbox', label: '列印淡色的「沿此剪下」裁切線', group, hint: '讓手撕、火燒的形狀可以照著剪出來。' },

    { key: 'stains', type: 'checkbox', label: '水漬與杯底圓環', group: more },
    { key: 'spots', type: 'range', label: '年久黃褐斑點', min: 0, max: 100, step: 5, unit: '%', group: more },
    { key: 'mold', type: 'range', label: '霉斑', min: 0, max: 100, step: 5, unit: '%', group: more },
    { key: 'sunFade', type: 'range', label: '日曬褪色', min: 0, max: 100, step: 5, unit: '%', group: more },
    { key: 'wormHoles', type: 'range', label: '蟲蛀小洞', min: 0, max: 40, step: 1, unit: '個', group: more },
    { key: 'pinHoles', type: 'checkbox', label: '圖釘孔', group: more },
    { key: 'rust', type: 'checkbox', label: '生鏽迴紋針的鏽痕', group: more },
    { key: 'tape', type: 'checkbox', label: '發黃的膠帶', group: more },
    { key: 'smudge', type: 'checkbox', label: '濕手抹糊的墨跡', group: more },
    { key: 'wax', type: 'checkbox', label: '蠟燭滴蠟', group: more },
    { key: 'pencilGhost', type: 'text', label: '鉛筆擦掉後殘留的字', maxLength: 20, group: more, placeholder: '例如：地窖鑰匙在灶下' },
    { key: 'inkFade', type: 'range', label: '墨水漸淡', min: 0, max: 100, step: 5, unit: '%', group: more },
    {
      key: 'effectSeed',
      type: 'seed',
      label: '隨機效果',
      button: '換一個',
      group: more,
      hint: '所有隨機效果（紙邊、破洞、污漬…）由這個種子決定，預覽與列印完全一致。正文可用 [保:…] 標出線索讓效果避開、[毀:…] 標出要毀掉的字。',
    },
  ] as const satisfies readonly Field[];
}

type ConditionFieldList = ReturnType<typeof conditionFields<'a', 'b'>>;
export type ConditionData = DataOf<ConditionFieldList>;

export const CONDITION_BASE: ConditionData = {
  preset: 'custom',
  aging: 'light',
  edge: 'none',
  edgeDepth: 3,
  burnHoles: 0,
  water: 'none',
  waterStrength: 50,
  waterTint: 'brown',
  folds: false,
  foldStyle: 'half',
  crumple: 0,
  cutGuide: false,
  stains: false,
  spots: 0,
  mold: 0,
  sunFade: 0,
  wormHoles: 0,
  pinHoles: false,
  rust: false,
  tape: false,
  smudge: false,
  wax: false,
  pencilGhost: '',
  inkFade: 0,
  effectSeed: 1,
};

export function conditionDefaults(overrides: Partial<ConditionData>): ConditionData {
  return { ...CONDITION_BASE, ...overrides };
}

/** 情境預設：一組狀況。套用時先回到基本值（全部關閉），再套上這一組。 */
export const PRESET_PATCHES: Readonly<Record<Exclude<PresetKey, 'custom'>, Partial<ConditionData>>> = {
  'fire-letter': { aging: 'heavy', edge: 'burnt', edgeDepth: 9, burnHoles: 2, smudge: true, spots: 25, folds: true, foldStyle: 'thirds', inkFade: 25, cutGuide: true },
  'sea-diary': { aging: 'medium', water: 'whole', waterStrength: 65, waterTint: 'blue', mold: 25, crumple: 30, edge: 'torn', edgeDepth: 2, spots: 30, inkFade: 35 },
  'pocket-telegram': { aging: 'medium', crumple: 85, folds: true, foldStyle: 'quarter', stains: true, spots: 30, edge: 'torn', edgeDepth: 1.5 },
  'cellar-deed': { aging: 'heavy', mold: 75, spots: 60, wormHoles: 14, water: 'corner', waterStrength: 45, edge: 'mouse', edgeDepth: 7, folds: true, foldStyle: 'thirds' },
  'torn-notes': { aging: 'light', edge: 'half', edgeDepth: 3, folds: true, foldStyle: 'half', pencilGhost: '別信他', cutGuide: true },
  'library-clipping': { aging: 'heavy', sunFade: 60, spots: 50, folds: true, foldStyle: 'half', tape: true, edge: 'scissors' },
};

/** 套用情境預設後的狀況欄位。 */
export function applyPreset(current: ConditionData, preset: string): ConditionData {
  if (preset === 'custom' || !(preset in PRESET_PATCHES)) return { ...current, preset: 'custom' };
  const patch = PRESET_PATCHES[preset as Exclude<PresetKey, 'custom'>];
  return { ...CONDITION_BASE, effectSeed: current.effectSeed, ...patch, preset: preset as PresetKey };
}

export const CONDITION_KEYS = Object.keys(CONDITION_BASE) as (keyof ConditionData)[];

/** 從某個道具的資料取出狀況欄位。 */
export function pickConditions(data: Readonly<Record<string, FieldValue>>): ConditionData {
  const out: Record<string, FieldValue> = {};
  for (const key of CONDITION_KEYS) out[key] = data[key] ?? CONDITION_BASE[key];
  return out as unknown as ConditionData;
}
