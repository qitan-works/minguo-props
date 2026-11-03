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
  | { readonly kind: 'text'; readonly x: number; readonly y: number; readonly text: string; readonly size: number; readonly fill: string; readonly vertical?: boolean; readonly weight?: number; readonly font?: 'title' | 'hand' };

/** 徑向漸層（座標單位公釐，以裝飾中心為原點）。 */
export interface GradientDef {
  readonly id: string;
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  readonly stops: readonly (readonly [number, string])[];
}

export interface DecorationShape {
  readonly primitives: Primitive[];
  readonly gradients?: readonly GradientDef[];
  /**
   * 遮罩：白色的地方留下、黑色的地方挖空（手印的掌紋、按壓不均的缺塊）。
   * 用遮罩而不是畫紙色，是因為紙色會隨做舊程度改變。
   */
  readonly mask?: readonly Primitive[];
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
  readonly ring: string;
  readonly mist: string;
}

/** 新鮮的血偏鮮紅；乾涸後氧化成暗紅到褐色。 */
export function bloodPalette(dry: boolean): BloodPalette {
  return dry
    ? { core: 'rgb(128 58 34 / 0.5)', mid: 'rgb(100 38 20 / 0.78)', edge: 'rgb(74 24 11 / 0.93)', ring: 'rgb(56 16 7 / 0.9)', mist: 'rgb(92 34 17 / 0.72)' }
    : { core: 'rgb(158 18 18 / 0.55)', mid: 'rgb(134 9 11 / 0.82)', edge: 'rgb(104 4 7 / 0.95)', ring: 'rgb(82 2 5 / 0.92)', mist: 'rgb(136 10 12 / 0.78)' };
}

function withAlpha(color: string, alpha: number): string {
  return color.replace(/\/ [0-9.]+\)/, `/ ${alpha.toFixed(2)})`);
}

/** 一灘：中心淡、邊緣深的漸層，加上乾涸後的深色環；邊緣用擾動濾鏡變得不規則。 */
function pool(rng: Rng, id: string, cx: number, cy: number, r: number, irregular: number, pal: BloodPalette, squash = 1): { prims: Primitive[]; grad: GradientDef } {
  const pts = blobPolygon(rng, cx, cy, r, irregular, 30).map((p) => ({ x: p.x, y: cy + (p.y - cy) * squash }));
  const d = poly(pts);
  return {
    grad: { id, cx, cy, r: r * 1.1, stops: [[0, pal.core], [0.62, pal.mid], [1, pal.edge]] },
    prims: [
      { kind: 'path', d, fill: `grad:${id}`, filter: 'rough' },
      { kind: 'path', d, fill: 'none', stroke: pal.ring, width: Math.max(0.25, r * 0.07), filter: 'rough' },
    ],
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

/** 噴濺：中央一灘，四周大小不一的衛星血點與有方向性的拉長血滴，外加細霧。 */
function splatter(rng: Rng, pal: BloodPalette): { prims: Primitive[]; grads: GradientDef[] } {
  const r = range(rng, 4.5, 7);
  const main = pool(rng, 'pool', 0, 0, r, 0.5, pal);
  const prims: Primitive[] = [...main.prims];
  const dir = range(rng, 0, Math.PI * 2);
  for (let i = 0, n = int(rng, 30, 48); i < n; i++) {
    const a = rng() < 0.25 ? range(rng, 0, Math.PI * 2) : dir + gaussianish(rng) * 0.55;
    const dist = r + 1 + 15 * Math.pow(rng(), 0.75);
    const size = 0.1 + 1.15 * Math.pow(rng(), 3.2);
    const cx = Math.cos(a) * dist;
    const cy = Math.sin(a) * dist;
    if (size > 0.3 && rng() < 0.6) {
      prims.push({ kind: 'path', d: poly(teardrop(cx, cy, size, a, size * range(rng, 1.1, 2.8))), fill: pal.mid, filter: 'fine' });
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
    const y0 = -11.5;
    const left: Point[] = [];
    const right: Point[] = [];
    for (let k = 0; k <= 10; k++) {
      const t = k / 10;
      const cx = x + Math.sin(t * 3 + i) * 0.35;
      const half = (w / 2) * (1 - 0.45 * t);
      left.push({ x: cx - half, y: y0 + t * len });
      right.push({ x: cx + half, y: y0 + t * len });
    }
    prims.push({ kind: 'path', d: poly([...left, ...right.reverse()]), fill: pal.mid, filter: 'fine' });
    const endX = x + Math.sin(3 + i) * 0.35;
    prims.push({ kind: 'path', d: poly(teardrop(endX, y0 + len + w * 0.5, w * 0.75, -Math.PI / 2, w * 1.1)), fill: pal.edge, filter: 'fine' });
    if (rng() < 0.4) prims.push({ kind: 'path', d: poly(teardrop(endX, y0 + len + w * 3 + range(rng, 1, 4), w * 0.5, -Math.PI / 2, w * 0.9)), fill: pal.mid });
  }
  return { prims: [...top.prims, ...prims], grads: [top.grad] };
}

/** 拖痕：起點一灘，接著是刷痕般的平行細紋，越往後越淡、越窄、斷斷續續。 */
function smear(rng: Rng, pal: BloodPalette): { prims: Primitive[]; grads: GradientDef[] } {
  const start = pool(rng, 'pool', -18, 0, 4.2, 0.35, pal, 0.9);
  const prims: Primitive[] = [];
  const bend = range(rng, -3, 3);
  const at = (t: number, off: number): Point => ({ x: -18 + t * 40, y: Math.sin(t * Math.PI) * bend + off * (1 - t * 0.35) });
  const W = range(rng, 6, 8);
  for (let s = 0; s < 6; s++) {
    const t0 = s / 6;
    const t1 = (s + 1) / 6 + 0.02;
    prims.push({ kind: 'path', d: poly([at(t0, -W / 2), at(t1, -W / 2), at(t1, W / 2), at(t0, W / 2)]), fill: withAlpha(pal.mid, 0.5 * (1 - s / 6.5)), filter: 'fine' });
  }
  for (let i = 0, n = int(rng, 18, 28); i < n; i++) {
    const off = range(rng, -W / 2, W / 2);
    const t0 = range(rng, 0, 0.1);
    const t1 = range(rng, 0.55, 1);
    const pts: Point[] = [];
    for (let k = 0; k <= 12; k++) pts.push(at(t0 + ((t1 - t0) * k) / 12, off));
    const dash = rng() < 0.7 ? `${range(rng, 4, 12).toFixed(1)} ${range(rng, 0.4, 2.2).toFixed(1)} ${range(rng, 2, 6).toFixed(1)} ${range(rng, 0.8, 3).toFixed(1)}` : undefined;
    prims.push({ kind: 'path', d: wobbly(rng, pts, 0.05), fill: 'none', stroke: pal.edge, width: range(rng, 0.12, 0.55), cap: 'round', opacity: Number(range(rng, 0.35, 0.9).toFixed(2)), ...(dash ? { dash } : {}) });
  }
  return { prims: [...start.prims, ...prims], grads: [start.grad] };
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

/** 血手印：掌心與五指，按壓不均（掌心淡、指尖濃）、掌紋與指節留白、部分缺塊。 */
function handprint(rng: Rng, pal: BloodPalette): { prims: Primitive[]; grads: GradientDef[]; mask: Primitive[] } {
  const prims: Primitive[] = [];
  const mask: Primitive[] = [{ kind: 'path', d: 'M-40 -40H40V40H-40Z', fill: 'white' }];
  // 掌：略呈梯形的圓角形，掌心（中央偏下）按得輕
  const palm: Point[] = [];
  for (let i = 0; i < 32; i++) {
    const t = (i / 32) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const wide = s < 0 ? 8.2 : 7.2 + s * 0.4;
    palm.push({ x: Math.sign(c) * Math.pow(Math.abs(c), 0.7) * wide + range(rng, -0.25, 0.25), y: 6 + Math.sign(s) * Math.pow(Math.abs(s), 0.8) * 7.8 + range(rng, -0.25, 0.25) });
  }
  const grads: GradientDef[] = [{ id: 'palm', cx: 0.6, cy: 7, r: 9.5, stops: [[0, withAlpha(pal.core, 0.32)], [0.55, pal.mid], [1, pal.edge]] }];
  prims.push({ kind: 'path', d: poly(palm), fill: 'grad:palm', filter: 'fine' });
  // 四指與拇指（中指最長）
  const fingers = [
    { x: -6, y: -0.6, a: -1.78, len: 11.5, w0: 3.5, w1: 3.0 },
    { x: -2.1, y: -1.6, a: -1.63, len: 13.6, w0: 3.8, w1: 3.25 },
    { x: 1.9, y: -1.4, a: -1.5, len: 12.8, w0: 3.65, w1: 3.1 },
    { x: 5.6, y: -0.2, a: -1.33, len: 10, w0: 3.2, w1: 2.75 },
    { x: -7.6, y: 8.5, a: -2.55, len: 10.5, w0: 4.4, w1: 3.6 },
  ];
  fingers.forEach((f, i) => {
    const len = f.len * range(rng, 0.94, 1.04) * (i < 4 && rng() < 0.1 ? 0.55 : 1);
    const a = f.a + range(rng, -0.06, 0.06);
    // 指根往掌內多伸一點，和手掌連在一起
    const bx = f.x - Math.cos(a) * 1.6;
    const by = f.y - Math.sin(a) * 1.6;
    prims.push({ kind: 'path', d: poly(fingerShape(bx, by, a, len + 1.6, f.w0 * 1.05, f.w1)), fill: pal.mid, filter: 'fine' });
    // 指尖按得重
    const tx = f.x + Math.cos(a) * (len - f.w1 * 0.75);
    const ty = f.y + Math.sin(a) * (len - f.w1 * 0.75);
    prims.push({ kind: 'path', d: ellipse(tx, ty, f.w1 * 0.42, f.w1 * 0.5), fill: withAlpha(pal.edge, 0.55), filter: 'fine' });
    // 指節的摺痕留白
    for (const k of i === 4 ? [0.45] : [0.38, 0.66]) {
      const cx = f.x + Math.cos(a) * len * k;
      const cy = f.y + Math.sin(a) * len * k;
      const px = -Math.sin(a) * f.w0 * 0.55;
      const py = Math.cos(a) * f.w0 * 0.55;
      mask.push({ kind: 'path', d: `M${(cx - px).toFixed(2)} ${(cy - py).toFixed(2)}L${(cx + px).toFixed(2)} ${(cy + py).toFixed(2)}`, fill: 'none', stroke: 'black', width: range(rng, 0.25, 0.45), cap: 'round' });
    }
  });
  // 掌紋：感情線、智慧線、生命線
  const lines: Point[][] = [
    [{ x: 7.6, y: 2.4 }, { x: 3, y: 3.6 }, { x: -2, y: 3 }, { x: -5.5, y: 1.6 }],
    [{ x: -7.4, y: 4.2 }, { x: -3, y: 5.6 }, { x: 2, y: 6.8 }, { x: 6.5, y: 9 }],
    [{ x: -6.8, y: 4.4 }, { x: -4.4, y: 8.5 }, { x: -3.2, y: 12 }, { x: -2.6, y: 13.6 }],
  ];
  for (const l of lines) mask.push({ kind: 'path', d: wobbly(rng, l, 0.18), fill: 'none', stroke: 'black', width: range(rng, 0.35, 0.6), cap: 'round' });
  // 按壓不均：幾塊缺失與許多細小白點
  for (let i = 0, n = int(rng, 2, 5); i < n; i++) {
    mask.push({ kind: 'path', d: poly(blobPolygon(rng, range(rng, -7, 7), range(rng, -8, 13), range(rng, 0.8, 2.6), 0.45, 14)), fill: 'black' });
  }
  for (let i = 0; i < 60; i++) mask.push({ kind: 'path', d: circle(range(rng, -10, 10), range(rng, -14, 14), range(rng, 0.08, 0.3)), fill: 'black' });
  return { prims, grads, mask };
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
  const grads: GradientDef[] = [{ id: 'slime', cx: -2, cy: -2, r: 13, stops: [[0, 'rgb(170 200 110 / 0.28)'], [0.7, 'rgb(105 140 60 / 0.48)'], [1, 'rgb(60 95 38 / 0.65)']] }];
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
      const s = splatter(rng, pal);
      return { primitives: s.prims, gradients: s.grads, radius: 22 };
    }
    case 'blood-drip': {
      const s = drips(rng, pal);
      return { primitives: s.prims, gradients: s.grads, radius: 24 };
    }
    case 'blood-smear': {
      const s = smear(rng, pal);
      return { primitives: s.prims, gradients: s.grads, radius: 24 };
    }
    case 'handprint': {
      const s = handprint(rng, pal);
      return { primitives: s.prims, gradients: s.grads, mask: s.mask, radius: 22 };
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
      const ink: BloodPalette = { core: 'rgb(30 28 34 / 0.6)', mid: 'rgb(22 20 26 / 0.85)', edge: 'rgb(14 12 18 / 0.95)', ring: 'rgb(10 8 12 / 0.9)', mist: 'rgb(22 20 26 / 0.75)' };
      const s = splatter(rng, ink);
      return { primitives: s.prims.slice(0, 18), gradients: s.grads, radius: 20 };
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
