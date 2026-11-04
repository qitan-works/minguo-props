// 逐一放置的紙張效果（第五版，純邏輯）：種類、樣式、每一項的欄位、存檔的壓縮與驗證、擺放位置與快速產生。
//
// 原本「紙張狀況」是一個全域滑桿、一種畫法；這裡每一項有自己的位置、旋轉、大小、不規則程度、強度、
// 色調、邊緣柔和度與種子，也可以用多邊形或手繪套索畫出自訂形狀（燒、水、撕）。
// 原本的全域滑桿照舊（舊存檔與情境預設的樣子不變），也可以一鍵拆成這裡的個別項目，之後再逐一調整或刪除。
//
// 座標：紙面公釐。每一項以中心 (x, y) 為原點、先不旋轉地產生形狀，再旋轉 rotate 度放到紙上（見 plan.ts）。
// 貼邊的樣式：自己的座標裡紙邊是 y = 0、紙面在 +y；旋轉 0° 是上邊，90° 右邊，180° 下邊，270° 左邊。
// 貼角的樣式：紙角在原點、紙面在 +x、+y；旋轉 0° 是左上角，90° 右上角，180° 右下角，270° 左下角。

import { rectsOverlap, type Point, type Rect } from '../geometry.ts';
import { int, isValidSeed, pick, range, rngFor, type Rng } from '../random.ts';

export const FX_KINDS = [
  { value: 'burn', label: '燒洞與焦痕' },
  { value: 'water', label: '水漬與浸水' },
  { value: 'tear', label: '撕口與缺角' },
  { value: 'fold', label: '摺痕' },
  { value: 'crumple', label: '揉皺' },
  { value: 'spots', label: '斑點' },
  { value: 'mold', label: '霉斑' },
  { value: 'worm', label: '蟲蛀' },
  { value: 'pin', label: '圖釘孔' },
  { value: 'rust', label: '鏽痕' },
  { value: 'tape', label: '膠帶' },
  { value: 'wax', label: '滴蠟' },
  { value: 'smudge', label: '抹糊的墨跡' },
] as const;
export type FxKind = (typeof FX_KINDS)[number]['value'];

/** 擺放方式：任意位置、貼著紙邊、貼著紙角、橫越整張紙的直線。 */
export type FxAnchor = 'free' | 'edge' | 'corner' | 'line';

export interface FxStyle {
  readonly value: string;
  readonly label: string;
  /** 大小（公釐）：半徑、長度或寬度，依樣式而定（見 sizeLabel）。 */
  readonly size: number;
  readonly sizeLabel: string;
  readonly irregular: number;
  readonly strength: number;
  readonly tone: number;
  readonly soft: number;
  /** 有數量的樣式（一排燒洞、雨點、散布的小洞…）的預設數量。 */
  readonly count?: number;
  readonly anchor: FxAnchor;
}

interface StyleInput {
  readonly irregular?: number;
  readonly strength?: number;
  readonly tone?: number;
  readonly soft?: number;
  readonly count?: number;
  readonly anchor?: FxAnchor;
}

function style(value: string, label: string, size: number, sizeLabel: string, o: StyleInput = {}): FxStyle {
  return {
    value,
    label,
    size,
    sizeLabel,
    irregular: o.irregular ?? 50,
    strength: o.strength ?? 55,
    tone: o.tone ?? 25,
    soft: o.soft ?? 15,
    ...(o.count !== undefined ? { count: o.count } : {}),
    anchor: o.anchor ?? 'free',
  };
}

export const FX_STYLES: Readonly<Record<FxKind, readonly FxStyle[]>> = {
  burn: [
    style('hole', '圓形燒穿', 6, '半徑', { strength: 55, tone: 10 }),
    style('cigarette', '菸頭燙痕', 3.5, '半徑', { strength: 40, tone: 35, soft: 30 }),
    style('flame', '火舌燒缺的邊', 34, '寬度', { strength: 60, tone: 5, anchor: 'edge' }),
    style('scorch', '只焦不穿', 9, '半徑', { strength: 50, tone: 40, soft: 45 }),
    style('row', '一排燒穿', 2.6, '每個洞的半徑', { strength: 50, tone: 15, count: 5 }),
  ],
  water: [
    style('round', '圓形水漬', 12, '半徑', { strength: 35, tone: 20, soft: 20 }),
    style('splash', '潑灑', 11, '半徑', { strength: 45, tone: 25, count: 14, irregular: 60 }),
    style('tear', '淚滴', 2.4, '每滴的半徑', { strength: 55, tone: 30, count: 3 }),
    style('rain', '雨點', 1.6, '每滴的半徑', { strength: 40, tone: 45, count: 16 }),
    style('cup', '杯底圈', 17, '半徑', { strength: 50, tone: 20, irregular: 30 }),
    style('soak', '整片浸潤', 45, '半徑', { strength: 60, tone: 25, irregular: 45 }),
  ],
  tear: [
    style('straight', '直撕', 90, '長度', { strength: 25, irregular: 45, tone: 10, soft: 0, anchor: 'edge' }),
    style('zigzag', '鋸齒', 60, '長度', { strength: 20, irregular: 50, tone: 10, soft: 0, anchor: 'edge' }),
    style('corner', '被扯掉一角', 26, '缺角大小', { irregular: 55, tone: 10, soft: 0, anchor: 'corner' }),
    style('bite', '咬痕', 6, '每口的半徑', { irregular: 50, tone: 30, soft: 0, count: 2, anchor: 'edge' }),
  ],
  fold: [
    style('line', '單道摺痕', 400, '長度', { strength: 50, tone: 35, irregular: 20, soft: 0, anchor: 'line' }),
    style('cross', '十字摺', 400, '長度', { strength: 50, tone: 35, irregular: 20, soft: 0, anchor: 'line' }),
    style('dogear', '摺角', 22, '摺角大小', { strength: 55, tone: 40, irregular: 25, soft: 0, anchor: 'corner' }),
    style('worn', '磨破的摺線', 400, '長度', { strength: 65, tone: 55, irregular: 30, soft: 0, count: 5, anchor: 'line' }),
  ],
  crumple: [
    style('light', '輕輕揉過', 70, '範圍半徑', { strength: 40, tone: 30, soft: 0, count: 8 }),
    style('heavy', '揉成一團再攤平', 90, '範圍半徑', { strength: 75, tone: 40, soft: 0, count: 22 }),
    style('radial', '從一點揉起', 50, '範圍半徑', { strength: 55, tone: 35, soft: 0, count: 12 }),
    style('wrinkle', '局部縐紋', 18, '範圍半徑', { strength: 50, tone: 30, soft: 0, count: 14 }),
  ],
  spots: [
    style('fox', '黃褐斑', 35, '範圍半徑', { strength: 55, tone: 25, soft: 0, count: 25 }),
    style('speck', '細黑點', 30, '範圍半徑', { strength: 60, tone: 80, soft: 0, count: 60 }),
    style('splash', '茶水濺點', 12, '範圍半徑', { strength: 55, tone: 45, soft: 10, count: 16 }),
    style('blotch', '大塊老斑', 14, '範圍半徑', { strength: 45, tone: 35, soft: 60, count: 3 }),
  ],
  mold: [
    style('colony', '霉菌落', 18, '範圍半徑', { strength: 55, tone: 25, soft: 15, count: 3 }),
    style('speckle', '細密黑霉', 22, '範圍半徑', { strength: 60, tone: 85, soft: 0, count: 140 }),
    style('ring', '霉圈', 10, '半徑', { strength: 55, tone: 30, soft: 20 }),
    style('powder', '白霉粉', 14, '範圍半徑', { strength: 55, tone: 20, soft: 55, count: 4 }),
  ],
  worm: [
    style('scatter', '散布小洞', 25, '範圍半徑', { strength: 60, tone: 40, soft: 0, count: 12 }),
    style('tunnel', '蛀道', 45, '長度', { strength: 50, tone: 50, soft: 0 }),
    style('cluster', '一叢蛀孔', 5, '範圍半徑', { strength: 60, tone: 45, soft: 0, count: 14 }),
    style('edge', '書邊蛀蝕', 40, '長度', { strength: 60, tone: 45, soft: 0, count: 12, anchor: 'edge' }),
  ],
  pin: [
    style('tack', '圖釘孔', 1, '大小', { tone: 20, soft: 0 }),
    style('staple', '釘書針孔', 12, '兩孔間距', { tone: 35, soft: 0 }),
    style('torn', '扯破的釘孔', 1.2, '大小', { strength: 60, tone: 25, soft: 0 }),
    style('rusty', '生鏽的釘孔', 1, '大小', { tone: 85, soft: 10 }),
  ],
  rust: [
    style('clip', '迴紋針', 27, '長度', { tone: 25, soft: 10 }),
    style('staple', '釘書針', 12, '寬度', { tone: 40, soft: 10 }),
    style('spot', '鏽斑', 6, '半徑', { tone: 35, soft: 25, count: 3 }),
    style('ring', '鐵罐圈印', 16, '半徑', { tone: 40, soft: 10, irregular: 30 }),
  ],
  tape: [
    style('clear', '透明膠帶發黃', 34, '長度', { strength: 55, tone: 30, soft: 0 }),
    style('masking', '紙膠帶', 34, '長度', { strength: 45, tone: 20, soft: 0 }),
    style('residue', '撕掉後的殘膠', 30, '長度', { strength: 60, tone: 45, soft: 10 }),
    style('cross', '交叉兩條', 34, '長度', { strength: 55, tone: 30, soft: 0 }),
  ],
  wax: [
    style('drip', '滴落', 3, '蠟滴半徑', { tone: 0, soft: 0, count: 3 }),
    style('pool', '一攤', 8, '半徑', { tone: 0, soft: 0 }),
    style('splash', '濺點', 3, '範圍大小', { tone: 0, soft: 0, count: 14 }),
    style('run', '流下的蠟淚', 3.5, '寬度', { tone: 0, soft: 0 }),
  ],
  smudge: [
    style('wipe', '手抹', 7, '大小', { strength: 60, tone: 0, soft: 25 }),
    style('thumb', '拇指抹', 6, '大小', { strength: 55, tone: 0, soft: 20 }),
    style('drag', '拖長', 6, '寬度', { strength: 60, tone: 0, soft: 20 }),
    style('wet', '濕暈', 8, '半徑', { strength: 65, tone: 0, soft: 35 }),
  ],
};

/** 色調滑桿兩端的說明（0 與 100）。 */
export const FX_TONE_LABELS: Readonly<Record<FxKind, readonly [string, string]>> = {
  burn: ['焦黑', '褐'],
  water: ['偏黃', '偏灰'],
  tear: ['白色紙纖維', '舊黃紙纖維'],
  fold: ['淺', '髒污'],
  crumple: ['淺', '深'],
  spots: ['淡黃褐', '深褐'],
  mold: ['青綠', '黑'],
  worm: ['淺褐', '深褐'],
  pin: ['乾淨', '鏽褐'],
  rust: ['橘褐', '黑褐'],
  tape: ['微黃', '琥珀'],
  wax: ['白蠟', '紅蠟'],
  smudge: ['黑墨', '藍黑'],
};

/** 可以畫自訂形狀的種類（多邊形或手繪套索）：當作燒、水、撕的範圍。 */
export const SHAPE_KINDS: ReadonlySet<FxKind> = new Set<FxKind>(['burn', 'water', 'tear']);

export interface FxItem {
  readonly id: string;
  readonly kind: FxKind;
  readonly style: string;
  /** 中心點（紙面座標，公釐）。 */
  readonly x: number;
  readonly y: number;
  readonly rotate: number;
  readonly size: number;
  /** 形狀的不規則程度、強度、色調、邊緣柔和度：0～100。 */
  readonly irregular: number;
  readonly strength: number;
  readonly tone: number;
  readonly soft: number;
  readonly count: number;
  readonly seed: number;
  /** 疊放順序（大的在上）。 */
  readonly z: number;
  /** 自訂形狀：相對中心的點（公釐、未旋轉），以 size 為外接半徑縮放；null 表示用樣式本身的形狀。 */
  readonly shape: readonly Point[] | null;
}

export const FX_LIMITS = {
  items: 150,
  shapePoints: 400,
  count: 200,
} as const;

export function isFxKind(v: unknown): v is FxKind {
  return FX_KINDS.some((k) => k.value === v);
}

export function fxKindLabel(kind: FxKind): string {
  return FX_KINDS.find((k) => k.value === kind)?.label ?? kind;
}

export function fxStyle(kind: FxKind, value: string): FxStyle {
  const styles = FX_STYLES[kind];
  return styles.find((s) => s.value === value) ?? (styles[0] as FxStyle);
}

export function isFxStyle(kind: FxKind, value: unknown): value is string {
  return typeof value === 'string' && FX_STYLES[kind].some((s) => s.value === value);
}

/** 大小滑桿的範圍（公釐）。 */
export function sizeRange(st: FxStyle, shaped = false): readonly [number, number] {
  if (shaped) return [1, 500];
  // 散布型（範圍半徑）的樣式可以大到蓋住整張紙
  if (st.sizeLabel.includes('範圍')) return [Math.max(0.3, Math.round(st.size * 0.2 * 10) / 10), 300];
  if (st.anchor === 'line') return [20, 500];
  return [Math.max(0.3, Math.round(st.size * 0.2 * 10) / 10), Math.min(500, Math.round(st.size * 4))];
}

/** 一項的預設值（不含位置、種子、編號）。 */
export function fxDefaults(kind: FxKind, styleValue: string): Omit<FxItem, 'id' | 'x' | 'y' | 'seed' | 'z'> {
  const st = fxStyle(kind, styleValue);
  return {
    kind,
    style: st.value,
    rotate: 0,
    size: st.size,
    irregular: st.irregular,
    strength: st.strength,
    tone: st.tone,
    soft: st.soft,
    count: st.count ?? 1,
    shape: null,
  };
}

export function createFxItem(kind: FxKind, styleValue: string, at: { readonly x: number; readonly y: number; readonly rotate?: number }, seed: number, z: number, id: string): FxItem {
  return { ...fxDefaults(kind, styleValue), id, x: at.x, y: at.y, rotate: at.rotate ?? 0, seed, z };
}

/** 換樣式：沒改過的欄位跟著新樣式的預設值，改過的保留。 */
export function changeStyle(item: FxItem, styleValue: string): FxItem {
  const before = fxDefaults(item.kind, item.style);
  const after = fxDefaults(item.kind, styleValue);
  const keep = <K extends keyof typeof before>(key: K): (typeof before)[K] => (item[key] === before[key] ? after[key] : item[key]);
  return {
    ...item,
    style: after.style,
    size: keep('size'),
    irregular: keep('irregular'),
    strength: keep('strength'),
    tone: keep('tone'),
    soft: keep('soft'),
    count: keep('count'),
  };
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** 存檔用：只留下與樣式預設值不同的欄位（位置、種子、編號、種類、樣式一定會存）。 */
export function compactFxItem(item: FxItem): Record<string, unknown> {
  const d = fxDefaults(item.kind, item.style);
  const out: Record<string, unknown> = { id: item.id, kind: item.kind, style: item.style, x: round2(item.x), y: round2(item.y), seed: item.seed };
  if (item.z !== 0) out['z'] = item.z;
  if (item.rotate !== d.rotate) out['rotate'] = round2(item.rotate);
  for (const key of ['size', 'irregular', 'strength', 'tone', 'soft'] as const) {
    if (item[key] !== d[key]) out[key] = round2(item[key]);
  }
  if (item.count !== d.count) out['count'] = item.count;
  if (item.shape) out['shape'] = item.shape.map((p) => ({ x: round2(p.x), y: round2(p.y) }));
  return out;
}

const ID_RE = /^[A-Za-z0-9#_:-]{1,60}$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * 匯入時逐項驗證：種類、樣式、位置、種子一定要有而且合法；其他欄位沒有就用樣式的預設值，
 * 有但格式不符（型別錯、超出範圍）就整項丟棄（回傳 null），由呼叫端提示。
 */
export function sanitizeFxItem(v: unknown): FxItem | null {
  if (!isRecord(v)) return null;
  const id = typeof v['id'] === 'string' && ID_RE.test(v['id']) ? v['id'] : null;
  const kind = isFxKind(v['kind']) ? v['kind'] : null;
  if (id === null || kind === null || !isFxStyle(kind, v['style'])) return null;
  const st = v['style'];
  const x = num(v['x'], -100, 600);
  const y = num(v['y'], -100, 600);
  const seed = isValidSeed(v['seed']) ? v['seed'] : null;
  if (x === null || y === null || seed === null) return null;
  const d = fxDefaults(kind, st);
  const [minSize, maxSize] = sizeRange(fxStyle(kind, st), v['shape'] !== undefined && v['shape'] !== null);
  const opt = (key: string, min: number, max: number, fallback: number): number | null => (v[key] === undefined ? fallback : num(v[key], min, max));
  const rotate = opt('rotate', -360, 360, d.rotate);
  const size = opt('size', minSize, maxSize, d.size);
  const irregular = opt('irregular', 0, 100, d.irregular);
  const strength = opt('strength', 0, 100, d.strength);
  const tone = opt('tone', 0, 100, d.tone);
  const soft = opt('soft', 0, 100, d.soft);
  const count = v['count'] === undefined ? d.count : Number.isInteger(v['count']) ? num(v['count'], 1, FX_LIMITS.count) : null;
  const z = v['z'] === undefined ? 0 : Number.isInteger(v['z']) ? num(v['z'], -1000, 1000) : null;
  let shape: Point[] | null = null;
  if (v['shape'] !== undefined && v['shape'] !== null) {
    shape = sanitizeShape(v['shape']);
    if (shape === null || !SHAPE_KINDS.has(kind)) return null;
  }
  if (rotate === null || size === null || irregular === null || strength === null || tone === null || soft === null || count === null || z === null) return null;
  return { id, kind, style: st, x, y, rotate, size, irregular, strength, tone, soft, count, seed, z, shape };
}

function num(v: unknown, min: number, max: number): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null;
}

export function sanitizeShape(v: unknown): Point[] | null {
  if (!Array.isArray(v) || v.length < 3 || v.length > FX_LIMITS.shapePoints) return null;
  const out: Point[] = [];
  for (const p of v) {
    if (!isRecord(p)) return null;
    const x = num(p['x'], -600, 600);
    const y = num(p['y'], -600, 600);
    if (x === null || y === null) return null;
    out.push({ x, y });
  }
  return out;
}

/**
 * 把畫好的自訂形狀（紙面座標）變成一項的形狀：中心取外框中心，點改成相對中心，
 * 大小（size）取最遠一點的距離。點太多時平均抽樣到上限以內。
 */
export function shapeFromPolygon(points: readonly Point[]): { readonly x: number; readonly y: number; readonly size: number; readonly shape: Point[] } | null {
  if (points.length < 3) return null;
  const step = Math.max(1, Math.ceil(points.length / FX_LIMITS.shapePoints));
  const pts = points.filter((_, i) => i % step === 0);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const rel = pts.map((p) => ({ x: round2(p.x - cx), y: round2(p.y - cy) }));
  const size = Math.max(...rel.map((p) => Math.hypot(p.x, p.y)));
  if (!(size > 0.5)) return null;
  return { x: round2(cx), y: round2(cy), size: round2(size), shape: rel };
}

// ---- 擺放：新加的一項放在哪裡 ----

export interface PlaceContext {
  /** 紙張外框（裁切之後的外接矩形）。 */
  readonly bounds: Rect;
  /** 保護區（線索），隨機擺放時避開。 */
  readonly protect: readonly Rect[];
}

/** 一項大約佔多大（公釐，半徑）：擺放時避開保護區用。 */
export function approxRadius(kind: FxKind, st: FxStyle, size: number): number {
  if (st.anchor === 'line') return 4;
  if (kind === 'tape' || kind === 'rust') return size / 2;
  if (kind === 'water' && (st.value === 'tear' || st.value === 'rain')) return size * 5;
  if (kind === 'burn' && st.value === 'row') return size * 6;
  if (kind === 'wax' && st.value === 'splash') return size * 4;
  if (kind === 'smudge' && st.value === 'drag') return size * 2;
  return size * (kind === 'burn' ? 1.8 : 1.1);
}

const CORNER_ROTATE = [0, 90, 180, 270] as const;

/** 依樣式的擺放方式與種子挑位置：貼邊、貼角、直線或任意位置（避開保護區與已有的項目）。 */
export function placeFx(kind: FxKind, styleValue: string, size: number, seed: number, ctx: PlaceContext, existing: readonly FxItem[] = []): { x: number; y: number; rotate: number } {
  const st = fxStyle(kind, styleValue);
  const rng = rngFor(seed, `place:${kind}:${st.value}`);
  const b = ctx.bounds;
  if (st.anchor === 'corner') {
    const k = int(rng, 0, 3);
    const corners = [
      { x: b.x, y: b.y },
      { x: b.x + b.w, y: b.y },
      { x: b.x + b.w, y: b.y + b.h },
      { x: b.x, y: b.y + b.h },
    ];
    const c = corners[k] as Point;
    return { x: c.x, y: c.y, rotate: CORNER_ROTATE[k] as number };
  }
  if (st.anchor === 'edge') {
    const side = int(rng, 0, 3);
    const t = range(rng, 0.2, 0.8);
    const jitter = range(rng, -3, 3);
    if (side === 0) return { x: b.x + b.w * t, y: b.y, rotate: jitter };
    if (side === 1) return { x: b.x + b.w, y: b.y + b.h * t, rotate: 90 + jitter };
    if (side === 2) return { x: b.x + b.w * t, y: b.y + b.h, rotate: 180 + jitter };
    return { x: b.x, y: b.y + b.h * t, rotate: 270 + jitter };
  }
  if (st.anchor === 'line') {
    const horizontal = b.h >= b.w ? rng() < 0.75 : rng() < 0.25;
    const t = pick(rng, [1 / 3, 1 / 2, 1 / 2, 2 / 3]);
    return horizontal ? { x: b.x + b.w / 2, y: b.y + b.h * t, rotate: 0 } : { x: b.x + b.w * t, y: b.y + b.h / 2, rotate: 90 };
  }
  const r = approxRadius(kind, st, size);
  const pad = Math.min(Math.max(3, r * 0.6), Math.min(b.w, b.h) / 3);
  const avoid = [...ctx.protect, ...existing.map((e) => square(e.x, e.y, approxRadius(e.kind, fxStyle(e.kind, e.style), e.size) * 0.6))];
  let best: { x: number; y: number } | null = null;
  for (let i = 0; i < 40; i++) {
    const p = { x: range(rng, b.x + pad, b.x + b.w - pad), y: range(rng, b.y + pad, b.y + b.h - pad) };
    best ??= p;
    const box = square(p.x, p.y, r);
    if (!ctx.protect.some((a) => rectsOverlap(a, box)) && (i > 25 || !avoid.some((a) => rectsOverlap(a, box)))) return { ...p, rotate: Math.round(range(rng, -40, 40)) };
  }
  return { ...(best ?? { x: b.x + b.w / 2, y: b.y + b.h / 2 }), rotate: 0 };
}

function square(x: number, y: number, r: number): Rect {
  return { x: x - r, y: y - r, w: 2 * r, h: 2 * r };
}

/** 快速產生 n 個（style 為 'random' 時每個隨機挑一種樣式）。 */
export function quickGenerate(
  kind: FxKind,
  styleValue: string,
  n: number,
  seed: number,
  ctx: PlaceContext,
  existing: readonly FxItem[],
  idOf: (i: number) => string,
): FxItem[] {
  const rng = rngFor(seed, `quick:${kind}:${styleValue}`);
  const out: FxItem[] = [];
  let z = existing.length ? Math.max(...existing.map((e) => e.z)) + 1 : 0;
  const count = Math.max(0, Math.min(FX_LIMITS.items - existing.length, Math.round(n)));
  for (let i = 0; i < count; i++) {
    const st = styleValue === 'random' ? pick(rng, FX_STYLES[kind]).value : styleValue;
    const itemSeed = 1 + Math.floor(rng() * 2147483000);
    const size = fxStyle(kind, st).size * range(rng, 0.8, 1.25);
    const at = placeFx(kind, st, size, itemSeed, ctx, [...existing, ...out]);
    const item = createFxItem(kind, st, at, itemSeed, z++, idOf(i));
    out.push(fxStyle(kind, st).anchor === 'line' ? item : { ...item, size: Math.round(size * 10) / 10 });
  }
  return out;
}

// ---- 把原本的全域滑桿拆成個別項目 ----

/** 紙張狀況裡可以拆成個別項目的欄位（其餘如泛黃、紙邊、日曬、墨水漸淡仍是整張紙的設定）。 */
export interface QuickConditions {
  readonly burnHoles: number;
  readonly wormHoles: number;
  readonly pinHoles: boolean;
  readonly water: string;
  readonly waterStrength: number;
  readonly waterTint?: string;
  readonly folds: boolean;
  readonly foldStyle: string;
  readonly crumple: number;
  readonly stains: boolean;
  readonly spots: number;
  readonly mold: number;
  readonly rust: boolean;
  readonly tape: boolean;
  readonly smudge: boolean;
  readonly wax: boolean;
  readonly effectSeed: number;
}

/** 拆完之後要把紙張狀況改成的值（這些效果改由個別項目畫）。 */
export const CLEARED_QUICK: Omit<QuickConditions, 'effectSeed' | 'waterTint' | 'waterStrength' | 'foldStyle'> = {
  burnHoles: 0,
  wormHoles: 0,
  pinHoles: false,
  water: 'none',
  folds: false,
  crumple: 0,
  stains: false,
  spots: 0,
  mold: 0,
  rust: false,
  tape: false,
  smudge: false,
  wax: false,
};

/** 依目前的全域滑桿產生對應的個別項目。位置由紙張狀況的種子決定。 */
export function itemsFromConditions(c: QuickConditions, ctx: PlaceContext, existing: readonly FxItem[], idOf: (i: number) => string): FxItem[] {
  const b = ctx.bounds;
  const out: FxItem[] = [];
  const rng: Rng = rngFor(c.effectSeed, 'convert');
  let n = 0;
  let z = existing.length ? Math.max(...existing.map((e) => e.z)) + 1 : 0;
  const all = (): FxItem[] => [...existing, ...out];
  const nextSeed = (): number => 1 + Math.floor(rng() * 2147483000);
  const add = (kind: FxKind, st: string, at: { x: number; y: number; rotate?: number }, patch: Partial<FxItem> = {}): void => {
    const made = { ...createFxItem(kind, st, at, nextSeed(), z++, idOf(n++)), ...patch };
    const [lo, hi] = sizeRange(fxStyle(kind, st), made.shape !== null);
    out.push({ ...made, size: Math.max(lo, Math.min(hi, made.size)) });
  };
  const quick = (kind: FxKind, st: string, count: number): void => {
    const made = quickGenerate(kind, st, count, nextSeed(), ctx, all(), (i) => idOf(n + i));
    n += made.length;
    for (const m of made) out.push({ ...m, z: z++ });
  };
  const center = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const big = Math.max(b.w, b.h);
  if (c.burnHoles > 0) quick('burn', 'hole', Math.round(c.burnHoles));
  if (c.wormHoles > 0) add('worm', 'scatter', center, { size: Math.round(big * 0.45), count: Math.round(c.wormHoles) });
  if (c.pinHoles) {
    add('pin', 'tack', { x: b.x + 6, y: b.y + 6 });
    add('pin', 'tack', { x: b.x + b.w - 6, y: b.y + 6 });
  }
  if (c.water === 'corner' || c.water === 'half' || c.water === 'whole') {
    const tone = c.waterTint === 'blue' ? 70 : 20;
    const strength = Math.max(0, Math.min(100, c.waterStrength));
    if (c.water === 'whole') {
      const hw = b.w / 2;
      const hh = b.h / 2;
      add('water', 'soak', center, { strength, tone, size: Math.round(Math.hypot(hw, hh) * 10) / 10, shape: [{ x: -hw, y: -hh }, { x: hw, y: -hh }, { x: hw, y: hh }, { x: -hw, y: hh }] });
    } else if (c.water === 'corner') {
      const k = int(rng, 0, 3);
      add('water', 'soak', { x: k === 1 || k === 2 ? b.x + b.w : b.x, y: k >= 2 ? b.y + b.h : b.y }, { strength, tone, size: Math.round(Math.min(b.w, b.h) * 0.5) });
    } else {
      add('water', 'soak', { x: center.x, y: b.y + b.h }, { strength, tone, size: Math.round(b.h * 0.55) });
    }
  }
  if (c.folds) {
    const portrait = b.h >= b.w;
    if (c.foldStyle === 'quarter') add('fold', 'cross', center);
    else if (c.foldStyle === 'thirds') {
      add('fold', 'line', { x: center.x, y: b.y + b.h / 3 });
      add('fold', 'line', { x: center.x, y: b.y + (b.h * 2) / 3 });
    } else add('fold', 'line', center, { rotate: portrait ? 0 : 90 });
  }
  if (c.crumple > 0) {
    add('crumple', c.crumple >= 60 ? 'heavy' : 'light', center, { size: Math.round(big * 0.7), strength: Math.round(c.crumple), count: Math.max(1, Math.round((c.crumple / 100) * 22)) });
  }
  if (c.stains) {
    quick('water', 'round', 2);
    quick('water', 'cup', 1);
  }
  if (c.spots > 0) add('spots', 'fox', center, { size: Math.round(big * 0.55), count: Math.max(1, Math.round((c.spots / 100) * 60)) });
  if (c.mold > 0) add('mold', 'colony', center, { size: Math.round(big * 0.45), count: Math.max(1, Math.round((c.mold / 100) * 7)) });
  if (c.rust) add('rust', 'clip', { x: b.x + b.w * range(rng, 0.2, 0.8), y: b.y + 11 }, { rotate: Math.round(range(rng, -6, 6)) });
  if (c.tape) {
    add('tape', 'clear', { x: b.x + 9, y: b.y + 9, rotate: -38 });
    add('tape', 'clear', { x: b.x + b.w - 9, y: b.y + 9, rotate: 38 });
  }
  if (c.smudge) quick('smudge', 'wipe', 1);
  if (c.wax) quick('wax', 'drip', 1);
  return out.slice(0, Math.max(0, FX_LIMITS.items - existing.length));
}
