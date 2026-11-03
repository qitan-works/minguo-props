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

/** 每個道具的標題、內文、手寫部分可分別選字型。 */
export function fontFields<G extends string>(group: G) {
  return [
    { key: 'fontTitle', type: 'select', label: '標題字型', options: FONT_OPTIONS, group },
    { key: 'fontBody', type: 'select', label: '內文字型', options: FONT_OPTIONS, group },
    { key: 'fontHand', type: 'select', label: '手寫字型', options: FONT_OPTIONS, group, hint: '字型只有在選用時才會下載，而且只下載用到的字。' },
  ] as const;
}
