// 文字層標記（純邏輯）。在信件、報紙、電報的正文裡可以用：
//
//   [保:文字]     保護區：線索，所有隨機效果都會避開
//   [毀:文字]     必毀區：火燒、水漬等效果會專門打在這裡
//   [黑:文字]     塗黑
//   [刪:文字]     刪除線
//   [改:舊|新]    劃掉重寫（舊字劃掉，新字寫在旁邊）
//   [斷:文字]     寫到一半中斷（最後幾個字的筆畫被切掉一部分）
//
// 標記不能巢狀；不成對的方括號照原樣顯示。

export type MarkKind = 'protect' | 'destroy' | 'redact' | 'strike' | 'rewrite' | 'cutoff';

export const MARK_TAGS: Readonly<Record<string, MarkKind>> = {
  保: 'protect',
  毀: 'destroy',
  黑: 'redact',
  刪: 'strike',
  改: 'rewrite',
  斷: 'cutoff',
};

export interface Segment {
  readonly text: string;
  readonly mark?: MarkKind;
  /** 劃掉重寫時的新字。 */
  readonly replacement?: string;
}

const TAG_RE = /\[(保|毀|黑|刪|改|斷)[:：]([^\[\]]*)\]/g;

export function parseMarkup(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(TAG_RE)) {
    const index = m.index ?? 0;
    if (index > last) out.push({ text: text.slice(last, index) });
    const mark = MARK_TAGS[m[1] ?? ''] as MarkKind;
    const inner = m[2] ?? '';
    if (mark === 'rewrite') {
      const sep = inner.search(/[|｜]/);
      const old = sep === -1 ? inner : inner.slice(0, sep);
      const replacement = sep === -1 ? '' : inner.slice(sep + 1);
      if (old) out.push({ text: old, mark, replacement });
    } else if (inner) {
      out.push({ text: inner, mark });
    }
    last = index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/** 去掉標記後實際寫在紙上的字（劃掉重寫時舊字與新字都算，新字接在舊字後面）。 */
export function stripMarkup(text: string): string {
  return parseMarkup(text)
    .map((s) => s.text + (s.replacement ?? ''))
    .join('');
}

/** 逐字附上標記，給需要逐字處理的地方（例如報紙斷行、電報方格）。 */
export interface MarkedChar {
  readonly ch: string;
  readonly mark?: MarkKind;
  /** 劃掉重寫的新字只標在被劃掉那段的最後一個字上。 */
  readonly replacement?: string;
}

export function markedChars(text: string): MarkedChar[] {
  const out: MarkedChar[] = [];
  for (const seg of parseMarkup(text)) {
    const chars = Array.from(seg.text);
    chars.forEach((ch, i) => {
      if (!seg.mark) out.push({ ch });
      else if (seg.mark === 'rewrite' && i === chars.length - 1 && seg.replacement) {
        out.push({ ch, mark: seg.mark, replacement: seg.replacement });
      } else out.push({ ch, mark: seg.mark });
    });
  }
  return out;
}

/** 文字裡有沒有任何標記。 */
export function hasMarkup(text: string): boolean {
  return parseMarkup(text).some((s) => s.mark !== undefined);
}
