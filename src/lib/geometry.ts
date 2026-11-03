// 平面幾何小工具：矩形、多邊形、剪線判斷。單位不限（本專案多用公釐）。

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export type Polygon = readonly Point[];

export function rect(x: number, y: number, w: number, h: number): Rect {
  return { x, y, w, h };
}

export function rectRight(r: Rect): number {
  return r.x + r.w;
}

export function rectBottom(r: Rect): number {
  return r.y + r.h;
}

/** 兩個矩形是否有重疊（只有邊相接不算）。 */
export function rectsOverlap(a: Rect, b: Rect, epsilon = 1e-9): boolean {
  return a.x < b.x + b.w - epsilon && b.x < a.x + a.w - epsilon && a.y < b.y + b.h - epsilon && b.y < a.y + a.h - epsilon;
}

export function rectContainsRect(outer: Rect, inner: Rect, epsilon = 1e-9): boolean {
  return (
    inner.x >= outer.x - epsilon &&
    inner.y >= outer.y - epsilon &&
    inner.x + inner.w <= outer.x + outer.w + epsilon &&
    inner.y + inner.h <= outer.y + outer.h + epsilon
  );
}

export function rectContainsPoint(r: Rect, p: Point): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

export function inflateRect(r: Rect, d: number): Rect {
  return { x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d };
}

export function unionRects(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function intersectRects(a: Rect, b: Rect): Rect | null {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

export function rectToPolygon(r: Rect): Point[] {
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ];
}

export function polygonBounds(poly: Polygon): Rect {
  const b = unionRects(poly.map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 })));
  return b ?? { x: 0, y: 0, w: 0, h: 0 };
}

/** 多邊形面積（取絕對值）。 */
export function polygonArea(poly: Polygon): number {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i] as Point;
    const b = poly[(i + 1) % poly.length] as Point;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/** 射線法判斷點是否在多邊形內（邊上的點視為在內）。 */
export function pointInPolygon(p: Point, poly: Polygon): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i] as Point;
    const b = poly[j] as Point;
    if (onSegment(p, a, b)) return true;
    const crosses = a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function onSegment(p: Point, a: Point, b: Point, epsilon = 1e-9): boolean {
  return (
    Math.abs(cross(a, b, p)) <= epsilon * Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)) &&
    p.x >= Math.min(a.x, b.x) - epsilon &&
    p.x <= Math.max(a.x, b.x) + epsilon &&
    p.y >= Math.min(a.y, b.y) - epsilon &&
    p.y <= Math.max(a.y, b.y) + epsilon
  );
}

/** 兩線段是否相交（含端點相接）。 */
export function segmentsIntersect(p1: Point, p2: Point, q1: Point, q2: Point): boolean {
  const d1 = cross(q1, q2, p1);
  const d2 = cross(q1, q2, p2);
  const d3 = cross(p1, p2, q1);
  const d4 = cross(p1, p2, q2);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return onSegment(p1, q1, q2) || onSegment(p2, q1, q2) || onSegment(q1, p1, p2) || onSegment(q2, p1, p2);
}

export type Relation = 'inside' | 'outside' | 'cut';

/**
 * 矩形（例如一個字、一行或一則新聞）與剪線多邊形的關係：
 * 完全在剪線內（inside）、完全在外（outside）、或被剪線切過（cut）。
 */
export function rectPolygonRelation(r: Rect, poly: Polygon): Relation {
  const corners = rectToPolygon(r);
  const inCount = corners.filter((c) => pointInPolygon(c, poly)).length;
  let edgeCrosses = false;
  for (let i = 0; i < poly.length && !edgeCrosses; i++) {
    const a = poly[i] as Point;
    const b = poly[(i + 1) % poly.length] as Point;
    // 剪線的頂點落在矩形內部，或剪線線段穿過矩形的邊。
    if (strictlyInsideRect(a, r)) edgeCrosses = true;
    for (let k = 0; k < 4 && !edgeCrosses; k++) {
      const c = corners[k] as Point;
      const d = corners[(k + 1) % 4] as Point;
      if (properIntersect(a, b, c, d)) edgeCrosses = true;
    }
  }
  if (inCount === 4 && !edgeCrosses) return 'inside';
  if (inCount === 0 && !edgeCrosses) return 'outside';
  return 'cut';
}

function strictlyInsideRect(p: Point, r: Rect): boolean {
  return p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;
}

function properIntersect(p1: Point, p2: Point, q1: Point, q2: Point): boolean {
  const d1 = cross(q1, q2, p1);
  const d2 = cross(q1, q2, p2);
  const d3 = cross(p1, p2, q1);
  const d4 = cross(p1, p2, q2);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** 把多邊形轉成 SVG／CSS path 字串（座標乘上 scale，例如公釐轉 CSS px）。 */
export function polygonToPath(poly: Polygon, scale = 1): string {
  if (poly.length === 0) return '';
  const f = (n: number): string => (Math.round(n * scale * 100) / 100).toString();
  return `M${poly.map((p) => `${f(p.x)} ${f(p.y)}`).join('L')}Z`;
}

/** 公釐轉 CSS px（96 dpi）。 */
export const PX_PER_MM = 96 / 25.4;
