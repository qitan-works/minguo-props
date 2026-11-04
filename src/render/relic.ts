// 古物：古籍殘頁（線裝書的半葉或整葉）、碑文拓片、符籙。都接紙張狀況、裝飾、字型與列印。
// 版框、界行、魚尾、拓片的墨色、符的筆畫都是 SVG；字是 HTML 文字（列印時仍是向量字）。

import { fontsOf, type PaperKey } from '../props/common.ts';
import { pickConditions } from '../props/conditions.ts';
import type { RelicData } from '../props/relic.ts';
import type { Point, Polygon } from '../lib/geometry.ts';
import { layoutBook, planRubbing, planTalisman } from '../lib/relic.ts';
import { range, rngFor } from '../lib/random.ts';
import { h, s } from '../ui/dom.ts';
import { createPaperSurface, createSheet } from './sheet.ts';

const mm = (v: number): string => `${v.toFixed(2)}mm`;
const VERMILION = 'rgb(192 38 26)';

function path(poly: readonly Point[]): string {
  return poly.length ? `M${poly.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join('L')}Z` : '';
}

function svgLayer(w: number, hh: number, className: string): SVGSVGElement {
  return s('svg', { class: ['rl-svg', className], attrs: { viewBox: `0 0 ${w} ${hh}`, preserveAspectRatio: 'none', 'aria-hidden': 'true' } });
}

function cell(text: string, x: number, y: number, w: number, hh: number, size: number, cls: string | readonly (string | false | null | undefined)[], extra: Record<string, string> = {}): HTMLElement {
  return h('div', { class: cls, text, style: { left: mm(x), top: mm(y), width: mm(w), height: mm(hh), 'font-size': mm(size), 'line-height': mm(hh), ...extra } });
}

/** 印章：方框裡的字由右而左、由上而下排；白文（紅底白字）或朱文（紅框紅字）。 */
function seal(text: string, x: number, y: number, size: number, white: boolean, rotate = 0): HTMLElement {
  const chars = Array.from(text.trim());
  const rows = chars.length <= 2 ? chars.length || 1 : chars.length <= 4 ? 2 : chars.length <= 6 ? 3 : 4;
  const cols = Math.ceil(chars.length / rows) || 1;
  const fs = Math.min((size * 0.86) / rows, (size * 0.86) / cols);
  return h(
    'div',
    {
      class: ['rl-seal', white ? 'rl-seal-white' : 'rl-seal-red'],
      style: { left: mm(x), top: mm(y), width: mm(size), height: mm(size), transform: rotate ? `rotate(${rotate}deg)` : null, 'font-size': mm(fs) },
    },
    h('div', { class: 'rl-seal-text', text: chars.join(''), style: { height: mm(fs * rows * 1.02) } }),
  );
}

// ---- 古籍殘頁 ----

function renderBook(data: RelicData, crop: Polygon | null): HTMLElement {
  const spread = data.bookLayout === 'spread';
  const page: PaperKey = spread ? 'a4-landscape' : 'a5-portrait';
  const W = spread ? 297 : 148;
  const H = 210;
  const sheet = createSheet(page);
  const { paper, content } = createPaperSurface({ width: W, height: H, conditions: pickConditions(data), fonts: fontsOf(data), crop, className: 'rl-paper stock-book' });
  content.classList.add('rl', 'rl-book');
  const cols = Number(data.bookCols) || 9;
  const perCol = Number(data.bookPerCol) || 18;
  const top = 32;
  const bottom = 16;
  const side = spread ? 16 : 14;
  const F = { x: spread ? side : 11, y: top, w: W - (spread ? 2 * side : 11 + side + 4), h: H - top - bottom };
  const heartW = 1.5;
  const cw = F.w / ((spread ? 2 : 1) * cols + heartW);
  const rowH = F.h / perCol;
  const fs = Math.min(cw * 0.8, rowH * 0.92);
  const layout = layoutBook(data.bookText, (spread ? 2 : 1) * cols, perCol, data.relicSeed, data.redCircles / 100);
  // 版心的位置：對開在中間，單頁在左邊（半葉的版心在書口那一側）
  const heartX = spread ? F.x + cols * cw : F.x;
  const colX = (i: number): number => {
    if (!spread) return F.x + F.w - (i + 1) * cw;
    return i < cols ? F.x + F.w - (i + 1) * cw : heartX - (i - cols + 1) * cw;
  };
  const k = data.woodblock / 100;
  const rng = rngFor(data.relicSeed, 'woodblock');
  const text = h('div', { class: ['rl-text', k > 0 && 'rl-woodblock'] });
  layout.columns.forEach((col, i) => {
    col.forEach((c, j) => {
      const dx = k ? range(rng, -0.18, 0.18) * k : 0;
      const op = k ? 1 - range(rng, 0, 0.38) * k : 1;
      text.appendChild(
        cell(c.ch, colX(i) + dx, F.y + j * rowH, cw, rowH, fs, ['rl-ch', data.redMarks && c.stop && 'rl-stop', c.circled && 'rl-circ'], { opacity: op.toFixed(2) }),
      );
    });
  });
  // 版框、界行、版心（象鼻、魚尾）
  const svg = svgLayer(W, H, 'rl-frame');
  const g = s('g', { attrs: { filter: k > 0.2 ? 'url(#f-ink)' : null } });
  const rect = (x: number, y: number, w: number, hh: number, sw: number): SVGElement => s('rect', { attrs: { x, y, width: w, height: hh, fill: 'none', stroke: 'currentColor', 'stroke-width': sw } });
  const line = (x1: number, y1: number, x2: number, y2: number, sw: number): SVGElement => s('line', { attrs: { x1, y1, x2, y2, stroke: 'currentColor', 'stroke-width': sw } });
  if (data.bookFrame === 'single') g.appendChild(rect(F.x - 0.6, F.y - 0.6, F.w + 1.2, F.h + 1.2, 0.8));
  else {
    g.appendChild(rect(F.x, F.y, F.w, F.h, 0.3));
    if (data.bookFrame === 'double') g.appendChild(rect(F.x - 1.2, F.y - 1.2, F.w + 2.4, F.h + 2.4, 0.9));
    else {
      g.appendChild(line(F.x - 1.2, F.y - 1.2, F.x - 1.2, F.y + F.h + 1.2, 0.9));
      g.appendChild(line(F.x + F.w + 1.2, F.y - 1.2, F.x + F.w + 1.2, F.y + F.h + 1.2, 0.9));
      g.appendChild(line(F.x - 1.2, F.y - 1.2, F.x + F.w + 1.2, F.y - 1.2, 0.7));
      g.appendChild(line(F.x - 1.2, F.y + F.h + 1.2, F.x + F.w + 1.2, F.y + F.h + 1.2, 0.7));
    }
  }
  for (let i = 1; i < (spread ? 2 : 1) * cols; i++) {
    if (spread && i === cols) continue;
    const x = colX(i) + cw;
    g.appendChild(line(x, F.y, x, F.y + F.h, 0.18));
  }
  const hx0 = heartX;
  const hx1 = heartX + heartW * cw;
  g.appendChild(line(hx0, F.y, hx0, F.y + F.h, 0.25));
  g.appendChild(line(hx1, F.y, hx1, F.y + F.h, 0.25));
  const hc = (hx0 + hx1) / 2;
  // 象鼻（黑口）
  const nose = F.h * 0.07;
  g.appendChild(s('rect', { attrs: { x: hc - cw * 0.22, y: F.y, width: cw * 0.44, height: nose, fill: 'currentColor' } }));
  g.appendChild(s('rect', { attrs: { x: hc - cw * 0.22, y: F.y + F.h - nose, width: cw * 0.44, height: nose, fill: 'currentColor' } }));
  const fish = (y: number, up: boolean): SVGElement => {
    const fh = cw * 0.75;
    const pts = up
      ? [{ x: hx0, y: y + fh }, { x: hx1, y: y + fh }, { x: hx1, y }, { x: hc, y: y + fh * 0.45 }, { x: hx0, y }]
      : [{ x: hx0, y }, { x: hx1, y }, { x: hx1, y: y + fh }, { x: hc, y: y + fh * 0.55 }, { x: hx0, y: y + fh }];
    return s('path', { attrs: { d: path(pts), fill: 'currentColor' } });
  };
  const fishTop = F.y + nose + 2;
  let titleTop = fishTop;
  if (data.bookFish !== 'none') {
    g.appendChild(fish(fishTop, false));
    titleTop = fishTop + cw * 0.75 + 1.5;
  }
  const lowerFish = F.y + F.h * 0.7;
  if (data.bookFish === 'double') g.appendChild(fish(lowerFish, true));
  svg.appendChild(g);
  const heartFs = Math.min(cw * 1.05, fs * 0.95);
  const heart = h('div', { class: 'rl-text rl-heart' });
  const vtext = (t: string, y: number, maxH: number, size: number): void => {
    if (!t) return;
    heart.appendChild(h('div', { class: 'rl-vt', text: t, style: { left: mm(hc - size * 0.6), top: mm(y), width: mm(size * 1.2), height: mm(maxH), 'font-size': mm(size) } }));
  };
  const titleLen = Array.from(data.bookTitle).length;
  vtext(data.bookTitle, titleTop, titleLen * heartFs * 1.05, heartFs);
  vtext(data.bookVolume, titleTop + titleLen * heartFs * 1.05 + heartFs * 0.8, Array.from(data.bookVolume).length * heartFs * 0.9 * 1.05, heartFs * 0.9);
  const pageLen = Array.from(data.bookPage).length;
  vtext(data.bookPage, F.y + F.h - nose - 2 - pageLen * heartFs * 0.85 * 1.05, pageLen * heartFs * 0.85 * 1.05, heartFs * 0.85);
  content.append(svg, text, heart);
  // 眉批：朱筆寫在天頭
  if (data.headNote.trim()) {
    const nx = spread ? F.x + F.w - cw * 7 : F.x + F.w - cw * 6.5;
    content.appendChild(h('div', { class: 'rl-headnote', text: data.headNote.trim(), style: { left: mm(nx), top: mm(5), width: mm(cw * 5.5), height: mm(top - 8), 'font-size': mm(4.6) } }));
  }
  // 裝訂孔：單頁在書背那一側（右邊），對開的兩邊都有
  if (data.bindingHoles) {
    const holes = h('div', { class: 'rl-holes' });
    const xs = spread ? [5.5, W - 5.5] : [W - 6];
    for (const x of xs) for (const t of [0.12, 0.37, 0.63, 0.88]) holes.appendChild(h('div', { class: 'rl-hole', style: { left: mm(x - 0.9), top: mm(H * t - 0.9) } }));
    content.appendChild(holes);
  }
  sheet.appendChild(paper);
  return sheet;
}

// ---- 碑文拓片 ----

function renderRubbing(data: RelicData, crop: Polygon | null): HTMLElement {
  const W = 210;
  const H = 297;
  const sheet = createSheet('a4-portrait');
  const { paper, content } = createPaperSurface({ width: W, height: H, conditions: pickConditions(data), fonts: fontsOf(data), crop, className: 'rl-paper stock-xuan' });
  content.classList.add('rl', 'rl-rubbing');
  const A = { x: 20, y: 22, w: W - 40, h: H - 48 };
  const hasTitle = data.stoneTitle.trim().length > 0;
  const titleH = hasTitle ? 40 : 0;
  const B = { x: A.x + 9, y: A.y + titleH + 9, w: A.w - 18, h: A.h - titleH - 18 };
  const cols = Number(data.stoneCols) || 9;
  const rows = Number(data.stonePerCol) || 14;
  const cw = B.w / cols;
  const rh = B.h / rows;
  const fs = Math.min(cw, rh) * 0.8;
  const plan = planRubbing(data.relicSeed, B, cols, rows, data.damage, A);
  const ink = data.inkTone / 100;
  const id = `rb${data.relicSeed % 100000}`;
  const svg = svgLayer(W, H, 'rl-ink');
  svg.appendChild(
    s(
      'defs',
      {},
      s(
        'filter',
        { attrs: { id: `${id}-tex`, x: '0', y: '0', width: '100%', height: '100%', 'color-interpolation-filters': 'sRGB' } },
        s('feTurbulence', { attrs: { type: 'fractalNoise', baseFrequency: 0.8, numOctaves: 3, seed: data.relicSeed % 997, result: 'n' } }),
        s('feColorMatrix', { attrs: { in: 'n', type: 'matrix', values: `0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.6 ${(1.72 + 0.28 * ink).toFixed(2)}`, result: 'a' } }),
        s('feComposite', { attrs: { in: 'SourceGraphic', in2: 'a', operator: 'in' } }),
      ),
      s('radialGradient', { attrs: { id: `${id}-light` } }, s('stop', { attrs: { offset: 0, 'stop-color': 'rgb(150 145 135)', 'stop-opacity': 0.35 } }), s('stop', { attrs: { offset: 1, 'stop-color': 'rgb(150 145 135)', 'stop-opacity': 0 } })),
      s('radialGradient', { attrs: { id: `${id}-dark` } }, s('stop', { attrs: { offset: 0, 'stop-color': 'rgb(0 0 0)', 'stop-opacity': 0.45 } }), s('stop', { attrs: { offset: 1, 'stop-color': 'rgb(0 0 0)', 'stop-opacity': 0 } })),
    ),
  );
  const g = s('g', { attrs: { filter: `url(#${id}-tex)` } });
  g.appendChild(s('path', { attrs: { d: path(plan.edge), fill: `rgb(20 19 19 / ${(0.7 + 0.3 * ink).toFixed(2)})` } }));
  for (const d of plan.dabs) g.appendChild(s('circle', { attrs: { cx: d.x.toFixed(1), cy: d.y.toFixed(1), r: d.r.toFixed(1), fill: `url(#${id}-${d.tone > 0 ? 'dark' : 'light'})` } }));
  svg.appendChild(g);
  // 碑的邊框（刻在石上的兩道線，拓出來是白線）與碑額的分隔
  const border = s('g', { class: 'rl-stone-line', attrs: { filter: 'url(#f-ink)' } });
  border.appendChild(s('rect', { attrs: { x: A.x + 3, y: A.y + 3, width: A.w - 6, height: A.h - 6, fill: 'none', 'stroke-width': 0.8 } }));
  border.appendChild(s('rect', { attrs: { x: A.x + 5, y: A.y + 5, width: A.w - 10, height: A.h - 10, fill: 'none', 'stroke-width': 0.3 } }));
  if (hasTitle) border.appendChild(s('line', { attrs: { x1: A.x + 5, y1: A.y + titleH + 4, x2: A.x + A.w - 5, y2: A.y + titleH + 4, 'stroke-width': 0.4 } }));
  svg.appendChild(border);
  // 字（拓出來是紙色）
  const text = h('div', { class: 'rl-text rl-stone' });
  const chars = Array.from(data.stoneText.replace(/[\s，。、；：！？「」『』（）,.;:!?()]/g, ''));
  const rng = rngFor(data.relicSeed, 'stone-chars');
  for (let c = 0; c < cols; c++) {
    for (let j = 0; j < rows; j++) {
      const ch = chars[c * rows + j];
      if (!ch || plan.missing.has(`${c},${j}`)) continue;
      text.appendChild(cell(ch, B.x + B.w - (c + 1) * cw, B.y + j * rh, cw, rh, fs, 'rl-ch', { opacity: (0.7 + range(rng, 0, 0.3)).toFixed(2) }));
    }
  }
  if (hasTitle) {
    const t = Array.from(data.stoneTitle.trim());
    const per = t.length <= 4 ? t.length : Math.ceil(t.length / 2);
    const tcols = Math.ceil(t.length / per);
    const tfs = Math.min((titleH - 6) / per, (A.w * 0.5) / tcols) * 0.98;
    const cx = A.x + A.w / 2;
    for (let c = 0; c < tcols; c++) {
      text.appendChild(h('div', { class: 'rl-vt rl-stone-title', text: t.slice(c * per, (c + 1) * per).join(''), style: { left: mm(cx + (tcols / 2 - c - 1) * tfs * 1.15), top: mm(A.y + 6), width: mm(tfs * 1.15), height: mm(titleH - 4), 'font-size': mm(tfs) } }));
    }
  }
  // 石面剝落（拓不上墨，露出紙色）與摺痕
  const over = svgLayer(W, H, 'rl-over');
  const flakes = s('g', { attrs: { filter: 'url(#f-ink)' } });
  for (const f of plan.flakes) flakes.appendChild(s('path', { attrs: { d: path(f), fill: 'rgb(222 212 192 / 0.88)' } }));
  over.appendChild(flakes);
  for (const y of plan.folds.h) over.appendChild(s('line', { attrs: { x1: A.x, y1: A.y + A.h * y, x2: A.x + A.w, y2: A.y + A.h * y, stroke: `rgb(205 195 175 / ${(0.25 + 0.2 * ink).toFixed(2)})`, 'stroke-width': 1.1 } }));
  for (const x of plan.folds.v) over.appendChild(s('line', { attrs: { x1: A.x + A.w * x, y1: A.y, x2: A.x + A.w * x, y2: A.y + A.h, stroke: `rgb(205 195 175 / ${(0.25 + 0.2 * ink).toFixed(2)})`, 'stroke-width': 1.1 } }));
  content.append(svg, text, over);
  // 收藏者鈐印
  if (data.sealText.trim()) content.appendChild(seal(data.sealText, A.x + 6, A.y + A.h - 4, 17, true, -2));
  if (data.sealText2.trim()) content.appendChild(seal(data.sealText2, A.x + A.w - 18, A.y - 14, 13, false, 1.5));
  sheet.appendChild(paper);
  return sheet;
}

// ---- 符籙 ----

function renderTalisman(data: RelicData, crop: Polygon | null): HTMLElement {
  const small = data.talismanSize === 'small';
  const W = small ? 60 : 90;
  const H = small ? 180 : 260;
  const sheet = createSheet('a4-portrait');
  sheet.classList.add('sheet--margin');
  const { paper, content } = createPaperSurface({ width: W, height: H, conditions: pickConditions(data), fonts: fontsOf(data), crop, className: 'rl-paper stock-talisman' });
  content.classList.add('rl', 'rl-talisman');
  const plan = planTalisman(data.relicSeed, W, H, data.complexity);
  const svg = svgLayer(W, H, 'rl-cinnabar');
  const g = s('g', { attrs: { filter: 'url(#f-ink)', fill: VERMILION } });
  for (const st of plan.strokes) g.appendChild(s('path', { attrs: { d: path(st.outline) } }));
  for (const d of plan.dots) g.appendChild(s('circle', { attrs: { cx: d.x.toFixed(2), cy: d.y.toFixed(2), r: d.r.toFixed(2) } }));
  svg.appendChild(g);
  content.appendChild(svg);
  const t = Array.from(data.talismanText.trim());
  if (t.length) {
    const tb = plan.textBox;
    const size = Math.min(tb.w, (tb.y1 - tb.y0) / t.length);
    content.appendChild(h('div', { class: 'rl-vt rl-tal-text', text: t.join(''), style: { left: mm(tb.x - size * 0.6), top: mm(tb.y0), width: mm(size * 1.2), height: mm(size * t.length * 1.05), 'font-size': mm(size) } }));
  }
  const [right = '', left = ''] = data.talismanSide.split(/[｜|]/);
  const sideSize = Math.min(W * 0.075, 5);
  for (const [txt, x] of [
    [right, W * 0.86],
    [left, W * 0.14],
  ] as const) {
    if (!txt.trim()) continue;
    content.appendChild(h('div', { class: 'rl-vt rl-tal-side', text: txt.trim(), style: { left: mm(x - sideSize * 0.6), top: mm(H * 0.26), width: mm(sideSize * 1.2), height: mm(H * 0.45), 'font-size': mm(sideSize) } }));
  }
  if (data.talismanSeal.trim()) content.appendChild(seal(data.talismanSeal, W * 0.06, H * 0.86, W * 0.24, false, -4));
  sheet.appendChild(paper);
  return sheet;
}

export function renderRelic(data: RelicData, crop: Polygon | null = null): HTMLElement {
  if (data.relicType === 'rubbing') return renderRubbing(data, crop);
  if (data.relicType === 'talisman') return renderTalisman(data, crop);
  return renderBook(data, crop);
}
