// 中文電碼（四碼電碼）查詢與電文標註。
//
// 電碼資料來自 Unicode Unihan 資料庫的 kTaiwanTelegraph 欄位（見 src/data/telegraph.json
// 與 scripts/unihan-telegraph.ts）。這是臺灣使用的標準電碼，與民國時期電碼本大致相同，
// 但個別字可能與當時的版本有出入。

export interface Codebook {
  /** 查詢單一字（一個 Unicode 碼位）的電碼；查不到時回傳 undefined。 */
  lookup(char: string): readonly string[] | undefined;
  readonly size: number;
}

export type TelegramCell =
  | { readonly kind: 'han'; readonly char: string; readonly codes: readonly string[] }
  | { readonly kind: 'missing'; readonly char: string }
  | { readonly kind: 'other'; readonly char: string };

const CODE_RE = /^\d{4}( \d{4})*$/;
const HAN_RE = /^\p{Script=Han}$/u;
// 標點與空白：舊式電文不拍發標點，可選擇略去。
const PUNCT_OR_SPACE_RE = /^[\p{P}\p{S}\p{Z}\s]$/u;

export function createCodebook(codes: Readonly<Record<string, string>>): Codebook {
  const map = new Map<string, readonly string[]>();
  for (const [char, value] of Object.entries(codes)) {
    if (Array.from(char).length !== 1) throw new Error(`電碼表的鍵必須是單一字：${char}`);
    if (!CODE_RE.test(value)) throw new Error(`電碼格式不符：${char} → ${value}`);
    map.set(char, value.split(' '));
  }
  return {
    lookup(char: string): readonly string[] | undefined {
      const direct = map.get(char);
      if (direct) return direct;
      // 相容表意字（例如 U+F900 區）以 NFC 正規化後再查一次。
      const nfc = char.normalize('NFC');
      return nfc !== char ? map.get(nfc) : undefined;
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
  const cleaned = text.replace(/[︀-️]|\uDB40[\uDD00-\uDDEF]/g, '');
  for (const char of cleaned) {
    if (char === '\n' || char === '\r') continue;
    if (PUNCT_OR_SPACE_RE.test(char)) {
      if (dropPunctuation || /\s/.test(char)) continue;
      cells.push({ kind: 'other', char });
      continue;
    }
    if (isHan(char)) {
      const codes = book.lookup(char);
      cells.push(codes ? { kind: 'han', char, codes } : { kind: 'missing', char });
    } else {
      cells.push({ kind: 'other', char });
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
