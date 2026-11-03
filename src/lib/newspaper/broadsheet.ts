// 整版報紙的不規則版面（純邏輯）。
//
// 版面是一張「行 × 格」的格子：行由右而左（直排一行），格由上而下（一個內文字高）。
// 不再切成等高的段，而是像當年的報紙：區塊高低寬窄各不相同，有的廣告跨兩三段，
// 分界可以是階梯或 L 形，文字繞著框排。做法是「天際線」填法：
//   1. 報頭框（右側直排或角落橫排）先佔住位置；
//   2. 主新聞放在最右上方可用的地方，寬度依內文長度決定；
//   3. 之後每次找「目前最淺」的一段，放一個區塊：高度從幾種倍數裡挑，並避開和鄰欄同高
//      （以免出現整排對齊的橫線）；有時把區塊做成左右兩邊不同深的 L 形；
//   4. 文字區塊用 flowRegion 依序排進幾則新聞，排滿為止；廣告區塊交給 adlayout.ts。
// 每一格都屬於剛好一個區塊（或報頭），所以版面除了框線都是字。區塊之間的欄線由格子的
// 歸屬直接算出（rules）。同一個種子永遠排出同樣的版面。

import { int, pick, rngFor, shuffle, type Rng } from '../random.ts';
import type { AdItem } from './ads.ts';
import { flowRegion, layoutItem, type ColumnSlot, type FlowItem, type FlowLine } from './flow.ts';
import { headlinePunctuation, type PunctuationMode } from './punctuation.ts';
import { toFullWidth } from './layout.ts';

export interface RegionColumn {
  /** 從版面右緣算起第幾行。 */
  readonly col: number;
  readonly top: number;
  /** 不含。 */
  readonly bottom: number;
}

export type RegionKind = 'main' | 'photo' | 'text' | 'box' | 'ad';

export interface BandLine {
  readonly text: string;
  /** 字高（內文字 = 1）。 */
  readonly size: number;
  /** 從區塊頂端算起第幾格（可為小數）。 */
  readonly row: number;
}

/** 主新聞的橫排標題（由右而左）。 */
export interface HeadlineBand {
  readonly rows: number;
  readonly lines: readonly BandLine[];
}

export type FrameStyle = 'double' | 'thickthin' | 'dotted' | 'corners' | 'plain';

export interface Region {
  readonly id: string;
  readonly kind: RegionKind;
  /** 由右而左的各行；同一區塊的行一定相鄰。 */
  readonly columns: readonly RegionColumn[];
  /** 區塊頂端第一格留白（上方有欄線）。 */
  readonly gapTop: boolean;
  /** 欄名（黑底白字），放在第一行的頂端。 */
  readonly tag?: { readonly text: string; readonly rows: number };
  readonly band?: HeadlineBand;
  readonly slots: readonly ColumnSlot[];
  readonly lines: readonly FlowLine[];
  readonly ad?: AdItem;
  readonly frame?: FrameStyle;
  /** 廣告用黑底白字。 */
  readonly inverted?: boolean;
  /** 廣告版型與裝飾的種子。 */
  readonly styleSeed?: number;
}

export interface Obstacle {
  readonly col: number;
  readonly row: number;
  readonly cols: number;
  readonly rows: number;
}

export interface BroadsheetInput {
  readonly cols: number;
  readonly rows: number;
  readonly seed: number;
  /** 大致的段數：決定區塊高度的基本單位。 */
  readonly tiers: number;
  readonly mode: PunctuationMode;
  /** 報頭框（右側直排或角落橫排）佔住的格子。 */
  readonly obstacle?: Obstacle;
  readonly main: FlowItem;
  /** 主標題橫排（由右而左）。 */
  readonly mainHorizontal: boolean;
  readonly photo?: { readonly cols: number; readonly rows: number; readonly caption: string };
  /** 文字素材，使用者的排在最前面。 */
  readonly queue: readonly FlowItem[];
  /** 廣告，使用者的排在最前面。 */
  readonly ads: readonly AdItem[];
  readonly tiny: readonly FlowItem[];
  readonly tags: readonly string[];
  /** 行寬與字高的比（pitch / cell），算橫排標題的寬度用。 */
  readonly aspect: number;
}

export interface RuleSegment {
  /** v：直線，at 是第 at−1 行與第 at 行之間；h：橫線，at 是第 at−1 格與第 at 格之間。 */
  readonly dir: 'v' | 'h';
  readonly at: number;
  readonly from: number;
  readonly to: number;
}

export interface Broadsheet {
  readonly cols: number;
  readonly rows: number;
  readonly regions: readonly Region[];
  /** 每一格屬於哪個區塊（regions 的索引）；−2 為報頭。依列存放：owner[row * cols + col]。 */
  readonly owner: Int32Array;
  readonly rules: readonly RuleSegment[];
  readonly usedIds: readonly string[];
  /** 使用者的內容沒有全部排進去或被截斷。 */
  readonly overflow: boolean;
  /** 為避開整排對齊而重排的次數（測試用）。 */
  readonly attempts: number;
}

const MASTHEAD = -2;
const MIN_H = 8;
const MIN_TEXT_W = 3;
const MIN_AD_W = 4;

function validHeight(h: number, remain: number, minH: number): boolean {
  return h >= Math.min(minH, remain) && h <= remain && (h === remain || remain - h >= minH);
}

function snapHeight(raw: number, remain: number, minH: number): number {
  let h = Math.max(Math.min(minH, remain), Math.min(remain, Math.round(raw)));
  if (remain - h < minH) h = remain;
  return h;
}

/** 由格子的歸屬算出區塊之間的分界（欄線）。報頭與廣告自己有框，旁邊不畫。 */
export function rulesOf(owner: Int32Array, cols: number, rows: number, regions: readonly Region[]): RuleSegment[] {
  const framed = (i: number): boolean => i === MASTHEAD || (i >= 0 && (regions[i]?.kind === 'ad' || regions[i]?.kind === 'box'));
  const out: RuleSegment[] = [];
  for (let k = 1; k < cols; k++) {
    let start = -1;
    for (let r = 0; r <= rows; r++) {
      const a = r < rows ? (owner[r * cols + k - 1] as number) : -9;
      const b = r < rows ? (owner[r * cols + k] as number) : -9;
      const on = r < rows && a !== b && !framed(a) && !framed(b);
      if (on && start < 0) start = r;
      if (!on && start >= 0) {
        out.push({ dir: 'v', at: k, from: start, to: r });
        start = -1;
      }
    }
  }
  for (let k = 1; k < rows; k++) {
    let start = -1;
    for (let c = 0; c <= cols; c++) {
      const a = c < cols ? (owner[(k - 1) * cols + c] as number) : -9;
      const b = c < cols ? (owner[k * cols + c] as number) : -9;
      const on = c < cols && a !== b && !framed(a) && !framed(b);
      if (on && start < 0) start = c;
      if (!on && start >= 0) {
        out.push({ dir: 'h', at: k, from: start, to: c });
        start = -1;
      }
    }
  }
  return out;
}

/** 有沒有一條橫向分界貫穿整個版面寬度（整排等高的段）。 */
export function fullWidthBoundaries(owner: Int32Array, cols: number, rows: number): number[] {
  const out: number[] = [];
  for (let k = 1; k < rows; k++) {
    let all = true;
    for (let c = 0; c < cols && all; c++) {
      if (owner[(k - 1) * cols + c] === owner[k * cols + c]) all = false;
    }
    if (all) out.push(k);
  }
  return out;
}

/** 主新聞的橫排標題：一到兩行，字盡量大。 */
export function headlineBand(title: string, width: number, aspect: number, mode: PunctuationMode): HeadlineBand | null {
  const chars = Array.from(headlinePunctuation(toFullWidth(title.trim()), mode));
  if (chars.length === 0 || width < 3) return null;
  const widthInCells = width * aspect * 0.94;
  let lines = 1;
  let size = Math.min(3.4, widthInCells / chars.length);
  if (size < 2.2 && chars.length > 4) {
    lines = 2;
    size = Math.min(3.4, widthInCells / Math.ceil(chars.length / 2));
  }
  size = Math.max(1.4, Math.round(size * 10) / 10);
  const per = Math.ceil(chars.length / lines);
  const out: BandLine[] = [];
  let row = 0.6;
  for (let i = 0; i < chars.length; i += per) {
    out.push({ text: chars.slice(i, i + per).join(''), size, row });
    row += size * 1.08;
  }
  return { rows: Math.ceil(row + 0.6), lines: out };
}

interface Packing {
  readonly regions: Region[];
  readonly owner: Int32Array;
  readonly used: string[];
  readonly overflow: boolean;
}

function pack(input: BroadsheetInput, rng: Rng): Packing {
  const { cols: C, rows: R } = input;
  const owner = new Int32Array(C * R).fill(-1);
  const sky = new Array<number>(C).fill(0);
  const regions: Region[] = [];
  const used: string[] = [];
  let overflow = false;
  const queue = [...input.queue];
  const ads = [...input.ads];
  const tiny = [...input.tiny];
  const unit = Math.max(MIN_H, Math.round(R / Math.max(2, input.tiers)));
  const userIds = new Set(input.queue.filter((q) => q.source === 'user').map((q) => q.id));
  /** 廣告最多佔版面的三分之一。 */
  const adBudget = C * R * 0.33;
  let adArea = 0;

  if (input.obstacle) {
    const o = input.obstacle;
    for (let c = o.col; c < Math.min(C, o.col + o.cols); c++) {
      for (let r = o.row; r < Math.min(R, o.row + o.rows); r++) owner[r * C + c] = MASTHEAD;
      sky[c] = Math.max(sky[c] as number, Math.min(R, o.row + o.rows));
    }
  }

  const claim = (index: number, columns: readonly RegionColumn[]): void => {
    for (const col of columns) {
      for (let r = col.top; r < col.bottom; r++) owner[r * C + col.col] = index;
      sky[col.col] = col.bottom;
    }
  };
  const segment = (): { s: number; c0: number; w: number } | null => {
    let s = Infinity;
    for (const v of sky) s = Math.min(s, v);
    if (s >= R) return null;
    const c0 = sky.indexOf(s);
    let c1 = c0;
    while (c1 < C && sky[c1] === s) c1++;
    return { s, c0, w: c1 - c0 };
  };
  const slotsFor = (columns: readonly RegionColumn[], gap: number, tagRows = 0, inset = 0): ColumnSlot[] =>
    columns.map((col, j) => {
      const top = col.top + gap + inset + (j === 0 ? tagRows : 0);
      return { col: col.col, top, cap: Math.max(0, col.bottom - inset - top) };
    });
  const addRegion = (region: Omit<Region, 'id'>): void => {
    const index = regions.length;
    regions.push({ id: `r${index}`, ...region });
    claim(index, region.columns);
  };
  const rect = (c0: number, w: number, top: number, bottom: number): RegionColumn[] =>
    Array.from({ length: w }, (_, j) => ({ col: c0 + j, top, bottom }));

  // 主新聞
  {
    const seg = segment();
    if (seg) {
      const remain = R - seg.s;
      const h = snapHeight(R * (0.4 + rng() * 0.1), remain, MIN_H);
      const gap = seg.s > 0 ? 1 : 0;
      const maxW = Math.max(1, Math.min(seg.w, Math.round(C * 0.62)));
      const minW = Math.min(maxW, 5);
      const mainItem = input.main;
      const tryWidth = (w: number, allowTruncate: boolean): { band: HeadlineBand | null; laid: ReturnType<typeof layoutItem> } => {
        const band = input.mainHorizontal ? headlineBand(mainItem.title, w, input.aspect, input.mode) : null;
        const slots = slotsFor(rect(seg.c0, w, seg.s, seg.s + h), gap + (band?.rows ?? 0));
        const item = band ? { ...mainItem, title: '' } : mainItem;
        return { band, laid: layoutItem(item, slots, 0, input.mode, allowTruncate) };
      };
      let width = maxW;
      for (let w = minW; w <= maxW; w++) {
        if (tryWidth(w, false).laid) {
          width = w;
          break;
        }
      }
      let result = tryWidth(width, true);
      if (result.laid && result.laid.used < width) {
        width = Math.max(minW, result.laid.used);
        result = tryWidth(width, true);
      }
      const columns = rect(seg.c0, width, seg.s, seg.s + h);
      const band = result.band;
      const slots = slotsFor(columns, gap + (band?.rows ?? 0));
      if (!result.laid || result.laid.truncated) overflow = true;
      addRegion({ kind: 'main', columns, gapTop: gap > 0, ...(band ? { band } : {}), slots, lines: result.laid?.lines ?? [] });
      used.push(mainItem.id);
    }
  }

  // 照片（緊接在主新聞旁邊）
  if (input.photo) {
    const seg = segment();
    if (seg && seg.w >= 3) {
      const remain = R - seg.s;
      const gap = seg.s > 0 ? 1 : 0;
      const w = Math.min(seg.w, input.photo.cols + 1);
      const h = snapHeight(input.photo.rows + gap + 1, remain, MIN_H);
      const columns = rect(seg.c0, w, seg.s, seg.s + h);
      const slots = slotsFor(columns, gap);
      const last = slots[slots.length - 1] as ColumnSlot;
      const captionGlyphs = Array.from(toFullWidth(input.photo.caption)).slice(0, last.cap).map((ch) => ({ ch }));
      const lines: FlowLine[] = captionGlyphs.length
        ? [{ itemId: 'photo', source: 'user', role: 'sub', slot: slots.length - 1, span: 1, size: 0.86, top: last.top, length: last.cap, glyphs: captionGlyphs, align: 'center' }]
        : [];
      addRegion({ kind: 'photo', columns, gapTop: gap > 0, slots, lines });
      used.push('photo');
    } else overflow = true;
  }

  // 其餘：每次找最淺的一段
  let guard = 0;
  for (let seg = segment(); seg && guard++ < 2000; seg = segment()) {
    const { s, c0, w: W } = seg;
    const remain = R - s;
    const gap = s > 0 ? 1 : 0;
    const left = c0 + W < C ? (sky[c0 + W] as number) : -1;
    const right = c0 > 0 ? (sky[c0 - 1] as number) : -1;
    const avoid = new Set([left, right].filter((v) => v > s && v < R));
    const chooseHeight = (factors: readonly number[], minH: number): number => {
      for (const f of shuffle(rng, factors)) {
        let h = snapHeight(unit * f + int(rng, -1, 1), remain, minH);
        if (avoid.has(s + h) && h !== remain) h = snapHeight(h + pick(rng, [-3, -2, 2, 3]), remain, minH);
        if (validHeight(h, remain, minH) && (!avoid.has(s + h) || h === remain)) return h;
      }
      return snapHeight(unit, remain, minH);
    };

    // 太窄：補到鄰欄的深度（或到底），排短訊與一行小訊
    if (W < MIN_TEXT_W) {
      const levels = [left, right].filter((v) => v >= s + 4).sort((a, b) => a - b);
      const bottom = levels[0] ?? R;
      const columns = rect(c0, W, s, bottom);
      const slots = slotsFor(columns, gap);
      const flowed = flowRegion(slots, queue, { mode: input.mode, tiny, lookahead: 14 });
      used.push(...flowed.used);
      addRegion({ kind: 'text', columns, gapTop: gap > 0, slots, lines: flowed.lines });
      continue;
    }

    const lowerHalf = s > R * 0.45;
    const roll = rng();
    const adOk = W >= MIN_AD_W && remain >= 9 && adArea < adBudget && ads.length > 0;
    const kind: RegionKind = adOk && roll < (lowerHalf ? 0.32 : 0.15) ? 'ad' : W >= 3 && roll > 0.88 ? 'box' : 'text';

    if (kind === 'ad') {
      const ad = ads.shift();
      if (ad) {
        let w = Math.min(W, int(rng, MIN_AD_W, Math.max(MIN_AD_W, Math.round(C * 0.3))));
        if (W - w > 0 && W - w < MIN_AD_W) w = W;
        if (w > Math.round(C * 0.35)) w = Math.min(W, Math.max(MIN_AD_W, Math.round(C * 0.35)));
        if (W - w > 0 && W - w < MIN_TEXT_W) w = W;
        const h = chooseHeight([0.8, 1, 1.5, 2, 2.5], 9);
        adArea += w * h;
        const columns = rect(c0, w, s, s + h);
        addRegion({
          kind: 'ad',
          columns,
          gapTop: gap > 0,
          slots: [],
          lines: [],
          ad,
          frame: pick(rng, ['double', 'thickthin', 'dotted', 'corners', 'plain', 'double'] as const),
          inverted: rng() < 0.16,
          styleSeed: int(rng, 1, 2 ** 30),
        });
        used.push(ad.id);
        continue;
      }
    }

    if (kind === 'box') {
      let w = Math.min(W, int(rng, 3, 6));
      if (W - w > 0 && W - w < MIN_TEXT_W) w = W;
      const h = chooseHeight([0.6, 0.8, 1], MIN_H);
      const columns = rect(c0, w, s, s + h);
      const slots = slotsFor(columns, gap, 0, 1);
      const notices = queue.filter((q) => q.source === 'filler' && q.level === 3 && !q.rows);
      const local = [...notices];
      const flowed = flowRegion(slots, local, { mode: input.mode, tiny, lookahead: 12 });
      for (const id of flowed.used) {
        const k = queue.findIndex((q) => q.id === id);
        if (k >= 0) queue.splice(k, 1);
      }
      used.push(...flowed.used);
      addRegion({ kind: 'box', columns, gapTop: gap > 0, slots, lines: flowed.lines, frame: pick(rng, ['plain', 'double', 'dotted'] as const) });
      continue;
    }

    // 文字區塊：可能是 L 形
    let w = W <= Math.round(C * 0.4) && rng() < 0.55 ? W : Math.min(W, int(rng, MIN_TEXT_W + 2, Math.max(MIN_TEXT_W + 2, Math.round(C * 0.4))));
    if (W - w > 0 && W - w < MIN_TEXT_W) w = W;
    const h1 = chooseHeight([0.75, 1, 1, 1.25, 1.5, 2], MIN_H);
    let columns = rect(c0, w, s, s + h1);
    if (w >= 2 * MIN_TEXT_W + 1 && rng() < 0.4) {
      const wr = int(rng, MIN_TEXT_W, w - MIN_TEXT_W);
      let h2 = chooseHeight([0.6, 0.9, 1.3, 1.7], MIN_H);
      if (Math.abs(h2 - h1) < 3) h2 = snapHeight(h1 + (h1 + 6 <= remain ? 6 : -6), remain, MIN_H);
      if (validHeight(h2, remain, MIN_H) && Math.abs(h2 - h1) >= 3) {
        columns = columns.map((col, j) => (j >= wr ? { ...col, bottom: s + h2 } : col));
      }
    }
    const tag = w >= 4 && rng() < 0.32 && input.tags.length > 0 ? pick(rng, input.tags) : undefined;
    const tagRows = tag ? Array.from(tag).length + 1 : 0;
    const slots = slotsFor(columns, gap, tagRows);
    const flowed = flowRegion(slots, queue, { mode: input.mode, tiny, lookahead: 12 });
    used.push(...flowed.used);
    for (const id of flowed.truncated) if (userIds.has(id)) overflow = true;
    addRegion({ kind: 'text', columns, gapTop: gap > 0, ...(tag ? { tag: { text: tag, rows: tagRows } } : {}), slots, lines: flowed.lines });
  }
  for (const id of userIds) if (!used.includes(id)) overflow = true;
  return { regions, owner, used, overflow };
}

/** 排出整版。若出現橫貫全版的分界，換一個內部種子重排（最多 8 次）。 */
export function layoutBroadsheet(input: BroadsheetInput): Broadsheet {
  let best: Packing | null = null;
  let attempts = 0;
  for (let k = 0; k < 8; k++) {
    attempts = k + 1;
    const packing = pack(input, rngFor(input.seed, `broadsheet:${k}`));
    best = packing;
    const straight = fullWidthBoundaries(packing.owner, input.cols, input.rows).filter((row) => !input.obstacle || row !== input.obstacle.row + input.obstacle.rows || input.obstacle.cols >= input.cols);
    if (straight.length === 0) break;
  }
  const packing = best as Packing;
  return {
    cols: input.cols,
    rows: input.rows,
    regions: packing.regions,
    owner: packing.owner,
    rules: rulesOf(packing.owner, input.cols, input.rows, packing.regions),
    usedIds: packing.used,
    overflow: packing.overflow,
    attempts,
  };
}
