// 第四版：整版報紙每個區塊的種類與樣式（純邏輯）。
//
// 一版先由「版面類型」與「年代預設」排出起點（pageplan.ts），每個區塊再可以個別改：
// 種類、標題（文字、字型、大小五級、直排或橫排、一般／空心／黑底白字／加框／陰影、括號或符號）、
// 內文（字型、大中小與割注）、框線（無、單線、雙線、粗細線、點線、花邊）、高度與寬度。
// 只有改過的欄位存進 JSON（extras.newspaper.blocks），匯入時逐項驗證。

import type { FillerItem } from '../../data/fillers.ts';

export const BLOCK_KINDS = [
  { value: 'news', label: '新聞' },
  { value: 'short', label: '短訊' },
  { value: 'editorial', label: '社論' },
  { value: 'wire', label: '專電' },
  { value: 'ad', label: '廣告' },
  { value: 'notice', label: '啟事' },
  { value: 'table', label: '表格（行情、船期）' },
  { value: 'toc', label: '目錄' },
  { value: 'serial', label: '連載' },
  { value: 'picture', label: '插圖' },
] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number]['value'];

/** 內文是文字流排的種類（標題＋內文）。 */
export const FLOW_KINDS: ReadonlySet<BlockKind> = new Set(['news', 'short', 'editorial', 'wire', 'notice', 'serial']);

export const TITLE_SIZES = [
  { value: '1', label: '一級（特大）' },
  { value: '2', label: '二級' },
  { value: '3', label: '三級' },
  { value: '4', label: '四級' },
  { value: '5', label: '五級（和內文一樣大）' },
] as const;
export type TitleSize = 1 | 2 | 3 | 4 | 5;

/** 標題字高（內文字 = 1）與直排時佔幾行寬。 */
export const TITLE_METRICS: Readonly<Record<TitleSize, { readonly size: number; readonly span: number }>> = {
  1: { size: 3.2, span: 3 },
  2: { size: 2.4, span: 2 },
  3: { size: 1.75, span: 2 },
  4: { size: 1.3, span: 1 },
  5: { size: 1, span: 1 },
};

export const TITLE_DIRS = [
  { value: 'v', label: '直排' },
  { value: 'h', label: '橫排（由右而左）' },
] as const;
export type TitleDir = (typeof TITLE_DIRS)[number]['value'];

export const TITLE_STYLES = [
  { value: 'plain', label: '一般' },
  { value: 'outline', label: '空心字' },
  { value: 'inverted', label: '黑底白字' },
  { value: 'boxed', label: '加框' },
  { value: 'shadow', label: '陰影' },
] as const;
export type TitleStyle = (typeof TITLE_STYLES)[number]['value'];

export const TITLE_MARKS = [
  { value: 'none', label: '無' },
  { value: 'lenticular', label: '【】' },
  { value: 'tortoise', label: '〔〕' },
  { value: 'corner', label: '「」' },
  { value: 'circle', label: '◎（句首）' },
  { value: 'triangle', label: '▲（句首）' },
] as const;
export type TitleMark = (typeof TITLE_MARKS)[number]['value'];

export const BODY_SIZES = [
  { value: 'l', label: '大' },
  { value: 'm', label: '中' },
  { value: 's', label: '小' },
  { value: 'gz', label: '割注（一行兩小行）' },
] as const;
export type BodySize = (typeof BODY_SIZES)[number]['value'];

/** 內文字高；割注是一行裡並排兩小行。 */
export const BODY_METRICS: Readonly<Record<BodySize, { readonly size: number; readonly split: boolean }>> = {
  l: { size: 1.1, split: false },
  m: { size: 1, split: false },
  s: { size: 0.82, split: false },
  gz: { size: 0.52, split: true },
};

export const FRAMES = [
  { value: 'none', label: '無' },
  { value: 'single', label: '單線' },
  { value: 'double', label: '雙線' },
  { value: 'thickthin', label: '粗細線' },
  { value: 'dotted', label: '點線' },
  { value: 'pattern', label: '花邊' },
] as const;
export type Frame = (typeof FRAMES)[number]['value'];

export const PATTERNS = [
  { value: 'meander', label: '回紋' },
  { value: 'cloud', label: '雲紋' },
  { value: 'dots', label: '圓點' },
  { value: 'diamond', label: '菱形' },
  { value: 'wave', label: '波紋' },
] as const;
export type Pattern = (typeof PATTERNS)[number]['value'];

export const PICTURES = [
  { value: 'bottle', label: '藥瓶' },
  { value: 'box', label: '藥盒' },
  { value: 'hat', label: '帽子' },
  { value: 'watch', label: '懷錶' },
  { value: 'ship', label: '輪船' },
  { value: 'clock', label: '時鐘' },
] as const;
export type PictureKind = (typeof PICTURES)[number]['value'];

export interface BlockStyle {
  readonly kind: BlockKind;
  /** 自訂標題；空字串表示用素材本身的標題。 */
  readonly title: string;
  /** 字型 id；空字串表示跟著整版的字型設定。 */
  readonly titleFont: string;
  readonly titleSize: TitleSize;
  readonly titleDir: TitleDir;
  readonly titleStyle: TitleStyle;
  readonly titleMark: TitleMark;
  readonly bodyFont: string;
  readonly bodySize: BodySize;
  readonly frame: Frame;
  readonly pattern: Pattern;
  /** 高度（佔幾段）。 */
  readonly span: number;
  /** 寬度（佔幾行）；0 表示佔滿這一段剩下的寬度（通欄）。 */
  readonly width: number;
  /** 插圖或廣告裡的插圖；none 表示沒有。 */
  readonly picture: PictureKind | 'none';
}

/** 存進 JSON 的個別修改：只有改過的欄位。locked 時連內容一起存下（換一批時保留）。 */
export interface BlockEdit extends Partial<BlockStyle> {
  readonly id: string;
  readonly locked?: boolean;
  /** 鎖定時存下的文字素材（新聞、短訊、廣告等）。 */
  readonly content?: readonly FillerItem[];
  /** 鎖定時存下的內容種子（表格、目錄、插圖等由種子產生的內容）。 */
  readonly contentSeed?: number;
}

export interface AddedBlock {
  readonly id: string;
  readonly kind: BlockKind;
  /** 插在哪個區塊之後；null 表示最後。 */
  readonly after: string | null;
}

export interface BlockExtras {
  readonly edits: readonly BlockEdit[];
  readonly added: readonly AddedBlock[];
  readonly removed: readonly string[];
  /** 使用者調整過的區塊順序（區塊 id）；空的表示照版面類型的順序。 */
  readonly order: readonly string[];
}

export const EMPTY_BLOCK_EXTRAS: BlockExtras = { edits: [], added: [], removed: [], order: [] };

export const BLOCK_LIMITS = { edits: 120, added: 40, removed: 200, order: 240, content: 6, title: 24, span: 6, width: 60 } as const;

const STYLE_KEYS = ['kind', 'title', 'titleFont', 'titleSize', 'titleDir', 'titleStyle', 'titleMark', 'bodyFont', 'bodySize', 'frame', 'pattern', 'span', 'width', 'picture'] as const;

/** 把個別修改套到預設樣式上。 */
export function mergeStyle(base: BlockStyle, edit: Partial<BlockStyle> | undefined): BlockStyle {
  if (!edit) return base;
  const out: Record<string, unknown> = { ...base };
  for (const key of STYLE_KEYS) {
    const v = edit[key];
    if (v !== undefined) out[key] = v;
  }
  return out as unknown as BlockStyle;
}

/** 兩個樣式不同的欄位（存檔時只存這些）。 */
export function styleDiff(base: BlockStyle, next: BlockStyle): Partial<BlockStyle> {
  const out: Record<string, unknown> = {};
  for (const key of STYLE_KEYS) if (base[key] !== next[key]) out[key] = next[key];
  return out as Partial<BlockStyle>;
}

const MARK_TEXT: Readonly<Record<TitleMark, readonly [string, string]>> = {
  none: ['', ''],
  lenticular: ['【', '】'],
  tortoise: ['〔', '〕'],
  corner: ['「', '」'],
  circle: ['◎', ''],
  triangle: ['▲', ''],
};

/** 標題加上括號或句首符號。 */
export function markTitle(title: string, mark: TitleMark): string {
  const t = title.trim();
  if (!t) return t;
  const [open, close] = MARK_TEXT[mark];
  return `${open}${t}${close}`;
}

// ---------- 匯入驗證 ----------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const ID_RE = /^[A-Za-z0-9#_:-]{1,60}$/;
const FONT_RE = /^[a-z0-9-]{0,40}$/;

function oneOf<T extends string>(list: readonly { readonly value: T }[], v: unknown): T | undefined {
  return list.find((o) => o.value === v)?.value;
}

function cleanText(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  return Array.from(v.replace(/[\u0000-\u001F\u007F]/g, '')).slice(0, max).join('');
}

function int(v: unknown, min: number, max: number): number | undefined {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : undefined;
}

const FILLER_KINDS = new Set(['news', 'short', 'ad', 'notice', 'list']);

function sanitizeContent(v: unknown): FillerItem[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: FillerItem[] = [];
  for (const x of v.slice(0, BLOCK_LIMITS.content)) {
    if (!isRecord(x)) continue;
    const id = typeof x['id'] === 'string' && ID_RE.test(x['id']) ? x['id'] : null;
    const kind = typeof x['kind'] === 'string' && FILLER_KINDS.has(x['kind']) ? (x['kind'] as FillerItem['kind']) : null;
    const title = cleanText(x['title'], 40);
    const body = cleanText(x['body'], 1200);
    if (id === null || kind === null || title === undefined || body === undefined) continue;
    const subtitle = cleanText(x['subtitle'], 80);
    const price = cleanText(x['price'], 80);
    const maker = cleanText(x['maker'], 80);
    out.push({ id, kind, title, body, ...(subtitle ? { subtitle } : {}), ...(price ? { price } : {}), ...(maker ? { maker } : {}) });
  }
  return out;
}

/** 驗證一筆個別修改；格式不符的欄位丟掉，id 不符時整筆丟掉。 */
export function sanitizeBlockEdit(v: unknown): BlockEdit | null {
  if (!isRecord(v)) return null;
  const id = typeof v['id'] === 'string' && ID_RE.test(v['id']) ? v['id'] : null;
  if (id === null) return null;
  const out: Record<string, unknown> = { id };
  const set = (key: string, value: unknown): void => {
    if (value !== undefined) out[key] = value;
  };
  set('kind', oneOf(BLOCK_KINDS, v['kind']));
  set('title', cleanText(v['title'], BLOCK_LIMITS.title));
  set('titleFont', typeof v['titleFont'] === 'string' && FONT_RE.test(v['titleFont']) ? v['titleFont'] : undefined);
  set('titleSize', int(v['titleSize'], 1, 5));
  set('titleDir', oneOf(TITLE_DIRS, v['titleDir']));
  set('titleStyle', oneOf(TITLE_STYLES, v['titleStyle']));
  set('titleMark', oneOf(TITLE_MARKS, v['titleMark']));
  set('bodyFont', typeof v['bodyFont'] === 'string' && FONT_RE.test(v['bodyFont']) ? v['bodyFont'] : undefined);
  set('bodySize', oneOf(BODY_SIZES, v['bodySize']));
  set('frame', oneOf(FRAMES, v['frame']));
  set('pattern', oneOf(PATTERNS, v['pattern']));
  set('span', int(v['span'], 1, BLOCK_LIMITS.span));
  set('width', int(v['width'], 0, BLOCK_LIMITS.width));
  set('picture', v['picture'] === 'none' ? 'none' : oneOf(PICTURES, v['picture']));
  if (v['locked'] === true) out['locked'] = true;
  const content = sanitizeContent(v['content']);
  if (content && content.length > 0) out['content'] = content;
  set('contentSeed', int(v['contentSeed'], 0, 2 ** 31 - 1));
  return out as unknown as BlockEdit;
}

function sanitizeAdded(v: unknown): AddedBlock | null {
  if (!isRecord(v)) return null;
  const id = typeof v['id'] === 'string' && ID_RE.test(v['id']) ? v['id'] : null;
  const kind = oneOf(BLOCK_KINDS, v['kind']);
  const after = v['after'] === null || v['after'] === undefined ? null : typeof v['after'] === 'string' && ID_RE.test(v['after']) ? v['after'] : undefined;
  if (id === null || !kind || after === undefined) return null;
  return { id, kind, after };
}

function list<T>(v: unknown, limit: number, item: (x: unknown) => T | null): { items: T[]; dropped: number } {
  if (!Array.isArray(v)) return { items: [], dropped: v === undefined ? 0 : 1 };
  const items: T[] = [];
  let dropped = Math.max(0, v.length - limit);
  for (const x of v.slice(0, limit)) {
    const clean = item(x);
    if (clean === null) dropped++;
    else items.push(clean);
  }
  return { items, dropped };
}

const idOf = (x: unknown): string | null => (typeof x === 'string' && ID_RE.test(x) ? x : null);

/** 驗證整版區塊的修改（舊存檔沒有這一項時得到空的）。 */
export function sanitizeBlockExtras(v: unknown): { blocks: BlockExtras; dropped: number } {
  if (!isRecord(v)) return { blocks: EMPTY_BLOCK_EXTRAS, dropped: v === undefined ? 0 : 1 };
  const edits = list(v['edits'], BLOCK_LIMITS.edits, sanitizeBlockEdit);
  const added = list(v['added'], BLOCK_LIMITS.added, sanitizeAdded);
  const removed = list(v['removed'], BLOCK_LIMITS.removed, idOf);
  const order = list(v['order'], BLOCK_LIMITS.order, idOf);
  // 同一個 id 只留最後一筆修改
  const byId = new Map<string, BlockEdit>();
  for (const e of edits.items) byId.set(e.id, e);
  return {
    blocks: { edits: [...byId.values()], added: added.items, removed: [...new Set(removed.items)], order: [...new Set(order.items)] },
    dropped: edits.dropped + added.dropped + removed.dropped + order.dropped,
  };
}
