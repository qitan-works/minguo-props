// 逐一放置的紙張效果：把一項（FxItem）變成要畫的幾何（純邏輯）。同一組輸入永遠得到同樣的結果。
//
// 輸出（全部是紙面公釐座標）：
// - cuts：從紙上挖掉的範圍（燒穿、撕掉、蟲蛀、釘孔）。碰到保護區（[保:…]）就縮小，縮到很小還碰到就取消。
// - prims：向量圖形（焦痕、水漬、摺痕、霉斑…），交給 src/render/fx-items.ts 畫成 SVG。
// - bleeds：要把字複製一份、染色模糊後只顯示在那幾塊範圍的地方（浸水暈開、抹糊）。
// - outline：選取時顯示的框（旋轉後的外接矩形）。

import { charMarks, resample, waterBleed, type CharMarks, type Rgb } from '../effects.ts';
import { polygonArea, polygonBounds, rectPolygonRelation, type Point, type Rect } from '../geometry.ts';
import { gaussianish, int, range, rngFor, type Rng } from '../random.ts';
import { fxStyle, type FxItem, type FxKind } from './catalog.ts';

export type FxPrim =
  | { readonly t: 'fill'; readonly d: string; readonly color: string; readonly evenodd?: boolean }
  | { readonly t: 'stroke'; readonly d: string; readonly color: string; readonly width: number; readonly dash?: string }
  | { readonly t: 'radial'; readonly cx: number; readonly cy: number; readonly r: number; readonly stops: readonly (readonly [number, string])[] };

export interface FxBleed {
  readonly polygons: readonly (readonly Point[])[];
  /** 把墨色換成這個顏色；null 表示保持原本的墨色（抹糊）。 */
  readonly tint: Rgb | null;
  /** 模糊（公釐）、透明度、先蓋一層紙色洗淡原本的字（0～1）、整片錯開（公釐，拖長的抹痕）。 */
  readonly blur: number;
  readonly opacity: number;
  readonly wash: number;
  readonly dx: number;
  readonly dy: number;
}

export interface FxPlan {
  readonly id: string;
  readonly z: number;
  readonly kind: FxKind;
  readonly cuts: Point[][];
  readonly prims: FxPrim[];
  /** 向量圖形要不要避開保護區（摺痕、揉皺、透明膠帶不擋字，不用避開）。 */
  readonly avoidProtect: boolean;
  /** 邊緣柔和度換算成的模糊（公釐）。 */
  readonly blur: number;
  readonly bleeds: FxBleed[];
  readonly outline: Point[];
  readonly center: Point;
  /** 挖掉的範圍碰到保護區而縮小或取消。 */
  readonly shrunk: boolean;
}

export interface FxPlanContext {
  /** 保護區（已外擴）。 */
  readonly protect: readonly Rect[];
}

const TAU = Math.PI * 2;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [Math.round(lerp(a[0], b[0], t)), Math.round(lerp(a[1], b[1], t)), Math.round(lerp(a[2], b[2], t))];
const rgba = (c: Rgb, alpha: number): string => `rgb(${c[0]} ${c[1]} ${c[2]} / ${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const f2 = (n: number): string => (Math.round(n * 100) / 100).toString();

export function closedPath(poly: readonly Point[]): string {
  return poly.length ? `M${poly.map((p) => `${f2(p.x)} ${f2(p.y)}`).join('L')}Z` : '';
}

export function openPath(line: readonly Point[]): string {
  return line.length ? `M${line.map((p) => `${f2(p.x)} ${f2(p.y)}`).join('L')}` : '';
}

/**
 * 焦痕的顏色：t 為 0 時是離洞最遠的淡黃，1 是洞邊的焦黑。tone 0 為焦黑、100 為褐（燒得比較淺）。
 * tone 為 0 時與原本紙張狀況的燒洞相同。
 */
export function charColor(i: number, count: number, tone = 0): string {
  const t = count <= 1 ? 1 : i / (count - 1);
  const k = clamp(tone, 0, 100) / 100;
  const black: Rgb[] = [[214, 176, 92], [150, 92, 36], [58, 30, 12], [12, 7, 4]];
  const brown: Rgb[] = [[214, 182, 112], [172, 116, 56], [126, 78, 36], [86, 52, 24]];
  const stops = black.map((c, j) => mix(c, brown[j] as Rgb, k));
  const x = t * (stops.length - 1);
  const j = Math.min(stops.length - 2, Math.floor(x));
  const c = mix(stops[j] as Rgb, stops[j + 1] as Rgb, x - j);
  const alpha = 0.07 + 0.55 * Math.pow(t, 1.8) + (t > 0.95 ? 0.35 : 0);
  return `rgb(${c[0]} ${c[1]} ${c[2]} / ${Math.min(0.97, alpha).toFixed(2)})`;
}

/** 有方向的面積（螢幕座標：正值為順時針）。 */
function signedArea(poly: readonly Point[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i] as Point;
    const q = poly[(i + 1) % poly.length] as Point;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/** 統一成順時針（同方向的多邊形用 nonzero 規則填色時是聯集）。 */
export function clockwise(poly: readonly Point[]): Point[] {
  return signedArea(poly) < 0 ? [...poly].reverse() : [...poly];
}

/** 往多邊形裡面縮 d 公釐（依方向算法向量，凹的地方也正確），沿線帶一點起伏。 */
function inset(poly: readonly Point[], d: number, rng: Rng, wobble = 0.4): Point[] {
  const pts = clockwise(poly);
  const n = pts.length;
  const ph = range(rng, 0, TAU);
  const f = int(rng, 2, 5);
  return pts.map((p, i) => {
    const a = pts[(i - 1 + n) % n] as Point;
    const b = pts[(i + 1) % n] as Point;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    // 順時針（y 朝下）時，切線 (tx, ty) 的內側法向量是 (-ty, tx)
    const nx = -(b.y - a.y) / len;
    const ny = (b.x - a.x) / len;
    const k = d * Math.max(0.2, 1 + wobble * Math.sin((i / n) * TAU * f + ph));
    return { x: p.x + nx * k, y: p.y + ny * k };
  });
}

/** 不規則的圓：irregular 為 0 時是正圓（或橢圓）。 */
function roundish(rng: Rng, r: number, ir: number, n = 32, cx = 0, cy = 0, sx = 1, sy = 1): Point[] {
  const ph = range(rng, 0, TAU);
  const f1 = int(rng, 2, 4);
  const f2b = int(rng, 5, 9);
  const a1 = range(rng, 0.08, 0.2);
  const a2 = range(rng, 0.03, 0.09);
  const noise = Array.from({ length: n }, () => gaussianish(rng));
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * TAU;
    const nz = ((noise[(i - 1 + n) % n] as number) + 2 * (noise[i] as number) + (noise[(i + 1) % n] as number)) / 4;
    const k = 1 + ir * (a1 * Math.sin(a * f1 + ph) + a2 * Math.sin(a * f2b + ph * 2) + 0.25 * nz);
    return { x: cx + Math.cos(a) * r * k * sx, y: cy + Math.sin(a) * r * k * sy };
  });
}

/** 淚滴形：圓頭在 (cx, cy)、尾巴朝 angle 方向（弧度）伸出 len。 */
function teardrop(cx: number, cy: number, r: number, len: number, angle: number): Point[] {
  const L = Math.max(len, r * 1.05);
  const beta = Math.acos(clamp(r / L, -1, 1));
  const out: Point[] = [{ x: cx + Math.cos(angle) * L, y: cy + Math.sin(angle) * L }];
  for (let i = 0; i <= 20; i++) {
    const t = angle + beta + ((TAU - 2 * beta) * i) / 20;
    out.push({ x: cx + Math.cos(t) * r, y: cy + Math.sin(t) * r });
  }
  return out;
}

/** 平滑的隨機起伏（每一點一個值，約 −1～1）。 */
function walk(rng: Rng, n: number, smooth = 0.8): number[] {
  const out: number[] = [];
  let v = 0;
  for (let i = 0; i < n; i++) {
    v = v * smooth + gaussianish(rng) * (1 - smooth) * 2.2;
    out.push(v);
  }
  return out;
}

/** 沿一條（開放的）線產生一條撕開的鋸齒線。 */
function jagLine(rng: Rng, from: Point, to: Point, amp: number, step = 0.7, bulge = 0): Point[] {
  const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  const n = Math.max(2, Math.round(len / step));
  const nx = -(to.y - from.y) / len;
  const ny = (to.x - from.x) / len;
  const w = walk(rng, n + 1, 0.75);
  const out: Point[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const o = amp * ((w[i] as number) + (rng() - 0.5) * 0.5) + bulge * Math.sin(t * Math.PI) * len;
    out.push({ x: from.x + (to.x - from.x) * t + nx * o, y: from.y + (to.y - from.y) * t + ny * o });
  }
  return out;
}

interface Cut {
  poly: Point[];
  /** 燒穿：焦痕的深度倍率；null 表示不畫焦痕。 */
  char: number | null;
  /** 撕開的紙纖維（白色毛邊）。 */
  fiber: boolean;
  /** 洞邊的細線顏色。 */
  rim: string | null;
}

/** 產生器的工作區：座標都是這一項自己的座標（中心為原點、未旋轉）。 */
interface Ctx {
  readonly item: FxItem;
  readonly rng: Rng;
  readonly S: number;
  readonly ir: number;
  readonly k: number;
  readonly tone: number;
  readonly count: number;
  readonly prims: FxPrim[];
  readonly cuts: Cut[];
  readonly bleeds: FxBleed[];
  readonly local: Point[];
  readonly T: (p: Point) => Point;
  readonly protect: readonly Rect[];
  readonly seedPhase: number;
}

function track(c: Ctx, pts: readonly Point[]): void {
  for (const p of pts) c.local.push(p);
}

function fill(c: Ctx, poly: readonly Point[], color: string): void {
  track(c, poly);
  c.prims.push({ t: 'fill', d: closedPath(poly.map(c.T)), color });
}

function fillMany(c: Ctx, polys: readonly (readonly Point[])[], color: string, evenodd = false): void {
  for (const p of polys) track(c, p);
  c.prims.push({ t: 'fill', d: polys.map((p) => closedPath(p.map(c.T))).join(''), color, ...(evenodd ? { evenodd: true } : {}) });
}

function stroke(c: Ctx, line: readonly Point[], color: string, width: number, closed = false, dash?: string): void {
  track(c, line);
  const pts = line.map(c.T);
  c.prims.push({ t: 'stroke', d: closed ? closedPath(pts) : openPath(pts), color, width, ...(dash ? { dash } : {}) });
}

function radial(c: Ctx, p: Point, r: number, stops: readonly (readonly [number, string])[]): void {
  track(c, [{ x: p.x - r, y: p.y - r }, { x: p.x + r, y: p.y + r }]);
  const q = c.T(p);
  c.prims.push({ t: 'radial', cx: q.x, cy: q.y, r, stops });
}

function cut(c: Ctx, poly: readonly Point[], o: { char?: number; fiber?: boolean; rim?: string } = {}): void {
  track(c, poly);
  c.cuts.push({ poly: poly.map(c.T), char: o.char ?? null, fiber: o.fiber ?? false, rim: o.rim ?? null });
}

function shift(poly: readonly Point[], dx: number, dy: number): Point[] {
  return poly.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

function rotateLocal(poly: readonly Point[], deg: number): Point[] {
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return poly.map((p) => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos }));
}

/** 自訂形狀（相對中心、外接半徑 size）加上一點不規則的起伏。 */
function customShape(c: Ctx, amp: number): Point[] | null {
  const shape = c.item.shape;
  if (!shape || shape.length < 3) return null;
  const r0 = Math.max(...shape.map((p) => Math.hypot(p.x, p.y))) || 1;
  const scaled = shape.map((p) => ({ x: (p.x / r0) * c.S, y: (p.y / r0) * c.S }));
  if (amp <= 0) return scaled;
  const pts = resample(scaled, 0.8);
  const w = walk(c.rng, pts.length, 0.7);
  const n = pts.length;
  return pts.map((p, i) => {
    const a = pts[(i - 1 + n) % n] as Point;
    const b = pts[(i + 1) % n] as Point;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const o = amp * (w[i] as number);
    return { x: p.x - ((b.y - a.y) / len) * o, y: p.y + ((b.x - a.x) / len) * o };
  });
}

// ---- 燒 ----

function burn(c: Ctx): void {
  const { S, ir, k, rng } = c;
  const style = c.item.style;
  const custom = customShape(c, ir * 0.6);
  if (style === 'scorch') {
    const base = custom ?? roundish(rng, S, ir, 36);
    const layers = 10;
    for (let i = 0; i < layers; i++) {
      const s = 1 - (i / layers) * 0.85;
      const poly = base.map((p, j) => {
        const wob = 1 + ir * 0.06 * Math.sin(j * 0.7 + i * 1.3);
        return { x: p.x * s * wob, y: p.y * s * wob };
      });
      fill(c, poly, charColor(Math.min(9, Math.round(1 + (i / (layers - 1)) * (3 + 6 * k))), 10, c.tone * 100));
    }
    return;
  }
  const charScale = (0.3 + 1.1 * k) * clamp(S / 6, 0.5, 2.2);
  if (custom && style !== 'cigarette' && style !== 'row') {
    cut(c, custom, { char: charScale });
    return;
  }
  if (style === 'hole') {
    cut(c, roundish(rng, S, ir, 28), { char: charScale });
  } else if (style === 'cigarette') {
    const tone = c.tone * 100;
    fill(c, roundish(rng, S * 2.2, ir * 0.6, 32), charColor(2, 10, tone));
    for (let i = 0; i < 6; i++) fill(c, roundish(rng, S * (1.7 - i * 0.17), ir, 30), charColor(Math.min(9, 4 + i), 10, tone));
    fill(c, roundish(rng, S * 0.6, ir, 20), 'rgb(118 110 98 / 0.55)');
    if (k >= 0.55) cut(c, roundish(rng, S * (0.22 + 0.4 * ((k - 0.55) / 0.45)), ir, 18), { rim: 'rgb(10 6 3 / 0.95)' });
  } else if (style === 'flame') {
    // 貼邊：紙邊在 y = 0、紙面在 +y。往紙裡燒出幾道火舌形的缺口。
    const W = S / 2;
    const d0 = S * (0.14 + 0.32 * k);
    const tongues = Array.from({ length: 2 + Math.round(ir * 4) + int(rng, 0, 1) }, () => ({
      x: range(rng, -W * 0.8, W * 0.8),
      w: W * range(rng, 0.1, 0.28) * (1 + ir * 0.3),
      h: d0 * range(rng, 0.35, 1.1),
    }));
    const line: Point[] = [];
    const n = Math.max(12, Math.round(S / 0.8));
    const w = walk(rng, n + 1, 0.7);
    for (let i = 0; i <= n; i++) {
      const x = W - (2 * W * i) / n;
      const env = Math.sqrt(Math.max(0, 1 - (x / W) ** 2));
      let y = d0 * 0.55 * env;
      for (const t of tongues) y += t.h * Math.exp(-(((x - t.x) / t.w) ** 2)) * Math.sqrt(env);
      line.push({ x, y: Math.max(-1, y + (w[i] as number) * (0.2 + ir * 0.8) * env) });
    }
    cut(c, [{ x: W + 2, y: -8 }, { x: W + 2, y: -1 }, ...line, { x: -W - 2, y: -1 }, { x: -W - 2, y: -8 }], { char: (0.5 + 1.0 * k) * clamp(S / 30, 0.6, 1.6) });
  } else {
    // 一排燒穿
    const n = Math.max(1, c.count);
    const gap = S * 2.6;
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * gap + range(rng, -0.3, 0.3) * S * ir;
      const y = gaussianish(rng) * S * 0.6 * ir;
      cut(c, roundish(rng, S * range(rng, 0.75, 1.2), ir, 18, x, y), { char: (0.25 + 0.8 * k) * clamp(S / 4, 0.5, 1.8) });
    }
  }
}

// ---- 水 ----

const WATER_YELLOW: Rgb = [168, 128, 62];
const WATER_GRAY: Rgb = [118, 122, 128];

/** 水漬：洗淡、染色、乾掉後留下的潮線，以及字的暈開。 */
function waterArea(c: Ctx, polys: readonly (readonly Point[])[], o: { tides?: number; bleed?: boolean } = {}): void {
  const k = c.k;
  const strength = c.item.strength;
  const look = waterBleed(strength, c.tone < 0.5 ? 'brown' : 'blue');
  const stain = mix(WATER_YELLOW, WATER_GRAY, c.tone);
  const edge = mix([135, 96, 48], [88, 92, 98], c.tone);
  if (o.bleed !== false && strength > 0) fillMany(c, polys, `rgb(250 244 228 / ${(look.wash * 0.85).toFixed(2)})`);
  fillMany(c, polys, rgba(stain, 0.05 + 0.13 * k));
  for (const p of polys) {
    stroke(c, p, rgba(edge, 0.16 + 0.22 * k), 1.2, true);
    stroke(c, p, rgba(edge, 0.32 + 0.3 * k), 0.28, true);
  }
  const tides = o.tides ?? 0;
  for (const p of polys) {
    for (let i = 0; i < tides; i++) stroke(c, inset(p, [1.4, 3.4, 6.2][i] ?? 6, c.rng), rgba(edge, 0.24 - i * 0.05 + 0.12 * k), 0.28 - i * 0.05, true);
  }
  if (o.bleed !== false && strength > 0) {
    const abs = polys.map((p) => p.map(c.T));
    for (const l of look.layers) c.bleeds.push({ polygons: abs, tint: l.color, blur: l.blur, opacity: l.opacity, wash: 0, dx: 0, dy: 0 });
  }
}

function water(c: Ctx): void {
  const { S, ir, k, rng } = c;
  const style = c.item.style;
  const custom = customShape(c, ir * 0.5);
  if (custom) {
    waterArea(c, [custom], { tides: S > 8 ? 3 : 1 });
    if (style === 'soak') soaked(c, custom);
    return;
  }
  if (style === 'round') {
    waterArea(c, [roundish(rng, S, ir, 44)], { tides: S > 6 ? 2 : 0 });
  } else if (style === 'splash') {
    const main = roundish(rng, S * 0.55, Math.min(1, ir + 0.25), 40);
    const drops: Point[][] = [];
    for (let i = 0; i < c.count; i++) {
      const a = range(rng, 0, TAU);
      const dist = S * range(rng, 0.6, 1.5);
      const r = S * range(rng, 0.035, 0.13);
      drops.push(teardrop(Math.cos(a) * dist, Math.sin(a) * dist, r, r * range(rng, 1.4, 3.2), a + Math.PI));
    }
    waterArea(c, [main, ...drops], { tides: 1 });
  } else if (style === 'tear') {
    const drops: Point[][] = [];
    for (let i = 0; i < c.count; i++) {
      const r = S * range(rng, 0.7, 1.25);
      const x = range(rng, -S * 4, S * 4);
      const y = range(rng, -S * 5, S * 5);
      drops.push(teardrop(x, y, r, r * range(rng, 2.2, 4.2), -Math.PI / 2 + range(rng, -0.2, 0.2)));
      // 淚水滑落留下的細痕
      stroke(c, [{ x, y: y - r * 4 }, { x: x + range(rng, -0.4, 0.4), y: y - r * range(rng, 7, 12) }], rgba(mix(WATER_YELLOW, WATER_GRAY, c.tone), 0.12 + 0.12 * k), r * 0.5);
    }
    waterArea(c, drops, { tides: 0 });
  } else if (style === 'rain') {
    const drops: Point[][] = [];
    for (let i = 0; i < c.count; i++) {
      const a = range(rng, 0, TAU);
      const dist = Math.sqrt(rng()) * S * 7;
      drops.push(roundish(rng, S * range(rng, 0.35, 1), ir * 0.6, 16, Math.cos(a) * dist, Math.sin(a) * dist));
    }
    waterArea(c, drops, { tides: 0 });
  } else if (style === 'cup') {
    const edge = mix([128, 84, 32], [92, 94, 98], c.tone);
    const ring = roundish(rng, S, ir * 0.3, 90);
    const per = ring.reduce((sum, p, i) => sum + Math.hypot(p.x - (ring[(i + 1) % ring.length] as Point).x, p.y - (ring[(i + 1) % ring.length] as Point).y), 0);
    const start = int(rng, 0, ring.length - 1);
    const rot = [...ring.slice(start), ...ring.slice(0, start)];
    const arc = 0.55 + 0.42 * k;
    fill(c, ring, rgba(mix(WATER_YELLOW, WATER_GRAY, c.tone), 0.035 + 0.04 * k));
    stroke(c, rot, rgba(edge, 0.18 + 0.25 * k), Math.max(0.6, S * 0.07), true, `${f2(per * arc)} ${f2(per)}`);
    stroke(c, rot, rgba(edge, 0.25 + 0.3 * k), 0.25, true, `${f2(per * arc)} ${f2(per)}`);
    if (rng() < 0.7) {
      const second = shift(roundish(rng, S * range(rng, 0.96, 1.03), ir * 0.3, 90), range(rng, -2, 2), range(rng, -2, 2));
      stroke(c, second, rgba(edge, 0.1 + 0.16 * k), Math.max(0.4, S * 0.04), true, `${f2(per * arc * 0.6)} ${f2(per)}`);
    }
  } else {
    const region = roundish(rng, S, Math.min(1, ir * 0.9 + 0.1), 72);
    waterArea(c, [region], { tides: 3 });
    soaked(c, region);
  }
}

/** 整片浸潤：起皺的紋路，以及泡得最久、字幾乎看不出來的幾塊。 */
function soaked(c: Ctx, region: readonly Point[]): void {
  const { rng, k } = c;
  const box = polygonBounds(region);
  const absRegion = region.map(c.T);
  let made = 0;
  for (let tries = 0; tries < 200 && made < 8 + Math.round(c.item.strength / 8); tries++) {
    const start = { x: range(rng, box.x, box.x + box.w), y: range(rng, box.y, box.y + box.h) };
    if (!inPoly(start, region)) continue;
    const a = range(rng, 0, TAU);
    const len = range(rng, 6, 22);
    const line: Point[] = [];
    for (let i = 0; i <= 10; i++) {
      const d = (len * i) / 10;
      line.push({ x: start.x + Math.cos(a) * d - Math.sin(a) * Math.sin(i * 0.9) * 0.6, y: start.y + Math.sin(a) * d + Math.cos(a) * Math.sin(i * 0.9) * 0.6 });
    }
    if (hitsProtect(line.map(c.T), c.protect)) continue;
    stroke(c, line, `rgb(255 252 244 / ${(0.35 + 0.3 * k).toFixed(2)})`, 0.35);
    stroke(c, shift(line, 0.25, 0.3), `rgb(110 85 50 / ${(0.18 + 0.2 * k).toFixed(2)})`, 0.18);
    made++;
  }
  if (c.item.strength < 30) return;
  const look = waterBleed(c.item.strength, c.tone < 0.5 ? 'brown' : 'blue');
  if (!look.soaked) return;
  const blobs: Point[][] = [];
  const want = int(rng, 2, 4);
  for (let tries = 0; tries < 120 && blobs.length < want; tries++) {
    const p = { x: range(rng, box.x + box.w * 0.15, box.x + box.w * 0.85), y: range(rng, box.y + box.h * 0.15, box.y + box.h * 0.85) };
    const blob = roundish(rng, range(rng, 6, 16) * clamp(c.S / 45, 0.4, 1.4), 0.6, 24, p.x, p.y);
    const abs = blob.map(c.T);
    if (!abs.every((q) => inPoly(q, absRegion))) continue;
    if (hitsProtect(abs, c.protect)) continue;
    const b = polygonBounds(blob);
    if (blobs.some((o) => overlap(polygonBounds(o), b))) continue;
    blobs.push(blob);
    stroke(c, blob, `rgb(125 88 42 / ${(0.12 + 0.16 * k).toFixed(2)})`, 0.22, true);
  }
  if (blobs.length) c.bleeds.push({ polygons: blobs.map((b) => b.map(c.T)), tint: look.soaked.color, blur: look.soaked.blur, opacity: look.soaked.opacity, wash: look.soaked.wash, dx: 0, dy: 0 });
}

// ---- 撕 ----

function fiberColor(c: Ctx): string {
  return rgba(mix([253, 251, 244], [232, 218, 184], c.tone), 0.95);
}

function tear(c: Ctx): void {
  const { S, ir, k, rng } = c;
  const style = c.item.style;
  const custom = customShape(c, 0.3 + ir * 1.1);
  if (custom) {
    cut(c, custom, { fiber: true });
    return;
  }
  if (style === 'straight' || style === 'zigzag') {
    // 貼邊：中間平直、兩端轉回紙邊，撕掉 y < depth 的部分
    const L = S / 2;
    const depth = 2 + k * 38;
    const n = Math.max(12, Math.round(S / 0.7));
    const w = walk(rng, n + 1, 0.75);
    const period = 3 + ir * 4;
    const amp = style === 'zigzag' ? 1 + ir * 2.4 : 0.3 + ir * 1.2;
    const line: Point[] = [];
    for (let i = 0; i <= n; i++) {
      const x = L - (2 * L * i) / n;
      const u = Math.abs(x) / L;
      const profile = Math.pow(Math.max(0, 1 - Math.pow(u, 8)), 0.5);
      const teeth = style === 'zigzag' ? amp * (2 * Math.abs(((x / period) % 1 + 1) % 1 - 0.5) - 0.5) : 0;
      line.push({ x, y: depth * profile - 1.5 * (1 - profile) + teeth * profile + (w[i] as number) * (style === 'zigzag' ? 0.25 : amp) * profile });
    }
    cut(c, [{ x: L + 1, y: -8 }, ...line, { x: -L - 1, y: -8 }], { fiber: true });
  } else if (style === 'corner') {
    // 貼角：紙角在原點、紙面在 +x、+y
    const a = S * range(rng, 0.8, 1.25);
    const b = S * range(rng, 0.8, 1.25);
    const line = jagLine(rng, { x: a, y: -1.5 }, { x: -1.5, y: b }, 0.3 + ir * 1.4, 0.7, range(rng, -0.08, 0.16) * (0.5 + ir));
    cut(c, [{ x: -8, y: -8 }, { x: a + 0.5, y: -8 }, ...line, { x: -8, y: b + 0.5 }], { fiber: true });
  } else {
    // 咬痕：貼邊的幾口半圓形缺口，邊上有細碎的齒痕
    const n = Math.max(1, c.count);
    let x = -((n - 1) * S * 1.3) / 2;
    for (let i = 0; i < n; i++) {
      const r = S * range(rng, 0.75, 1.2);
      const cy = -r * range(rng, 0.15, 0.4);
      const pts: Point[] = [];
      for (let s = 0; s < 40; s++) {
        const ang = (s / 40) * TAU;
        const teeth = 1 + (s % 2 === 0 ? 0.06 : -0.05) * (0.5 + ir) + range(rng, -0.04, 0.04) * ir;
        pts.push({ x: x + Math.cos(ang) * r * teeth, y: cy + Math.sin(ang) * r * teeth });
      }
      cut(c, pts, { fiber: true, rim: rgba(mix([110, 80, 45], [80, 55, 30], c.tone), 0.4) });
      x += S * range(rng, 1.1, 1.5);
    }
  }
}

// ---- 摺痕、揉皺 ----

function creaseLine(c: Ctx, line: readonly Point[], strength: number, normal: Point): void {
  const dark = mix([105, 80, 45], [62, 46, 30], c.tone);
  const off = (d: number): Point[] => line.map((p) => ({ x: p.x + normal.x * d, y: p.y + normal.y * d }));
  stroke(c, off(0.7), rgba(dark, 0.03 + 0.07 * strength), 2.6);
  stroke(c, off(0.15), rgba(dark, 0.14 + 0.32 * strength), 0.36);
  stroke(c, off(-0.22), `rgb(255 255 250 / ${(0.4 + 0.3 * strength).toFixed(2)})`, 0.4);
}

function straightCrease(c: Ctx, L: number, angleDeg: number): Point[] {
  const a = (angleDeg * Math.PI) / 180;
  const n = Math.max(4, Math.round(L / 4));
  const w = walk(c.rng, n + 1, 0.85);
  const line = Array.from({ length: n + 1 }, (_, i) => {
    const t = -L / 2 + (L * i) / n;
    const o = (w[i] as number) * c.ir * 0.8;
    return { x: Math.cos(a) * t - Math.sin(a) * o, y: Math.sin(a) * t + Math.cos(a) * o };
  });
  creaseLine(c, line, c.k, { x: -Math.sin(a), y: Math.cos(a) });
  return line;
}

function fold(c: Ctx): void {
  const { S, k, rng } = c;
  const style = c.item.style;
  if (style === 'line') straightCrease(c, S, 0);
  else if (style === 'cross') {
    straightCrease(c, S, 0);
    straightCrease(c, S, 90);
    radial(c, { x: 0, y: 0 }, 7, [[0, `rgb(255 253 245 / ${(0.35 + 0.3 * k).toFixed(2)})`], [1, 'rgb(255 253 245 / 0)']]);
    radial(c, { x: 0.4, y: 0.4 }, 3, [[0, rgba(mix([120, 95, 60], [70, 55, 35], c.tone), 0.08 + 0.1 * k)], [1, 'rgb(120 95 60 / 0)']]);
  } else if (style === 'dogear') {
    // 貼角：摺過又攤開的角，斜的一道摺痕，角上比較髒
    const a = S * range(rng, 0.85, 1.15);
    const b = S * range(rng, 0.85, 1.15);
    fill(c, [{ x: -1, y: -1 }, { x: a, y: -1 }, { x: -1, y: b }], rgba(mix([160, 128, 76], [100, 80, 50], c.tone), 0.05 + 0.12 * k));
    const len = Math.hypot(a, b);
    const line = Array.from({ length: 9 }, (_, i) => ({ x: a - (a * i) / 8 + gaussianish(rng) * c.ir * 0.3, y: (b * i) / 8 + gaussianish(rng) * c.ir * 0.3 }));
    creaseLine(c, line, k, { x: b / len, y: a / len });
  } else {
    const line = straightCrease(c, S, 0);
    const dark = mix([100, 76, 44], [55, 40, 26], c.tone);
    stroke(c, line, rgba(dark, 0.06 + 0.1 * k), 1.6);
    // 摺線磨破的地方：幾道細長的裂縫
    const half = S / 2;
    for (let i = 0; i < c.count; i++) {
      const x = range(rng, -Math.min(half, 120), Math.min(half, 120));
      const len = range(rng, 1.5, 4.5) * (0.6 + k);
      const wdt = range(rng, 0.2, 0.45) * (0.6 + k);
      const slit = Array.from({ length: 12 }, (_, j) => {
        const t = (j / 12) * TAU;
        return { x: x + Math.cos(t) * len, y: Math.sin(t) * wdt + 0.05 };
      });
      cut(c, slit, { rim: rgba(dark, 0.6), fiber: true });
    }
  }
}

function crumple(c: Ctx): void {
  const { S, k, rng } = c;
  const style = c.item.style;
  const n = Math.max(1, c.count);
  const draw = (line: Point[]): void => {
    let ang = Math.atan2((line[1] as Point).y - (line[0] as Point).y, (line[1] as Point).x - (line[0] as Point).x);
    if (!Number.isFinite(ang)) ang = 0;
    creaseLine(c, line, k * 0.8, { x: -Math.sin(ang), y: Math.cos(ang) });
  };
  const polyline = (start: Point, angle: number, len: number, segs: number, turn: number): Point[] => {
    const pts: Point[] = [start];
    let { x, y } = start;
    let a = angle;
    for (let i = 0; i < segs; i++) {
      a += range(rng, -turn, turn);
      x += Math.cos(a) * (len / segs);
      y += Math.sin(a) * (len / segs);
      pts.push({ x, y });
    }
    return pts;
  };
  if (style === 'radial') {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + range(rng, -0.3, 0.3);
      const ray = polyline({ x: Math.cos(a) * 1.5, y: Math.sin(a) * 1.5 }, a, S * range(rng, 0.5, 1), int(rng, 3, 5), 0.25);
      draw(ray);
      if (rng() < 0.5) {
        const from = ray[int(rng, 1, ray.length - 2)] as Point;
        draw(polyline(from, a + range(rng, -0.9, 0.9), S * range(rng, 0.2, 0.45), 3, 0.3));
      }
    }
    radial(c, { x: 0, y: 0 }, S * 0.25, [[0, rgba(mix([110, 85, 50], [60, 45, 30], c.tone), 0.05 + 0.06 * k)], [1, 'rgb(110 85 50 / 0)']]);
  } else if (style === 'wrinkle') {
    for (let i = 0; i < n; i++) {
      const a = Math.sqrt(rng()) * S;
      const t = range(rng, 0, TAU);
      const start = { x: Math.cos(t) * a, y: Math.sin(t) * a };
      const dir = range(rng, 0, TAU);
      const len = S * range(rng, 0.3, 0.8);
      const line = Array.from({ length: 11 }, (_, j) => {
        const d = (len * j) / 10;
        return { x: start.x + Math.cos(dir) * d - Math.sin(dir) * Math.sin(j * 0.9) * 0.5, y: start.y + Math.sin(dir) * d + Math.cos(dir) * Math.sin(j * 0.9) * 0.5 };
      });
      stroke(c, line, `rgb(255 252 244 / ${(0.35 + 0.35 * k).toFixed(2)})`, 0.35);
      stroke(c, shift(line, 0.25, 0.3), rgba(mix([110, 85, 50], [60, 45, 30], c.tone), 0.15 + 0.25 * k), 0.2);
    }
  } else {
    const lines: Point[][] = [];
    for (let i = 0; i < n; i++) {
      const a = Math.sqrt(rng()) * S * 0.8;
      const t = range(rng, 0, TAU);
      const line = polyline({ x: Math.cos(t) * a, y: Math.sin(t) * a }, range(rng, 0, Math.PI), S * range(rng, 0.4, 1.2), int(rng, 3, 6), 0.35);
      lines.push(line);
      draw(line);
    }
    if (style === 'heavy') {
      // 揉爛後攤平：一塊塊微微的明暗面
      const pts = lines.flatMap((l) => [l[0] as Point, l[l.length - 1] as Point]);
      for (let i = 0; i + 2 < pts.length; i += 2) {
        const tri = [pts[i] as Point, pts[i + 1] as Point, pts[(i + 3) % pts.length] as Point];
        fill(c, tri, rng() < 0.5 ? `rgb(90 65 35 / ${(0.025 + 0.035 * k).toFixed(3)})` : `rgb(255 253 245 / ${(0.05 + 0.06 * k).toFixed(3)})`);
      }
    }
  }
}

// ---- 斑點、霉斑 ----

function scatterIn(rng: Rng, R: number): Point {
  const a = range(rng, 0, TAU);
  const d = Math.sqrt(rng()) * R;
  return { x: Math.cos(a) * d, y: Math.sin(a) * d };
}

function spots(c: Ctx): void {
  const { S, ir, k, rng } = c;
  const style = c.item.style;
  const fox0 = mix([120, 70, 20], [80, 44, 16], c.tone);
  const fox1 = mix([150, 95, 35], [100, 60, 25], c.tone);
  if (style === 'fox') {
    for (let i = 0; i < c.count; i++) {
      const p = scatterIn(rng, S);
      const r = range(rng, 0.3, 2.2) * (rng() < 0.15 ? 2 : 1);
      radial(c, p, r, [[0, rgba(fox0, 0.3 + 0.45 * k)], [0.6, rgba(fox1, 0.12 + 0.2 * k)], [1, rgba(fox1, 0)]]);
    }
  } else if (style === 'speck') {
    const dark = mix([90, 65, 40], [25, 22, 20], c.tone);
    const polys: Point[][] = [];
    for (let i = 0; i < c.count; i++) {
      const p = scatterIn(rng, S);
      polys.push(roundish(rng, range(rng, 0.07, 0.3), ir, 8, p.x, p.y));
    }
    fillMany(c, polys, rgba(dark, 0.35 + 0.5 * k));
  } else if (style === 'splash') {
    const tea = mix([155, 105, 45], [95, 60, 25], c.tone);
    const polys: Point[][] = [];
    for (let i = 0; i < c.count; i++) {
      const x = range(rng, -S, S);
      const y = gaussianish(rng) * S * 0.35;
      const r = range(rng, 0.2, 0.9) * (1 - Math.abs(x) / (S * 1.6));
      polys.push(rng() < 0.4 ? teardrop(x, y, r, r * range(rng, 1.6, 3), x > 0 ? Math.PI : 0) : roundish(rng, r, ir, 12, x, y));
    }
    fillMany(c, polys, rgba(tea, 0.25 + 0.35 * k));
    for (const p of polys) stroke(c, p, rgba(tea, 0.3 + 0.3 * k), 0.12, true);
  } else {
    for (let i = 0; i < c.count; i++) {
      const p = scatterIn(rng, S * 0.6);
      const r = S * range(rng, 0.35, 0.8);
      const blob = roundish(rng, r, Math.min(1, ir + 0.2), 28, p.x, p.y);
      fill(c, blob, rgba(fox1, 0.08 + 0.12 * k));
      fill(c, inset(blob, r * 0.3, rng, 0.3), rgba(fox0, 0.06 + 0.1 * k));
    }
  }
}

function mold(c: Ctx): void {
  const { S, ir, k, rng } = c;
  const style = c.item.style;
  const dot = mix([62, 100, 72], [28, 28, 26], c.tone);
  const halo = mix([95, 118, 82], [60, 60, 55], c.tone);
  const dots = (center: Point, r: number, n: number, ring = false): void => {
    const polys: Point[][] = [];
    for (let i = 0; i < n; i++) {
      const a = range(rng, 0, TAU);
      const d = ring ? r * range(rng, 0.72, 1.02) : Math.abs(gaussianish(rng)) * r;
      polys.push(roundish(rng, range(rng, 0.12, 0.6), ir, 8, center.x + Math.cos(a) * d, center.y + Math.sin(a) * d));
    }
    fillMany(c, polys, rgba(dot, 0.3 + 0.35 * k));
  };
  if (style === 'colony') {
    for (let i = 0; i < c.count; i++) {
      const p = scatterIn(rng, S * 0.7);
      const r = S * range(rng, 0.25, 0.6);
      fill(c, roundish(rng, r, Math.min(1, ir + 0.2), 28, p.x, p.y), rgba(halo, 0.06 + 0.1 * k));
      dots(p, r, Math.round(r * 4));
    }
  } else if (style === 'speckle') {
    const polys: Point[][] = [];
    for (let i = 0; i < c.count; i++) {
      const p = { x: gaussianish(rng) * S, y: gaussianish(rng) * S };
      polys.push(roundish(rng, range(rng, 0.05, 0.22), ir, 6, p.x, p.y));
    }
    fillMany(c, polys, rgba(dot, 0.35 + 0.45 * k));
  } else if (style === 'ring') {
    const ring = roundish(rng, S, ir * 0.5, 48);
    stroke(c, ring, rgba(halo, 0.06 + 0.1 * k), S * 0.3, true);
    fill(c, roundish(rng, S * 0.7, ir * 0.5, 32), rgba(halo, 0.03 + 0.04 * k));
    dots({ x: 0, y: 0 }, S, Math.round(S * 9), true);
  } else {
    const white = mix([242, 242, 232], [200, 200, 192], c.tone);
    for (let i = 0; i < c.count; i++) {
      const p = scatterIn(rng, S * 0.7);
      fill(c, roundish(rng, S * range(rng, 0.3, 0.6), Math.min(1, ir + 0.3), 24, p.x, p.y), rgba(white, 0.35 + 0.35 * k));
    }
    dots({ x: 0, y: 0 }, S * 0.6, Math.round(S * 3));
  }
}

// ---- 蟲蛀、釘孔 ----

function worm(c: Ctx): void {
  const { S, ir, k, rng } = c;
  const style = c.item.style;
  const brown = mix([140, 104, 60], [88, 60, 30], c.tone);
  const rim = rgba(brown, 0.5);
  if (style === 'scatter' || style === 'cluster') {
    for (let i = 0; i < c.count; i++) {
      const p = style === 'cluster' ? { x: gaussianish(rng) * S, y: gaussianish(rng) * S } : scatterIn(rng, S);
      const r = style === 'cluster' ? range(rng, 0.4, 1.4) : range(rng, 0.35, 1.1);
      cut(c, roundish(rng, r, 0.3 + ir * 0.7, 10, p.x, p.y), { rim });
    }
  } else if (style === 'tunnel') {
    // 蛀道：彎彎曲曲的一條，有的段落穿透、有的只蛀掉表層
    const n = Math.max(6, Math.round(S));
    const pts: Point[] = [];
    let a = range(rng, 0, TAU);
    let p = { x: -Math.cos(a) * S * 0.4, y: -Math.sin(a) * S * 0.4 };
    for (let i = 0; i <= n; i++) {
      pts.push(p);
      a += gaussianish(rng) * (0.25 + ir * 0.6);
      p = { x: p.x + Math.cos(a), y: p.y + Math.sin(a) };
    }
    let i = 0;
    while (i < pts.length - 1) {
      const len = int(rng, 3, 8);
      const seg = pts.slice(i, Math.min(pts.length, i + len + 1));
      i += len;
      if (seg.length < 2) break;
      const wdt = range(rng, 0.35, 0.75);
      const left: Point[] = [];
      const right: Point[] = [];
      seg.forEach((q, j) => {
        const b = seg[Math.min(seg.length - 1, j + 1)] as Point;
        const a0 = seg[Math.max(0, j - 1)] as Point;
        const l = Math.hypot(b.x - a0.x, b.y - a0.y) || 1;
        const nx = -(b.y - a0.y) / l;
        const ny = (b.x - a0.x) / l;
        const ww = wdt * (0.8 + 0.4 * rng());
        left.push({ x: q.x + nx * ww, y: q.y + ny * ww });
        right.push({ x: q.x - nx * ww, y: q.y - ny * ww });
      });
      const channel = [...left, ...right.reverse()];
      if (rng() < 0.2 + 0.65 * k) cut(c, channel, { rim });
      else {
        fill(c, channel, rgba(brown, 0.35 + 0.25 * k));
        stroke(c, channel, rgba(brown, 0.45), 0.12, true);
      }
    }
  } else {
    // 書邊蛀蝕（貼邊）
    for (let i = 0; i < c.count; i++) {
      const x = range(rng, -S / 2, S / 2);
      cut(c, roundish(rng, range(rng, 0.8, 2.4), 0.4 + ir * 0.6, 12, x, range(rng, -0.8, 1.2)), { rim });
    }
  }
}

function pin(c: Ctx): void {
  const { S, ir, k, rng } = c;
  const style = c.item.style;
  const dirt = mix([120, 110, 95], [150, 74, 24], c.tone);
  const hole = (x: number, y: number, r: number): void => {
    cut(c, roundish(rng, r, 0.3 + ir * 0.5, 10, x, y), { rim: rgba(dirt, 0.55) });
    if (c.tone > 0.15) radial(c, { x, y }, r * 3.2, [[0, rgba(dirt, 0.15 + 0.4 * c.tone)], [1, rgba(dirt, 0)]]);
  };
  if (style === 'tack') {
    stroke(c, roundish(rng, 4.6 * S, 0.1, 40), 'rgb(120 100 70 / 0.12)', 0.3, true);
    fill(c, roundish(rng, 4.6 * S, 0.1, 40), 'rgb(120 100 70 / 0.03)');
    hole(0, 0, 0.45 * S);
  } else if (style === 'staple') {
    stroke(c, [{ x: -S / 2, y: 0 }, { x: S / 2, y: 0 }], rgba(mix([110, 100, 90], [140, 70, 25], c.tone), 0.15 + 0.15 * k), 0.55);
    hole(-S / 2, 0, 0.28);
    hole(S / 2, 0, 0.28);
  } else if (style === 'torn') {
    const r = 0.5 * S;
    const len = 1.5 + k * 5;
    cut(c, [...roundish(rng, r, 0.3, 12), { x: r * 0.3, y: -r }, { x: range(rng, -0.4, 0.4), y: -r - len }, { x: -r * 0.3, y: -r }], { fiber: true, rim: rgba(dirt, 0.4) });
  } else {
    radial(c, { x: 0, y: 0 }, 2.6 * S, [[0, rgba(dirt, 0.6)], [0.5, rgba(dirt, 0.25)], [1, rgba(dirt, 0)]]);
    hole(0, 0, 0.45 * S);
  }
}

// ---- 鏽、膠帶、蠟、抹糊 ----

function rust(c: Ctx): void {
  const { S, ir, rng } = c;
  const style = c.item.style;
  const col = mix([150, 78, 28], [70, 40, 20], c.tone);
  const grain = (line: readonly Point[], n: number): void => {
    const polys: Point[][] = [];
    for (let i = 0; i < n; i++) {
      const p = line[int(rng, 0, line.length - 1)] as Point;
      polys.push(roundish(rng, range(rng, 0.1, 0.35), 0.5, 7, p.x + gaussianish(rng) * 0.8, p.y + gaussianish(rng) * 0.8));
    }
    fillMany(c, polys, rgba(col, 0.35));
  };
  if (style === 'clip') {
    const sc = S / 27;
    const w = 9 * sc;
    const r = w / 2;
    const x0 = -w / 2;
    const y0 = -S / 2;
    const pts: Point[] = [];
    const arc = (cx: number, cy: number, rr: number, a0: number, a1: number): void => {
      for (let i = 0; i <= 10; i++) {
        const a = a0 + ((a1 - a0) * i) / 10;
        pts.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr });
      }
    };
    pts.push({ x: x0 + r, y: y0 + S - r });
    arc(x0 + r * 1.5, y0 + r, r * 0.5 + r * 0.5, Math.PI, TAU);
    pts.push({ x: x0 + w, y: y0 + S - r * 0.6 });
    arc(x0 + w - r * 0.7, y0 + S - r * 0.6, r * 0.7, 0, Math.PI);
    pts.push({ x: x0 + w - r * 1.4, y: y0 + r * 1.6 });
    stroke(c, pts, rgba(col, 0.28), 2.2 * sc);
    stroke(c, pts, rgba(col, 0.55), 0.7 * sc);
    grain(pts, Math.round(S * 0.8));
  } else if (style === 'staple') {
    const pts = [{ x: -S / 2, y: 2.5 }, { x: -S / 2, y: 0 }, { x: S / 2, y: 0 }, { x: S / 2, y: 2.5 }];
    stroke(c, pts, rgba(col, 0.22), 2);
    stroke(c, pts, rgba(col, 0.55), 0.8);
    grain(pts, Math.round(S * 0.8));
  } else if (style === 'spot') {
    for (let i = 0; i < c.count; i++) {
      const p = scatterIn(rng, S * 0.9);
      const r = S * range(rng, 0.35, 0.85);
      fill(c, roundish(rng, r, Math.min(1, ir + 0.3), 22, p.x, p.y), rgba(col, 0.12 + 0.12 * c.k));
      radial(c, p, r * 0.8, [[0, rgba(col, 0.4)], [1, rgba(col, 0)]]);
      grain([p], Math.round(r * 3));
    }
  } else {
    const ring = roundish(rng, S, ir * 0.3, 90);
    const per = TAU * S;
    stroke(c, ring, rgba(col, 0.32), 1.2, true, `${f2(per * range(rng, 0.6, 0.95))} ${f2(per)}`);
    stroke(c, roundish(rng, S * 0.94, ir * 0.3, 90), rgba(col, 0.12), 0.5, true);
    grain(ring, Math.round(S * 3));
  }
}

function tapeRect(c: Ctx, L: number, angle = 0): Point[] {
  const W = 5.6;
  const amp = 0.3 + c.ir * 0.9;
  const end = (x: number, from: number, to: number): Point[] =>
    Array.from({ length: 9 }, (_, i) => ({ x: x + (i % 2 === 0 ? amp : -amp) * (x > 0 ? 1 : -1) * c.rng(), y: from + ((to - from) * i) / 8 }));
  return rotateLocal([...end(L / 2, -W, W), ...end(-L / 2, W, -W)], angle);
}

function tape(c: Ctx): void {
  const { S, k, rng } = c;
  const style = c.item.style;
  const col = mix([228, 205, 120], [196, 136, 48], c.tone);
  const clear = (angle: number): void => {
    const rect = tapeRect(c, S, angle);
    fill(c, rect, rgba(col, 0.22 + 0.3 * k));
    stroke(c, rect, rgba(mix(col, [120, 90, 30], 0.5), 0.3 + 0.2 * k), 0.25, true);
    stroke(c, rotateLocal([{ x: -S / 2 + 1, y: -5.2 }, { x: S / 2 - 1, y: -5.2 }], angle), rgba(mix(col, [110, 80, 30], 0.5), 0.12 + 0.15 * k), 0.8);
    stroke(c, rotateLocal([{ x: -S / 2 + 1, y: 5.2 }, { x: S / 2 - 1, y: 5.2 }], angle), rgba(mix(col, [110, 80, 30], 0.5), 0.12 + 0.15 * k), 0.8);
    stroke(c, rotateLocal([{ x: -S / 2 + 2, y: -2.4 }, { x: S / 2 - 2, y: -2.2 }], angle), 'rgb(255 255 250 / 0.22)', 0.9);
  };
  if (style === 'clear') clear(0);
  else if (style === 'cross') {
    clear(-35);
    clear(35);
  } else if (style === 'masking') {
    const rect = tapeRect(c, S, 0);
    fill(c, rect, rgba(mix([238, 228, 198], col, 0.4), 0.72 + 0.2 * k));
    stroke(c, rect, rgba(mix(col, [120, 95, 50], 0.5), 0.35), 0.2, true);
    for (let i = 0; i < 14; i++) {
      const x = range(rng, -S / 2 + 1, S / 2 - 1);
      const y = range(rng, -5, 5);
      stroke(c, [{ x, y }, { x: x + range(rng, 0.8, 2.5), y: y + range(rng, -0.3, 0.3) }], 'rgb(170 150 110 / 0.18)', 0.12);
    }
  } else {
    const rect = tapeRect(c, S, 0);
    fill(c, rect, rgba(col, 0.15 + 0.25 * k));
    stroke(c, rect, rgba(mix(col, [110, 80, 30], 0.6), 0.25 + 0.25 * k), 0.6, true);
    for (let i = 0; i < int(rng, 3, 7); i++) {
      fill(c, roundish(rng, range(rng, 0.8, 2.4), 0.8, 14, range(rng, -S / 2 + 2, S / 2 - 2), range(rng, -3.5, 3.5)), 'rgb(255 253 246 / 0.6)');
    }
  }
}

function wax(c: Ctx): void {
  const { S, ir, rng } = c;
  const style = c.item.style;
  const body = mix([250, 247, 236], [168, 30, 28], c.tone);
  const light = mix([255, 253, 248], [205, 70, 60], c.tone);
  const rim = mix([150, 135, 95], [92, 16, 14], c.tone);
  const blob = (poly: readonly Point[], hi: Point, r: number): void => {
    fill(c, shift(poly, 0.25, 0.25), rgba(rim, 0.25));
    fill(c, poly, rgba(body, 0.9));
    stroke(c, poly, rgba(rim, 0.75), 0.3, true);
    fill(c, roundish(rng, r * 0.35, 0.3, 12, hi.x, hi.y), rgba(light, 0.7));
  };
  if (style === 'drip') {
    for (let i = 0; i < c.count; i++) {
      const p = scatterIn(rng, S * 4);
      const r = S * range(rng, 0.45, 1.3);
      const len = range(rng, 2, 9) * (S / 3);
      const shape = [...roundish(rng, r, ir * 0.4, 18, p.x, p.y).filter((q) => q.y <= p.y + r * 0.2), { x: p.x + r * 0.25, y: p.y + r + len }, { x: p.x, y: p.y + r + len + r * 0.35 }, { x: p.x - r * 0.25, y: p.y + r + len }];
      blob(shape, { x: p.x - r * 0.3, y: p.y - r * 0.3 }, r);
    }
  } else if (style === 'pool') {
    const poly = roundish(rng, S, Math.min(1, ir + 0.2), 36);
    blob(poly, { x: -S * 0.3, y: -S * 0.3 }, S);
    for (const d of [0.25, 0.5]) stroke(c, inset(poly, S * d, rng, 0.4), rgba(rim, 0.22), 0.22, true);
  } else if (style === 'splash') {
    for (let i = 0; i < c.count; i++) {
      const p = scatterIn(rng, S * 4);
      const r = S * range(rng, 0.1, 0.4);
      blob(roundish(rng, r, ir * 0.5, 12, p.x, p.y), { x: p.x - r * 0.3, y: p.y - r * 0.3 }, r);
    }
  } else {
    // 蠟淚：往下流的一長條，尾端與兩側有蠟珠
    const L = S * range(rng, 4, 7);
    const left: Point[] = [];
    const right: Point[] = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      const y = t * L;
      const w = (S / 2) * (1 - 0.55 * t) * (1 + ir * 0.25 * Math.sin(t * 9 + c.seedPhase));
      const x = Math.sin(t * 3 + c.seedPhase) * S * 0.25 * ir;
      left.push({ x: x - w, y });
      right.push({ x: x + w, y });
    }
    const tail = right[right.length - 1] as Point;
    blob([...roundish(rng, S * 0.6, 0.2, 14).filter((q) => q.y <= 0), ...right, { x: tail.x - S * 0.22, y: L + S * 0.45 }, ...left.reverse()], { x: -S * 0.15, y: S * 0.2 }, S * 0.6);
    for (let i = 0; i < int(rng, 1, 3); i++) {
      const y = range(rng, 0.3, 0.8) * L;
      const r = S * range(rng, 0.2, 0.35);
      blob(roundish(rng, r, 0.3, 10, (rng() < 0.5 ? -1 : 1) * S * 0.45, y), { x: 0, y }, r);
    }
  }
}

function smudge(c: Ctx): void {
  const { S, ir, k, rng } = c;
  const style = c.item.style;
  const ink = mix([25, 22, 20], [26, 36, 72], c.tone);
  const a = (c.item.rotate * Math.PI) / 180;
  const bleed = (polys: Point[][], blur: number, opacity: number, wash: number, dx = 0, dy = 0): void => {
    c.bleeds.push({ polygons: polys.map((p) => p.map(c.T)), tint: c.tone > 0.5 ? ink : null, blur, opacity, wash, dx, dy });
  };
  if (style === 'wipe') {
    const poly = roundish(rng, S, Math.min(1, ir + 0.2), 28, 0, 0, 1.8, 1);
    fill(c, poly, rgba(ink, 0.12 + 0.2 * k));
    fill(c, inset(poly, S * 0.35, rng), rgba(ink, 0.06 + 0.12 * k));
    bleed([poly], 0.25 + 0.5 * k, 0.9, 0.25 * k);
  } else if (style === 'thumb') {
    const poly = roundish(rng, S, ir * 0.4, 32, 0, 0, 0.62, 1);
    fill(c, poly, rgba(ink, 0.1 + 0.16 * k));
    for (let i = 1; i <= 6; i++) {
      const s = 1 - i * 0.13;
      stroke(c, roundish(rng, S * s, ir * 0.2, 28, 0, S * 0.08 * i * 0.3, 0.62, 1), rgba(ink, 0.08 + 0.1 * k), 0.18, true);
    }
    bleed([poly], 0.2 + 0.4 * k, 0.85, 0.2 * k);
  } else if (style === 'drag') {
    const L = S * 3.2;
    const top: Point[] = [];
    const bottom: Point[] = [];
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      const w = (S / 2) * (1 - 0.7 * t) * (1 + gaussianish(rng) * 0.15 * ir);
      top.push({ x: -L / 2 + L * t, y: -w });
      bottom.push({ x: -L / 2 + L * t, y: w });
    }
    const poly = [...top, ...bottom.reverse()];
    fill(c, poly, rgba(ink, 0.1 + 0.18 * k));
    for (let i = 0; i < 5; i++) {
      const y = range(rng, -S * 0.35, S * 0.35);
      stroke(c, [{ x: -L / 2 + range(rng, 0, L * 0.2), y }, { x: L / 2 - range(rng, 0, L * 0.4), y: y * 0.4 }], rgba(ink, 0.08 + 0.1 * k), 0.25);
    }
    // 字被拖著抹開：錯開兩次的複製品
    bleed([poly], 0.25, 0.55 + 0.25 * k, 0.15 * k, Math.cos(a) * 0.9, Math.sin(a) * 0.9);
    bleed([poly], 0.4, 0.3 + 0.2 * k, 0, Math.cos(a) * 2, Math.sin(a) * 2);
  } else {
    const poly = roundish(rng, S, ir, 32);
    fill(c, poly, rgba(mix(ink, [120, 120, 120], 0.6), 0.05 + 0.06 * k));
    bleed([poly], 0.8 + 1.4 * k, 0.9, 0.35 * k);
  }
}

const GENERATORS: Readonly<Record<FxKind, (c: Ctx) => void>> = { burn, water, tear, fold, crumple, spots, mold, worm, pin, rust, tape, wax, smudge };

// ---- 組裝 ----

function inPoly(p: Point, poly: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i] as Point;
    const b = poly[j] as Point;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function overlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function hitsProtect(poly: readonly Point[], protect: readonly Rect[]): boolean {
  if (poly.length < 2) return false;
  if (poly.length < 3) return protect.some((r) => poly.some((p) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h));
  return protect.some((r) => rectPolygonRelation(r, poly) !== 'outside');
}

/** 不碰保護區的挖洞範圍：以中心縮小，最多縮到 15%；仍然碰到就取消。 */
function avoidProtect(poly: readonly Point[], center: Point, protect: readonly Rect[]): { poly: Point[] | null; shrunk: boolean } {
  if (!hitsProtect(poly, protect)) return { poly: [...poly], shrunk: false };
  for (let s = 0.85; s > 0.15; s *= 0.85) {
    const p = poly.map((q) => ({ x: center.x + (q.x - center.x) * s, y: center.y + (q.y - center.y) * s }));
    if (!hitsProtect(p, protect)) return { poly: p, shrunk: true };
  }
  return { poly: null, shrunk: true };
}

function charPrims(marks: CharMarks, tone: number): FxPrim[] {
  const edge = closedPath(marks.edge);
  const out: FxPrim[] = marks.bands.map((band, i) => ({ t: 'fill', d: edge + closedPath(band.line), color: charColor(i, marks.bands.length, tone), evenodd: true }));
  const flakes = marks.flakes.filter((f) => !f.ash).map((f) => closedPath(f.polygon));
  const ash = marks.flakes.filter((f) => f.ash).map((f) => closedPath(f.polygon));
  if (flakes.length) out.push({ t: 'fill', d: flakes.join(''), color: 'rgb(10 6 3 / 0.95)' });
  if (ash.length) out.push({ t: 'fill', d: ash.join(''), color: 'rgb(118 112 102 / 0.85)' });
  if (marks.cracks.length) out.push({ t: 'stroke', d: marks.cracks.map(openPath).join(''), color: 'rgb(20 10 5 / 0.8)', width: 0.18 });
  out.push({ t: 'stroke', d: edge, color: tone > 50 ? 'rgb(40 22 10)' : 'rgb(8 5 3)', width: 0.45 });
  return out;
}

/** 規劃一項。protect 是保護區（已外擴）。 */
export function planFxItem(item: FxItem, ctx: FxPlanContext): FxPlan {
  const rad = (item.rotate * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const T = (p: Point): Point => ({ x: item.x + p.x * cos - p.y * sin, y: item.y + p.x * sin + p.y * cos });
  const st = fxStyle(item.kind, item.style);
  const c: Ctx = {
    item,
    rng: rngFor(item.seed, `fx:${item.kind}:${st.value}`),
    S: Math.max(0.2, item.size),
    ir: clamp(item.irregular, 0, 100) / 100,
    k: clamp(item.strength, 0, 100) / 100,
    tone: clamp(item.tone, 0, 100) / 100,
    count: Math.max(1, Math.round(item.count)),
    prims: [],
    cuts: [],
    bleeds: [],
    local: [],
    T,
    protect: ctx.protect,
    seedPhase: (item.seed % 997) / 97,
  };
  GENERATORS[item.kind](c);

  // 挖洞碰到保護區就縮小；燒穿的洞再畫焦痕、撕口畫白色毛邊
  const center = { x: item.x, y: item.y };
  const cuts: Point[][] = [];
  const edgePrims: FxPrim[] = [];
  let shrunk = false;
  const charRng = rngFor(item.seed, 'fx-char');
  for (const k of c.cuts) {
    const res = avoidProtect(k.poly, center, ctx.protect);
    shrunk ||= res.shrunk;
    if (!res.poly) continue;
    cuts.push(res.poly);
    const d = closedPath(res.poly);
    if (k.char !== null) edgePrims.push(...charPrims(charMarks(charRng, res.poly, true, k.char, ctx.protect), item.tone));
    if (k.fiber) {
      edgePrims.push({ t: 'stroke', d, color: fiberColor(c), width: 0.9 });
      edgePrims.push({ t: 'stroke', d, color: 'rgb(120 95 60 / 0.22)', width: 0.25 });
    }
    if (k.rim) edgePrims.push({ t: 'stroke', d, color: k.rim, width: 0.3 });
  }

  // 選取框：自己座標裡的外接矩形，旋轉後放到紙上
  const pts = c.local.length ? c.local : [{ x: -2, y: -2 }, { x: 2, y: 2 }];
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const cap = (v: number): number => clamp(v, -300, 300);
  const x0 = cap(Math.min(...xs) - 1);
  const x1 = cap(Math.max(...xs) + 1);
  const y0 = cap(Math.min(...ys) - 1);
  const y1 = cap(Math.max(...ys) + 1);
  const outline = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }].map(T);
  const avoid = !(item.kind === 'fold' || item.kind === 'crumple' || (item.kind === 'tape' && (item.style === 'clear' || item.style === 'cross')));
  return {
    id: item.id,
    z: item.z,
    kind: item.kind,
    cuts,
    prims: [...c.prims, ...edgePrims],
    avoidProtect: avoid,
    blur: (clamp(item.soft, 0, 100) / 100) * clamp(c.S * 0.12, 0.15, 1.6),
    bleeds: c.bleeds,
    outline,
    center,
    shrunk,
  };
}

/** 規劃一張紙上的所有項目（依疊放順序）。 */
export function planFxItems(items: readonly FxItem[], ctx: FxPlanContext): FxPlan[] {
  return [...items].sort((a, b) => a.z - b.z).map((item) => planFxItem(item, ctx));
}

/** 測試用：一項畫出來的所有向量圖形與挖掉的範圍的外框面積總和（看不同樣式是否真的不同）。 */
export function planFootprint(plan: FxPlan): number {
  return plan.cuts.reduce((s, p) => s + Math.abs(polygonArea(p)), 0) + plan.prims.length;
}
