// 解析 Unihan 文字檔並產生前端使用的精簡 JSON。純函式，方便測試。
//
// Unihan 檔案格式（UAX #38）：每行 `U+XXXX<TAB>欄位名<TAB>值`，`#` 開頭為註解。
//
// 產生的資料有兩部分：
// - codes：Unihan_OtherMappings.txt 的 kTaiwanTelegraph（字 → 四碼電碼）。
// - variants：異體字代查表。電碼本收的常是舊字形（例如「啓」「卽」「爲」），
//   現代常用的「啟」「即」「為」反而查不到。對每個「沒有電碼、但有異體字有電碼」的字，
//   依 Unihan_Variants.txt 依序找：kZVariant → kSemanticVariant → kSpoofingVariant，
//   取第一個有電碼的異體字；都沒有時，若 kTraditionalVariant（簡體 → 繁體）恰好只有一個
//   有電碼的繁體字，就用那個字。kSpecializedSemanticVariant（只有部分意義相同）不採用。

export interface TelegraphDataFile {
  readonly $comment: string;
  readonly unicodeVersion: string;
  readonly field: string;
  readonly source: string;
  readonly sha256: string;
  readonly license: string;
  readonly count: number;
  readonly variantCount: number;
  /** 字 → 四碼電碼；少數字有兩個電碼時以半形空白分隔，第一個為主要電碼。 */
  readonly codes: Readonly<Record<string, string>>;
  /** 沒有電碼的字 → 用來代查電碼的異體字。 */
  readonly variants: Readonly<Record<string, string>>;
}

export interface UnihanEntry {
  readonly codePoint: number;
  readonly char: string;
  readonly value: string;
}

const LINE_RE = /^U\+([0-9A-F]{4,6})\t(k[A-Za-z0-9_]+)\t(.+)$/;
const TELEGRAPH_VALUE_RE = /^\d{4}( \d{4})*$/;
const VARIANT_TARGET_RE = /^U\+([0-9A-F]{4,6})(?:<.*)?$/;

export function parseUnihanField(text: string, field: string): UnihanEntry[] {
  const out: UnihanEntry[] = [];
  const lines = text.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (line === '' || line.startsWith('#')) continue;
    const m = LINE_RE.exec(line);
    if (!m) throw new Error(`第 ${index + 1} 行格式不符：${line.slice(0, 60)}`);
    const [, hex, name, value] = m;
    if (name !== field || hex === undefined || value === undefined) continue;
    const codePoint = Number.parseInt(hex, 16);
    out.push({ codePoint, char: String.fromCodePoint(codePoint), value });
  }
  return out;
}

/** 取出 kTaiwanTelegraph 並驗證每個值都是四碼數字。 */
export function parseTaiwanTelegraph(text: string): UnihanEntry[] {
  const entries = parseUnihanField(text, 'kTaiwanTelegraph');
  const seen = new Set<number>();
  for (const e of entries) {
    if (!TELEGRAPH_VALUE_RE.test(e.value)) {
      throw new Error(`U+${e.codePoint.toString(16).toUpperCase()} 的電碼格式不符：${e.value}`);
    }
    if (seen.has(e.codePoint)) {
      throw new Error(`U+${e.codePoint.toString(16).toUpperCase()} 重複出現`);
    }
    seen.add(e.codePoint);
  }
  return entries;
}

export const VARIANT_FIELDS = ['kZVariant', 'kSemanticVariant', 'kSpoofingVariant', 'kTraditionalVariant'] as const;
export type VariantField = (typeof VARIANT_FIELDS)[number];
export type VariantMap = ReadonlyMap<number, Readonly<Partial<Record<VariantField, readonly number[]>>>>;

/** 解析 Unihan_Variants.txt 中本專案用到的欄位。值如 `U+5553<kLau,kMatthews U+...`。 */
export function parseUnihanVariants(text: string): VariantMap {
  const map = new Map<number, Partial<Record<VariantField, number[]>>>();
  for (const field of VARIANT_FIELDS) {
    for (const entry of parseUnihanField(text, field)) {
      const targets = entry.value.split(' ').map((token) => {
        const m = VARIANT_TARGET_RE.exec(token);
        if (!m?.[1]) throw new Error(`U+${entry.codePoint.toString(16).toUpperCase()} 的 ${field} 格式不符：${token}`);
        return Number.parseInt(m[1], 16);
      });
      const record = map.get(entry.codePoint) ?? {};
      record[field] = targets;
      map.set(entry.codePoint, record);
    }
  }
  return map;
}

/** 依本檔開頭說明的規則，為沒有電碼的字找可以代查的異體字。結果依碼位排序。 */
export function buildVariantFallback(
  telegraph: readonly UnihanEntry[],
  variants: VariantMap,
): Record<string, string> {
  const hasCode = new Set(telegraph.map((e) => e.codePoint));
  const found: [number, number][] = [];
  for (const [cp, fields] of variants) {
    if (hasCode.has(cp)) continue;
    let pick: number | undefined;
    for (const field of ['kZVariant', 'kSemanticVariant', 'kSpoofingVariant'] as const) {
      pick = fields[field]?.find((t) => t !== cp && hasCode.has(t));
      if (pick !== undefined) break;
    }
    if (pick === undefined && fields.kTraditionalVariant) {
      const candidates = fields.kTraditionalVariant.filter((t) => t !== cp && hasCode.has(t));
      if (candidates.length === 1) pick = candidates[0];
    }
    if (pick !== undefined) found.push([cp, pick]);
  }
  found.sort((a, b) => a[0] - b[0]);
  const out: Record<string, string> = {};
  for (const [from, to] of found) out[String.fromCodePoint(from)] = String.fromCodePoint(to);
  return out;
}

export interface BuildMeta {
  readonly unicodeVersion: string;
  readonly source: string;
  readonly sha256: string;
}

/** 電碼依電碼排序（同碼再依碼位），讓產生結果穩定、差異好讀。 */
export function buildTelegraphData(
  entries: readonly UnihanEntry[],
  variants: Readonly<Record<string, string>>,
  meta: BuildMeta,
): TelegraphDataFile {
  const sorted = [...entries].sort((a, b) => {
    if (a.value < b.value) return -1;
    if (a.value > b.value) return 1;
    return a.codePoint - b.codePoint;
  });
  const codes: Record<string, string> = {};
  for (const e of sorted) codes[e.char] = e.value;
  for (const [from, to] of Object.entries(variants)) {
    if (from in codes) throw new Error(`異體字代查表的「${from}」本身已有電碼`);
    if (!(to in codes)) throw new Error(`異體字代查表的「${from}」→「${to}」沒有電碼`);
  }
  return {
    $comment:
      '由 scripts/unihan-telegraph.ts 自動產生，請勿手動修改。資料取自 Unicode Unihan 資料庫（kTaiwanTelegraph 與異體字欄位），授權見 licenses/Unicode-License-v3.txt。',
    unicodeVersion: meta.unicodeVersion,
    field: 'kTaiwanTelegraph',
    source: meta.source,
    sha256: meta.sha256,
    license: 'Unicode-3.0',
    count: sorted.length,
    variantCount: Object.keys(variants).length,
    codes,
    variants: { ...variants },
  };
}

function objectLines(obj: Readonly<Record<string, string>>): string[] {
  const entries = Object.entries(obj);
  return entries.map(([k, v], i) => `${JSON.stringify(k)}:${JSON.stringify(v)}${i === entries.length - 1 ? '' : ','}`);
}

/** 每個字一行（不縮排以節省空間），方便審查差異；結尾換行。 */
export function serializeTelegraphData(data: TelegraphDataFile): string {
  const lines: string[] = ['{'];
  for (const [key, value] of Object.entries(data)) {
    if (key === 'codes' || key === 'variants') continue;
    lines.push(`${JSON.stringify(key)}:${JSON.stringify(value)},`);
  }
  lines.push('"codes":{', ...objectLines(data.codes), '},');
  lines.push('"variants":{', ...objectLines(data.variants), '}');
  lines.push('}');
  return `${lines.join('\n')}\n`;
}
