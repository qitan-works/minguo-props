// 剪線幾何（純邏輯）：把一個矩形框變成剪刀直剪、手撕、剪歪等形狀的多邊形，
// 並判斷每個文字矩形是在剪線內、外，還是被剪線切過。

import { pointInPolygon, polygonBounds, rectPolygonRelation, type Point, type Polygon, type Rect, type Relation } from './geometry.ts';
import { gaussianish, range, rngFor, type Rng } from './random.ts';

export type CutStyle = 'straight' | 'scissors' | 'torn' | 'skew';

export const CUT_STYLES: readonly { value: CutStyle; label: string }[] = [
  { value: 'scissors', label: '剪刀直剪（略歪、細微鋸齒）' },
  { value: 'torn', label: '手撕' },
  { value: 'skew', label: '剪歪' },
  { value: 'straight', label: '筆直' },
];

export function isCutStyle(value: string): value is CutStyle {
  return CUT_STYLES.some((s) => s.value === value);
}

function rotate(p: Point, c: Point, angle: number): Point {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

/** 沿一條邊取點；offset(t) 回傳垂直於邊、向內為正的位移。 */
function edgePoints(a: Point, b: Point, step: number, offset: (t: number, i: number) => number): Point[] {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const n = Math.max(1, Math.round(len / step));
  // 邊的方向與向內法向量（多邊形為順時針：上→右→下→左，螢幕座標 y 向下）
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  const nx = -uy;
  const ny = ux;
  const pts: Point[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const o = offset(t, i);
    pts.push({ x: a.x + ux * len * t + nx * o, y: a.y + uy * len * t + ny * o });
  }
  return pts;
}

/** 手撕：多層雜訊疊加的不規則邊，振幅以公釐計。 */
function tornOffset(rng: Rng, amplitude: number): (t: number, i: number) => number {
  const phases = [range(rng, 0, 6.28), range(rng, 0, 6.28), range(rng, 0, 6.28)];
  const freqs = [range(rng, 1.5, 3), range(rng, 5, 9), range(rng, 13, 21)];
  return (t) => {
    const smooth =
      Math.sin(t * freqs[0]! * 6.28 + phases[0]!) * 0.45 +
      Math.sin(t * freqs[1]! * 6.28 + phases[1]!) * 0.3 +
      Math.sin(t * freqs[2]! * 6.28 + phases[2]!) * 0.15;
    return amplitude * (0.55 + 0.45 * smooth + 0.35 * gaussianish(rng));
  };
}

/**
 * 產生剪線多邊形（順時針，紙面座標）。
 * frame 為要保留的範圍；剪線大致沿著框，向內或向外偏移不超過約 2 mm（剪歪則整體旋轉）。
 */
export function cutPolygon(frame: Rect, style: CutStyle, seed: number): Point[] {
  const rng = rngFor(seed, `cut:${style}`);
  const tl = { x: frame.x, y: frame.y };
  const tr = { x: frame.x + frame.w, y: frame.y };
  const br = { x: frame.x + frame.w, y: frame.y + frame.h };
  const bl = { x: frame.x, y: frame.y + frame.h };
  const center = { x: frame.x + frame.w / 2, y: frame.y + frame.h / 2 };
  const corners = [tl, tr, br, bl];

  switch (style) {
    case 'straight':
      return corners;
    case 'scissors': {
      // 每一刀略歪（±0.5°），刀口有細微鋸齒（0.1 mm 等級）。
      const out: Point[] = [];
      for (let k = 0; k < 4; k++) {
        const a = corners[k] as Point;
        const b = corners[(k + 1) % 4] as Point;
        const tilt = range(rng, -0.6, 0.6);
        const drift = range(rng, -0.8, 0.8);
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        out.push(
          ...edgePoints(a, b, 1.6, (t) => drift + Math.tan((tilt * Math.PI) / 180) * len * (t - 0.5) + range(rng, -0.12, 0.12)),
        );
      }
      return out;
    }
    case 'torn': {
      const out: Point[] = [];
      for (let k = 0; k < 4; k++) {
        const a = corners[k] as Point;
        const b = corners[(k + 1) % 4] as Point;
        out.push(...edgePoints(a, b, 0.8, tornOffset(rng, 1.4)));
      }
      return out;
    }
    case 'skew': {
      const angle = ((rng() < 0.5 ? -1 : 1) * range(rng, 1.5, 3.5) * Math.PI) / 180;
      const out: Point[] = [];
      for (let k = 0; k < 4; k++) {
        const a = rotate(corners[k] as Point, center, angle);
        const b = rotate(corners[(k + 1) % 4] as Point, center, angle);
        out.push(...edgePoints(a, b, 2, () => range(rng, -0.1, 0.1)));
      }
      return out;
    }
  }
}

export interface Classified<T> {
  readonly item: T;
  readonly relation: Relation;
}

/** 依剪線把矩形分成：框內、框外、被剪到。 */
export function classifyRects<T extends { readonly rect: Rect }>(items: readonly T[], polygon: Polygon): Classified<T>[] {
  return items.map((item) => ({ item, relation: rectPolygonRelation(item.rect, polygon) }));
}

/** 剪線的外框（用來把剪下的紙片置中）。 */
export function cutBounds(polygon: Polygon): Rect {
  return polygonBounds(polygon);
}

export { pointInPolygon };
