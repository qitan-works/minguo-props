// 第四版：報紙裡的線條插圖、花邊與空心字（全部 SVG 程式產生，沒有圖片素材，圖樣原創）。
// - 插圖：藥瓶、藥盒、帽子、懷錶、輪船、時鐘，畫在 100×100 的座標裡，依框的大小縮放；
// - 花邊：回紋、雲紋、圓點、菱形、波紋，沿框線重複的紋樣帶；
// - 空心字：SVG 的 text 只描邊不填色。不用 -webkit-text-stroke，那會讓 PDF 把字轉成外框而膨脹。

import type { Rect } from '../lib/geometry.ts';
import type { Pattern, PictureKind } from '../lib/newspaper/blockstyle.ts';
import { s } from '../ui/dom.ts';

const mm = (n: number): string => `${n.toFixed(3)}mm`;

function path(d: string, width = 1.6, extra: Record<string, string> = {}): SVGElement {
  return s('path', { attrs: { d, fill: 'none', stroke: 'currentColor', 'stroke-width': String(width), 'stroke-linecap': 'round', 'stroke-linejoin': 'round', ...extra } });
}

/** 平行的斜線陰影：在 x0..x1、y0..y1 的範圍裡、clip 到給定的形狀。 */
function hatch(id: string, clipD: string, x0: number, x1: number, y0: number, y1: number, gap = 3.2): SVGElement[] {
  const lines: string[] = [];
  for (let x = x0 - (y1 - y0); x < x1; x += gap) lines.push(`M${x.toFixed(1)} ${y1}L${(x + (y1 - y0)).toFixed(1)} ${y0}`);
  return [
    s('clipPath', { attrs: { id } }, s('path', { attrs: { d: clipD } })),
    s('path', { attrs: { d: lines.join(''), fill: 'none', stroke: 'currentColor', 'stroke-width': '0.7', 'clip-path': `url(#${id})` } }),
  ];
}

function pictureParts(kind: PictureKind, id: string): SVGElement[] {
  switch (kind) {
    case 'bottle': {
      const body = 'M34 38Q34 32 40 30L40 20L60 20L60 30Q66 32 66 38L66 88Q66 92 62 92L38 92Q34 92 34 88Z';
      return [
        path(body, 2.2),
        path('M38 14L62 14L62 20L38 20Z', 1.8),
        path('M38 48L62 48L62 76L38 76Z', 1.4),
        path('M42 54L58 54M42 60L58 60M44 66L56 66M46 71L54 71', 1),
        ...hatch(`${id}-h`, 'M58 31L66 38L66 88L58 92Z', 56, 68, 30, 92),
        path('M44 24L44 28', 1.2),
      ];
    }
    case 'box': {
      return [
        path('M22 38L52 26L80 36L50 48Z', 2),
        path('M22 38L22 74L50 86L50 48', 2),
        path('M50 86L80 74L80 36', 2),
        path('M28 46L44 52L44 72L28 66Z', 1.3),
        path('M31 54L41 58M31 60L41 64', 1),
        path('M36 35L60 32', 1),
        ...hatch(`${id}-h`, 'M50 48L80 36L80 74L50 86Z', 48, 82, 30, 90),
      ];
    }
    case 'hat': {
      return [
        path('M10 66Q50 84 90 66Q84 58 70 58L30 58Q16 58 10 66Z', 2),
        path('M30 58L32 34Q34 24 50 24Q66 24 68 34L70 58', 2),
        path('M42 25Q50 31 58 25', 1.4),
        path('M31 50L69 50L69 57L31 57Z', 1.6),
        ...hatch(`${id}-h`, 'M31 50L69 50L69 57L31 57Z', 30, 70, 49, 58, 2.2),
        path('M18 66Q50 78 82 66', 1),
      ];
    }
    case 'watch': {
      const ticks: string[] = [];
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const r1 = i % 3 === 0 ? 22 : 25;
        ticks.push(`M${(50 + Math.sin(a) * r1).toFixed(1)} ${(58 - Math.cos(a) * r1).toFixed(1)}L${(50 + Math.sin(a) * 28).toFixed(1)} ${(58 - Math.cos(a) * 28).toFixed(1)}`);
      }
      return [
        s('circle', { attrs: { cx: 50, cy: 58, r: 34, fill: 'none', stroke: 'currentColor', 'stroke-width': '2.4' } }),
        s('circle', { attrs: { cx: 50, cy: 58, r: 30, fill: 'none', stroke: 'currentColor', 'stroke-width': '1' } }),
        path(ticks.join(''), 1.3),
        path('M50 58L50 38M50 58L63 66', 2),
        s('circle', { attrs: { cx: 50, cy: 58, r: 1.8, fill: 'currentColor' } }),
        path('M45 24L55 24L55 17L45 17Z', 1.6),
        path('M50 17Q50 8 58 7Q70 6 76 14Q80 20 86 18', 1.2, { 'stroke-dasharray': '2.2 1.4' }),
      ];
    }
    case 'ship': {
      return [
        path('M8 64L92 64L82 80L18 80Z', 2.2),
        path('M24 64L24 52L74 52L74 64', 1.8),
        path('M30 52L30 44L62 44L62 52', 1.6),
        path('M40 44L40 26L50 26L50 44', 1.8),
        path('M40 31L50 31', 1.2),
        path('M46 26Q42 18 50 14Q58 10 54 4', 1.4),
        path('M30 58L32 58M38 58L40 58M46 58L48 58M54 58L56 58M62 58L64 58', 2),
        path('M70 52L70 36L84 52', 1.2),
        path('M4 86Q12 82 20 86T36 86T52 86T68 86T84 86T100 86', 1.3),
        path('M10 92Q18 88 26 92T42 92T58 92T74 92T90 92', 1),
        ...hatch(`${id}-h`, 'M8 64L92 64L82 80L18 80Z', 6, 94, 64, 80, 3),
      ];
    }
    case 'clock': {
      const ticks: string[] = [];
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        ticks.push(`M${(50 + Math.sin(a) * 15).toFixed(1)} ${(36 - Math.cos(a) * 15).toFixed(1)}L${(50 + Math.sin(a) * 18).toFixed(1)} ${(36 - Math.cos(a) * 18).toFixed(1)}`);
      }
      return [
        path('M26 92L26 30Q26 8 50 8Q74 8 74 30L74 92Z', 2.2),
        s('circle', { attrs: { cx: 50, cy: 36, r: 20, fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6' } }),
        path(ticks.join(''), 1.2),
        path('M50 36L50 23M50 36L59 41', 1.8),
        path('M34 62L66 62L66 86L34 86Z', 1.4),
        path('M50 62L50 78', 1.2),
        s('circle', { attrs: { cx: 50, cy: 80, r: 4, fill: 'none', stroke: 'currentColor', 'stroke-width': '1.4' } }),
        path('M22 92L78 92L80 96L20 96Z', 1.8),
        ...hatch(`${id}-h`, 'M66 14Q74 20 74 30L74 92L66 92Z', 64, 76, 10, 94),
      ];
    }
  }
}

let uid = 0;

/** 一張線條插圖，等比縮放後置中在 r 裡（紙面座標，公釐）。 */
export function pictureSvg(kind: PictureKind, r: Rect): SVGSVGElement {
  const id = `pic${++uid}`;
  return s(
    'svg',
    {
      class: 'nf-picture',
      attrs: { viewBox: '0 0 100 100', preserveAspectRatio: 'xMidYMid meet', 'aria-hidden': 'true', 'data-picture': kind },
      style: { left: mm(r.x), top: mm(r.y), width: mm(r.w), height: mm(r.h) },
    },
    ...pictureParts(kind, id),
  );
}

/** 花邊紋樣的一格（邊長 1，之後縮放）。 */
function motif(pattern: Pattern): SVGElement[] {
  switch (pattern) {
    case 'meander':
      return [path('M0.1 0.9L0.1 0.1L0.9 0.1L0.9 0.75L0.3 0.75L0.3 0.3L0.7 0.3L0.7 0.55L0.5 0.55', 0.09, { 'stroke-linecap': 'square', 'stroke-linejoin': 'miter' })];
    case 'cloud':
      return [path('M0.05 0.75Q0.05 0.3 0.4 0.3Q0.7 0.3 0.7 0.55Q0.7 0.75 0.5 0.75Q0.35 0.75 0.35 0.6Q0.35 0.48 0.48 0.5M0.7 0.55Q0.8 0.2 0.98 0.4', 0.075)];
    case 'dots':
      return [s('circle', { attrs: { cx: 0.5, cy: 0.5, r: 0.24, fill: 'currentColor' } })];
    case 'diamond':
      return [path('M0.5 0.08L0.92 0.5L0.5 0.92L0.08 0.5Z', 0.08), s('circle', { attrs: { cx: 0.5, cy: 0.5, r: 0.1, fill: 'currentColor' } })];
    case 'wave':
      return [path('M0 0.6Q0.25 0.2 0.5 0.6T1 0.6', 0.09), path('M0 0.85Q0.25 0.5 0.5 0.85T1 0.85', 0.05)];
  }
}

/**
 * 花邊框：沿 r 的四邊排一圈紋樣（寬 band），內外各一條細線。紋樣一格一格明確地畫出來，
 * 不用 SVG 的 pattern 填色：後者列印成 PDF 時會讓檔案大好幾倍。
 */
export function patternFrameSvg(r: Rect, pattern: Pattern, band: number): SVGSVGElement {
  const b = Math.max(0.8, band);
  const svg = s('svg', {
    class: 'nf-framebox nf-patternframe',
    attrs: { viewBox: `0 0 ${r.w.toFixed(3)} ${r.h.toFixed(3)}`, 'aria-hidden': 'true', 'data-pattern': pattern },
    style: { left: mm(r.x), top: mm(r.y), width: mm(r.w), height: mm(r.h) },
  });
  const tile = (x: number, y: number, size: number): void => {
    svg.appendChild(s('g', { attrs: { transform: `translate(${x.toFixed(3)} ${y.toFixed(3)}) scale(${size.toFixed(3)})` } }, ...motif(pattern)));
  };
  const along = (length: number): { n: number; step: number } => {
    const n = Math.max(1, Math.round(length / b));
    return { n, step: length / n };
  };
  const top = along(r.w);
  for (let i = 0; i < top.n; i++) {
    tile(i * top.step, 0, Math.min(b, top.step));
    tile(i * top.step, r.h - b, Math.min(b, top.step));
  }
  const side = along(r.h - 2 * b);
  for (let i = 0; i < side.n; i++) {
    tile(0, b + i * side.step, Math.min(b, side.step));
    tile(r.w - b, b + i * side.step, Math.min(b, side.step));
  }
  svg.appendChild(s('rect', { attrs: { x: 0.12, y: 0.12, width: r.w - 0.24, height: r.h - 0.24, fill: 'none', stroke: 'currentColor', 'stroke-width': 0.22 } }));
  svg.appendChild(s('rect', { attrs: { x: b, y: b, width: Math.max(0.1, r.w - 2 * b), height: Math.max(0.1, r.h - 2 * b), fill: 'none', stroke: 'currentColor', 'stroke-width': 0.16 } }));
  return svg;
}

/** 空心字：每個字一個 SVG text，只描邊。dir v 直排（由上而下），h 橫排由右而左。 */
export function outlineTextSvg(text: readonly string[], r: Rect, size: number, dir: 'v' | 'h', fontVar: string): SVGSVGElement {
  const svg = s('svg', {
    class: 'nf-outline',
    attrs: { viewBox: `0 0 ${r.w.toFixed(3)} ${r.h.toFixed(3)}`, 'aria-hidden': 'false', role: 'img', 'aria-label': text.join('') },
    style: { left: mm(r.x), top: mm(r.y), width: mm(r.w), height: mm(r.h) },
  });
  const n = text.length;
  text.forEach((ch, i) => {
    const x = dir === 'v' ? r.w / 2 : r.w / 2 + ((n - 1) / 2 - i) * size;
    const y = dir === 'v' ? (i + 0.5) * size + Math.max(0, (r.h - n * size) / 2) : r.h / 2;
    svg.appendChild(
      s('text', {
        attrs: { x: x.toFixed(3), y: y.toFixed(3), 'font-size': size.toFixed(3), 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: 'none', stroke: 'currentColor', 'stroke-width': (size * 0.055).toFixed(3), 'stroke-linejoin': 'round' },
        style: { 'font-family': fontVar, 'font-weight': '900' },
        text: ch,
      }),
    );
  });
  return svg;
}
