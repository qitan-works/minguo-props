// 裝飾的形狀（純邏輯）：血跡、杯印、墨漬、指紋、火漆、紅筆圈注、鉛筆眉批、公文戳記、
// 抓痕、黏液、怪符號、反覆描寫的字。全部由種子以程式產生（怪符號也是隨機組合的原創圖形），
// 座標以裝飾中心為原點、單位公釐；畫面上再依位置、旋轉、縮放、透明度擺放。

import type { DecorationType } from '../props/extras.ts';
import { blobPolygon } from './effects.ts';
import type { Point } from './geometry.ts';
import { gaussianish, int, pick, range, rngFor, type Rng } from './random.ts';

export type Primitive =
  | { readonly kind: 'path'; readonly d: string; readonly fill: string; readonly stroke?: string; readonly width?: number; readonly dash?: string; readonly cap?: 'round' }
  | { readonly kind: 'text'; readonly x: number; readonly y: number; readonly text: string; readonly size: number; readonly fill: string; readonly vertical?: boolean; readonly weight?: number; readonly font?: 'title' | 'hand' };

export interface DecorationShape {
  readonly primitives: Primitive[];
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

const BLOOD = 'rgb(105 10 8 / 0.88)';
const BLOOD_OLD = 'rgb(90 25 15 / 0.75)';
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

function splatter(rng: Rng, color: string): Primitive[] {
  const out: Primitive[] = [{ kind: 'path', d: poly(blobPolygon(rng, 0, 0, range(rng, 3.5, 6), 0.45, 26)), fill: color }];
  for (let i = 0; i < int(rng, 14, 26); i++) {
    const a = range(rng, 0, Math.PI * 2);
    const dist = range(rng, 5, 17);
    const r = range(rng, 0.25, 1.4) * (1 - dist / 25);
    const cx = Math.cos(a) * dist;
    const cy = Math.sin(a) * dist;
    out.push({ kind: 'path', d: circle(cx, cy, r), fill: color });
    if (rng() < 0.35) {
      // 拉長的濺痕
      const len = range(rng, 1.5, 4);
      out.push({ kind: 'path', d: `M${(cx * 0.82).toFixed(2)} ${(cy * 0.82).toFixed(2)}L${(cx + Math.cos(a) * len).toFixed(2)} ${(cy + Math.sin(a) * len).toFixed(2)}`, fill: 'none', stroke: color, width: r * 0.9, cap: 'round' });
    }
  }
  return out;
}

function drips(rng: Rng): Primitive[] {
  const out: Primitive[] = [];
  for (let i = 0; i < int(rng, 2, 4); i++) {
    const x = range(rng, -8, 8);
    const w = range(rng, 0.8, 2);
    const len = range(rng, 6, 20);
    out.push({ kind: 'path', d: `M${x.toFixed(2)} -10L${x.toFixed(2)} ${(-10 + len).toFixed(2)}`, fill: 'none', stroke: BLOOD, width: w, cap: 'round' });
    out.push({ kind: 'path', d: circle(x, -10 + len + w * 0.4, w * 0.9), fill: BLOOD });
  }
  out.push({ kind: 'path', d: poly(blobPolygon(rng, 0, -11, 9, 0.3, 24).map((p) => ({ x: p.x, y: -11 + (p.y + 11) * 0.35 }))), fill: BLOOD });
  return out;
}

function smear(rng: Rng): Primitive[] {
  const out: Primitive[] = [];
  const pts: Point[] = [];
  for (let i = 0; i <= 8; i++) pts.push({ x: -20 + i * 5, y: Math.sin(i * 0.6 + range(rng, 0, 1)) * 2 });
  out.push({ kind: 'path', d: wobbly(rng, pts, 0.3), fill: 'none', stroke: BLOOD_OLD, width: 7, cap: 'round' });
  for (let k = 0; k < 6; k++) {
    const off = range(rng, -3, 3);
    out.push({ kind: 'path', d: wobbly(rng, pts.map((p) => ({ x: p.x, y: p.y + off })), 0.15), fill: 'none', stroke: BLOOD, width: range(rng, 0.2, 0.7), cap: 'round' });
  }
  return out;
}

function handprint(rng: Rng): Primitive[] {
  const out: Primitive[] = [{ kind: 'path', d: poly(blobPolygon(rng, 0, 4, 9, 0.25, 26).map((p) => ({ x: p.x, y: 4 + (p.y - 4) * 1.1 }))), fill: BLOOD_OLD }];
  const fingers = [
    { a: -2.3, len: 9 },
    { a: -1.85, len: 12 },
    { a: -1.55, len: 13 },
    { a: -1.25, len: 12 },
    { a: -0.95, len: 9.5 },
  ];
  fingers.forEach((f, i) => {
    if (i > 0 && rng() < 0.12) return; // 有時沒印到
    const base = i === 0 ? { x: -8, y: 3 } : { x: -6 + i * 3, y: -4 };
    const end = { x: base.x + Math.cos(f.a) * f.len, y: base.y + Math.sin(f.a) * f.len };
    out.push({ kind: 'path', d: wobbly(rng, [base, end], 0.2), fill: 'none', stroke: BLOOD_OLD, width: range(rng, 2.6, 3.3), cap: 'round' });
  });
  return out;
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

function claw(rng: Rng): Primitive[] {
  const out: Primitive[] = [];
  const count = int(rng, 3, 4);
  for (let i = 0; i < count; i++) {
    const x = (i - (count - 1) / 2) * range(rng, 4.5, 6);
    const pts: Point[] = [];
    for (let k = 0; k <= 10; k++) pts.push({ x: x + Math.sin(k * 0.5) * 1.2 + k * 0.6, y: -16 + k * 3.2 });
    const d = wobbly(rng, pts, 0.25);
    out.push({ kind: 'path', d, fill: 'none', stroke: 'rgb(60 20 10 / 0.75)', width: range(rng, 1.4, 2.2), cap: 'round' });
    out.push({ kind: 'path', d, fill: 'none', stroke: 'rgb(250 245 235 / 0.9)', width: 0.45, cap: 'round' });
  }
  return out;
}

function slime(rng: Rng): Primitive[] {
  const out: Primitive[] = [{ kind: 'path', d: poly(blobPolygon(rng, 0, 0, 11, 0.5, 30)), fill: 'rgb(80 120 55 / 0.42)', stroke: 'rgb(50 80 35 / 0.5)', width: 0.4 }];
  for (let i = 0; i < int(rng, 2, 4); i++) {
    const x = range(rng, -8, 8);
    const len = range(rng, 5, 14);
    out.push({ kind: 'path', d: `M${x.toFixed(2)} 6L${x.toFixed(2)} ${(6 + len).toFixed(2)}`, fill: 'none', stroke: 'rgb(80 120 55 / 0.45)', width: range(rng, 1, 2.2), cap: 'round' });
  }
  out.push({ kind: 'path', d: ellipse(-3.5, -4, 4, 1.6), fill: 'rgb(230 255 210 / 0.35)' });
  out.push({ kind: 'path', d: poly(blobPolygon(rng, 3, 2, 3, 0.4, 14)), fill: 'rgb(120 60 140 / 0.25)' });
  return out;
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

export function decorationShape(type: DecorationType, seed: number, text: string): DecorationShape {
  const rng = rngFor(seed, `deco:${type}`);
  const t = text || DEFAULT_TEXT[type] || '';
  switch (type) {
    case 'blood-splatter':
      return { primitives: splatter(rng, BLOOD), radius: 20 };
    case 'blood-drip':
      return { primitives: drips(rng), radius: 22 };
    case 'blood-smear':
      return { primitives: smear(rng), radius: 24 };
    case 'handprint':
      return { primitives: handprint(rng), radius: 20 };
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
    case 'ink-blot':
      return { primitives: splatter(rng, 'rgb(20 18 22 / 0.88)').slice(0, 14), radius: 20 };
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
    case 'slime':
      return { primitives: slime(rng), radius: 22 };
    case 'sigil':
      return { primitives: sigil(rng), radius: 24 };
    case 'pressed-text':
      return { primitives: pressedText(rng, t), radius: 11 };
  }
}
