// 存檔中「表單欄位以外」的結構化資料：使用者自己加的新聞與啟事、鎖定或刪除的填版素材、
// 自由裁切的多邊形、裝飾。匯入時逐項驗證，格式不符的項目丟棄並提示。純邏輯。

import type { FillerItem } from '../data/fillers.ts';
import type { Point } from '../lib/geometry.ts';
import { EMPTY_BLOCK_EXTRAS, sanitizeBlockExtras, type BlockExtras } from '../lib/newspaper/blockstyle.ts';
import { isValidSeed } from '../lib/random.ts';
import { FX_LIMITS, compactFxItem, sanitizeFxItem, type FxItem } from '../lib/fx/catalog.ts';

export const NEWS_ITEM_KINDS = [
  { value: 'short', label: '短訊' },
  { value: 'news', label: '新聞（大標題）' },
  { value: 'notice', label: '啟事（加框）' },
  { value: 'ad', label: '廣告（加框、大字）' },
] as const;
export type NewsItemKind = (typeof NEWS_ITEM_KINDS)[number]['value'];

export interface NewsItem {
  readonly id: string;
  readonly kind: NewsItemKind;
  readonly title: string;
  readonly body: string;
}

export const DECORATION_TYPES = [
  { value: 'blood-splatter', label: '血跡：噴濺' },
  { value: 'blood-drip', label: '血跡：滴落' },
  { value: 'blood-smear', label: '血跡：拖痕' },
  { value: 'handprint', label: '血手印' },
  { value: 'coffee-ring', label: '咖啡杯印' },
  { value: 'ink-blot', label: '墨漬' },
  { value: 'fingerprint', label: '指紋' },
  { value: 'wax-seal', label: '火漆封印' },
  { value: 'red-circle', label: '紅筆圈注' },
  { value: 'red-arrow', label: '紅筆箭頭' },
  { value: 'pencil-line', label: '鉛筆劃線' },
  { value: 'pencil-note', label: '鉛筆眉批' },
  { value: 'stamp', label: '公文戳記' },
  { value: 'claw', label: '抓痕' },
  { value: 'slime', label: '怪異黏液' },
  { value: 'sigil', label: '怪符號' },
  { value: 'pressed-text', label: '反覆描寫到穿紙的字' },
] as const;
export type DecorationType = (typeof DECORATION_TYPES)[number]['value'];

export interface Decoration {
  readonly id: string;
  readonly type: DecorationType;
  /** 中心點（紙面座標，公釐）。 */
  readonly x: number;
  readonly y: number;
  /** 旋轉角度（度）。 */
  readonly rotate: number;
  readonly scale: number;
  readonly opacity: number;
  /** 疊放順序（大的在上）。 */
  readonly z: number;
  readonly seed: number;
  /** 戳記、眉批等的文字。 */
  readonly text: string;
  /** 血跡類：乾涸（褐色）或新鮮（鮮紅）。 */
  readonly dry: boolean;
}

export interface PropExtras {
  /** 自由裁切的多邊形（紙面座標，公釐）；null 表示不裁切。 */
  readonly crop: readonly Point[] | null;
  readonly decorations: readonly Decoration[];
  /** 第五版：逐一放置的紙張效果（燒洞、水漬、撕口…）。 */
  readonly effects: readonly FxItem[];
}

export interface NewspaperExtras extends PropExtras {
  readonly items: readonly NewsItem[];
  readonly locked: readonly FillerItem[];
  readonly removed: readonly string[];
  /** 第四版：整版各區塊的個別設定（新增、刪除、順序、樣式、鎖定）。 */
  readonly blocks: BlockExtras;
}

export interface ExtrasState {
  readonly newspaper: NewspaperExtras;
  readonly telegram: PropExtras;
  readonly letter: PropExtras;
  readonly card: PropExtras;
  readonly relic: PropExtras;
  readonly document: PropExtras;
}

export const LIMITS = {
  items: 30,
  title: 40,
  body: 2000,
  locked: 60,
  lockedBody: 800,
  removed: 500,
  cropPoints: 400,
  decorations: 100,
  decorationText: 40,
} as const;

export function defaultExtras(): ExtrasState {
  const empty: PropExtras = { crop: null, decorations: [], effects: [] };
  return {
    newspaper: { ...empty, items: [], locked: [], removed: [], blocks: EMPTY_BLOCK_EXTRAS },
    telegram: { ...empty },
    letter: { ...empty },
    card: { ...empty },
    relic: { ...empty },
    document: { ...empty },
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const ID_RE = /^[A-Za-z0-9#_:-]{1,60}$/;

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  return Array.from(value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ''))
    .slice(0, max)
    .join('');
}

function finite(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null;
}

export function sanitizeNewsItem(v: unknown): NewsItem | null {
  if (!isRecord(v)) return null;
  const id = typeof v['id'] === 'string' && ID_RE.test(v['id']) ? v['id'] : null;
  const kind = NEWS_ITEM_KINDS.find((k) => k.value === v['kind'])?.value ?? null;
  const title = cleanText(v['title'], LIMITS.title);
  const body = cleanText(v['body'], LIMITS.body);
  if (id === null || kind === null || title === null || body === null) return null;
  const optional = (key: 'subtitle' | 'price' | 'maker'): string | undefined => {
    const value = cleanText(v[key], LIMITS.title * 2);
    return value ? value : undefined;
  };
  const subtitle = optional('subtitle');
  const price = optional('price');
  const maker = optional('maker');
  return { id, kind, title, body, ...(subtitle ? { subtitle } : {}), ...(price ? { price } : {}), ...(maker ? { maker } : {}) };
}

const FILLER_KINDS = new Set(['news', 'short', 'ad', 'notice', 'list']);

function sanitizeFiller(v: unknown): FillerItem | null {
  if (!isRecord(v)) return null;
  const id = typeof v['id'] === 'string' && ID_RE.test(v['id']) ? v['id'] : null;
  const kind = typeof v['kind'] === 'string' && FILLER_KINDS.has(v['kind']) ? (v['kind'] as FillerItem['kind']) : null;
  const title = cleanText(v['title'], LIMITS.title);
  const body = cleanText(v['body'], LIMITS.lockedBody);
  if (id === null || kind === null || title === null || body === null) return null;
  return { id, kind, title, body };
}

export function sanitizeCrop(v: unknown): Point[] | null {
  if (!Array.isArray(v) || v.length < 3 || v.length > LIMITS.cropPoints) return null;
  const pts: Point[] = [];
  for (const p of v) {
    if (!isRecord(p)) return null;
    const x = finite(p['x'], -100, 600);
    const y = finite(p['y'], -100, 600);
    if (x === null || y === null) return null;
    pts.push({ x, y });
  }
  return pts;
}

export function sanitizeDecoration(v: unknown): Decoration | null {
  if (!isRecord(v)) return null;
  const id = typeof v['id'] === 'string' && ID_RE.test(v['id']) ? v['id'] : null;
  const type = DECORATION_TYPES.find((t) => t.value === v['type'])?.value ?? null;
  const x = finite(v['x'], -100, 600);
  const y = finite(v['y'], -100, 600);
  const rotate = finite(v['rotate'], -360, 360);
  const scale = finite(v['scale'], 0.1, 8);
  const opacity = finite(v['opacity'], 0, 1);
  const z = typeof v['z'] === 'number' && Number.isInteger(v['z']) && Math.abs(v['z']) <= 1000 ? v['z'] : null;
  const seed = isValidSeed(v['seed']) ? v['seed'] : null;
  const text = cleanText(v['text'] ?? '', LIMITS.decorationText);
  if (id === null || type === null || x === null || y === null || rotate === null || scale === null || opacity === null || z === null || seed === null || text === null) {
    return null;
  }
  // 第三版新增：沒有這個欄位的舊存檔視為乾涸
  const dry = typeof v['dry'] === 'boolean' ? v['dry'] : true;
  return { id, type, x, y, rotate, scale, opacity, z, seed, text, dry };
}

function sanitizeList<T>(v: unknown, limit: number, item: (x: unknown) => T | null, label: string, warnings: string[]): T[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) {
    warnings.push(`${label}格式不符，已略過。`);
    return [];
  }
  const out: T[] = [];
  let dropped = 0;
  for (const x of v.slice(0, limit)) {
    const clean = item(x);
    if (clean === null) dropped++;
    else out.push(clean);
  }
  dropped += Math.max(0, v.length - limit);
  if (dropped > 0) warnings.push(`${label}有 ${dropped} 項格式不符或超過上限，已略過。`);
  return out;
}

function sanitizeCommon(v: Record<string, unknown>, label: string, warnings: string[]): PropExtras {
  let crop: Point[] | null = null;
  if (v['crop'] !== undefined && v['crop'] !== null) {
    crop = sanitizeCrop(v['crop']);
    if (crop === null) warnings.push(`${label}的裁切範圍格式不符，已取消裁切。`);
  }
  const decorations = sanitizeList(v['decorations'], LIMITS.decorations, sanitizeDecoration, `${label}的裝飾`, warnings);
  const effects = sanitizeList(v['effects'], FX_LIMITS.items, sanitizeFxItem, `${label}的特效項目`, warnings);
  return { crop, decorations, effects };
}

export function sanitizeExtras(input: unknown, labels: Readonly<Record<keyof ExtrasState, string>>): { extras: ExtrasState; warnings: string[] } {
  const warnings: string[] = [];
  const root = isRecord(input) ? input : {};
  const part = (key: keyof ExtrasState): Record<string, unknown> => (isRecord(root[key]) ? (root[key] as Record<string, unknown>) : {});

  const np = part('newspaper');
  const newspaper: NewspaperExtras = {
    ...sanitizeCommon(np, labels.newspaper, warnings),
    items: sanitizeList(np['items'], LIMITS.items, sanitizeNewsItem, '自己加的新聞與啟事', warnings),
    locked: sanitizeList(np['locked'], LIMITS.locked, sanitizeFiller, '鎖定的填版素材', warnings),
    removed: sanitizeList(np['removed'], LIMITS.removed, (x) => (typeof x === 'string' && ID_RE.test(x) ? x : null), '刪除的填版素材', warnings),
    blocks: blocksOf(np['blocks'], warnings),
  };
  return {
    extras: {
      newspaper,
      telegram: sanitizeCommon(part('telegram'), labels.telegram, warnings),
      letter: sanitizeCommon(part('letter'), labels.letter, warnings),
      card: sanitizeCommon(part('card'), labels.card, warnings),
      relic: sanitizeCommon(part('relic'), labels.relic, warnings),
      document: sanitizeCommon(part('document'), labels.document, warnings),
    },
    warnings,
  };
}

function blocksOf(v: unknown, warnings: string[]): BlockExtras {
  const { blocks, dropped } = sanitizeBlockExtras(v);
  if (dropped > 0) warnings.push(`整版區塊的設定有 ${dropped} 項格式不符或超過上限，已略過。`);
  return blocks;
}

let counter = 0;
/** 產生新項目的編號（只用於介面；存檔驗證只要求格式）。 */
export function newId(prefix: string): string {
  counter = (counter + 1) % 1000;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}`;
}

/** 存檔用：特效項目只存與樣式預設值不同的欄位（見 compactFxItem），其餘照原樣。 */
export function compactExtras(extras: ExtrasState): Record<keyof ExtrasState, unknown> {
  const out = {} as Record<keyof ExtrasState, unknown>;
  for (const key of Object.keys(extras) as (keyof ExtrasState)[]) {
    const e: PropExtras = extras[key];
    out[key] = { ...e, effects: e.effects.map(compactFxItem) };
  }
  return out;
}
