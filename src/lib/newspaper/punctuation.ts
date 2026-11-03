// 句讀模式（純邏輯）：民國報紙的標點隨年代不同。
// - modern：現代標點，照原文；
// - circle：舊式圈點，只用「。」「、」，而且不佔字格，印在字的右側（句末用「。」，句中停頓用「、」）；
// - none：無標點，全部拿掉（引號、括號也拿掉）。

import type { MarkKind } from '../markup.ts';

export type PunctuationMode = 'modern' | 'circle' | 'none';

export const PUNCTUATION_MODES: readonly { value: PunctuationMode; label: string }[] = [
  { value: 'circle', label: '舊式圈點（只用。、印在字旁）' },
  { value: 'none', label: '無標點' },
  { value: 'modern', label: '現代標點' },
];

export function isPunctuationMode(v: string): v is PunctuationMode {
  return v === 'modern' || v === 'circle' || v === 'none';
}

/** 一個字（可能帶文字層標記與旁注圈點）。 */
export interface Glyph {
  readonly ch: string;
  readonly mark?: MarkKind;
  /** 舊式圈點：印在這個字右側的「。」或「、」。 */
  readonly pm?: '。' | '、';
}

const SENTENCE_END = new Set(Array.from('。！？!?'));
const PAUSE = new Set(Array.from('，、；：,;:'));
/** 無標點與圈點模式都直接拿掉的符號。 */
const DROPPED = new Set(Array.from('「」『』（）()〈〉《》【】〔〕“”‘’"\'…—─・·．'));

export function isPunctuation(ch: string): boolean {
  return SENTENCE_END.has(ch) || PAUSE.has(ch) || DROPPED.has(ch);
}

/** 依句讀模式改寫一串字。 */
export function applyPunctuation(glyphs: readonly Glyph[], mode: PunctuationMode): Glyph[] {
  if (mode === 'modern') return [...glyphs];
  const out: Glyph[] = [];
  for (const g of glyphs) {
    if (!isPunctuation(g.ch)) {
      out.push(g);
      continue;
    }
    if (mode === 'none') continue;
    const pm = SENTENCE_END.has(g.ch) ? '。' : PAUSE.has(g.ch) ? '、' : undefined;
    const prev = out[out.length - 1];
    // 圈點印在前一個字的右側；開頭或前一字是空白時就不圈。句號優先於頓號。
    if (pm && prev && prev.ch !== '　' && prev.pm !== '。') {
      out[out.length - 1] = { ...prev, pm };
    }
  }
  return out;
}

/** 標題用：圈點與無標點模式都把標點全部拿掉，現代模式照原文。 */
export function headlinePunctuation(text: string, mode: PunctuationMode): string {
  if (mode === 'modern') return text;
  return Array.from(text)
    .map((ch) => (isPunctuation(ch) ? (PAUSE.has(ch) || SENTENCE_END.has(ch) ? '　' : '') : ch))
    .join('')
    .replace(/　{2,}/g, '　')
    .replace(/^　|　$/g, '');
}
