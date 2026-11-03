// 中文數字。
//
// - toChineseNumber(1928)            → 一千九百二十八
// - toChineseNumber(21, { date: true }) → 廿一（日期常用的「廿」「卅」寫法）
// - toChineseDigits('1928')          → 一九二八（逐字，電話、門牌、年份常用）
// - toFinancialNumber(105)           → 壹佰零伍（大寫，帳目與請帖金額）

const DIGITS = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'] as const;
const FINANCIAL_DIGITS = ['零', '壹', '貳', '參', '肆', '伍', '陸', '柒', '捌', '玖'] as const;
const SMALL_UNITS = ['', '十', '百', '千'] as const;
const FINANCIAL_SMALL_UNITS = ['', '拾', '佰', '仟'] as const;
const BIG_UNITS = ['', '萬', '億', '兆'] as const;

export interface ChineseNumberOptions {
  /** 日期寫法：20～29 寫「廿」、30～39 寫「卅」（例如廿一、卅）。預設 false。 */
  readonly date?: boolean;
  /** 「零」的寫法。一般行文用「零」（一百零五），預設「零」。 */
  readonly zero?: '零' | '〇';
}

function assertSafeInteger(n: number): void {
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new RangeError(`只支援非負整數：${n}`);
  }
  if (n >= 10 ** 16) throw new RangeError(`數字太大：${n}`);
}

/** 0～9999 的一段，回傳不含前導「零」的寫法。 */
function sectionToChinese(
  section: number,
  digits: readonly string[],
  units: readonly string[],
  zero: string,
): string {
  let out = '';
  let pendingZero = false;
  for (let pos = 3; pos >= 0; pos--) {
    const d = Math.floor(section / 10 ** pos) % 10;
    if (d === 0) {
      if (out !== '') pendingZero = true;
      continue;
    }
    if (pendingZero) {
      out += zero;
      pendingZero = false;
    }
    out += (digits[d] ?? '') + (units[pos] ?? '');
  }
  return out;
}

function compose(n: number, digits: readonly string[], units: readonly string[], zero: string): string {
  if (n === 0) return zero;
  const sections: number[] = [];
  let rest = n;
  while (rest > 0) {
    sections.push(rest % 10000);
    rest = Math.floor(rest / 10000);
  }
  let out = '';
  let needZero = false;
  for (let i = sections.length - 1; i >= 0; i--) {
    const sec = sections[i] ?? 0;
    if (sec === 0) {
      if (out !== '') needZero = true;
      continue;
    }
    // 前一段非空、而這一段不滿千（例如 1,0005 → 一萬零五），要補「零」。
    if (out !== '' && (needZero || sec < 1000)) out += zero;
    needZero = false;
    out += sectionToChinese(sec, digits, units, zero) + (BIG_UNITS[i] ?? '');
  }
  return out;
}

export function toChineseNumber(n: number, options: ChineseNumberOptions = {}): string {
  assertSafeInteger(n);
  const zero = options.zero ?? '零';
  if (options.date) {
    if (n >= 20 && n < 30) return `廿${n === 20 ? '' : (DIGITS[n - 20] ?? '')}`;
    if (n >= 30 && n < 40) return `卅${n === 30 ? '' : (DIGITS[n - 30] ?? '')}`;
  }
  const out = compose(n, DIGITS, SMALL_UNITS, zero);
  // 開頭的「一十」習慣省略「一」：十、十五、十萬（但一百一十五保留）。
  return out.startsWith('一十') ? out.slice(1) : out;
}

export function toFinancialNumber(n: number): string {
  assertSafeInteger(n);
  return compose(n, FINANCIAL_DIGITS, FINANCIAL_SMALL_UNITS, '零');
}

/** 把字串中的阿拉伯數字（半形或全形）逐字換成中文數字，其他字元保留。 */
export function toChineseDigits(text: string): string {
  return text.replace(/[0-9０-９]/g, (ch) => {
    const code = ch.charCodeAt(0);
    const d = code >= 0xff10 ? code - 0xff10 : code - 0x30;
    return DIGITS[d] ?? ch;
  });
}
