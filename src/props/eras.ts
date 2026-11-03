// 報紙的年代預設：一次設定句讀、報頭位置、各角色字型與印刷質感。
// 字型以「偏好清單」表示，取第一個已收錄的字型；都沒有時退回思源宋體／霞鶩文楷。

import { FONTS } from '../fonts.ts';
import type { MastheadLayout } from '../lib/newspaper/sheetgeom.ts';
import type { PunctuationMode } from '../lib/newspaper/punctuation.ts';

export type EraKey = 'custom' | '1910s' | '1920s' | '1930s';

export const ERAS: readonly { value: EraKey; label: string }[] = [
  { value: '1910s', label: '1910 年代：舊式句讀、行書報頭、明體為主' },
  { value: '1920s', label: '1920 年代：圈點、顏楷報頭、標題混用隸書' },
  { value: '1930s', label: '1930 年代：現代標點、特黑廣告、仿宋內文' },
  { value: 'custom', label: '自訂' },
];

export function isEra(v: string): v is EraKey {
  return ERAS.some((e) => e.value === v);
}

/** 王漢宗自由字型與其他字型在 src/fonts.ts 的 id。 */
export const FONT_IDS = {
  ming: 'wang-ming',
  teming: 'wang-teming',
  chaoming: 'wang-chaoming',
  tehei: 'wang-tehei',
  li: 'wang-li',
  fangsong: 'wang-fangsong',
  yankai: 'wang-yankai',
  xing: 'wang-xing',
  pen: 'wang-pen',
  jason5: 'jason-5',
  jason7: 'jason-7',
  jason8: 'jason-8',
  notoSerif: 'noto-serif',
  cactus: 'cactus',
  lxgw: 'lxgw',
} as const;

export interface EraFonts {
  readonly masthead: readonly string[];
  /** 手寫（信箋正文、電報譯文、名片上的手寫字）。 */
  readonly hand: readonly string[];
  readonly title: readonly string[];
  readonly body: readonly string[];
  readonly ad: readonly string[];
  /** 第二、三級標題與副題（同一版混用不同字型）。 */
  readonly h2: readonly string[];
  readonly h3: readonly string[];
  readonly sub: readonly string[];
}

const F = FONT_IDS;

export const ERA_SETTINGS: Readonly<
  Record<Exclude<EraKey, 'custom'>, { readonly punctuation: PunctuationMode; readonly masthead: Exclude<MastheadLayout, 'none'>; readonly press: number; readonly fonts: EraFonts }>
> = {
  '1910s': {
    punctuation: 'circle',
    masthead: 'right',
    press: 72,
    fonts: {
      masthead: [F.xing, F.yankai, F.lxgw],
      hand: [F.xing, F.lxgw],
      title: [F.chaoming, F.teming, F.cactus, F.notoSerif],
      body: [F.ming, F.notoSerif],
      ad: [F.teming, F.chaoming, F.notoSerif],
      h2: [F.teming, F.cactus, F.notoSerif],
      h3: [F.yankai, F.cactus, F.notoSerif],
      sub: [F.ming, F.notoSerif],
    },
  },
  '1920s': {
    punctuation: 'circle',
    masthead: 'corner-right',
    press: 58,
    fonts: {
      masthead: [F.yankai, F.xing, F.lxgw],
      hand: [F.pen, F.xing, F.lxgw],
      title: [F.chaoming, F.teming, F.cactus, F.notoSerif],
      body: [F.ming, F.notoSerif],
      ad: [F.teming, F.li, F.notoSerif],
      h2: [F.li, F.yankai, F.cactus, F.notoSerif],
      h3: [F.yankai, F.teming, F.notoSerif],
      sub: [F.fangsong, F.ming, F.notoSerif],
    },
  },
  '1930s': {
    punctuation: 'modern',
    masthead: 'corner-left',
    press: 42,
    fonts: {
      masthead: [F.yankai, F.xing, F.lxgw],
      hand: [F.jason5, F.pen, F.lxgw],
      title: [F.tehei, F.chaoming, F.notoSerif],
      body: [F.fangsong, F.ming, F.notoSerif],
      ad: [F.tehei, F.chaoming, F.notoSerif],
      h2: [F.li, F.chaoming, F.cactus, F.notoSerif],
      h3: [F.chaoming, F.tehei, F.notoSerif],
      sub: [F.fangsong, F.ming, F.notoSerif],
    },
  },
};

/** 偏好清單裡第一個已收錄的字型。 */
export function resolveFont(prefs: readonly string[]): string {
  return prefs.find((id) => FONTS.some((f) => f.id === id)) ?? prefs[prefs.length - 1] ?? F.notoSerif;
}

export interface EraPatch {
  readonly era: EraKey;
  readonly punctuation: PunctuationMode;
  readonly mastheadLayout: Exclude<MastheadLayout, 'none'>;
  readonly press: number;
  readonly fontMasthead: string;
  readonly fontTitle: string;
  readonly fontBody: string;
  readonly fontAd: string;
}

/** 選了某個年代後要改的欄位；「自訂」不改任何欄位。 */
export function eraPatch(era: EraKey): EraPatch | null {
  if (era === 'custom') return null;
  const s = ERA_SETTINGS[era];
  return {
    era,
    punctuation: s.punctuation,
    mastheadLayout: s.masthead,
    press: s.press,
    fontMasthead: resolveFont(s.fonts.masthead),
    fontTitle: resolveFont(s.fonts.title),
    fontBody: resolveFont(s.fonts.body),
    fontAd: resolveFont(s.fonts.ad),
  };
}

export interface EraFontPatch {
  readonly fontEra: EraKey;
  readonly fontMasthead: string;
  readonly fontTitle: string;
  readonly fontBody: string;
  readonly fontAd: string;
  readonly fontHand: string;
}

/** 電報、信箋、名片的「字型年代組合」：只改五個字型角色。 */
export function eraFontPatch(era: EraKey): EraFontPatch | null {
  if (era === 'custom') return null;
  const f = ERA_SETTINGS[era].fonts;
  return {
    fontEra: era,
    fontMasthead: resolveFont(f.masthead),
    fontTitle: resolveFont(f.title),
    fontBody: resolveFont(f.body),
    fontAd: resolveFont(f.ad),
    fontHand: resolveFont(f.hand),
  };
}

/** 第二、三級標題與副題的字型：依年代混用；自訂時跟著標題字型。 */
export function headlineMix(era: string, fontTitle: string, fontBody: string): { h2: string; h3: string; sub: string } {
  if (!isEra(era) || era === 'custom') return { h2: fontTitle, h3: fontTitle, sub: fontBody };
  const f = ERA_SETTINGS[era].fonts;
  return { h2: resolveFont(f.h2), h3: resolveFont(f.h3), sub: resolveFont(f.sub) };
}
