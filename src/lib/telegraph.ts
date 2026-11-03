// 中文電碼（四碼電碼）查詢與電文標註。
//
// 電碼資料來自 Unicode Unihan 資料庫的 kTaiwanTelegraph 欄位（見 src/data/telegraph.json
// 與 scripts/unihan-telegraph.ts）。這是臺灣使用的標準電碼，與民國時期電碼本大致相同，
// 但個別字可能與當時的版本有出入。電碼本收的常是舊字形（例如「啓」「卽」「爲」），
// 所以另有異體字代查表：查不到「啟」時改用「啓」的電碼，並標示出來。

import { markedChars, type MarkKind } from './markup.ts';

export interface LookupResult {
  readonly codes: readonly string[];
  /** 本字沒有電碼、改用異體字代查時，記下所用的字。 */
  readonly via?: string;
}

export interface Codebook {
  /** 查詢單一字（一個 Unicode 碼位）的電碼；查不到時回傳 undefined。 */
  lookup(char: string): LookupResult | undefined;
  readonly size: number;
}

export type TelegramCell = (
  | { readonly kind: 'han'; readonly char: string; readonly codes: readonly string[]; readonly via?: string }
  | { readonly kind: 'missing'; readonly char: string }
  | { readonly kind: 'other'; readonly char: string }
) & {
  /** 文字層標記（[保:…]、[毀:…] 等）。 */
  readonly mark?: MarkKind;
};

const CODE_RE = /^\d{4}( \d{4})*$/;
const HAN_RE = /^\p{Script=Han}$/u;
// 標點與空白：舊式電文不拍發標點，可選擇略去。
const PUNCT_OR_SPACE_RE = /^[\p{P}\p{S}\p{Z}\s]$/u;

function isSingleChar(text: string): boolean {
  return Array.from(text).length === 1;
}

export function createCodebook(
  codes: Readonly<Record<string, string>>,
  variants: Readonly<Record<string, string>> = {},
): Codebook {
  const map = new Map<string, readonly string[]>();
  for (const [char, value] of Object.entries(codes)) {
    if (!isSingleChar(char)) throw new Error(`電碼表的鍵必須是單一字：${char}`);
    if (!CODE_RE.test(value)) throw new Error(`電碼格式不符：${char} → ${value}`);
    map.set(char, value.split(' '));
  }
  const variantMap = new Map<string, string>();
  for (const [from, to] of Object.entries(variants)) {
    if (!isSingleChar(from) || !isSingleChar(to)) throw new Error(`異體字代查表格式不符：${from} → ${to}`);
    if (map.has(to)) variantMap.set(from, to);
  }

  function direct(char: string): LookupResult | undefined {
    const found = map.get(char);
    if (found) return { codes: found };
    const via = variantMap.get(char);
    const viaCodes = via === undefined ? undefined : map.get(via);
    return via !== undefined && viaCodes ? { codes: viaCodes, via } : undefined;
  }

  return {
    lookup(char: string): LookupResult | undefined {
      const result = direct(char);
      if (result) return result;
      // 相容表意字（例如 U+F900 區）以 NFC 正規化後再查一次。
      const nfc = char.normalize('NFC');
      return nfc !== char ? direct(nfc) : undefined;
    },
    get size() {
      return map.size;
    },
  };
}

export function isHan(char: string): boolean {
  return HAN_RE.test(char);
}

export interface AnnotateOptions {
  /** 略去標點與空白（舊式電文不拍發標點）。預設 true。 */
  readonly dropPunctuation?: boolean;
}

/** 把電文逐字切開並標上電碼。換行一律略去。 */
export function annotateTelegram(text: string, book: Codebook, options: AnnotateOptions = {}): TelegramCell[] {
  const dropPunctuation = options.dropPunctuation ?? true;
  const cells: TelegramCell[] = [];
  // 去掉異體字選擇符（VS1–16、VS17–256），以免干擾查詢。
  const cleaned = text.replace(/[\uFE00-\uFE0F]|\uDB40[\uDD00-\uDDEF]/g, '');
  for (const { ch: char, mark } of markedChars(cleaned)) {
    const push = (cell: TelegramCell): void => {
      cells.push(mark ? { ...cell, mark } : cell);
    };
    if (char === '\n' || char === '\r') continue;
    if (PUNCT_OR_SPACE_RE.test(char)) {
      if (dropPunctuation || /\s/.test(char)) continue;
      push({ kind: 'other', char });
      continue;
    }
    if (isHan(char)) {
      const found = book.lookup(char);
      if (!found) push({ kind: 'missing', char });
      else if (found.via !== undefined) push({ kind: 'han', char, codes: found.codes, via: found.via });
      else push({ kind: 'han', char, codes: found.codes });
    } else {
      push({ kind: 'other', char });
    }
  }
  return cells;
}

/** 依出現順序列出查不到電碼的字（不重複）。 */
export function missingChars(cells: readonly TelegramCell[]): string[] {
  const seen = new Set<string>();
  for (const cell of cells) {
    if (cell.kind === 'missing') seen.add(cell.char);
  }
  return [...seen];
}

/** 依出現順序列出改用異體字代查的字（不重複），例如 [['啟', '啓']]。 */
export function substitutedChars(cells: readonly TelegramCell[]): [string, string][] {
  const seen = new Map<string, string>();
  for (const cell of cells) {
    if (cell.kind === 'han' && cell.via !== undefined && !seen.has(cell.char)) seen.set(cell.char, cell.via);
  }
  return [...seen];
}

/** 電報計字：每個拍發的字（含查無電碼的字與非漢字）算一字。 */
export function countWords(cells: readonly TelegramCell[]): number {
  return cells.length;
}

/** 把電文轉成電碼串，例如「馬」→ 7456；查不到的字以 ???? 表示。 */
export function encodeTelegram(cells: readonly TelegramCell[]): string {
  return cells
    .map((cell) => {
      if (cell.kind === 'han') return cell.codes[0] ?? '????';
      if (cell.kind === 'missing') return '????';
      return cell.char;
    })
    .join(' ');
}
