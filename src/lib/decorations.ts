// 裝飾的形狀（純邏輯）：血跡、杯印、墨漬、指紋、火漆、紅筆圈注、鉛筆眉批、公文戳記、
// 抓痕、黏液、怪符號、反覆描寫的字。全部由種子以程式產生（怪符號也是隨機組合的原創圖形），
// 座標以裝飾中心為原點、單位公釐；畫面上再依位置、旋轉、縮放、透明度擺放。

import type { DecorationType } from '../props/extras.ts';
import { blobPolygon } from './effects.ts';
import { rectsOverlap, type Point, type Rect } from './geometry.ts';
import { gaussianish, int, pick, range, rngFor, type Rng } from './random.ts';

export type Primitive =
  | {
      readonly kind: 'path';
      readonly d: string;
      /** 顏色，或「grad:id」指向 DecorationShape.gradients 裡的漸層。 */
      readonly fill: string;
      readonly stroke?: string;
      readonly width?: number;
      readonly dash?: string;
      readonly cap?: 'round';
      /** 用擾動濾鏡讓邊緣不規則：rough 較粗、fine 較細。 */
      readonly filter?: 'rough' | 'fine';
      readonly opacity?: number;
    }
  | { readonly kind: 'text'; readonly x: number; readonly y: number; readonly text: string; readonly size: number; readonly fill: string; readonly vertical?: boolean; readonly weight?: number; readonly font?: 'title' | 'hand' }
  /** 一組圖形，可整組模糊（手印各塊壓痕之間的過渡）。 */
  | { readonly kind: 'group'; readonly children: readonly Primitive[]; readonly blur?: number };

type GradientStops = readonly (readonly [number, string])[];

/** 漸層（座標單位公釐，以裝飾中心為原點）。 */
export type GradientDef =
  | { readonly kind: 'radial'; readonly id: string; readonly cx: number; readonly cy: number; readonly r: number; readonly stops: GradientStops }
  | { readonly kind: 'linear'; readonly id: string; readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number; readonly stops: GradientStops };

/**
 * 血跡等污漬的質感，交給 SVG 濾鏡處理：
 * - 邊緣用雜訊擾動成不規則，再略為模糊，所以沒有硬邊框；
 * - 內部的透明度由另一層雜訊控制（feTurbulence），做出斑駁、深淺不均。
 * 雜訊種子由裝飾的種子決定，所以預覽與列印一致、按「換一個」才會變。
 */
export interface StainTexture {
  readonly seed: number;
  /** 邊緣擾動：雜訊頻率（每公釐）與最大位移（公釐）。 */
  readonly warpFrequency: number;
  readonly warp: number;
  /** 邊緣柔化：模糊的標準差（公釐）。 */
  readonly soften: number;
  /** 斑駁：雜訊頻率，以及透明度 = 斜率 × 雜訊 + 截距（再限制在 0～1）。 */
  readonly mottleFrequency: number;
  readonly mottle: readonly [slope: number, intercept: number];
}

export interface DecorationShape {
  readonly primitives: Primitive[];
  readonly gradients?: readonly GradientDef[];
  /**
   * 遮罩：亮的地方留下、暗的地方挖空，灰階代表按壓的輕重（血手印整個印子就是畫在遮罩裡）。
   * 用遮罩而不是畫紙色，是因為紙色會隨做舊程度改變。
   */
  readonly mask?: readonly Primitive[];
  /** 污漬質感（不規則略柔和的邊緣、斑駁的透明度）。 */
  readonly texture?: StainTexture;
  /** 大約的外接半徑（公釐），用於點選與測試。 */
  readonly radius: number;
  /** 使用印泥質感濾鏡（戳記、火漆）。 */
  readonly inky?: boolean;
}

export const DEFAULT_TEXT: Partial<Record<DecorationType, string>> = {
  stamp: '機密',
  'pencil-note': '此人可疑',
  'wax-seal': '林',
  'pressed-text': '逃',
};

const RED_PEN = 'rgb(190 25 25 / 0.9)';
const PENCIL = 'rgb(70 70 75 / 0.75)';

function poly(points: readonly Point[]): string {
  return `M${points.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join('L')}Z`;
}

function circle(cx: number, cy: number, r: number): string {
  return `M${(cx - r).toFixed(2)} ${cy.toFixed(2)}a${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(2 * r).toFixed(2)} 0a${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(-2 * r).toFixed(2)} 0Z`;
}

function ellipse(cx: number, cy: number, rx: number, ry: number): string {
  return `M${(cx - rx).toFixed(2)} ${cy.toFixed(2)}a${rx.toFixed(2)} ${ry.toFixed(2)} 0 1 0 ${(2 * rx).toFixed(2)} 0a${rx.toFixed(2)} ${ry.toFixed(2)} 0 1 0 ${(-2 * rx).toFixed(2)} 0Z`;
}

/** 手繪感的線：沿點列加一點抖動。 */
function wobbly(rng: Rng, pts: readonly Point[], jitter: number): string {
  return `M${pts.map((p) => `${(p.x + gaussianish(rng) * jitter).toFixed(2)} ${(p.y + gaussianish(rng) * jitter).toFixed(2)}`).join('L')}`;
}

// ---------- 第三版：較寫實的血跡、手印、抓痕、黏液 ----------

export interface BloodPalette {
  readonly core: string;
  readonly mid: string;
  readonly edge: string;
  readonly mist: string;
}

/**
 * 新鮮的血偏鮮紅；乾涸後氧化成暗紅到褐色。
 * 顏色都不透明：重疊的地方不會疊出深色接縫，透明度與斑駁交給 StainTexture 的濾鏡。
 * 邊緣色只比中間略深一點（乾掉時邊緣會積得較濃），不是一圈框線。
 */
export function bloodPalette(dry: boolean): BloodPalette {
  return dry
    ? { core: 'rgb(130 58 36 / 1)', mid: 'rgb(106 40 22 / 1)', edge: 'rgb(90 31 16 / 1)', mist: 'rgb(102 38 20 / 1)' }
    : { core: 'rgb(160 22 20 / 1)', mid: 'rgb(134 10 12 / 1)', edge: 'rgb(116 6 9 / 1)', mist: 'rgb(140 12 14 / 1)' };
}

function withAlpha(color: string, alpha: number): string {
  return color.replace(/\/ [0-9.]+\)/, `/ ${alpha.toFixed(2)})`);
}

/**
 * 污漬質感的參數。乾涸的比新鮮的斑駁（透明度起伏大、會出現幾乎沒沾到的地方）；
 * 手印的擾動較細、幾乎不模糊，指紋才看得到，斑駁更強，像按壓時沒沾到的地方。
 */
export function stainTexture(rng: Rng, kind: 'stain' | 'print', dry: boolean): StainTexture {
  const seed = int(rng, 1, 997);
  if (kind === 'print') {
    return { seed, warpFrequency: 1.1, warp: 0.28, soften: 0.05, mottleFrequency: 0.42, mottle: dry ? [3.1, -0.75] : [2.6, -0.4] };
  }
  return { seed, warpFrequency: 0.6, warp: 0.45, soften: 0.17, mottleFrequency: 0.3, mottle: dry ? [2.9, -0.6] : [2.2, -0.15] };
}

/** 一灘：中心略淺、邊緣略深的漸層，沒有外框；邊緣的不規則與柔和交給濾鏡。 */
function pool(rng: Rng, id: string, cx: number, cy: number, r: number, irregular: number, pal: BloodPalette, squash = 1): { prim: Primitive; grad: GradientDef } {
  const pts = blobPolygon(rng, cx, cy, r, irregular, 36).map((p) => ({ x: p.x, y: cy + (p.y - cy) * squash }));
  return {
    grad: { kind: 'radial', id, cx, cy, r: r * 1.15, stops: [[0, pal.core], [0.7, pal.mid], [1, pal.edge]] },
    prim: { kind: 'path', d: poly(pts), fill: `grad:${id}` },
  };
}

/** 淚滴形：圓頭中心 (hx, hy)、半徑 r，尾巴朝 a 方向再延伸 len。 */
export function teardrop(hx: number, hy: number, r: number, a: number, len: number): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i <= 14; i++) {
    const t = a + Math.PI / 2 + (i / 14) * Math.PI;
    pts.push({ x: hx + Math.cos(t) * r, y: hy + Math.sin(t) * r });
  }
  pts.push({ x: hx + Math.cos(a) * (r + len), y: hy + Math.sin(a) * (r + len) });
  return pts;
}

/** 噴濺：中央一灘與向外的尖刺，四周大小不一的衛星血點與有方向性的拉長血滴，外加細霧。 */
function splatter(rng: Rng, pal: BloodPalette): { prims: Primitive[]; grads: GradientDef[] } {
  const r = range(rng, 4.5, 7);
  const main = pool(rng, 'pool', 0, 0, r, 0.5, pal);
  const prims: Primitive[] = [];
  const dir = range(rng, 0, Math.PI * 2);
  // 血滴落下時從本體濺出的尖刺（從邊緣往外變細）
  for (let i = 0, n = int(rng, 6, 12); i < n; i++) {
    const a = range(rng, 0, Math.PI * 2);
    const w = range(rng, 0.35, 0.9);
    prims.push({ kind: 'path', d: poly(teardrop(Math.cos(a) * (r * 0.82), Math.sin(a) * (r * 0.82), w, a, range(rng, 1, 4.5))), fill: pal.mid });
  }
  prims.push(main.prim);
  for (let i = 0, n = int(rng, 30, 48); i < n; i++) {
    const a = rng() < 0.25 ? range(rng, 0, Math.PI * 2) : dir + gaussianish(rng) * 0.55;
    const dist = r + 1 + 15 * Math.pow(rng(), 0.75);
    const size = 0.1 + 1.15 * Math.pow(rng(), 3.2);
    const cx = Math.cos(a) * dist;
    const cy = Math.sin(a) * dist;
    if (size > 0.3 && rng() < 0.6) {
      prims.push({ kind: 'path', d: poly(teardrop(cx, cy, size, a, size * range(rng, 1.1, 2.8))), fill: pal.mid });
    } else {
      prims.push({ kind: 'path', d: circle(cx, cy, size), fill: size > 0.6 ? pal.mid : pal.mist });
    }
  }
  for (let i = 0, n = int(rng, 25, 50); i < n; i++) {
    const a = dir + gaussianish(rng) * 0.8;
    const dist = r + range(rng, 2, 19);
    prims.push({ kind: 'path', d: circle(Math.cos(a) * dist, Math.sin(a) * dist, range(rng, 0.06, 0.16)), fill: pal.mist });
  }
  return { prims, grads: [main.grad] };
}

/** 滴落：上方一灘，往下幾道越來越細的流痕，末端是淚滴形的血珠，偶有再滴下去的一滴。 */
function drips(rng: Rng, pal: BloodPalette): { prims: Primitive[]; grads: GradientDef[] } {
  const top = pool(rng, 'pool', 0, -12, 8, 0.45, pal, 0.55);
  const prims: Primitive[] = [];
  for (let i = 0, n = int(rng, 2, 5); i < n; i++) {
    const x = range(rng, -7.5, 7.5);
    const w = range(rng, 0.7, 2);
    const len = range(rng, 6, 22);
    const y0 = -12.5;
    const left: Point[] = [];
    const right: Point[] = [];
    for (let k = 0; k <= 12; k++) {
      const t = k / 12;
      const cx = x + Math.sin(t * 3 + i) * 0.35;
      const half = (w / 2) * (1 - 0.45 * t) * (1 + 0.12 * Math.sin(t * 9 + i * 2));
      left.push({ x: cx - half, y: y0 + t * len });
      right.push({ x: cx + half, y: y0 + t * len });
    }
    prims.push({ kind: 'path', d: poly([...left, ...right.reverse()]), fill: pal.mid });
    const endX = x + Math.sin(3 + i) * 0.35;
    prims.push({ kind: 'path', d: poly(teardrop(endX, y0 + len + w * 0.5, w * 0.75, -Math.PI / 2, w * 1.1)), fill: pal.edge });
    if (rng() < 0.4) prims.push({ kind: 'path', d: poly(teardrop(endX, y0 + len + w * 3 + range(rng, 1, 4), w * 0.5, -Math.PI / 2, w * 0.9)), fill: pal.mid });
  }
  return { prims: [...prims, top.prim], grads: [top.grad] };
}

/** 拖痕：起點一灘，接著是一道往後漸淡、漸窄的抹痕，上面有刷痕般斷斷續續的平行細紋。 */
function smear(rng: Rng, pal: BloodPalette): { prims: Primitive[]; grads: GradientDef[] } {
  const start = pool(rng, 'pool', -18, 0, 4.2, 0.35, pal, 0.9);
  const prims: Primitive[] = [];
  const bend = range(rng, -3, 3);
  const at = (t: number, off: number): Point => ({ x: -18 + t * 40, y: Math.sin(t * Math.PI) * bend + off * (1 - t * 0.35) });
  const W = range(rng, 6, 8);
  // 抹痕本體：一整塊，邊緣起伏，用沿拖曳方向的漸層由濃到淡（不分段，所以沒有接縫）
  const upper: Point[] = [];
  const lower: Point[] = [];
  for (let k = 0; k <= 28; k++) {
    const t = k / 28;
    upper.push(at(t, -W / 2 + gaussianish(rng) * 0.25 + Math.sin(t * 11) * 0.3));
    lower.push(at(t, W / 2 + gaussianish(rng) * 0.25 + Math.sin(t * 7 + 1) * 0.3));
  }
  const grads: GradientDef[] = [
    start.grad,
    { kind: 'linear', id: 'smear', x1: -18, y1: 0, x2: 22, y2: 0, stops: [[0, withAlpha(pal.mid, 0.85)], [0.45, withAlpha(pal.mid, 0.45)], [1, withAlpha(pal.mid, 0.04)]] },
  ];
  prims.push({ kind: 'path', d: poly([...upper, ...lower.reverse()]), fill: 'grad:smear' });
  for (let i = 0, n = int(rng, 18, 28); i < n; i++) {
    const off = range(rng, -W / 2, W / 2);
    const t0 = range(rng, 0, 0.1);
    const t1 = range(rng, 0.55, 1);
    const pts: Point[] = [];
    for (let k = 0; k <= 12; k++) pts.push(at(t0 + ((t1 - t0) * k) / 12, off));
    const dash = rng() < 0.7 ? `${range(rng, 4, 12).toFixed(1)} ${range(rng, 0.4, 2.2).toFixed(1)} ${range(rng, 2, 6).toFixed(1)} ${range(rng, 0.8, 3).toFixed(1)}` : undefined;
    prims.push({ kind: 'path', d: wobbly(rng, pts, 0.05), fill: 'none', stroke: pal.edge, width: range(rng, 0.12, 0.55), cap: 'round', opacity: Number(range(rng, 0.3, 0.8).toFixed(2)), ...(dash ? { dash } : {}) });
  }
  prims.push(start.prim);
  return { prims, grads };
}

/** 手指：指根寬 w0、指尖圓頭寬 w1，從 (x0, y0) 朝 a 方向長 len。 */
export function fingerShape(x0: number, y0: number, a: number, len: number, w0: number, w1: number): Point[] {
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const px = -uy;
  const py = ux;
  const r = w1 / 2;
  const cx = x0 + ux * (len - r);
  const cy = y0 + uy * (len - r);
  const pts: Point[] = [{ x: x0 + px * (w0 / 2), y: y0 + py * (w0 / 2) }];
  for (let i = 0; i <= 14; i++) {
    const t = (i / 14) * Math.PI;
    pts.push({ x: cx + px * Math.cos(t) * r + ux * Math.sin(t) * r, y: cy + py * Math.cos(t) * r + uy * Math.sin(t) * r });
  }
  pts.push({ x: x0 - px * (w0 / 2), y: y0 - py * (w0 / 2) });
  return pts;
}

/** 手印的一塊壓痕：沿 a 方向半長 hl、橫向半寬 hw 的橢圓，邊緣略有起伏。 */
interface Pad {
  readonly cx: number;
  readonly cy: number;
  readonly hl: number;
  readonly hw: number;
  readonly a: number;
  /** 按壓的輕重（遮罩的亮度，0～1）。 */
  readonly level: number;
  readonly pts: readonly Point[];
}

function makePad(rng: Rng, cx: number, cy: number, hl: number, hw: number, a: number, level: number): Pad {
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const pts: Point[] = [];
  const phase = range(rng, 0, Math.PI * 2);
  for (let i = 0; i < 28; i++) {
    const t = (i / 28) * Math.PI * 2;
    const k = 1 + 0.07 * Math.sin(t * 3 + phase) + gaussianish(rng) * 0.035;
    const along = Math.cos(t) * hl * k;
    const across = Math.sin(t) * hw * k;
    pts.push({ x: cx + ux * along - uy * across, y: cy + uy * along + ux * across });
  }
  return { cx, cy, hl, hw, a, level, pts };
}

function gray(level: number): string {
  const v = Math.round(Math.max(0, Math.min(1, level)) * 255);
  return `rgb(${v} ${v} ${v})`;
}

/**
 * 血手印：像真的手按上去的印子，而不是一個手形剪影。整個印子畫在遮罩裡（灰階＝按壓輕重），
 * 上面只有一塊血色，所以沒有外框：
 * - 掌心凹處幾乎沒沾到，掌根、拇指根、指根的肉墊與指尖按得重，指節之間是自然的斷開；
 * - 指尖有指紋的紋路；
 * - 隨機缺幾塊，加上斑駁濾鏡讓沒沾到的地方自然出現；
 * - 整隻手往一個方向略微拖抹：印子後方有漸淡的殘影與拖痕。
 */
function handprint(rng: Rng, pal: BloodPalette, dry: boolean): { prims: Primitive[]; grads: GradientDef[]; mask: Primitive[] } {
  const mirror = rng() < 0.5 ? -1 : 1;
  const turn = range(rng, -0.15, 0.15);
  const place = (p: Point): Point => {
    const x = p.x * mirror;
    return { x: x * Math.cos(turn) - p.y * Math.sin(turn), y: x * Math.sin(turn) + p.y * Math.cos(turn) };
  };
  const angle = (a: number): number => (mirror < 0 ? Math.PI - a : a) + turn;
  const pad = (cx: number, cy: number, hl: number, hw: number, a: number, level: number): Pad => {
    const c = place({ x: cx, y: cy });
    return makePad(rng, c.x, c.y, hl, hw, angle(a), level);
  };

  // 掌：先畫輕的（掌心），重的蓋在上面；遮罩裡後畫的直接取代，不會疊深
  const hollow: Pad[] = [];
  for (let i = 0, n = int(rng, 3, 5); i < n; i++) {
    hollow.push(pad(range(rng, -2.2, 2.8), range(rng, 3.4, 7.4), range(rng, 0.6, 1.5), range(rng, 0.5, 1.2), range(rng, 0, Math.PI), range(rng, 0.2, 0.42)));
  }
  const palm: Pad[] = [
    pad(0, 12.6, 5.8, 2.3, 0, range(rng, 0.5, 0.68)),
    pad(4.7, 8.4, 5.2, 2.9, Math.PI / 2 + 0.1, range(rng, 0.6, 0.78)),
    pad(-4.4, 8.8, 4.7, 3.4, Math.PI / 2 - 0.35, range(rng, 0.72, 0.88)),
  ];
  const fingers = [
    { x: -6, y: -0.6, a: -1.78, len: 11.5, w: 3.3 },
    { x: -2.1, y: -1.6, a: -1.63, len: 13.6, w: 3.5 },
    { x: 1.9, y: -1.4, a: -1.5, len: 12.8, w: 3.4 },
    { x: 5.6, y: -0.2, a: -1.33, len: 10, w: 3.0 },
  ];
  // 指根下方的肉墊
  for (const f of fingers) palm.push(pad(f.x, f.y + 1.7, 1.55, 2.1, 0, range(rng, 0.72, 0.9)));
  const digits: Pad[] = [];
  const tips: Pad[] = [];
  const segment = (x: number, y: number, a: number, len: number, w: number, parts: readonly (readonly [number, number, number])[]): void => {
    let s = 0;
    parts.forEach(([frac, lo, hi], i) => {
      const gap = i === 0 ? 0 : range(rng, 0.2, 0.42);
      const l = len * frac;
      const mid = s + gap + (l - gap) / 2;
      const taper = 1 - 0.08 * i;
      const p = pad(x + Math.cos(a) * mid, y + Math.sin(a) * mid, (l - gap) / 2 + 0.05, (w / 2) * taper, a, range(rng, lo, hi));
      digits.push(p);
      if (i === parts.length - 1) tips.push(p);
      s += l;
    });
  };
  for (const f of fingers) {
    const short = rng() < 0.12 ? 0.6 : 1;
    const proximal: [number, number, number] = rng() < 0.15 ? [0.42, 0.12, 0.3] : [0.42, 0.6, 0.8];
    segment(f.x, f.y, f.a + range(rng, -0.06, 0.06), f.len * range(rng, 0.95, 1.04) * short, f.w, [proximal, [0.28, 0.74, 0.9], [0.3, 0.9, 1]]);
  }
  segment(-6.8, 7.4, -2.5 + range(rng, -0.08, 0.08), 10.5, 3.9, [[0.5, 0.58, 0.76], [0.5, 0.88, 1]]);
  // 由輕到重排序：遮罩裡後畫的取代先畫的，重疊處就取按得較重的那塊
  const all = [...hollow, ...palm, ...digits].sort((p, q) => p.level - q.level);

  const mask: Primitive[] = [];
  // 往一個方向拖抹：印子後方幾層漸淡的殘影，加上指尖與掌根拉出的拖痕
  const drag = Math.PI / 2 + range(rng, -0.9, 0.9);
  const dragLen = range(rng, 2.5, 6);
  const dx = Math.cos(drag);
  const dy = Math.sin(drag);
  const ghosts: Primitive[] = [];
  for (let k = 5; k >= 1; k--) {
    const off = (k / 5) * dragLen;
    const fade = 0.24 * (1 - (k - 1) / 5.5);
    for (const p of all) ghosts.push({ kind: 'path', d: poly(p.pts.map((q) => ({ x: q.x + dx * off, y: q.y + dy * off }))), fill: gray(p.level * fade) });
  }
  const streaks: Primitive[] = [];
  for (const p of [...tips, ...palm.slice(0, 3)]) {
    for (let i = 0, n = int(rng, 2, 4); i < n; i++) {
      const across = range(rng, -0.8, 0.8) * p.hw;
      const sx = p.cx - Math.sin(p.a) * across;
      const sy = p.cy + Math.cos(p.a) * across;
      const len = dragLen * range(rng, 0.7, 1.5);
      const pts: Point[] = [];
      for (let k = 0; k <= 6; k++) pts.push({ x: sx + dx * len * (k / 6), y: sy + dy * len * (k / 6) });
      streaks.push({ kind: 'path', d: wobbly(rng, pts, 0.06), fill: 'none', stroke: gray(range(rng, 0.25, 0.5)), width: range(rng, 0.12, 0.4), cap: 'round' });
    }
  }
  // 隨機缺塊（和壓痕一起模糊，邊緣才不會像打洞）
  const chunks: Primitive[] = [];
  for (let i = 0, n = dry ? int(rng, 2, 5) : int(rng, 1, 3); i < n; i++) {
    const p = all[int(rng, 0, all.length - 1)]!;
    chunks.push({ kind: 'path', d: poly(blobPolygon(rng, p.cx + range(rng, -1, 1) * p.hw, p.cy + range(rng, -1, 1) * p.hw, range(rng, 0.6, 2.2), 0.5, 14)), fill: 'black', opacity: Number(range(rng, 0.7, 1).toFixed(2)) });
  }
  // 各塊壓痕整組略為模糊，輕重之間的過渡才自然
  mask.push({ kind: 'group', blur: 0.14, children: [...ghosts, ...streaks, ...all.map((p): Primitive => ({ kind: 'path', d: poly(p.pts), fill: gray(p.level) })), ...chunks] });

  // 指紋：整個指尖一圈圈的紋路（螺旋紋或箕形紋），斷斷續續、和壓痕一樣略模糊
  const ridges: Primitive[] = [];
  for (const t of tips) {
    const whorl = rng() < 0.5;
    const spacing = range(rng, 0.3, 0.36);
    const n = Math.floor((t.hw * 1.02) / spacing);
    const ratio = t.hl / t.hw;
    const core = { x: t.cx + Math.cos(t.a) * t.hl * 0.12, y: t.cy + Math.sin(t.a) * t.hl * 0.12 };
    const from = whorl ? 0 : range(rng, 0.2, 0.6);
    const to = whorl ? Math.PI * 2 : Math.PI * 2 - range(rng, 0.2, 0.6);
    for (let i = 1; i <= n; i++) {
      const ra = spacing * i * ratio;
      const rb = spacing * i;
      const pts: Point[] = [];
      for (let k = 0; k <= 30; k++) {
        const u = from + ((to - from) * k) / 30;
        const along = Math.cos(u) * ra;
        const acrossV = Math.sin(u) * rb;
        pts.push({ x: core.x + Math.cos(t.a) * along - Math.sin(t.a) * acrossV, y: core.y + Math.sin(t.a) * along + Math.cos(t.a) * acrossV });
      }
      const dash = `${range(rng, 1.2, 3.2).toFixed(2)} ${range(rng, 0.12, 0.4).toFixed(2)}`;
      ridges.push({ kind: 'path', d: wobbly(rng, pts, 0.03), fill: 'none', stroke: 'black', width: range(rng, 0.11, 0.15), cap: 'round', opacity: Number(range(rng, 0.36, 0.52).toFixed(2)), dash });
    }
  }
  mask.push({ kind: 'group', blur: 0.04, children: ridges });

  const grads: GradientDef[] = [{ kind: 'radial', id: 'hand', cx: 0, cy: 3, r: 20, stops: [[0, pal.core], [0.6, pal.mid], [1, pal.edge]] }];
  return { prims: [{ kind: 'path', d: 'M-34 -34H34V34H-34Z', fill: 'grad:hand' }], grads, mask };
}

/** 抓痕：三到四道平行的深色劃痕，頭尾尖細；中間露出被刮起的淺色紙纖維，邊緣有毛邊。 */
function claw(rng: Rng): Primitive[] {
  const out: Primitive[] = [];
  const count = int(rng, 3, 4);
  const spacing = range(rng, 4.5, 6);
  const skew = range(rng, 2, 6);
  for (let i = 0; i < count; i++) {
    const x = (i - (count - 1) / 2) * spacing;
    const maxW = range(rng, 1.7, 2.6) * (i === 0 || i === count - 1 ? 0.8 : 1);
    const y0 = -17 + range(rng, -2, 2);
    const y1 = 17 + range(rng, -3, 2);
    const left: Point[] = [];
    const right: Point[] = [];
    const inner: Point[][] = [[], []];
    for (let k = 0; k <= 24; k++) {
      const t = k / 24;
      const cx = x + skew * t + Math.sin(t * 2.4 + i) * 0.5;
      const cy = y0 + (y1 - y0) * t;
      const w = maxW * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.05)), 0.85);
      left.push({ x: cx - w / 2, y: cy });
      right.push({ x: cx + w / 2, y: cy });
      inner[0]!.push({ x: cx - w * 0.18, y: cy });
      inner[1]!.push({ x: cx + w * 0.22, y: cy });
      // 邊緣被刮起的纖維
      if (k > 2 && k < 22 && rng() < 0.55) {
        const side = rng() < 0.5 ? -1 : 1;
        const ex = cx + (side * w) / 2;
        const len = range(rng, 0.4, 1.3);
        out.push({ kind: 'path', d: `M${ex.toFixed(2)} ${cy.toFixed(2)}l${(side * len).toFixed(2)} ${(range(rng, -0.6, 0.6)).toFixed(2)}`, fill: 'none', stroke: rng() < 0.6 ? 'rgb(236 224 196 / 0.85)' : 'rgb(60 30 15 / 0.5)', width: range(rng, 0.08, 0.2), cap: 'round' });
      }
    }
    out.unshift({ kind: 'path', d: poly([...left, ...right.slice().reverse()]), fill: 'rgb(48 20 10 / 0.88)', filter: 'fine' });
    out.push({ kind: 'path', d: poly([...inner[0]!, ...inner[1]!.slice().reverse()]), fill: 'rgb(214 196 160 / 0.8)', filter: 'fine' });
  }
  return out;
}

/** 黏液：半透明、帶光澤，往下垂流。 */
function slime(rng: Rng): { prims: Primitive[]; grads: GradientDef[] } {
  const grads: GradientDef[] = [{ kind: 'radial', id: 'slime', cx: -2, cy: -2, r: 13, stops: [[0, 'rgb(170 200 110 / 0.28)'], [0.7, 'rgb(105 140 60 / 0.48)'], [1, 'rgb(60 95 38 / 0.65)']] }];
  const body = poly(blobPolygon(rng, 0, 0, 11, 0.5, 30));
  const prims: Primitive[] = [
    { kind: 'path', d: body, fill: 'grad:slime', filter: 'rough' },
    { kind: 'path', d: body, fill: 'none', stroke: 'rgb(45 75 30 / 0.55)', width: 0.35, filter: 'rough' },
  ];
  for (let i = 0, n = int(rng, 2, 4); i < n; i++) {
    const x = range(rng, -8, 8);
    const w = range(rng, 1.2, 2.6);
    const len = range(rng, 5, 15);
    const left: Point[] = [];
    const right: Point[] = [];
    for (let k = 0; k <= 8; k++) {
      const t = k / 8;
      const half = (w / 2) * (1 - 0.5 * t);
      left.push({ x: x - half, y: 6 + t * len });
      right.push({ x: x + half, y: 6 + t * len });
    }
    prims.push({ kind: 'path', d: poly([...left, ...right.reverse()]), fill: 'rgb(95 135 55 / 0.45)', filter: 'fine' });
    prims.push({ kind: 'path', d: poly(teardrop(x, 6 + len + w * 0.4, w * 0.6, -Math.PI / 2, w)), fill: 'rgb(80 120 48 / 0.55)' });
    prims.push({ kind: 'path', d: ellipse(x - w * 0.15, 6 + len * 0.4, w * 0.12, len * 0.25), fill: 'rgb(240 255 225 / 0.45)' });
  }
  // 光澤與反光點
  prims.push({ kind: 'path', d: ellipse(-3.5, -4.5, 4.2, 1.5), fill: 'rgb(245 255 235 / 0.42)' });
  prims.push({ kind: 'path', d: ellipse(3, 2.5, 2, 0.8), fill: 'rgb(245 255 235 / 0.3)' });
  for (let i = 0; i < 5; i++) prims.push({ kind: 'path', d: circle(range(rng, -7, 7), range(rng, -6, 5), range(rng, 0.15, 0.4)), fill: 'rgb(255 255 250 / 0.75)' });
  prims.push({ kind: 'path', d: poly(blobPolygon(rng, 3, 2, 3, 0.4, 14)), fill: 'rgb(120 60 140 / 0.22)' });
  return { prims, grads };
}

function fingerprint(rng: Rng): Primitive[] {
  const out: Primitive[] = [];
  for (let i = 1; i <= 11; i++) {
    const rx = i * 0.65;
    const ry = i * 0.85;
    const circ = Math.PI * (rx + ry);
    out.push({ kind: 'path', d: ellipse(range(rng, -0.15, 0.15), range(rng, -0.15, 0.15), rx, ry), fill: 'none', stroke: 'rgb(60 55 50 / 0.55)', width: 0.28, dash: `${(circ * range(rng, 0.15, 0.4)).toFixed(2)} ${(circ * range(rng, 0.03, 0.08)).toFixed(2)}` });
  }
  return out;
}

function waxSeal(rng: Rng, text: string): Primitive[] {
  return [
    { kind: 'path', d: poly(blobPolygon(rng, 0, 0, 12, 0.35, 30)), fill: 'rgb(150 20 25)' },
    { kind: 'path', d: circle(0, 0, 8.5), fill: 'rgb(130 15 20)', stroke: 'rgb(95 8 12)', width: 0.6 },
    { kind: 'path', d: circle(0, 0, 7), fill: 'none', stroke: 'rgb(185 60 55 / 0.7)', width: 0.4 },
    { kind: 'text', x: 0, y: 0, text: Array.from(text).slice(0, 2).join(''), size: 7, fill: 'rgb(90 5 10)', weight: 800, font: 'title' },
    { kind: 'path', d: ellipse(-4, -5, 3, 1.4), fill: 'rgb(255 255 255 / 0.18)' },
  ];
}

function redCircle(rng: Rng): Primitive[] {
  const pts: Point[] = [];
  const turns = range(rng, 1.15, 1.4);
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * Math.PI * 2 * turns + range(rng, -0.02, 0.02);
    const k = 1 + 0.06 * Math.sin(a * 2) + (i / 48) * 0.08;
    pts.push({ x: Math.cos(a) * 16 * k, y: Math.sin(a) * 9 * k });
  }
  return [{ kind: 'path', d: wobbly(rng, pts, 0.15), fill: 'none', stroke: RED_PEN, width: 0.7, cap: 'round' }];
}

function redArrow(rng: Rng): Primitive[] {
  const bend = range(rng, -6, 6);
  const shaft = `M-18 6Q0 ${bend} 16 -4`;
  return [
    { kind: 'path', d: shaft, fill: 'none', stroke: RED_PEN, width: 0.75, cap: 'round' },
    { kind: 'path', d: wobbly(rng, [{ x: 10.5, y: -6.5 }, { x: 16, y: -4 }, { x: 12, y: 0.5 }], 0.1), fill: 'none', stroke: RED_PEN, width: 0.75, cap: 'round' },
  ];
}

function pencilLine(rng: Rng): Primitive[] {
  const out: Primitive[] = [];
  for (let k = 0; k < 2; k++) {
    const pts: Point[] = [];
    for (let i = 0; i <= 12; i++) pts.push({ x: 0.6 * k + range(rng, -0.3, 0.3), y: -20 + i * (40 / 12) });
    out.push({ kind: 'path', d: wobbly(rng, pts, 0.12), fill: 'none', stroke: PENCIL, width: 0.35, cap: 'round' });
  }
  return out;
}

function pencilNote(rng: Rng, text: string): Primitive[] {
  const n = Math.max(1, Array.from(text).length);
  return [
    { kind: 'path', d: wobbly(rng, [{ x: 3.5, y: -n * 2.2 - 1 }, { x: 4.5, y: -n * 2.2 - 1 }, { x: 4.5, y: n * 2.2 + 1 }, { x: 3.5, y: n * 2.2 + 1 }], 0.1), fill: 'none', stroke: PENCIL, width: 0.3 },
    { kind: 'text', x: 0, y: 0, text, size: 4.2, fill: PENCIL, vertical: true, font: 'hand' },
  ];
}

function stamp(rng: Rng, text: string): Primitive[] {
  const chars = Array.from(text).slice(0, 6).join('');
  const w = Math.max(14, chars.length * 7 + 6);
  const color = 'rgb(185 30 30 / 0.85)';
  const round = rng() < 0.3;
  if (round) {
    return [
      { kind: 'path', d: circle(0, 0, 13), fill: 'none', stroke: color, width: 1.4 },
      { kind: 'path', d: circle(0, 0, 10.5), fill: 'none', stroke: color, width: 0.5 },
      { kind: 'text', x: 0, y: 0, text: chars, size: chars.length > 2 ? 5 : 7, fill: color, weight: 800, font: 'title' },
    ];
  }
  return [
    { kind: 'path', d: `M${-w / 2} -7H${w / 2}V7H${-w / 2}Z`, fill: 'none', stroke: color, width: 1.3 },
    { kind: 'path', d: `M${-w / 2 + 1.6} -5.4H${w / 2 - 1.6}V5.4H${-w / 2 + 1.6}Z`, fill: 'none', stroke: color, width: 0.45 },
    { kind: 'text', x: 0, y: 0, text: chars, size: 7, fill: color, weight: 800, font: 'title' },
  ];
}

/** 原創的怪符號：以種子組合圓、放射線、螺旋、眼形與鉤狀筆畫。 */
function sigil(rng: Rng): Primitive[] {
  const color = pick(rng, ['rgb(95 12 10 / 0.85)', 'rgb(35 30 28 / 0.85)']);
  const width = range(rng, 0.6, 1);
  const out: Primitive[] = [];
  const add = (d: string): void => {
    out.push({ kind: 'path', d, fill: 'none', stroke: color, width, cap: 'round' });
  };
  const r = range(rng, 9, 13);
  if (rng() < 0.7) add(wobbly(rng, Array.from({ length: 41 }, (_, i) => ({ x: Math.cos((i / 40) * Math.PI * 2) * r, y: Math.sin((i / 40) * Math.PI * 2) * r })), 0.2));
  const spokes = int(rng, 3, 7);
  const phase = range(rng, 0, Math.PI);
  for (let i = 0; i < spokes; i++) {
    const a = phase + (i / spokes) * Math.PI * 2;
    const inner = range(rng, 1, 4);
    const outer = r + range(rng, -1, 5);
    const hook = range(rng, -0.6, 0.6);
    add(wobbly(rng, [
      { x: Math.cos(a) * inner, y: Math.sin(a) * inner },
      { x: Math.cos(a) * outer, y: Math.sin(a) * outer },
      { x: Math.cos(a + hook) * (outer + 3), y: Math.sin(a + hook) * (outer + 3) },
    ], 0.15));
  }
  // 中央的眼形或螺旋
  if (rng() < 0.5) {
    add(`M-5 0Q0 -4 5 0Q0 4 -5 0Z`);
    out.push({ kind: 'path', d: circle(0, 0, 1.2), fill: color });
  } else {
    const pts: Point[] = [];
    for (let i = 0; i <= 40; i++) {
      const a = (i / 40) * Math.PI * 4;
      const rr = 0.3 + (i / 40) * 4.5;
      pts.push({ x: Math.cos(a) * rr, y: Math.sin(a) * rr });
    }
    add(wobbly(rng, pts, 0.08));
  }
  // 外圈小記號
  for (let i = 0; i < int(rng, 3, 6); i++) {
    const a = range(rng, 0, Math.PI * 2);
    const x = Math.cos(a) * (r + 6);
    const y = Math.sin(a) * (r + 6);
    add(`M${(x - 1.2).toFixed(2)} ${(y - 1.2).toFixed(2)}L${(x + 1.2).toFixed(2)} ${(y + 1.2).toFixed(2)}M${(x + 1.2).toFixed(2)} ${(y - 1.2).toFixed(2)}L${x.toFixed(2)} ${(y + 1.6).toFixed(2)}`);
  }
  return out;
}

/** 反覆描寫到穿紙的字：同一個字疊寫多次，中央有劃破的裂口。 */
function pressedText(rng: Rng, text: string): Primitive[] {
  const ch = Array.from(text)[0] ?? '逃';
  const out: Primitive[] = [];
  for (let i = 0; i < 7; i++) {
    out.push({ kind: 'text', x: gaussianish(rng) * 0.6, y: gaussianish(rng) * 0.6, text: ch, size: 16, fill: `rgb(25 18 15 / ${(0.35 + i * 0.07).toFixed(2)})`, weight: 900, font: 'hand' });
  }
  const tear: Point[] = [];
  for (let i = 0; i <= 8; i++) tear.push({ x: -5 + i * 1.25, y: Math.sin(i) * 0.6 + range(rng, -0.4, 0.4) });
  out.push({ kind: 'path', d: wobbly(rng, tear, 0.1), fill: 'none', stroke: 'rgb(255 253 246 / 0.95)', width: 0.9, cap: 'round' });
  out.push({ kind: 'path', d: wobbly(rng, tear.map((p) => ({ x: p.x + 0.3, y: p.y + 0.6 })), 0.1), fill: 'none', stroke: 'rgb(30 20 15 / 0.6)', width: 0.35, cap: 'round' });
  return out;
}

/** 血跡類（可選新鮮／乾涸）。 */
export const BLOOD_TYPES: readonly DecorationType[] = ['blood-splatter', 'blood-drip', 'blood-smear', 'handprint'];

export function decorationShape(type: DecorationType, seed: number, text: string, dry = true): DecorationShape {
  const rng = rngFor(seed, `deco:${type}`);
  const t = text || DEFAULT_TEXT[type] || '';
  const pal = bloodPalette(dry);
  switch (type) {
    case 'blood-splatter': {
      const texture = stainTexture(rng, 'stain', dry);
      const s = splatter(rng, pal);
      return { primitives: s.prims, gradients: s.grads, texture, radius: 22 };
    }
    case 'blood-drip': {
      const texture = stainTexture(rng, 'stain', dry);
      const s = drips(rng, pal);
      return { primitives: s.prims, gradients: s.grads, texture, radius: 24 };
    }
    case 'blood-smear': {
      const texture = stainTexture(rng, 'stain', dry);
      const s = smear(rng, pal);
      return { primitives: s.prims, gradients: s.grads, texture, radius: 24 };
    }
    case 'handprint': {
      const texture = stainTexture(rng, 'print', dry);
      const s = handprint(rng, pal, dry);
      return { primitives: s.prims, gradients: s.grads, mask: s.mask, texture, radius: 22 };
    }
    case 'coffee-ring': {
      const r = range(rng, 11, 14);
      const circ = 2 * Math.PI * r;
      return {
        primitives: [
          { kind: 'path', d: circle(0, 0, r), fill: 'rgb(150 100 45 / 0.08)' },
          { kind: 'path', d: circle(0, 0, r), fill: 'none', stroke: 'rgb(120 75 30 / 0.45)', width: 1.1, dash: `${(circ * range(rng, 0.7, 0.95)).toFixed(2)} ${circ.toFixed(2)}` },
          { kind: 'path', d: circle(range(rng, -0.5, 0.5), range(rng, -0.5, 0.5), r - 0.8), fill: 'none', stroke: 'rgb(120 75 30 / 0.2)', width: 0.4 },
        ],
        radius: 15,
      };
    }
    case 'ink-blot': {
      const ink: BloodPalette = { core: 'rgb(34 32 38 / 1)', mid: 'rgb(24 22 28 / 1)', edge: 'rgb(16 14 20 / 1)', mist: 'rgb(24 22 28 / 1)' };
      const texture = stainTexture(rng, 'stain', false);
      const s = splatter(rng, ink);
      return { primitives: s.prims.slice(0, 26), gradients: s.grads, texture, radius: 20 };
    }
    case 'fingerprint':
      return { primitives: fingerprint(rng), radius: 10 };
    case 'wax-seal':
      return { primitives: waxSeal(rng, t), radius: 13, inky: false };
    case 'red-circle':
      return { primitives: redCircle(rng), radius: 20 };
    case 'red-arrow':
      return { primitives: redArrow(rng), radius: 20 };
    case 'pencil-line':
      return { primitives: pencilLine(rng), radius: 21 };
    case 'pencil-note':
      return { primitives: pencilNote(rng, t), radius: Math.max(8, Array.from(t).length * 2.4 + 2) };
    case 'stamp':
      return { primitives: stamp(rng, t), radius: Math.max(14, Array.from(t).length * 3.5 + 4), inky: true };
    case 'claw':
      return { primitives: claw(rng), radius: 22 };
    case 'slime': {
      const s = slime(rng);
      return { primitives: s.prims, gradients: s.grads, radius: 22 };
    }
    case 'sigil':
      return { primitives: sigil(rng), radius: 24 };
    case 'pressed-text':
      return { primitives: pressedText(rng, t), radius: 11 };
  }
}

export interface PlacementOptions {
  /** 紙面大小（公釐）。 */
  readonly width: number;
  readonly height: number;
  /** 新裝飾的半徑（公釐）。 */
  readonly radius: number;
  readonly existing: readonly { readonly x: number; readonly y: number }[];
  /** 保護區（線索），裝飾要避開。 */
  readonly protect: readonly Rect[];
}

/**
 * 新裝飾的位置：從紙面中央以黃金角螺旋往外找，第一個不碰保護區、離已有裝飾夠遠、
 * 又在紙內的位置；都找不到時取碰到最少的位置。不用亂數，所以同樣的情況永遠放在同一處。
 */
export function placeDecoration(o: PlacementOptions): Point {
  const cx = o.width / 2;
  const cy = o.height / 2;
  const margin = Math.min(o.radius * 0.7, Math.min(o.width, o.height) / 4);
  let best: { p: Point; score: number } | null = null;
  for (let k = 0; k < 160; k++) {
    const a = k * 2.399963;
    const r = Math.sqrt(k) * Math.max(6, o.radius * 0.75);
    const p = { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
    if (p.x < margin || p.y < margin || p.x > o.width - margin || p.y > o.height - margin) continue;
    const box = { x: p.x - o.radius * 0.8, y: p.y - o.radius * 0.8, w: o.radius * 1.6, h: o.radius * 1.6 };
    const hits = o.protect.filter((q) => rectsOverlap(box, q)).length;
    const crowd = o.existing.filter((e) => Math.hypot(e.x - p.x, e.y - p.y) < o.radius * 1.1).length;
    const score = hits * 10 + crowd;
    if (score === 0) return p;
    if (!best || score < best.score) best = { p, score };
  }
  return best?.p ?? { x: cx, y: cy };
}
