// 第四版：分段網格的整版排版（純邏輯）。
//
// 版面是「行 × 格」的格子（行由右而左、格由上而下），再由上而下切成固定的 8～12 段，段與段之間有
// 較粗的段線。每個區塊佔整數個段（高）與若干行（寬）：
//   1. 報頭框佔住右上（或角落）的幾段，框的高度對齊段線；
//   2. 「版面最下方」的區塊（一排大小不一的廣告格）先排在最後一兩段；
//   3. 其餘區塊依閱讀順序排：每次找最上面一段、最右邊的空位，放下一個區塊，所以頭條一定在右上；
//      區塊跨兩三段時，標題直排佔滿整個高度（標題跨段），內文仍依段由右而左排；
//   4. 排完還有空位，就用短訊補滿：整版除了邊框都是字。
// 不規則來自標題跨段、廣告框跨段與各區塊的寬窄，不是隨機高度。同一個種子永遠排出同樣的版面。

import { FLOW_KINDS, BODY_METRICS, TITLE_METRICS, markTitle, type BlockKind, type BlockStyle } from './blockstyle.ts';
import { flowRegion, layoutItem, wrapHeadline, type ColumnSlot, type FlowItem, type FlowLine } from './flow.ts';
import type { AdItem } from './ads.ts';
import { toFullWidth } from './layout.ts';
import type { PlannedBlock } from './pageplan.ts';
import { headlinePunctuation, type PunctuationMode } from './punctuation.ts';
import type { TableData, TocData } from './tables.ts';
import type { PictureKind } from './blockstyle.ts';

export interface Obstacle {
  readonly col: number;
  readonly row: number;
  readonly cols: number;
  readonly rows: number;
}

export interface BandLine {
  readonly text: string;
  /** 字高（內文字 = 1）。 */
  readonly size: number;
  /** 從標題列頂端算起第幾格（可為小數）。 */
  readonly row: number;
}

/** 橫排標題（由右而左），跨整個區塊寬。 */
export interface HeadlineBand {
  readonly rows: number;
  readonly lines: readonly BandLine[];
}

/** 標題橫排：一到兩行，字盡量大但不超過 maxSize。 */
export function headlineBand(title: string, width: number, aspect: number, mode: PunctuationMode, maxSize = 3.4): HeadlineBand | null {
  const chars = Array.from(headlinePunctuation(toFullWidth(title.trim()), mode));
  if (chars.length === 0 || width < 3) return null;
  const widthInCells = width * aspect * 0.94;
  let lines = 1;
  let size = Math.min(maxSize, widthInCells / chars.length);
  if (size < Math.min(2.2, maxSize * 0.8) && chars.length > 4) {
    lines = 2;
    size = Math.min(maxSize, widthInCells / Math.ceil(chars.length / 2));
  }
  size = Math.max(Math.min(1, maxSize), Math.round(size * 10) / 10);
  const per = Math.ceil(chars.length / lines);
  const out: BandLine[] = [];
  let row = 0.5;
  for (let i = 0; i < chars.length; i += per) {
    out.push({ text: chars.slice(i, i + per).join(''), size, row });
    row += size * 1.08;
  }
  return { rows: Math.ceil(row + 0.5), lines: out };
}

export interface RuleSegment {
  /** v：直線，at 是第 at−1 行與第 at 行之間；h：橫線（段線），at 是第 at−1 格與第 at 格之間。 */
  readonly dir: 'v' | 'h';
  readonly at: number;
  readonly from: number;
  readonly to: number;
}

/** 區塊的內容來源（由呼叫的一方依素材池提供）。 */
export interface ContentProvider {
  /** 這個區塊自己的幾則（主新聞、社論、專電……）；一般新聞與短訊回傳空的，直接從共用佇列取。 */
  flow(block: PlannedBlock): FlowItem[];
  /** 共用的填版佇列（使用者的新聞在最前面）。 */
  readonly queue: FlowItem[];
  /** 使用者的主新聞與第二則（估算區塊要多寬才放得下）。 */
  readonly userStory?: (source: 'lead' | 'second') => FlowItem | null;
  readonly tiny: FlowItem[];
  ad(block: PlannedBlock): AdItem | null;
  table(block: PlannedBlock): TableData;
  toc(block: PlannedBlock): TocData;
  picture(block: PlannedBlock): { readonly kind: PictureKind; readonly caption: string };
}

export interface SectionInput {
  readonly cols: number;
  readonly rows: number;
  readonly sections: number;
  readonly mode: PunctuationMode;
  /** 行寬與字高的比（pitch / cell），算橫排標題的寬度用。 */
  readonly aspect: number;
  readonly obstacle?: Obstacle;
  readonly blocks: readonly PlannedBlock[];
  readonly content: ContentProvider;
}

export interface PlacedBlock {
  readonly plan: PlannedBlock;
  readonly id: string;
  readonly kind: BlockKind;
  readonly style: BlockStyle;
  /** 最右邊一行（從版面右緣算起）。 */
  readonly col: number;
  /** 佔幾行。 */
  readonly w: number;
  /** 第一段與佔幾段。 */
  readonly s0: number;
  readonly span: number;
  /** 上下緣（格）。 */
  readonly top: number;
  readonly bottom: number;
  /** 頂端第一格留給段線（不在第一段時）。 */
  readonly gapTop: boolean;
  /** 框線內縮：左右各幾行、上下各幾格。 */
  readonly inset: { readonly cols: number; readonly rows: number };
  readonly slots: readonly ColumnSlot[];
  readonly lines: readonly FlowLine[];
  /** 直排標題跨段時佔的行數（這幾行的段線不畫）。 */
  readonly titleCols: number;
  readonly band?: HeadlineBand;
  readonly tag?: { readonly text: string; readonly rows: number };
  /** 套上區塊標題樣式的那一則（第一則或自訂標題）。 */
  readonly headItemId?: string;
  readonly ad?: AdItem;
  readonly table?: TableData;
  readonly toc?: TocData;
  readonly picture?: { readonly kind: PictureKind; readonly caption: string };
  /** 自動補上的短訊區塊（不是版面類型排的）。 */
  readonly filler: boolean;
  /** 用到的素材 id（鎖定時存下內容用）。 */
  readonly usedIds: readonly string[];
}

export interface SectionLayout {
  readonly cols: number;
  readonly rows: number;
  readonly sections: number;
  /** 每一段的上緣（格）；最後一個是版面底。 */
  readonly bounds: readonly number[];
  readonly blocks: readonly PlacedBlock[];
  /** 每一格屬於哪個區塊（blocks 的索引）；−2 為報頭。依列存放：owner[row * cols + col]。 */
  readonly owner: Int32Array;
  readonly rules: readonly RuleSegment[];
  /** 報頭框對齊段線後的高度（格）；沒有報頭框時為 0。 */
  readonly mastheadRows: number;
  /** 使用者的內容沒有全部排進去或被截斷。 */
  readonly overflow: boolean;
  readonly usedIds: readonly string[];
  /** 沒排進去的區塊（空間不夠）。 */
  readonly dropped: readonly string[];
}

const MASTHEAD = -2;

/** 區塊最窄幾行：種類的下限，文字區塊再加上標題直排時佔的寬度。 */
function minWidth(block: PlannedBlock): number {
  const base = MIN_WIDTH[block.style.kind];
  if (!FLOW_KINDS.has(block.style.kind) || block.style.titleDir === 'h') return base;
  return Math.max(base, TITLE_METRICS[block.style.titleSize].span + 2 + (block.style.frame === 'none' ? 0 : 2));
}

/** 各種類最窄幾行。 */
export const MIN_WIDTH: Readonly<Record<BlockKind, number>> = {
  news: 3,
  short: 2,
  editorial: 4,
  wire: 3,
  ad: 4,
  notice: 3,
  table: 5,
  toc: 4,
  serial: 6,
  picture: 4,
};

/** 把 rows 格切成 sections 段：每段一樣高，除不盡的分給上面幾段。 */
export function sectionBounds(rows: number, sections: number): number[] {
  const s = Math.max(1, Math.min(Math.floor(sections), Math.floor(rows / 3)));
  const base = Math.floor(rows / s);
  const extra = rows - base * s;
  const out = [0];
  for (let i = 0; i < s; i++) out.push((out[i] as number) + base + (i < extra ? 1 : 0));
  return out;
}

/** 直排標題（與副題）跨段時要佔幾行：每一行標題佔 span 行，每行副題一行。 */
export function titleColumns(item: FlowItem, cap: number, mode: PunctuationMode, subSize = 0.86): number {
  const title = headlinePunctuation(toFullWidth(item.title.trim()), mode);
  let n = 0;
  if (title) {
    const m = item.headline ?? { span: 1, size: 1 };
    const per = Math.max(1, Math.floor(cap / m.size));
    n += wrapHeadline(Array.from(title), per).length * m.span;
  }
  for (const sub of item.subtitles) {
    const text = headlinePunctuation(toFullWidth(sub.trim()), mode);
    if (text) n += wrapHeadline(Array.from(text), Math.max(1, Math.floor(cap / subSize))).length;
  }
  return n;
}

interface Placement {
  readonly block: PlannedBlock;
  readonly col: number;
  readonly w: number;
  readonly s0: number;
  readonly span: number;
  readonly filler: boolean;
}

export function layoutSections(input: SectionInput): SectionLayout {
  const C = input.cols;
  const R = input.rows;
  const bounds = sectionBounds(R, input.sections);
  const S = bounds.length - 1;
  const occ = new Int32Array(S * C).fill(-1);
  const at = (s: number, c: number): number => occ[s * C + c] as number;

  // 1. 報頭框：佔住它所在的幾段，高度對齊段線
  let mastheadRows = 0;
  if (input.obstacle) {
    const o = input.obstacle;
    let k = 1;
    while (k < S && (bounds[k] as number) < o.row + o.rows - 1) k++;
    mastheadRows = bounds[k] as number;
    for (let s = 0; s < k; s++) for (let c = o.col; c < Math.min(C, o.col + o.cols); c++) occ[s * C + c] = MASTHEAD;
  }

  const placements: Placement[] = [];
  const dropped: string[] = [];
  const mark = (p: Placement): void => {
    const index = placements.length;
    placements.push(p);
    for (let s = p.s0; s < p.s0 + p.span; s++) for (let c = p.col; c < p.col + p.w; c++) occ[s * C + c] = index;
  };
  const run = (s: number, c: number): number => {
    let n = 0;
    while (c + n < C && at(s, c + n) === -1) n++;
    return n;
  };
  const fits = (s: number, c: number, span: number, w: number): boolean => {
    if (s + span > S) return false;
    for (let k = s; k < s + span; k++) for (let x = c; x < c + w; x++) if (at(k, x) !== -1) return false;
    return true;
  };
  const firstFree = (fromSection = 0, toSection = S): { s: number; c: number } | null => {
    for (let s = fromSection; s < toSection; s++) for (let c = 0; c < C; c++) if (at(s, c) === -1) return { s, c };
    return null;
  };
  const secRows = Math.max(3, Math.floor(R / S) - 1);
  const chooseWidth = (block: PlannedBlock, avail: number): number => {
    const min = minWidth(block);
    let want = block.style.width;
    // 使用者的主新聞與第二則：估算要幾行才排得完（不截斷）
    if ((block.source === 'lead' || block.source === 'second') && want > 0 && FLOW_KINDS.has(block.style.kind)) {
      const story = input.content.userStory?.(block.source);
      if (story) want = Math.max(want, storyWidth(story, block.style, secRows, input.mode));
    }
    let w = want === 0 ? avail : Math.min(Math.max(want, min), avail);
    if (avail - w > 0 && avail - w < 3) w = avail;
    return w;
  };
  const fillerBlock = (id: string): PlannedBlock => ({
    id,
    zone: 'flow',
    source: 'pool',
    style: { kind: 'short', title: '', titleFont: '', titleSize: 5, titleDir: 'v', titleStyle: 'plain', titleMark: 'none', bodyFont: '', bodySize: 'm', frame: 'none', pattern: 'meander', span: 1, width: 0, picture: 'none' },
  });
  let fillerCount = 0;
  const fillGap = (s: number, c: number, w: number): void => {
    mark({ block: fillerBlock(`f${fillerCount++}`), col: c, w, s0: s, span: 1, filler: true });
  };

  // 2. 版面最下方的一排
  const bottom = input.blocks.filter((b) => b.zone === 'bottom');
  const band = Math.min(S - 1, Math.max(0, ...bottom.map((b) => Math.min(2, b.style.span))));
  for (const block of bottom) {
    const spot = firstFree(S - band, S);
    if (!spot) {
      dropped.push(block.id);
      continue;
    }
    const avail = run(spot.s, spot.c);
    if (avail < minWidth(block)) {
      fillGap(spot.s, spot.c, avail);
      dropped.push(block.id);
      continue;
    }
    const w = chooseWidth(block, avail);
    let span = Math.min(block.style.span, S - spot.s);
    while (span > 1 && !fits(spot.s, spot.c, span, w)) span--;
    mark({ block, col: spot.c, w, s0: spot.s, span, filler: false });
  }

  // 3. 其餘依閱讀順序
  for (const block of input.blocks.filter((b) => b.zone !== 'bottom')) {
    let placed = false;
    for (let guard = 0; guard < S * C && !placed; guard++) {
      const spot = firstFree();
      if (!spot) break;
      const avail = run(spot.s, spot.c);
      if (avail < minWidth(block)) {
        fillGap(spot.s, spot.c, avail);
        continue;
      }
      // 使用者的主新聞與第二則：寬度不夠時改成跨更多段（最多四段），盡量不截斷
      let target = block;
      const story = (block.source === 'lead' || block.source === 'second') && FLOW_KINDS.has(block.style.kind) ? input.content.userStory?.(block.source) : null;
      if (story && block.style.width > 0) {
        // 空位太窄、連跨三段都放不下時，先用短訊補這個空位，換下一個位置
        const best = storyWidth(story, { ...block.style, span: Math.min(3, S - spot.s) }, secRows, input.mode);
        if (avail < best && avail < C * 0.5 && firstFree() !== null && guard < S * C - 1) {
          fillGap(spot.s, spot.c, avail);
          continue;
        }
        for (let span = block.style.span; span <= Math.min(4, S - spot.s); span++) {
          const want = storyWidth(story, { ...block.style, span }, secRows, input.mode);
          target = { ...block, style: { ...block.style, span } };
          if (want <= avail && fits(spot.s, spot.c, span, Math.max(MIN_WIDTH[block.style.kind], Math.min(want, avail)))) break;
        }
      }
      const w = chooseWidth(target, avail);
      let span = Math.min(target.style.span, S - spot.s);
      while (span > 1 && !fits(spot.s, spot.c, span, w)) span--;
      mark({ block: target, col: spot.c, w, s0: spot.s, span, filler: false });
      placed = true;
    }
    if (!placed) dropped.push(block.id);
  }

  // 4. 剩下的空位用短訊補滿
  for (let spot = firstFree(); spot; spot = firstFree()) fillGap(spot.s, spot.c, run(spot.s, spot.c));

  // 依閱讀順序（右上起）排內容，頭條的內容一定在頭條區塊
  const order = placements.map((p, i) => ({ p, i })).sort((a, b) => a.p.s0 - b.p.s0 || a.p.col - b.p.col);
  const blocks: PlacedBlock[] = new Array<PlacedBlock>(placements.length);
  const used: string[] = [];
  let overflow = false;
  for (const { p, i } of order) {
    const laid = fillBlock(p, bounds, input);
    blocks[i] = laid.block;
    used.push(...laid.block.usedIds);
    if (laid.overflow) overflow = true;
  }
  if (dropped.some((id) => input.blocks.find((b) => b.id === id)?.source === 'lead' || input.blocks.find((b) => b.id === id)?.added)) overflow = true;

  // 每一格的歸屬
  const owner = new Int32Array(R * C).fill(-1);
  for (let s = 0; s < S; s++) {
    for (let c = 0; c < C; c++) {
      const v = at(s, c);
      for (let r = bounds[s] as number; r < (bounds[s + 1] as number); r++) owner[r * C + c] = v;
    }
  }
  return { cols: C, rows: R, sections: S, bounds, blocks, owner, rules: rulesOf(occ, bounds, C, blocks), mastheadRows, overflow, usedIds: used, dropped };
}

/** 估算一則要幾行寬才排得完：直排標題佔的行＋內文（橫排標題會佔掉第一段頂端幾格）。 */
export function storyWidth(item: FlowItem, style: BlockStyle, secRows: number, mode: PunctuationMode): number {
  const span = Math.max(1, style.span);
  const body = BODY_METRICS[style.bodySize];
  const metrics = TITLE_METRICS[style.titleSize];
  const head = { ...item, title: markTitle(item.title, style.titleMark), headline: metrics };
  const titleChars = Array.from(head.title.trim()).length;
  const bandRows = style.titleDir === 'h' && titleChars > 0 ? Math.ceil(Math.min(metrics.size, secRows / 2) * 1.08 * (titleChars > 12 ? 2 : 1) + 1) : 0;
  // 每一行（跨 span 段）放得下的字
  const rowsPerCol = Math.max(2, span * secRows - bandRows);
  const perCol = Math.max(1, Math.floor(rowsPerCol / body.size)) * (body.split ? 2 : 1);
  const chars = item.paragraphs.reduce((n, p, k) => n + Array.from(k === 0 && item.kicker ? `【${item.kicker}】${p}` : p).length + 1 + secRows / 2, 0);
  const bodyCols = Math.ceil((chars * 1.08) / perCol);
  const titleCols = style.titleDir === 'h' ? item.subtitles.length : titleColumns(head, span * secRows - 1, mode);
  const inset = style.frame === 'none' ? 0 : 2;
  return titleCols + bodyCols + inset + 2;
}

/** 區塊內縮：有框時上下各留一格；粗的框（雙線、粗細線、花邊）左右再各留一行。 */
export function insetOf(style: BlockStyle, w: number, kind: BlockKind): { cols: number; rows: number } {
  if (style.frame === 'none') return { cols: 0, rows: 0 };
  const heavy = style.frame === 'double' || style.frame === 'thickthin' || style.frame === 'pattern';
  return { cols: heavy && w >= 6 && FLOW_KINDS.has(kind) ? 1 : 0, rows: 1 };
}

function fillBlock(p: Placement, bounds: readonly number[], input: SectionInput): { block: PlacedBlock; overflow: boolean } {
  const { block } = p;
  const style = block.style;
  const kind = style.kind;
  const top = bounds[p.s0] as number;
  const bottomRow = bounds[p.s0 + p.span] as number;
  const gapTop = p.s0 > 0;
  const inset = insetOf(style, p.w, kind);
  const base = {
    plan: block,
    id: block.id,
    kind,
    style,
    col: p.col,
    w: p.w,
    s0: p.s0,
    span: p.span,
    top,
    bottom: bottomRow,
    gapTop,
    inset,
    filler: p.filler,
  };
  const empty = { slots: [] as ColumnSlot[], lines: [] as FlowLine[], titleCols: 0 };
  if (kind === 'ad') {
    const ad = input.content.ad(block);
    return { block: { ...base, ...empty, ...(ad ? { ad } : {}), usedIds: ad ? [ad.id] : [] }, overflow: false };
  }
  if (kind === 'table') return { block: { ...base, ...empty, table: input.content.table(block), usedIds: [] }, overflow: false };
  if (kind === 'toc') return { block: { ...base, ...empty, toc: input.content.toc(block), usedIds: [] }, overflow: false };
  if (kind === 'picture') return { block: { ...base, ...empty, picture: input.content.picture(block), usedIds: [] }, overflow: false };
  return flowBlock(p, base, bounds, input);
}

function flowBlock(
  p: Placement,
  base: Omit<PlacedBlock, 'slots' | 'lines' | 'titleCols' | 'usedIds'>,
  bounds: readonly number[],
  input: SectionInput,
): { block: PlacedBlock; overflow: boolean } {
  const { block } = p;
  const style = block.style;
  const mode = input.mode;
  const own = input.content.flow(block);
  const metrics = TITLE_METRICS[style.titleSize];
  const body = BODY_METRICS[style.bodySize];
  const bodyStyle = style.bodySize === 'm' ? undefined : { size: body.size, split: body.split };
  // 區塊的標題：自訂標題（另成一則），或第一則的標題
  const items: FlowItem[] = [...own];
  let head: FlowItem | null = null;
  if (style.title.trim()) {
    head = { id: `${block.id}:title`, source: 'user', level: 1, title: markTitle(style.title, style.titleMark), subtitles: [], paragraphs: [], headline: metrics };
    items.unshift(head);
  } else if (items[0]) {
    const first = items[0];
    head = { ...first, title: markTitle(first.title, style.titleMark), headline: metrics, ...(bodyStyle ? { body: bodyStyle } : {}) };
    items[0] = head;
  }
  const innerCols: number[] = [];
  for (let c = p.col + base.inset.cols; c < p.col + p.w - base.inset.cols; c++) innerCols.push(c);
  if (innerCols.length === 0) innerCols.push(p.col);
  const tagText = block.tag && innerCols.length >= 3 && !(style.titleDir === 'h') ? block.tag : undefined;
  const tagRows = tagText ? Array.from(tagText).length + 1 : 0;
  const sectionTop = (s: number): number => (bounds[s] as number) + (s > 0 ? 1 : 0) + (s === p.s0 ? base.inset.rows : 0);
  const sectionBottom = (s: number): number => (bounds[s + 1] as number) - (s === p.s0 + p.span - 1 ? base.inset.rows : 0);

  // 橫排標題（由右而左）：佔第一段頂端幾格
  let band: HeadlineBand | null = null;
  if (head && style.titleDir === 'h' && head.title) {
    const firstH = sectionBottom(p.s0) - sectionTop(p.s0);
    band = headlineBand(head.title, innerCols.length, input.aspect, mode, Math.min(metrics.size, Math.max(1, (firstH - 3) / 1.3)));
    if (band && band.rows > firstH - 2) band = null;
    if (band) {
      const stripped: FlowItem = { ...head, title: '' };
      if (head === items[0]) items[0] = stripped;
      head = stripped;
    }
  }
  // 直排標題跨段：標題與副題佔整個區塊高度的幾行
  let titleCols = 0;
  const tallTop = sectionTop(p.s0) + (band?.rows ?? 0);
  const tallBottom = sectionBottom(p.s0 + p.span - 1);
  if (head && head.title && !band && p.span > 1) {
    titleCols = Math.min(innerCols.length - 1, titleColumns(head, tallBottom - tallTop - 1, mode));
    if (titleCols < 1) titleCols = 0;
  }
  const slots: ColumnSlot[] = [];
  innerCols.slice(0, titleCols).forEach((c, j) => {
    const t = tallTop + (j === 0 ? tagRows : 0);
    slots.push({ col: c, top: t, cap: Math.max(1, tallBottom - t) });
  });
  for (let s = p.s0; s < p.s0 + p.span; s++) {
    innerCols.slice(titleCols).forEach((c, j) => {
      const t = sectionTop(s) + (s === p.s0 ? (band?.rows ?? 0) + (j === 0 && titleCols === 0 ? tagRows : 0) : 0);
      slots.push({ col: c, top: t, cap: Math.max(1, sectionBottom(s) - t) });
    });
  }

  const lines: FlowLine[] = [];
  const usedIds: string[] = [];
  let overflow = false;
  let start = 0;
  if (head) {
    // 標題太大放不下時，一級一級縮小，標題一定排在最前面
    let laid = layoutItem(head, slots, 0, mode, true);
    for (const size of [3, 4, 5] as const) {
      if (laid || !head.title) break;
      if (TITLE_METRICS[size].size >= (head.headline?.size ?? 99)) continue;
      const smaller: FlowItem = { ...head, headline: TITLE_METRICS[size] };
      laid = layoutItem(smaller, slots, 0, mode, true);
      if (laid) {
        if (items[0] === head) items[0] = smaller;
        else items.splice(items.indexOf(head), 1, smaller);
        head = smaller;
      }
    }
    if (laid) {
      lines.push(...laid.lines);
      start = laid.used;
      if (head !== items[0] || head.source === 'filler') usedIds.push(head.id);
      else usedIds.push(head.id);
      if (laid.truncated && head.source === 'user') overflow = true;
      items.splice(items.indexOf(head), 1);
    } else if (head.source === 'user') overflow = true;
  }
  const queue = [...items, ...input.content.queue];
  const flowed = flowRegion(slots.slice(start), queue, { mode, tiny: input.content.tiny, lookahead: 12, ...(bodyStyle ? { body: bodyStyle } : {}) });
  lines.push(...flowed.lines.map((l) => ({ ...l, slot: l.slot + start })));
  usedIds.push(...flowed.used);
  // 用掉的共用素材從共用佇列移除；這個區塊自己的沒排完就算了（使用者的要標示溢出）
  for (const id of flowed.used) {
    const k = input.content.queue.findIndex((q) => q.id === id);
    if (k >= 0) input.content.queue.splice(k, 1);
  }
  for (const item of items) if (item.source === 'user' && !flowed.used.includes(item.id)) overflow = true;
  for (const id of flowed.truncated) if (items.some((q) => q.id === id && q.source === 'user') || input.content.queue.some((q) => q.id === id && q.source === 'user')) overflow = true;
  return {
    block: {
      ...base,
      slots,
      lines,
      titleCols,
      ...(band ? { band } : {}),
      ...(tagText ? { tag: { text: tagText, rows: tagRows } } : {}),
      ...(head ? { headItemId: head.id } : {}),
      usedIds,
    },
    overflow,
  };
}

/**
 * 區塊之間的直線，與段線（段與段之間的橫線）。跨段的文字區塊裡也畫段線，
 * 只有直排標題跨段的那幾行、加框的區塊與廣告等不畫；報頭框自己有框，旁邊不畫。
 */
function rulesOf(occ: Int32Array, bounds: readonly number[], C: number, blocks: readonly PlacedBlock[]): RuleSegment[] {
  const S = bounds.length - 1;
  const at = (s: number, c: number): number => occ[s * C + c] as number;
  const out: RuleSegment[] = [];
  for (let k = 1; k < C; k++) {
    let start = -1;
    for (let s = 0; s <= S; s++) {
      const a = s < S ? at(s, k - 1) : -9;
      const b = s < S ? at(s, k) : -9;
      const on = s < S && a !== b && a !== MASTHEAD && b !== MASTHEAD;
      if (on && start < 0) start = s;
      if (!on && start >= 0) {
        out.push({ dir: 'v', at: k, from: bounds[start] as number, to: bounds[s] as number });
        start = -1;
      }
    }
  }
  for (let k = 1; k < S; k++) {
    let start = -1;
    for (let c = 0; c <= C; c++) {
      let on = false;
      if (c < C) {
        const a = at(k - 1, c);
        const b = at(k, c);
        if (a !== MASTHEAD && b !== MASTHEAD) {
          if (a !== b) on = true;
          else {
            const blk = blocks[a];
            on = !!blk && FLOW_KINDS.has(blk.kind) && blk.style.frame === 'none' && c - blk.col >= blk.titleCols;
          }
        }
      }
      if (on && start < 0) start = c;
      if (!on && start >= 0) {
        out.push({ dir: 'h', at: bounds[k] as number, from: start, to: c });
        start = -1;
      }
    }
  }
  return out;
}
