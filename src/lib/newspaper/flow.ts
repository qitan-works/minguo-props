// 欄內文字流排（純邏輯）：把一則一則的新聞依序排進一個區塊的直行裡。
//
// 區塊的形狀不一定是矩形（L 形、階梯形），所以每一直行可放的字數各自不同；這裡只管
// 「第幾行從第幾格開始、放幾格」，不管紙上的公釐座標。標題分級：
// - h1：佔三行寬、字高 2.6 倍（主新聞、大新聞）
// - h2：佔兩行寬、字高 1.7 倍
// - h3：佔一行寬、內文大小但用標題字型
// - sub：副題，一行寬、字略小
// 一個區塊裡可以接連排好幾則；最後一則放不下時截斷並加「（未完）」，剩一兩行就用一行小訊補滿。

import { markedChars } from '../markup.ts';
import { toFullWidth } from './layout.ts';
import { applyPunctuation, headlinePunctuation, type Glyph, type PunctuationMode } from './punctuation.ts';

export interface ColumnSlot {
  /** 從版面右緣算起第幾行（0 起算）。 */
  readonly col: number;
  /** 這一行文字從第幾格開始（以內文字高為單位）。 */
  readonly top: number;
  /** 這一行可以放幾格。 */
  readonly cap: number;
}

export type LineRole = 'h1' | 'h2' | 'h3' | 'sub' | 'kicker' | 'body' | 'row' | 'tiny';

export interface FlowLine {
  readonly itemId: string;
  readonly source: 'user' | 'filler';
  readonly role: LineRole;
  /** 這一行從 slots 的第幾行開始（右邊第一行）。 */
  readonly slot: number;
  /** 佔幾行寬。 */
  readonly span: number;
  /** 字高（內文字 = 1）。 */
  readonly size: number;
  /** 起始格與可用長度（以內文字高為單位）。 */
  readonly top: number;
  readonly length: number;
  readonly glyphs: readonly Glyph[];
  readonly align: 'start' | 'center';
}

export interface FlowItem {
  readonly id: string;
  readonly source: 'user' | 'filler';
  /** 標題等級：1 最大。 */
  readonly level: 1 | 2 | 3;
  readonly title: string;
  readonly subtitles: readonly string[];
  /** 電頭，例如「本埠訊」（排在內文最前面，加【】）。 */
  readonly kicker?: string;
  readonly paragraphs: readonly string[];
  /** 表列（船期、物價）：每段一行，不縮排。 */
  readonly rows?: boolean;
}

export const HEADLINE = {
  1: { span: 3, size: 2.6 },
  2: { span: 2, size: 1.7 },
  3: { span: 1, size: 1 },
} as const;
const SUB_SIZE = 0.86;

/** 不可放在行首與行尾的標點。 */
const NO_LINE_START = new Set(Array.from('，。、；：！？）」』〉》】〕…—％'));
const NO_LINE_END = new Set(Array.from('（「『〈《【〔'));

export function truncationMark(mode: PunctuationMode): string {
  return mode === 'modern' ? '（未完）' : '未完';
}

export function glyphsOf(text: string, mode: PunctuationMode): Glyph[] {
  const tokens: Glyph[] = markedChars(text).map((t) => (t.mark ? { ch: toFullWidth(t.ch), mark: t.mark } : { ch: toFullWidth(t.ch) }));
  return applyPunctuation(tokens, mode);
}

/** 把一串字依各行的容量填進去，處理避頭點與避尾點。回傳每行的字與用掉的字數。 */
export function fillColumns(glyphs: readonly Glyph[], caps: readonly number[]): { lines: Glyph[][]; used: number } {
  const lines: Glyph[][] = [];
  let pos = 0;
  for (const cap of caps) {
    if (pos >= glyphs.length) break;
    let n = Math.min(cap, glyphs.length - pos);
    if (n <= 0) {
      lines.push([]);
      continue;
    }
    const next = glyphs[pos + n];
    if (next && NO_LINE_START.has(next.ch) && n > 1) n--;
    const last = glyphs[pos + n - 1];
    if (last && NO_LINE_END.has(last.ch) && n > 1) n--;
    lines.push(glyphs.slice(pos, pos + n));
    pos += n;
  }
  return { lines, used: pos };
}

/** 標題斷成幾行，每行字數盡量平均。 */
export function wrapHeadline(chars: readonly string[], perLine: number): string[][] {
  if (chars.length === 0 || perLine <= 0) return [];
  const count = Math.ceil(chars.length / perLine);
  const each = Math.ceil(chars.length / count);
  const out: string[][] = [];
  for (let i = 0; i < chars.length; i += each) out.push(chars.slice(i, i + each));
  return out;
}

interface ItemLayout {
  readonly lines: FlowLine[];
  /** 用掉幾行（slots）。 */
  readonly used: number;
  readonly truncated: boolean;
}

/**
 * 從 slots[start] 起排一則。allowTruncate 為 false 時，放不完就回傳 null；
 * 為 true 時放到最後一行截斷（但至少要放得下標題與一行內文）。
 */
export function layoutItem(
  item: FlowItem,
  slots: readonly ColumnSlot[],
  start: number,
  mode: PunctuationMode,
  allowTruncate: boolean,
): ItemLayout | null {
  const lines: FlowLine[] = [];
  let i = start;
  const remain = (): number => slots.length - i;
  const base = { itemId: item.id, source: item.source } as const;

  // 標題
  const title = headlinePunctuation(toFullWidth(item.title.trim()), mode);
  if (title) {
    const { span, size } = HEADLINE[item.level];
    const actualSpan = Math.min(span, Math.max(1, remain()));
    const group = slots.slice(i, i + actualSpan);
    const cap = Math.min(...group.map((s) => s.cap));
    const perLine = Math.max(1, Math.floor(cap / size));
    for (const chars of wrapHeadline(Array.from(title), perLine)) {
      if (i + actualSpan > slots.length) return null;
      const g = slots.slice(i, i + actualSpan);
      lines.push({
        ...base,
        role: item.level === 1 ? 'h1' : item.level === 2 ? 'h2' : 'h3',
        slot: i,
        span: actualSpan,
        size,
        top: Math.max(...g.map((s) => s.top)),
        length: Math.min(...g.map((s) => s.cap)),
        glyphs: chars.map((ch) => ({ ch })),
        align: item.level === 3 ? 'start' : 'center',
      });
      i += actualSpan;
    }
  }
  // 副題
  for (const sub of item.subtitles) {
    const text = headlinePunctuation(toFullWidth(sub.trim()), mode);
    if (!text) continue;
    if (i >= slots.length) return null;
    const s = slots[i] as ColumnSlot;
    const perLine = Math.max(1, Math.floor(s.cap / SUB_SIZE));
    for (const chars of wrapHeadline(Array.from(text), perLine)) {
      if (i >= slots.length) return null;
      const slot = slots[i] as ColumnSlot;
      lines.push({ ...base, role: 'sub', slot: i, span: 1, size: SUB_SIZE, top: slot.top, length: slot.cap, glyphs: chars.map((ch) => ({ ch })), align: 'center' });
      i++;
    }
  }
  // 內文：每段從新的一行開始
  const paragraphs = item.paragraphs.map((p, k) => (k === 0 && item.kicker ? `【${item.kicker}】${p}` : p));
  let truncated = false;
  for (let k = 0; k < paragraphs.length; k++) {
    const glyphs = glyphsOf(paragraphs[k] as string, mode);
    if (glyphs.length === 0) continue;
    if (i >= slots.length) {
      truncated = true;
      break;
    }
    if (item.rows) {
      const slot = slots[i] as ColumnSlot;
      lines.push({ ...base, role: 'row', slot: i, span: 1, size: 1, top: slot.top, length: slot.cap, glyphs: glyphs.slice(0, slot.cap), align: 'start' });
      i++;
      continue;
    }
    const indented: Glyph[] = [{ ch: '　' }, ...glyphs];
    const caps = slots.slice(i).map((s) => s.cap);
    const { lines: filled, used } = fillColumns(indented, caps);
    for (const g of filled) {
      const slot = slots[i] as ColumnSlot;
      lines.push({ ...base, role: 'body', slot: i, span: 1, size: 1, top: slot.top, length: slot.cap, glyphs: g, align: 'start' });
      i++;
    }
    if (used < indented.length) {
      truncated = true;
      break;
    }
  }
  if (truncated) {
    if (!allowTruncate) return null;
    // 最後一行內文換成截斷記號
    let last = lines.length - 1;
    while (last >= 0 && (lines[last] as FlowLine).role !== 'body' && (lines[last] as FlowLine).role !== 'row') last--;
    if (last < 0) return null;
    const line = lines[last] as FlowLine;
    const mark = Array.from(truncationMark(mode)).map((ch) => ({ ch }));
    const keep = Math.max(0, Math.min(line.glyphs.length, line.length - mark.length));
    lines[last] = { ...line, glyphs: [...line.glyphs.slice(0, keep), ...mark] };
    lines.length = last + 1;
    i = line.slot + 1;
  }
  return { lines, used: i - start, truncated };
}

export interface FlowOptions {
  readonly mode: PunctuationMode;
  /** 往後找幾則看有沒有剛好放得下的。 */
  readonly lookahead?: number;
  /** 補最後一兩行用的一行小訊（依序取用，會被移出佇列）。 */
  readonly tiny: FlowItem[];
}

export interface FlowResult {
  readonly lines: FlowLine[];
  /** 用到的素材（依排入順序）。 */
  readonly used: string[];
  readonly truncated: string[];
}

/** 一則至少要幾行才值得截斷排入。 */
const MIN_TRUNCATE_SLOTS = 3;

/** 把佇列裡的新聞排進一個區塊，直到每一行都有字。用掉的會從 queue 移除。 */
export function flowRegion(slots: readonly ColumnSlot[], queue: FlowItem[], options: FlowOptions): FlowResult {
  const lines: FlowLine[] = [];
  const used: string[] = [];
  const truncated: string[] = [];
  const lookahead = options.lookahead ?? 10;
  let i = 0;
  let guard = 0;
  while (i < slots.length && guard++ < 400) {
    let placed = false;
    for (let k = 0; k < Math.min(lookahead, queue.length); k++) {
      const item = queue[k] as FlowItem;
      const laid = layoutItem(item, slots, i, options.mode, false);
      if (laid && laid.used > 0) {
        lines.push(...laid.lines);
        used.push(item.id);
        queue.splice(k, 1);
        i += laid.used;
        placed = true;
        break;
      }
    }
    if (placed) continue;
    if (slots.length - i >= MIN_TRUNCATE_SLOTS && queue.length > 0) {
      const k = queue.findIndex((q) => !q.rows);
      const item = queue[k >= 0 ? k : 0] as FlowItem;
      const laid = layoutItem(item, slots, i, options.mode, true);
      if (laid && laid.used > 0) {
        lines.push(...laid.lines);
        used.push(item.id);
        if (laid.truncated) truncated.push(item.id);
        queue.splice(queue.indexOf(item), 1);
        i += laid.used;
        continue;
      }
    }
    // 剩一兩行：一行小訊
    const tiny = options.tiny.shift();
    const slot = slots[i] as ColumnSlot;
    if (!tiny) {
      i++;
      continue;
    }
    const glyphs = glyphsOf(tiny.paragraphs.join('　'), options.mode).slice(0, slot.cap);
    lines.push({ itemId: tiny.id, source: tiny.source, role: 'tiny', slot: i, span: 1, size: 1, top: slot.top, length: slot.cap, glyphs, align: 'start' });
    used.push(tiny.id);
    i++;
  }
  return { lines, used, truncated };
}
