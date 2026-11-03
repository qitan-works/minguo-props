// 各道具共用的欄位：紙張做舊效果。

import { FONT_OPTIONS } from '../fonts.ts';
import type { Option } from './schema.ts';

export const AGING_OPTIONS = [
  { value: 'none', label: '無（新紙）' },
  { value: 'light', label: '輕微泛黃' },
  { value: 'medium', label: '中度做舊' },
  { value: 'heavy', label: '重度做舊' },
] as const satisfies readonly Option[];

export function agingFields<G extends string>(group: G) {
  return [
    { key: 'aging', type: 'select', label: '做舊程度', options: AGING_OPTIONS, group },
    { key: 'folds', type: 'checkbox', label: '摺痕', group },
    { key: 'stains', type: 'checkbox', label: '污漬', group },
    { key: 'effectSeed', type: 'seed', label: '隨機效果', button: '換一個', hint: '污漬、紙邊等隨機效果的位置；預覽與列印完全相同。', group },
  ] as const;
}

/** 紙張尺寸（公釐）。 */
export interface PaperSize {
  readonly label: string;
  readonly width: number;
  readonly height: number;
  /** 對應 CSS 具名頁面（@page 名稱），列印時用來設定紙張大小。 */
  readonly page: string;
}

export const PAPER_SIZES = {
  'a4-portrait': { label: 'A4 直式（210×297 mm）', width: 210, height: 297, page: 'a4-portrait' },
  'a4-landscape': { label: 'A4 橫式（297×210 mm）', width: 297, height: 210, page: 'a4-landscape' },
  'a5-portrait': { label: 'A5 直式（148×210 mm）', width: 148, height: 210, page: 'a5-portrait' },
  'a5-landscape': { label: 'A5 橫式（210×148 mm）', width: 210, height: 148, page: 'a5-landscape' },
  'card-landscape': { label: '名片橫式（90×54 mm）', width: 90, height: 54, page: 'card-landscape' },
  'card-portrait': { label: '名片直式（54×90 mm）', width: 54, height: 90, page: 'card-portrait' },
} as const satisfies Readonly<Record<string, PaperSize>>;

export type PaperKey = keyof typeof PAPER_SIZES;

export function paperOptions(keys: readonly PaperKey[]): Option[] {
  return keys.map((key) => ({ value: key, label: PAPER_SIZES[key].label }));
}

export function isPaperKey(value: string): value is PaperKey {
  return Object.prototype.hasOwnProperty.call(PAPER_SIZES, value);
}

const FONT_ERA_OPTIONS = [
  { value: 'custom', label: '自訂' },
  { value: '1910s', label: '1910 年代（行書、明體）' },
  { value: '1920s', label: '1920 年代（顏楷、超明、鋼筆行楷）' },
  { value: '1930s', label: '1930 年代（特黑、仿宋、清松行楷）' },
] as const satisfies readonly Option[];

/** 電報、信箋、名片用：先選一組年代字型，再個別調整。 */
export function fontEraField<G extends string>(group: G) {
  return { key: 'fontEra', type: 'select', label: '字型年代組合', options: FONT_ERA_OPTIONS, group, hint: '一次換掉下面五個字型；個別調整後顯示為「自訂」。' } as const;
}

/** 每個道具的報頭、標題、內文、廣告大字、手寫部分可分別選字型。 */
export function fontFields<G extends string>(group: G) {
  return [
    { key: 'fontMasthead', type: 'select', label: '報頭字型', options: FONT_OPTIONS, group, hint: '報紙的報頭；電報的局名；請帖的抬頭。' },
    { key: 'fontTitle', type: 'select', label: '標題字型', options: FONT_OPTIONS, group },
    { key: 'fontBody', type: 'select', label: '內文字型', options: FONT_OPTIONS, group },
    { key: 'fontAd', type: 'select', label: '廣告大字字型', options: FONT_OPTIONS, group, hint: '報紙廣告的特大字；名片的機構名；信紙的箋紙店號；電報局戳。' },
    { key: 'fontHand', type: 'select', label: '手寫字型', options: FONT_OPTIONS, group, hint: '字型只有在選用時才會下載，而且只下載用到的字。' },
  ] as const;
}

export interface FontChoice {
  readonly masthead: string;
  readonly title: string;
  readonly body: string;
  readonly ad: string;
  readonly hand: string;
}

/** 表單資料裡的五個字型角色。 */
export function fontsOf(data: { readonly fontMasthead: string; readonly fontTitle: string; readonly fontBody: string; readonly fontAd: string; readonly fontHand: string }): FontChoice {
  return { masthead: data.fontMasthead, title: data.fontTitle, body: data.fontBody, ad: data.fontAd, hand: data.fontHand };
}
