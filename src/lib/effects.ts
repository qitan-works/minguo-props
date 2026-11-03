// 紙張狀況的效果規劃（純邏輯）：由種子決定紙邊、破洞、水漬、斑點等的位置與形狀。
//
// 保護區（[保:…] 標出的線索）：所有隨機效果都會避開，紙邊損傷也不會深入保護區。
// 必毀區（[毀:…]）：依目前啟用的效果，在那裡放一個燒穿的洞、浸水模糊或墨跡，確保那些字被毀掉。
// 輸出全部是紙面座標（公釐）的幾何資料，交給 src/render/effects.ts 畫出來；同一組輸入永遠得到同樣的結果。

import { cutPolygon } from './cutline.ts';
import { inflateRect, pointInPolygon, polygonBounds, rectPolygonRelation, rectToPolygon, rectsOverlap, type Point, type Polygon, type Rect } from './geometry.ts';
import { gaussianish, int, pick, range, rngFor, type Rng } from './random.ts';

export const EDGE_STYLES = [
  { value: 'none', label: '完整紙邊' },
  { value: 'scissors', label: '剪刀剪' },
  { value: 'torn', label: '手撕（毛邊、露出白色紙纖維）' },
  { value: 'burnt', label: '火燒（焦黑邊緣）' },
  { value: 'mouse', label: '老鼠咬' },
  { value: 'half', label: '被撕掉一半' },
] as const;
export type EdgeStyle = (typeof EDGE_STYLES)[number]['value'];

export const WATER_REGIONS = [
  { value: 'none', label: '沒有' },
  { value: 'corner', label: '泡到一角' },
  { value: 'half', label: '泡到一半' },
  { value: 'whole', label: '整張泡過' },
] as const;
export type WaterRegion = (typeof WATER_REGIONS)[number]['value'];

export const FOLD_STYLES = [
  { value: 'half', label: '對摺' },
  { value: 'quarter', label: '四摺' },
  { value: 'thirds', label: '三摺（信紙）' },
] as const;
export type FoldStyle = (typeof FOLD_STYLES)[number]['value'];

export interface ConditionSettings {
  readonly edge: string;
  readonly edgeDepth: number;
  readonly burnHoles: number;
  readonly wormHoles: number;
  readonly pinHoles: boolean;
  readonly water: string;
  readonly waterStrength: number;
  /** 墨水暈開後偏藍或偏褐（第三版新增；舊存檔沒有時偏褐）。 */
  readonly waterTint?: string;
  readonly folds: boolean;
  readonly foldStyle: string;
  readonly crumple: number;
  readonly stains: boolean;
  readonly spots: number;
  readonly mold: number;
  readonly sunFade: number;
  readonly rust: boolean;
  readonly tape: boolean;
  readonly smudge: boolean;
  readonly wax: boolean;
  readonly pencilGhost: string;
  readonly effectSeed: number;
}

export interface PlanInput {
  readonly width: number;
  readonly height: number;
  readonly settings: ConditionSettings;
  readonly protect: readonly Rect[];
  readonly destroy: readonly Rect[];
  /** 使用者自由裁切的多邊形；null 表示整張紙。 */
  readonly crop: Polygon | null;
  /** 同一頁有多張紙（名片拼版）時，讓每張的隨機效果不同。 */
  readonly variant?: number;
}

export interface Ellipse {
  readonly cx: number;
  readonly cy: number;
  readonly rx: number;
  readonly ry: number;
  readonly rotate: number;
}

export interface Circle {
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
}

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly rotate: number;
}

export interface EffectPlan {
  readonly width: number;
  readonly height: number;
  /** 紙張外形（裁切與紙邊損傷之後）。 */
  readonly outline: Point[];
  readonly edge: EdgeStyle;
  /** 破洞：燒穿的洞、蟲蛀、圖釘孔。 */
  readonly holes: { readonly kind: 'burn' | 'worm' | 'pin'; readonly polygon: Point[] }[];
  /** 火燒的焦痕：紙邊（edge = burnt）與每個燒洞各一組，由外往內。 */
  readonly char: { readonly edge: CharMarks | null; readonly holes: CharMarks[] };
  /** 浸水範圍（含避開保護區的洞，以 evenodd 規則填色）、乾掉後留下的潮線、起皺的紋路與墨色偏向。 */
  readonly water: {
    readonly polygons: Point[][];
    readonly strength: number;
    readonly tides: Point[][];
    readonly wrinkles: Point[][];
    readonly tint: 'blue' | 'brown';
  } | null;
  /** 濕手抹糊的墨跡。 */
  readonly smudges: Point[][];
  /** 必毀區的濃墨塗抹（沒有火燒時用來毀掉那些字）。 */
  readonly blots: Point[][];
  readonly stains: Ellipse[];
  readonly rings: { readonly cx: number; readonly cy: number; readonly r: number; readonly arc: number; readonly rotate: number }[];
  readonly spots: Circle[];
  readonly mold: { readonly cx: number; readonly cy: number; readonly r: number; readonly dots: Circle[] }[];
  readonly creases: Point[][];
  readonly folds: { readonly horizontal: number[]; readonly vertical: number[] };
  readonly rust: Box | null;
  readonly tape: Box[];
  readonly wax: { readonly blob: Point[]; readonly drip: Point[] }[];
  readonly pencil: (Box & { readonly text: string }) | null;
  readonly sun: { readonly side: 'left' | 'right' | 'top' | 'bottom'; readonly amount: number } | null;
}

/** 火燒的焦痕：由外往內的幾圈焦痕線（越外越黑），加上灰燼碎片與焦裂的細紋。 */
export interface CharMarks {
  /** 起點的線（紙邊或燒洞的邊）。 */
  readonly edge: Point[];
  /** 往紙面內縮 depth 公釐、帶起伏的線，依 depth 由大到小排列。 */
  readonly bands: { readonly depth: number; readonly line: Point[] }[];
  readonly flakes: { readonly polygon: Point[]; readonly ash: boolean }[];
  readonly cracks: Point[][];
}

/** 焦痕帶的深度（公釐），由深到淺：淡黃漸層帶、褐色焦痕、深褐、焦黑。分十圈疊出漸層。 */
export const CHAR_DEPTHS = [11, 9.2, 7.6, 6.2, 5, 3.9, 2.9, 2, 1.3, 0.7] as const;

/** 沿封閉多邊形每隔 step 公釐取一點。 */
export function resample(poly: readonly Point[], step: number): Point[] {
  const out: Point[] = [];
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k] as Point;
    const b = poly[(k + 1) % poly.length] as Point;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.round(len / step));
    for (let i = 0; i < n; i++) out.push({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n });
  }
  return out;
}

function centroid(poly: readonly Point[]): Point {
  let x = 0;
  let y = 0;
  for (const p of poly) {
    x += p.x;
    y += p.y;
  }
  return { x: x / Math.max(1, poly.length), y: y / Math.max(1, poly.length) };
}

/** 每一點朝「紙面」的法向量：紙邊朝內（朝中心），燒洞朝外（離開洞）。用前後各兩點平滑。 */
function paperNormals(pts: readonly Point[], outward: boolean): Point[] {
  const c = centroid(pts);
  return pts.map((p, i) => {
    const a = pts[(i - 2 + pts.length) % pts.length] as Point;
    const b = pts[(i + 2) % pts.length] as Point;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    let n = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
    const toward = (c.x - p.x) * n.x + (c.y - p.y) * n.y;
    if ((toward < 0) !== outward) n = { x: -n.x, y: -n.y };
    return n;
  });
}

/** 沿線平滑起伏的係數（幾個不同頻率的正弦相加）。 */
function waviness(rng: Rng, count: number): (i: number) => number {
  const terms = [0, 1, 2].map(() => ({ f: int(rng, 2, Math.max(3, Math.round(count / 18))), p: range(rng, 0, Math.PI * 2), a: range(rng, 0.25, 0.5) }));
  return (i) => terms.reduce((s, t) => s + t.a * Math.sin((i / count) * Math.PI * 2 * t.f + t.p), 0);
}

/** 點在不在任何保護區（多留 margin 公釐）裡。 */
function inProtect(p: Point, protect: readonly Rect[], margin: number): boolean {
  return protect.some((r) => p.x > r.x - margin && p.x < r.x + r.w + margin && p.y > r.y - margin && p.y < r.y + r.h + margin);
}

export function charMarks(rng: Rng, polygon: readonly Point[], outward: boolean, scale = 1, protect: readonly Rect[] = []): CharMarks {
  const pts = resample(polygon, 2);
  const normals = paperNormals(pts, outward);
  const bands = CHAR_DEPTHS.map((depth) => {
    const wave = waviness(rng, pts.length);
    const d = depth * scale;
    return {
      depth: d,
      line: pts.map((p, i) => {
        const n = normals[i] as Point;
        let reach = d * Math.max(0.2, 1 + wave(i) * 0.6);
        // 焦痕不蓋到保護區（線索）：碰到就往紙邊縮回
        for (let k = 0; k < 6 && reach > 0.05 && inProtect({ x: p.x + n.x * reach, y: p.y + n.y * reach }, protect, 1); k++) reach *= 0.5;
        return { x: p.x + n.x * reach, y: p.y + n.y * reach };
      }),
    };
  });
  const flakes: CharMarks['flakes'] = [];
  const cracks: Point[][] = [];
  pts.forEach((p, i) => {
    const n = normals[i] as Point;
    if (i % 2 === 0 && rng() < 0.32) {
      const at = range(rng, 0.2, 1.5) * scale;
      if (inProtect({ x: p.x + n.x * at, y: p.y + n.y * at }, protect, 2)) return;
      flakes.push({ polygon: blobPolygon(rng, p.x + n.x * at, p.y + n.y * at, range(rng, 0.25, 1) * scale, 0.5, 9), ash: rng() < 0.35 });
    }
    if (rng() < 0.08) {
      const a = Math.atan2(n.y, n.x) + range(rng, -0.6, 0.6);
      const len = range(rng, 1.2, 3.6) * scale;
      const line: Point[] = [];
      for (let k = 0; k <= 4; k++) {
        const r = 0.3 + (len * k) / 4;
        line.push({ x: p.x + Math.cos(a) * r + range(rng, -0.25, 0.25), y: p.y + Math.sin(a) * r + range(rng, -0.25, 0.25) });
      }
      cracks.push(line);
    }
  });
  return { edge: pts, bands, flakes, cracks };
}

function isEdge(v: string): v is EdgeStyle {
  return EDGE_STYLES.some((e) => e.value === v);
}

/** 不規則的團塊（水漬、霉斑、燒洞）：以中心與半徑沿圓周取點並加上雜訊。 */
export function blobPolygon(rng: Rng, cx: number, cy: number, r: number, roughness = 0.25, points = 28): Point[] {
  const phase = range(rng, 0, Math.PI * 2);
  const waves = [int(rng, 2, 4), int(rng, 5, 8)];
  const amps = [range(rng, 0.05, 0.15), range(rng, 0.02, 0.07)];
  const out: Point[] = [];
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2;
    const k =
      1 +
      (amps[0] as number) * Math.sin(a * (waves[0] as number) + phase) +
      (amps[1] as number) * Math.sin(a * (waves[1] as number) + phase * 2) +
      roughness * 0.3 * gaussianish(rng);
    out.push({ x: cx + Math.cos(a) * r * k, y: cy + Math.sin(a) * r * k });
  }
  return out;
}

/** 緊貼矩形的不規則團塊（超橢圓，外擴 pad 公釐，只向外起伏，保證蓋住整個矩形）。 */
function ellipseBlob(rng: Rng, target: Rect, pad: number, rough: number): Point[] {
  const cx = target.x + target.w / 2;
  const cy = target.y + target.h / 2;
  // 指數 4 的超橢圓在 45° 方向約為半軸的 0.84 倍，所以半軸取半寬高的 1.19 倍即可包住四角
  const ax = (target.w / 2) * 1.19 + pad;
  const ay = (target.h / 2) * 1.19 + pad;
  const n = 48;
  const base: Point[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const k = 1 + rng() * 0.04;
    base.push({ x: cx + Math.sign(c) * Math.sqrt(Math.abs(c)) * ax * k, y: cy + Math.sign(s) * Math.sqrt(Math.abs(s)) * ay * k });
  }
  if (rough <= 0) return base;
  // 邊緣只往外鼓（不往內縮，免得露出該毀掉的字）：平滑過的雜訊沿外法線推出去，最多約 2.2 mm
  const raw = base.map(() => rng());
  const smooth = raw.map((_, i) => {
    let sum = 0;
    for (let d = -2; d <= 2; d++) sum += raw[(i + d + n) % n] as number;
    return sum / 5;
  });
  const lo = Math.min(...smooth);
  const span = Math.max(1e-6, Math.max(...smooth) - lo);
  return base.map((p, i) => {
    const a = base[(i - 1 + n) % n] as Point;
    const b = base[(i + 1) % n] as Point;
    const tx = b.x - a.x;
    const ty = b.y - a.y;
    const len = Math.hypot(tx, ty) || 1;
    const push = rough * 2.2 * Math.pow(((smooth[i] as number) - lo) / span, 1.5);
    return { x: p.x + (ty / len) * push, y: p.y - (tx / len) * push };
  });
}

function boundsOf(poly: readonly Point[]): Rect {
  return polygonBounds(poly);
}

function hitsAny(r: Rect, avoid: readonly Rect[]): boolean {
  return avoid.some((a) => rectsOverlap(r, a));
}

function polygonHitsAny(poly: readonly Point[], avoid: readonly Rect[]): boolean {
  return avoid.some((a) => rectPolygonRelation(a, poly) !== 'outside');
}

function circleRect(c: Circle): Rect {
  return { x: c.cx - c.r, y: c.cy - c.r, w: 2 * c.r, h: 2 * c.r };
}

/** 依序嘗試，直到產生的形狀不碰到保護區為止；都不行就放棄（回傳 null）。 */
function tryPlace<T>(tries: number, make: () => T, rectOf: (t: T) => Rect, avoid: readonly Rect[]): T | null {
  for (let i = 0; i < tries; i++) {
    const t = make();
    if (!hitsAny(rectOf(t), avoid)) return t;
  }
  return null;
}

/** 依紙邊樣式產生外形。amplitude 為損傷深度（公釐）。 */
function edgeOutline(rng: Rng, base: Polygon, edge: EdgeStyle, amplitude: number, w: number, h: number): Point[] {
  const rectBase = base.length === 4 && boundsOf(base).w === w && boundsOf(base).h === h;
  const box = boundsOf(base);
  switch (edge) {
    case 'none':
      return [...base];
    case 'scissors':
      return rectBase ? cutPolygon({ x: 0.6, y: 0.6, w: w - 1.2, h: h - 1.2 }, 'scissors', Math.floor(rng() * 1e9) + 1) : jaggedPolygon(rng, base, 0.15, 1.6);
    case 'torn':
      return jaggedPolygon(rng, base, Math.max(0.6, amplitude), 0.8);
    case 'burnt':
      return wavyPolygon(rng, base, Math.max(1.5, amplitude), 2.4);
    case 'mouse':
      return mouseBites(rng, rectBase ? rectToPolygon({ x: 0, y: 0, w, h }) : [...base], Math.max(4, amplitude * 1.6));
    case 'half': {
      // 撕掉左半邊或下半邊，保留右側（直排從右邊讀起）
      const vertical = box.w >= box.h * 0.6;
      if (vertical) {
        const top = box.x + box.w * range(rng, 0.35, 0.6);
        const bottom = box.x + box.w * range(rng, 0.35, 0.6);
        const tear = tearLine(rng, { x: top, y: box.y - 2 }, { x: bottom, y: box.y + box.h + 2 }, Math.max(1.5, amplitude));
        return [{ x: top, y: box.y - 2 }, { x: box.x + box.w + 2, y: box.y - 2 }, { x: box.x + box.w + 2, y: box.y + box.h + 2 }, ...tear.reverse()];
      }
      const left = box.y + box.h * range(rng, 0.4, 0.65);
      const right = box.y + box.h * range(rng, 0.4, 0.65);
      const tear = tearLine(rng, { x: box.x - 2, y: left }, { x: box.x + box.w + 2, y: right }, Math.max(1.5, amplitude));
      return [{ x: box.x - 2, y: box.y - 2 }, { x: box.x + box.w + 2, y: box.y - 2 }, ...tear.reverse()];
    }
  }
}

/** 每條邊的向內法向量（多邊形為螢幕座標下的順時針）。 */
function edgeNormals(base: Polygon): Point[] {
  return base.map((a, k) => {
    const b = base[(k + 1) % base.length] as Point;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
  });
}

/** 轉角的點要沿兩條邊的法向量一起往內推，否則會在轉角留下尖角。 */
function offsetPoint(a: Point, b: Point, t: number, n: Point, prev: Point, o: number, i: number): Point {
  const x = a.x + (b.x - a.x) * t + n.x * o;
  const y = a.y + (b.y - a.y) * t + n.y * o;
  return i === 0 ? { x: x + prev.x * o, y: y + prev.y * o } : { x, y };
}

/** 沿多邊形每條邊加上細碎的向內鋸齒（手撕）。 */
function jaggedPolygon(rng: Rng, base: Polygon, amplitude: number, step: number): Point[] {
  const out: Point[] = [];
  const normals = edgeNormals(base);
  for (let k = 0; k < base.length; k++) {
    const a = base[k] as Point;
    const b = base[(k + 1) % base.length] as Point;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.round(len / step));
    const normal = normals[k] as Point;
    const prev = normals[(k + base.length - 1) % base.length] as Point;
    let walk = range(rng, 0, amplitude);
    for (let i = 0; i < n; i++) {
      const t = i / n;
      walk = Math.max(0, Math.min(amplitude * 1.6, walk + gaussianish(rng) * amplitude * 0.45));
      const o = walk + rng() * amplitude * 0.35;
      // 轉角附近只留轉角那一點，避免與相鄰邊交錯出尖角
      if (i > 0 && (t * len < amplitude * 2.2 || (1 - t) * len < amplitude * 2.2)) continue;
      out.push(offsetPoint(a, b, t, normal, prev, o, i));
    }
  }
  return out;
}

/** 火燒：較大的波浪形向內侵蝕。 */
function wavyPolygon(rng: Rng, base: Polygon, amplitude: number, step: number): Point[] {
  const out: Point[] = [];
  const normals = edgeNormals(base);
  for (let k = 0; k < base.length; k++) {
    const a = base[k] as Point;
    const b = base[(k + 1) % base.length] as Point;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.round(len / step));
    const normal = normals[k] as Point;
    const prev = normals[(k + base.length - 1) % base.length] as Point;
    const f1 = range(rng, 1, 3);
    const f2 = range(rng, 4, 9);
    const p1 = range(rng, 0, 6.28);
    const p2 = range(rng, 0, 6.28);
    for (let i = 0; i < n; i++) {
      const t = i / n;
      // 兩端（轉角）燒得深一些
      const corner = 1 + 0.6 * Math.exp(-((t * (1 - t)) * 30));
      const o = amplitude * corner * (0.55 + 0.3 * Math.sin(t * f1 * 6.28 + p1) + 0.15 * Math.sin(t * f2 * 6.28 + p2)) + rng() * 0.4;
      if (i > 0 && (t * len < amplitude * 2.8 || (1 - t) * len < amplitude * 2.8)) continue;
      out.push(offsetPoint(a, b, t, normal, prev, o, i));
    }
  }
  return out;
}

function tearLine(rng: Rng, from: Point, to: Point, amplitude: number): Point[] {
  const len = Math.hypot(to.x - from.x, to.y - from.y);
  const n = Math.max(2, Math.round(len / 0.9));
  const nx = -(to.y - from.y) / len;
  const ny = (to.x - from.x) / len;
  const out: Point[] = [];
  let walk = 0;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    walk = walk * 0.85 + gaussianish(rng) * amplitude * 0.6;
    out.push({ x: from.x + (to.x - from.x) * t + nx * walk, y: from.y + (to.y - from.y) * t + ny * walk });
  }
  return out;
}

/** 老鼠咬：在幾條邊上咬出半圓形缺口，缺口邊緣是細碎的齒痕。 */
function mouseBites(rng: Rng, base: Point[], radius: number): Point[] {
  const bites = int(rng, 2, 4);
  const out: Point[] = [];
  const chosen = new Map<number, number>();
  for (let i = 0; i < bites; i++) chosen.set(int(rng, 0, base.length - 1), range(rng, 0.2, 0.8));
  for (let k = 0; k < base.length; k++) {
    const a = base[k] as Point;
    const b = base[(k + 1) % base.length] as Point;
    out.push(a);
    const t = chosen.get(k);
    if (t === undefined) continue;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    const nx = -uy;
    const ny = ux;
    const r = Math.min(radius * range(rng, 0.6, 1.3), len * 0.25);
    const c = { x: a.x + ux * len * t, y: a.y + uy * len * t };
    const steps = 18;
    for (let s = 0; s <= steps; s++) {
      const ang = Math.PI - (s / steps) * Math.PI;
      const teeth = 1 + (s % 2 === 0 ? 0.08 : -0.05) + range(rng, -0.05, 0.05);
      out.push({
        x: c.x + ux * Math.cos(ang) * r * teeth + nx * Math.sin(ang) * r * teeth,
        y: c.y + uy * Math.cos(ang) * r * teeth + ny * Math.sin(ang) * r * teeth,
      });
    }
  }
  return out;
}

function protectedInside(poly: readonly Point[], protect: readonly Rect[]): boolean {
  return protect.every((r) => rectPolygonRelation(r, poly) === 'inside');
}

const EMPTY_FOLDS = { horizontal: [] as number[], vertical: [] as number[] };

export function planEffects(input: PlanInput): EffectPlan {
  const { width: w, height: h, settings: s } = input;
  const seed = s.effectSeed + (input.variant ?? 0) * 7919;
  const rngOf = (label: string): Rng => rngFor(seed, label);
  const protect = input.protect.map((r) => inflateRect(r, 1.2));
  const page = rectToPolygon({ x: 0, y: 0, w, h });
  const base: Polygon = input.crop && input.crop.length >= 3 ? input.crop : page;
  const edge: EdgeStyle = isEdge(s.edge) ? s.edge : 'none';

  // 1. 紙邊：損傷不得深入保護區。逐次減半深度；仍不行就退回原本的外形。
  let outline: Point[] = [...base];
  if (edge !== 'none') {
    const rng = rngOf(`edge:${edge}`);
    let amplitude = Math.max(0, s.edgeDepth);
    let ok = false;
    for (let attempt = 0; attempt < 6 && !ok; attempt++) {
      const candidate = edgeOutline(rng, base, edge, amplitude, w, h);
      if (protectedInside(candidate, protect)) {
        outline = candidate;
        ok = true;
      } else amplitude *= 0.5;
    }
  }

  const inner = boundsOf(outline);
  const margin = 3;
  const randomPoint = (rng: Rng, pad = margin): Point => ({
    x: range(rng, inner.x + pad, inner.x + inner.w - pad),
    y: range(rng, inner.y + pad, inner.y + inner.h - pad),
  });

  // 2. 破洞
  const holes: EffectPlan['holes'] = [];
  {
    const rng = rngOf('burn-holes');
    const count = Math.max(0, Math.min(8, Math.round(s.burnHoles)));
    for (let i = 0; i < count; i++) {
      const hole = tryPlace(
        30,
        () => {
          const p = randomPoint(rng, 12);
          return blobPolygon(rng, p.x, p.y, range(rng, 2.5, 7), 0.35, 22);
        },
        boundsOf,
        protect,
      );
      if (hole) holes.push({ kind: 'burn', polygon: hole });
    }
  }
  {
    const rng = rngOf('worm');
    const count = Math.max(0, Math.min(40, Math.round(s.wormHoles)));
    for (let i = 0; i < count; i++) {
      const hole = tryPlace(
        20,
        () => {
          const p = randomPoint(rng, 5);
          return blobPolygon(rng, p.x, p.y, range(rng, 0.35, 1.1), 0.5, 10);
        },
        boundsOf,
        protect,
      );
      if (hole) holes.push({ kind: 'worm', polygon: hole });
    }
  }
  if (s.pinHoles) {
    const rng = rngOf('pins');
    const spots = [
      { x: inner.x + 6, y: inner.y + 6 },
      { x: inner.x + inner.w - 6, y: inner.y + 6 },
    ];
    for (const p of spots) {
      const c = { cx: p.x + range(rng, -1.5, 1.5), cy: p.y + range(rng, -1.5, 1.5), r: 0.45 };
      if (!hitsAny(circleRect(c), protect)) holes.push({ kind: 'pin', polygon: blobPolygon(rng, c.cx, c.cy, c.r, 0.2, 10) });
    }
  }

  // 3. 必毀區：在那裡放燒洞、浸水模糊或墨跡
  const smudges: Point[][] = [];
  const blots: Point[][] = [];
  const burnTargets = edge === 'burnt' || s.burnHoles > 0;
  {
    const rng = rngOf('destroy');
    for (const target of input.destroy) {
      if (hitsAny(target, input.protect)) continue;
      // 依目標的形狀（直排時是細長的一行）做成邊緣不規則的團塊；碰到保護區就先收平邊緣、再縮小外擴
      let shape: Point[] | null = null;
      search: for (const rough of [1, 0.5, 0]) {
        for (const pad of [1.2, 0.6, 0.2]) {
          const candidate = ellipseBlob(rng, target, pad, rough);
          if (!polygonHitsAny(candidate, input.protect)) {
            shape = candidate;
            break search;
          }
        }
      }
      if (!shape) continue;
      if (burnTargets) holes.push({ kind: 'burn', polygon: shape });
      else blots.push(shape);
    }
  }

  // 4. 浸水：保護區在水漬範圍內時挖成洞，字保持清楚
  let water: EffectPlan['water'] = null;
  if (s.water === 'corner' || s.water === 'half' || s.water === 'whole') {
    const rng = rngOf(`water:${s.water}`);
    let region: Point[];
    if (s.water === 'whole') region = [...outline];
    else if (s.water === 'corner') {
      const corners = [
        { x: inner.x, y: inner.y },
        { x: inner.x + inner.w, y: inner.y },
        { x: inner.x, y: inner.y + inner.h },
        { x: inner.x + inner.w, y: inner.y + inner.h },
      ];
      const c = pick(rng, corners);
      region = blobPolygon(rng, c.x, c.y, Math.min(inner.w, inner.h) * range(rng, 0.38, 0.55), 0.3, 36);
    } else {
      const side = pick(rng, ['left', 'right', 'bottom'] as const);
      const r = Math.max(inner.w, inner.h);
      const cx = side === 'left' ? inner.x : side === 'right' ? inner.x + inner.w : inner.x + inner.w / 2;
      const cy = side === 'bottom' ? inner.y + inner.h : inner.y + inner.h / 2;
      region = blobPolygon(rng, cx, cy, (side === 'bottom' ? inner.h : inner.w) * range(rng, 0.5, 0.62), 0.25, 44).map((p) => ({
        x: side === 'bottom' ? cx + (p.x - cx) * (r / inner.h) : p.x,
        y: side === 'bottom' ? p.y : cy + (p.y - cy) * (r / inner.w),
      }));
    }
    const holesInWater = input.protect.filter((r) => rectPolygonRelation(inflateRect(r, 1.2), region) !== 'outside').map((r) => rectToPolygon(inflateRect(r, 1.5)));
    // 乾掉後的潮線：從水漬邊往裡幾圈，帶起伏
    const edgePts = resample(region, 2.5);
    const normals = paperNormals(edgePts, false);
    const tides = [1.6, 3.8, 6.8].map((depth) => {
      const wave = waviness(rng, edgePts.length);
      return edgePts.map((p, i) => {
        const n = normals[i] as Point;
        const k = Math.max(0.2, 1 + wave(i) * 0.6);
        return { x: p.x + n.x * depth * k, y: p.y + n.y * depth * k };
      });
    });
    // 起皺的紋路：水漬範圍內的短波浪線，避開保護區
    const wrinkles: Point[][] = [];
    const box = polygonBounds(region);
    for (let tries = 0; tries < 200 && wrinkles.length < 8 + Math.round(s.waterStrength / 8); tries++) {
      const start = { x: range(rng, box.x, box.x + box.w), y: range(rng, box.y, box.y + box.h) };
      if (!pointInPolygon(start, region) || !pointInPolygon(start, outline)) continue;
      const a = range(rng, 0, Math.PI * 2);
      const len = range(rng, 6, 22);
      const line: Point[] = [];
      for (let k = 0; k <= 10; k++) {
        const d = (len * k) / 10;
        line.push({ x: start.x + Math.cos(a) * d - Math.sin(a) * Math.sin(k * 0.9) * 0.6, y: start.y + Math.sin(a) * d + Math.cos(a) * Math.sin(k * 0.9) * 0.6 });
      }
      if (polygonHitsAny(line, input.protect)) continue;
      wrinkles.push(line);
    }
    water = {
      polygons: [region, ...holesInWater],
      strength: Math.max(0, Math.min(100, s.waterStrength)),
      tides,
      wrinkles,
      tint: s.waterTint === 'blue' ? 'blue' : 'brown',
    };
  }
  if (s.smudge) {
    const rng = rngOf('smudge');
    const blob = tryPlace(
      30,
      () => {
        const p = randomPoint(rng, 10);
        return blobPolygon(rng, p.x, p.y, range(rng, 5, 10), 0.4, 24).map((q) => ({ x: p.x + (q.x - p.x) * 1.8, y: q.y }));
      },
      boundsOf,
      protect,
    );
    if (blob) smudges.push(blob);
  }

  // 5. 污漬、斑點、霉斑
  const stains: Ellipse[] = [];
  const rings: EffectPlan['rings'] = [];
  if (s.stains) {
    const rng = rngOf('stains');
    const scale = Math.min(inner.w, inner.h);
    for (let i = 0; i < int(rng, 2, 3); i++) {
      const e = tryPlace(
        25,
        () => {
          const p = randomPoint(rng, 6);
          const rx = scale * range(rng, 0.05, 0.12);
          return { cx: p.x, cy: p.y, rx, ry: rx * range(rng, 0.6, 1.1), rotate: range(rng, 0, 180) };
        },
        (e) => ({ x: e.cx - e.rx, y: e.cy - e.rx, w: e.rx * 2, h: e.rx * 2 }),
        protect,
      );
      if (e) stains.push(e);
    }
    const ring = tryPlace(
      25,
      () => {
        const p = randomPoint(rng, 10);
        return { cx: p.x, cy: p.y, r: scale * range(rng, 0.07, 0.11), arc: range(rng, 0.55, 0.95), rotate: range(rng, 0, 360) };
      },
      (c) => circleRect(c),
      protect,
    );
    if (ring) rings.push(ring);
  }
  const spots: Circle[] = [];
  {
    const rng = rngOf('spots');
    const count = Math.round((Math.max(0, Math.min(100, s.spots)) / 100) * 60);
    for (let i = 0; i < count; i++) {
      const c = tryPlace(
        10,
        () => {
          const p = randomPoint(rng, 2);
          return { cx: p.x, cy: p.y, r: range(rng, 0.3, 2.2) * (rng() < 0.15 ? 2 : 1) };
        },
        circleRect,
        protect,
      );
      if (c) spots.push(c);
    }
  }
  const mold: EffectPlan['mold'] = [];
  {
    const rng = rngOf('mold');
    const clusters = Math.round((Math.max(0, Math.min(100, s.mold)) / 100) * 7);
    for (let i = 0; i < clusters; i++) {
      const c = tryPlace(
        20,
        () => {
          const p = randomPoint(rng, 4);
          return { cx: p.x, cy: p.y, r: range(rng, 4, 14) };
        },
        circleRect,
        protect,
      );
      if (!c) continue;
      const dots: Circle[] = [];
      for (let d = 0; d < Math.round(c.r * 4); d++) {
        const a = range(rng, 0, Math.PI * 2);
        const dist = Math.abs(gaussianish(rng)) * c.r;
        dots.push({ cx: c.cx + Math.cos(a) * dist, cy: c.cy + Math.sin(a) * dist, r: range(rng, 0.15, 0.7) });
      }
      mold.push({ ...c, dots });
    }
  }

  // 6. 揉皺：數條橫越紙面的折線
  const creases: Point[][] = [];
  {
    const rng = rngOf('crumple');
    const count = Math.round((Math.max(0, Math.min(100, s.crumple)) / 100) * 22);
    for (let i = 0; i < count; i++) {
      const a = { x: range(rng, -0.1, 1.1) * w, y: range(rng, -0.1, 1.1) * h };
      const angle = range(rng, 0, Math.PI);
      const len = range(rng, 0.3, 0.9) * Math.max(w, h);
      const pts: Point[] = [];
      const segs = int(rng, 3, 6);
      let x = a.x;
      let y = a.y;
      let ang = angle;
      for (let k = 0; k <= segs; k++) {
        pts.push({ x, y });
        ang += range(rng, -0.35, 0.35);
        x += Math.cos(ang) * (len / segs);
        y += Math.sin(ang) * (len / segs);
      }
      creases.push(pts);
    }
  }

  // 7. 摺痕
  let folds = EMPTY_FOLDS;
  if (s.folds) {
    folds =
      s.foldStyle === 'quarter'
        ? { horizontal: [0.5], vertical: [0.5] }
        : s.foldStyle === 'thirds'
          ? { horizontal: [1 / 3, 2 / 3], vertical: [] }
          : w > h
            ? { horizontal: [], vertical: [0.5] }
            : { horizontal: [0.5], vertical: [] };
  }

  // 8. 鏽痕、膠帶、滴蠟、鉛筆殘字、日曬
  let rust: Box | null = null;
  if (s.rust) {
    const rng = rngOf('rust');
    rust = tryPlace(
      20,
      () => ({ x: range(rng, inner.x + 8, inner.x + inner.w - 20), y: inner.y - 3, w: 9, h: range(rng, 24, 30), rotate: range(rng, -6, 6) }),
      (b) => b,
      protect,
    );
  }
  const tape: Box[] = [];
  if (s.tape) {
    const rng = rngOf('tape');
    const corners = [
      { x: inner.x - 4, y: inner.y + 2, rotate: -38 },
      { x: inner.x + inner.w - 26, y: inner.y + 2, rotate: 38 },
      { x: inner.x - 4, y: inner.y + inner.h - 14, rotate: 38 },
      { x: inner.x + inner.w - 26, y: inner.y + inner.h - 14, rotate: -38 },
    ];
    for (const c of corners) {
      if (rng() < 0.45) continue;
      const box = { x: c.x, y: c.y, w: 30, h: 11, rotate: c.rotate + range(rng, -6, 6) };
      if (!hitsAny(box, protect)) tape.push(box);
    }
  }
  const wax: EffectPlan['wax'] = [];
  if (s.wax) {
    const rng = rngOf('wax');
    for (let i = 0; i < int(rng, 2, 4); i++) {
      const placed = tryPlace(
        20,
        () => {
          const p = randomPoint(rng, 8);
          const r = range(rng, 1.2, 4);
          const blob = blobPolygon(rng, p.x, p.y, r, 0.2, 18);
          const dripLen = range(rng, 2, 9);
          const drip = [
            { x: p.x - r * 0.35, y: p.y },
            { x: p.x + r * 0.35, y: p.y },
            { x: p.x + r * 0.2, y: p.y + r + dripLen },
            { x: p.x - r * 0.2, y: p.y + r + dripLen },
          ];
          return { blob, drip };
        },
        (x) => boundsOf([...x.blob, ...x.drip]),
        protect,
      );
      if (placed) wax.push(placed);
    }
  }
  let pencil: EffectPlan['pencil'] = null;
  if (s.pencilGhost.trim()) {
    const rng = rngOf('pencil');
    const n = Array.from(s.pencilGhost).length;
    pencil = tryPlace(
      30,
      () => {
        const p = randomPoint(rng, 10);
        return { x: p.x, y: p.y, w: 6, h: Math.min(inner.h * 0.8, n * 5.5), rotate: range(rng, -8, 8), text: s.pencilGhost };
      },
      (b) => b,
      protect,
    );
  }
  let sun: EffectPlan['sun'] = null;
  if (s.sunFade > 0) {
    sun = { side: pick(rngOf('sun'), ['left', 'right', 'top', 'bottom'] as const), amount: Math.min(100, s.sunFade) };
  }

  // 火燒的焦痕：紙邊由外往內、燒洞由洞往外，都避開保護區
  const charRng = rngOf('char');
  const char = {
    edge: edge === 'burnt' ? charMarks(charRng, outline, false, Math.max(0.6, Math.min(1.4, s.edgeDepth / 6)), protect) : null,
    holes: holes.filter((x) => x.kind === 'burn').map((x) => charMarks(charRng, x.polygon, true, 0.7, protect)),
  };
  return { width: w, height: h, outline, edge, holes, char, water, smudges, blots, stains, rings, spots, mold, creases, folds, rust, tape, wax, pencil, sun };
}

/** 測試用：所有「會遮住字」的效果的外框。 */
export function obscuringShapes(plan: EffectPlan): Rect[] {
  const rects: Rect[] = [];
  for (const hole of plan.holes) rects.push(boundsOf(hole.polygon));
  for (const s of plan.smudges) rects.push(boundsOf(s));
  for (const s of plan.blots) rects.push(boundsOf(s));
  for (const e of plan.stains) rects.push({ x: e.cx - e.rx, y: e.cy - e.rx, w: 2 * e.rx, h: 2 * e.rx });
  for (const r of plan.rings) rects.push({ x: r.cx - r.r, y: r.cy - r.r, w: 2 * r.r, h: 2 * r.r });
  for (const c of plan.spots) rects.push({ x: c.cx - c.r, y: c.cy - c.r, w: 2 * c.r, h: 2 * c.r });
  for (const m of plan.mold) rects.push({ x: m.cx - m.r, y: m.cy - m.r, w: 2 * m.r, h: 2 * m.r });
  if (plan.rust) rects.push(plan.rust);
  for (const t of plan.tape) rects.push(t);
  for (const x of plan.wax) rects.push(boundsOf([...x.blob, ...x.drip]));
  if (plan.pencil) rects.push(plan.pencil);
  return rects;
}

export { polygonHitsAny };
