// 報紙排版的共用小工具（純邏輯）：素材區塊的型別、斷行（避頭點、避尾點）與全形轉換。
// 第四版的分段網格整版排版在 sections.ts 與 flow.ts。

export type BlockKind = 'news' | 'short' | 'ad' | 'notice' | 'list' | 'tiny' | 'photo';

export interface SourceBlock {
  readonly id: string;
  readonly kind: BlockKind;
  readonly title?: string;
  readonly subtitle?: string;
  readonly dateline?: string;
  /** 段落或行以換行分隔。 */
  readonly body: string;
  readonly source: 'user' | 'filler';
  /** 照片區塊佔的行數（只用於 kind = 'photo'）。 */
  readonly photoSlots?: number;
}

export const TRUNCATION_MARK = '（未完）';

/** 不可放在行首的標點（避頭）與不可放在行尾的標點（避尾）。 */
const NO_LINE_START = new Set(Array.from('，。、；：！？）」』〉》】〕…—％'));
const NO_LINE_END = new Set(Array.from('（「『〈《【〔'));

/**
 * 把一段文字斷成每行最多 width 字。第一行可縮排 indent 字（以全形空白補）。
 * 避頭點：行首若是標點，把上一行最後一字移下來；避尾點：行尾若是開括號，移到下一行。
 */
export function breakLines(text: string, width: number, indent = 0): string[] {
  return breakTokens(Array.from(text), width, indent, (c) => c, () => '　').map((l) => l.join(''));
}

/** 同 breakLines，但可帶著每個字的附加資料（例如文字層標記）一起斷行。 */
export function breakTokens<T>(tokens: readonly T[], width: number, indent: number, charOf: (t: T) => string, space: () => T): T[][] {
  if (width < 2) throw new RangeError(`每行至少要 2 字：${width}`);
  const lines: T[][] = [];
  let current: T[] = Array.from({ length: Math.min(indent, width - 1) }, space);
  for (const ch of tokens) {
    if (current.length >= width) {
      lines.push(current);
      current = [];
    }
    current.push(ch);
  }
  if (current.length > 0) lines.push(current);
  // 修正避頭、避尾
  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1] as T[];
    const line = lines[i] as T[];
    if (line[0] !== undefined && NO_LINE_START.has(charOf(line[0])) && prev.length > 1) {
      line.unshift(prev.pop() as T);
    }
    const tail = prev[prev.length - 1];
    if (tail !== undefined && NO_LINE_END.has(charOf(tail)) && prev.length > 1) {
      line.unshift(prev.pop() as T);
    }
    // 移下來之後這一行可能超過寬度：多出的字往後推。
    while (line.length > width) {
      const overflow = line.pop() as T;
      const next = lines[i + 1];
      if (next) next.unshift(overflow);
      else lines.push([overflow]);
    }
  }
  return lines;
}

/** 把半形英數轉成全形，讓每個字都佔一格（民國報紙也多用全形或中文數字）。 */
export function toFullWidth(text: string): string {
  return text.replace(/[!-~]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0xfee0)).replace(/ /g, '　');
}
