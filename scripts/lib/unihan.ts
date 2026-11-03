// 解析 Unihan 文字檔（例如 Unihan_OtherMappings.txt）中的單一欄位，
// 並產生前端使用的精簡 JSON。純函式，方便測試。
//
// Unihan 檔案格式（UAX #38）：每行 `U+XXXX<TAB>欄位名<TAB>值`，`#` 開頭為註解。

export interface TelegraphDataFile {
  readonly $comment: string;
  readonly unicodeVersion: string;
  readonly field: string;
  readonly source: string;
  readonly sha256: string;
  readonly license: string;
  readonly count: number;
  /** 字 → 四碼電碼；少數字有兩個電碼時以半形空白分隔，第一個為主要電碼。 */
  readonly codes: Readonly<Record<string, string>>;
}

export interface UnihanEntry {
  readonly codePoint: number;
  readonly char: string;
  readonly value: string;
}

const LINE_RE = /^U\+([0-9A-F]{4,6})\t(k[A-Za-z0-9_]+)\t(.+)$/;
const TELEGRAPH_VALUE_RE = /^\d{4}( \d{4})*$/;

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

export interface BuildMeta {
  readonly unicodeVersion: string;
  readonly source: string;
  readonly sha256: string;
}

/** 依電碼排序（同碼再依碼位），讓產生結果穩定、差異好讀。 */
export function buildTelegraphData(entries: readonly UnihanEntry[], meta: BuildMeta): TelegraphDataFile {
  const sorted = [...entries].sort((a, b) => {
    if (a.value < b.value) return -1;
    if (a.value > b.value) return 1;
    return a.codePoint - b.codePoint;
  });
  const codes: Record<string, string> = {};
  for (const e of sorted) codes[e.char] = e.value;
  return {
    $comment:
      '由 scripts/unihan-telegraph.ts 自動產生，請勿手動修改。資料取自 Unicode Unihan 資料庫的 kTaiwanTelegraph 欄位，授權見 licenses/Unicode-License-v3.txt。',
    unicodeVersion: meta.unicodeVersion,
    field: 'kTaiwanTelegraph',
    source: meta.source,
    sha256: meta.sha256,
    license: 'Unicode-3.0',
    count: sorted.length,
    codes,
  };
}

/** 每個字一行（不縮排以節省空間），方便審查差異；結尾換行。 */
export function serializeTelegraphData(data: TelegraphDataFile): string {
  const head = { ...data, codes: undefined };
  const lines: string[] = ['{'];
  for (const [key, value] of Object.entries(head)) {
    if (value === undefined) continue;
    lines.push(`${JSON.stringify(key)}:${JSON.stringify(value)},`);
  }
  lines.push('"codes":{');
  const entries = Object.entries(data.codes);
  entries.forEach(([char, code], i) => {
    const comma = i === entries.length - 1 ? '' : ',';
    lines.push(`${JSON.stringify(char)}:${JSON.stringify(code)}${comma}`);
  });
  lines.push('}');
  lines.push('}');
  return `${lines.join('\n')}\n`;
}
