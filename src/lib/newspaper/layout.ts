// 整版報紙的排版引擎（純邏輯）。
//
// 直排報紙以「格」為單位：版面由上而下分成若干「段」（tier），每段由右而左排著若干「行」（slot），
// 每行可放 H 個字。每一則新聞、廣告、啟事都是一個矩形區塊：佔幾段（tierSpan）、從右邊第幾行開始、
// 共幾行寬（slots）。標題用兩倍大的字，一行標題佔兩行寬。
//
// 排版順序：主新聞放在右上角（跨兩段），其餘使用者新聞依序放進最空的段，最後用填版素材把每一段
// 由右而左補滿，直到沒有空行；放不下時在最後一則截斷並加「（未完）」。
// 所有斷行都由這裡計算，畫面上每一行都是固定的字，所以預覽、列印與「哪些字被剪到」的判斷完全一致。

import { markedChars, type MarkKind } from '../markup.ts';

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

export type LineStyle = 'title' | 'subtitle' | 'body' | 'big' | 'center' | 'heading' | 'row' | 'caption';

export interface TextLine {
  readonly text: string;
  /** 字的大小（1 = 內文字；2 = 兩倍大）。一行佔的寬度等於 size 行。 */
  readonly size: number;
  readonly style: LineStyle;
  /** 逐字的文字層標記（與 text 的字一一對應）；沒有標記時省略。 */
  readonly marks?: readonly (MarkKind | undefined)[];
}

export interface LaidBlock {
  readonly lines: readonly TextLine[];
  readonly slots: number;
  readonly truncated: boolean;
  readonly boxed: boolean;
}

export interface PlacedBlock extends LaidBlock {
  readonly id: string;
  readonly kind: BlockKind;
  readonly source: 'user' | 'filler';
  readonly tier: number;
  readonly tierSpan: number;
  /** 從版面右緣算起的第幾行（0 起算）。 */
  readonly slot: number;
  /** 這個區塊一行可以放幾個內文字。 */
  readonly charsPerLine: number;
}

export interface GridSpec {
  /** 段數。 */
  readonly tiers: number;
  /** 每段的行數（版面寬度）。 */
  readonly slots: number;
  /** 每段一行的字數。 */
  readonly chars: number;
  /** 段與段之間的間隔，換算成字數（跨段的區塊可以多放這麼多字）。 */
  readonly gapChars: number;
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

function paragraphsOf(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((p) => p.trim())
    .filter((p) => p !== '');
}

/** 把半形英數轉成全形，讓每個字都佔一格（民國報紙也多用全形或中文數字）。 */
export function toFullWidth(text: string): string {
  return text.replace(/[!-~]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0xfee0)).replace(/ /g, '　');
}

/** 依區塊種類排出每一行（尚未限制寬度）。cpl 為內文字每行字數。 */
export function layoutLines(block: SourceBlock, cpl: number): { lines: TextLine[]; boxed: boolean } {
  const lines: TextLine[] = [];
  const boxed = block.kind === 'ad' || block.kind === 'notice';
  const inner = boxed ? cpl - 1 : cpl;
  const push = (text: string, size: number, style: LineStyle, indent = 0): void => {
    const width = Math.max(2, Math.floor(inner / size));
    // 文字層標記（[保:…] 等）先拆開，再逐字轉全形；標記跟著字一起斷行。
    const tokens = markedChars(text).map((t) => ({ ch: toFullWidth(t.ch), mark: t.mark }));
    const anyMark = tokens.some((t) => t.mark !== undefined);
    for (const line of breakTokens(tokens, width, indent, (t) => t.ch, () => ({ ch: '　', mark: undefined }))) {
      const textLine = line.map((t) => t.ch).join('');
      lines.push(anyMark ? { text: textLine, size, style, marks: line.map((t) => t.mark) } : { text: textLine, size, style });
    }
  };
  switch (block.kind) {
    case 'news':
    case 'short': {
      const big = block.kind === 'news';
      if (block.title) push(block.title, big ? 2 : 1, big ? 'title' : 'heading');
      for (const sub of (block.subtitle ?? '').split(/[　 ]+/).filter(Boolean)) push(sub, 1, 'subtitle');
      paragraphsOf(block.body).forEach((p, i) => {
        const text = i === 0 && block.dateline ? `【${block.dateline}】${p}` : p;
        push(text, 1, 'body', 1);
      });
      break;
    }
    case 'ad': {
      if (block.title) push(block.title, 2, 'big');
      for (const p of paragraphsOf(block.body)) push(p, 1, 'center');
      break;
    }
    case 'notice': {
      if (block.title) push(block.title, 1, 'heading');
      for (const p of paragraphsOf(block.body)) push(p, 1, 'body', 1);
      break;
    }
    case 'list': {
      if (block.title) push(block.title, 1, 'heading');
      for (const p of paragraphsOf(block.body)) push(p, 1, 'row');
      break;
    }
    case 'tiny': {
      const text = toFullWidth(paragraphsOf(block.body).join('　'));
      lines.push({ text: Array.from(text).slice(0, inner).join(''), size: 1, style: 'body' });
      break;
    }
    case 'photo': {
      if (block.body) push(block.body, 1, 'caption');
      break;
    }
  }
  return { lines, boxed };
}

function slotsOf(lines: readonly TextLine[], boxed: boolean, extra = 0): number {
  return lines.reduce((s, l) => s + l.size, 0) + (boxed ? 1 : 0) + extra;
}

/** 區塊最少要幾行寬才值得放（放不下標題加一行內文就不放）。 */
export function minimumSlots(block: SourceBlock, cpl: number): number {
  if (block.kind === 'photo') return block.photoSlots ?? 0;
  const { lines, boxed } = layoutLines(block, cpl);
  const head = lines.filter((l) => l.style !== 'body' && l.style !== 'row' && l.style !== 'center');
  return Math.min(slotsOf(lines, boxed), slotsOf(head, boxed) + 1);
}

/**
 * 排出一個區塊；給了 maxSlots 時，超過就截斷，最後一行改成「…（未完）」。
 * 連最少的寬度都放不下時回傳 null。
 */
export function layoutBlock(block: SourceBlock, cpl: number, maxSlots?: number): LaidBlock | null {
  const { lines, boxed } = layoutLines(block, cpl);
  const photoExtra = block.kind === 'photo' ? (block.photoSlots ?? 0) : 0;
  const full = slotsOf(lines, boxed, photoExtra);
  if (maxSlots === undefined || full <= maxSlots) return { lines, slots: full, truncated: false, boxed };
  if (block.kind === 'photo' || block.kind === 'tiny') return null;
  if (maxSlots < minimumSlots(block, cpl)) return null;

  const kept: TextLine[] = [];
  let used = boxed ? 1 : 0;
  for (const line of lines) {
    if (used + line.size > maxSlots) break;
    kept.push(line);
    used += line.size;
  }
  // 最後一行換成截斷記號；若最後一行不是內文，就再往前找內文行。
  const width = Math.floor((boxed ? cpl - 1 : cpl) / 1);
  const mark = Array.from(TRUNCATION_MARK);
  let lastIndex = kept.length - 1;
  while (lastIndex >= 0 && (kept[lastIndex] as TextLine).size !== 1) lastIndex--;
  if (lastIndex < 0) return null;
  const last = kept[lastIndex] as TextLine;
  const chars = Array.from(last.text).slice(0, Math.max(0, width - mark.length));
  const truncatedLine: TextLine = last.marks
    ? { text: chars.join('') + TRUNCATION_MARK, size: 1, style: last.style, marks: [...last.marks.slice(0, chars.length), ...mark.map(() => undefined)] }
    : { text: chars.join('') + TRUNCATION_MARK, size: 1, style: last.style };
  kept[lastIndex] = truncatedLine;
  kept.length = lastIndex + 1;
  return { lines: kept, slots: slotsOf(kept, boxed), truncated: true, boxed };
}

export interface PackOptions {
  readonly grid: GridSpec;
  /** 使用者的區塊，第一則為主新聞。 */
  readonly userBlocks: readonly SourceBlock[];
  /** 填版素材（已依種子排好順序，鎖定的排在最前面）。 */
  readonly fillers: readonly SourceBlock[];
  /** 一行填版素材（補最後一兩行空隙用），會依序取用。 */
  readonly tinyFillers: readonly SourceBlock[];
  /** 主新聞最多佔版面寬度的比例。 */
  readonly mainMaxRatio?: number;
}

export interface PageLayout {
  readonly grid: GridSpec;
  readonly blocks: readonly PlacedBlock[];
  /** 使用者的內容放不下（有被截斷或整則放不進去）。 */
  readonly overflow: boolean;
  readonly usedFillerIds: readonly string[];
}

export function charsForSpan(grid: GridSpec, span: number): number {
  return grid.chars * span + Math.floor(grid.gapChars * (span - 1));
}

/** 排滿整版。 */
export function packPage(options: PackOptions): PageLayout {
  const { grid } = options;
  const cursor = Array.from({ length: grid.tiers }, () => 0);
  const blocks: PlacedBlock[] = [];
  const used = new Set<string>();
  let overflow = false;

  const place = (block: SourceBlock, tier: number, span: number, laid: LaidBlock): void => {
    const slot = Math.max(...cursor.slice(tier, tier + span));
    blocks.push({
      ...laid,
      id: block.id,
      kind: block.kind,
      source: block.source,
      tier,
      tierSpan: span,
      slot,
      charsPerLine: charsForSpan(grid, span),
    });
    for (let t = tier; t < tier + span; t++) cursor[t] = slot + laid.slots;
    if (block.source === 'filler') used.add(block.id);
  };

  // 1. 主新聞：右上角，跨兩段（只有一段時就一段）。
  const [main, ...others] = options.userBlocks;
  if (main) {
    const span = Math.min(2, grid.tiers);
    const maxSlots = Math.max(4, Math.floor(grid.slots * (options.mainMaxRatio ?? 0.6)));
    const laid = layoutBlock(main, charsForSpan(grid, span), maxSlots);
    if (laid) {
      place(main, 0, span, laid);
      if (laid.truncated) overflow = true;
    } else overflow = true;
  }

  // 2. 其他使用者區塊：依序放進最空的段（同樣空時取上面的段）。
  for (const block of others) {
    const cpl = grid.chars;
    let best = -1;
    for (let t = 0; t < grid.tiers; t++) {
      if (best === -1 || (cursor[t] as number) < (cursor[best] as number)) best = t;
    }
    const room = grid.slots - (cursor[best] as number);
    const laid = layoutBlock(block, cpl, room);
    if (!laid) {
      overflow = true;
      continue;
    }
    if (laid.truncated) overflow = true;
    place(block, best, 1, laid);
  }

  // 3. 填版：每一段由右而左補到滿。
  const pool = options.fillers.filter((b) => !used.has(b.id));
  const tiny = [...options.tinyFillers];
  let tinyIndex = 0;
  for (let t = 0; t < grid.tiers; t++) {
    let guard = 0;
    while ((cursor[t] as number) < grid.slots && guard++ < 500) {
      const room = grid.slots - (cursor[t] as number);
      let placed = false;
      // 先找整則放得下的
      for (let i = 0; i < pool.length; i++) {
        const block = pool[i] as SourceBlock;
        const laid = layoutBlock(block, grid.chars);
        if (laid && laid.slots <= room) {
          place(block, t, 1, laid);
          pool.splice(i, 1);
          placed = true;
          break;
        }
      }
      if (placed) continue;
      // 再截斷一則可截斷的（新聞、短訊、啟事）
      if (room >= 3) {
        for (let i = 0; i < pool.length; i++) {
          const block = pool[i] as SourceBlock;
          if (block.kind !== 'news' && block.kind !== 'short' && block.kind !== 'notice') continue;
          const laid = layoutBlock(block, grid.chars, room);
          if (laid && laid.slots === room) {
            place(block, t, 1, laid);
            pool.splice(i, 1);
            placed = true;
            break;
          }
        }
      }
      if (placed) continue;
      // 剩一兩行：用一行素材補
      const filler = tiny[tinyIndex % Math.max(1, tiny.length)];
      tinyIndex++;
      if (!filler) break;
      const laid = layoutBlock(filler, grid.chars);
      if (!laid) break;
      place({ ...filler, id: `${filler.id}#${tinyIndex}` }, t, 1, laid);
    }
  }
  return { grid, blocks, overflow, usedFillerIds: [...used] };
}

/** 每一段的區塊是否剛好由右排到左、沒有重疊也沒有空行。 */
export function checkCoverage(layout: PageLayout): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  for (let t = 0; t < layout.grid.tiers; t++) {
    const spans = layout.blocks
      .filter((b) => b.tier <= t && t < b.tier + b.tierSpan)
      .map((b) => [b.slot, b.slot + b.slots] as const)
      .sort((a, b) => a[0] - b[0]);
    let pos = 0;
    for (const [start, end] of spans) {
      if (start < pos) problems.push(`第 ${t + 1} 段在第 ${start} 行重疊`);
      if (start > pos) problems.push(`第 ${t + 1} 段第 ${pos}～${start} 行是空的`);
      pos = Math.max(pos, end);
    }
    if (pos < layout.grid.slots) problems.push(`第 ${t + 1} 段最後 ${layout.grid.slots - pos} 行是空的`);
    if (pos > layout.grid.slots) problems.push(`第 ${t + 1} 段超出版面 ${pos - layout.grid.slots} 行`);
  }
  return { ok: problems.length === 0, problems };
}
