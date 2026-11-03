// 把「紙張狀況」畫到紙面上：先量出保護區（[保:…]）與必毀區（[毀:…]）的位置，
// 由 src/lib/effects.ts 依種子規劃，再畫成 clip-path、SVG 與少量 CSS 濾鏡。
//
// 取捨：大部分效果是向量（SVG 線條、漸層），PDF 小、列印不卡。只有浸水與抹糊的墨跡用了
// backdrop-filter 模糊（只作用在那一塊範圍內），列印時瀏覽器會把那一塊轉成點陣圖。

import { planEffects, type EffectPlan } from '../lib/effects.ts';
import { PX_PER_MM, polygonToPath, type Point, type Polygon, type Rect } from '../lib/geometry.ts';
import type { ConditionData } from '../props/conditions.ts';
import { h, s } from '../ui/dom.ts';

export interface PaperSpec {
  readonly width: number;
  readonly height: number;
  readonly conditions: ConditionData;
  readonly crop: Polygon | null;
  readonly variant: number;
}

const registry = new WeakMap<HTMLElement, PaperSpec>();
let uid = 0;

export function registerPaper(paper: HTMLElement, spec: PaperSpec): void {
  registry.set(paper, spec);
}

/** 改變某張紙的裁切外形（例如「從整版剪下」在排版後才知道剪線）。 */
export function setPaperCrop(paper: HTMLElement, crop: Polygon | null): void {
  const spec = registry.get(paper);
  if (spec) registry.set(paper, { ...spec, crop });
}

/** 量出紙面內標了 data-mark 的元素位置（紙面座標，公釐）。 */
export function measureMarks(paper: HTMLElement, mark: 'protect' | 'destroy'): Rect[] {
  const box = paper.getBoundingClientRect();
  const scale = box.width / (paper.offsetWidth || 1);
  if (!Number.isFinite(scale) || scale === 0) return [];
  const toMm = (v: number): number => v / scale / PX_PER_MM;
  const rects: Rect[] = [];
  for (const el of paper.querySelectorAll<HTMLElement>(`[data-mark="${mark}"]`)) {
    for (const r of el.getClientRects()) {
      if (r.width === 0 && r.height === 0) continue;
      rects.push({ x: toMm(r.left - box.left), y: toMm(r.top - box.top), w: toMm(r.width), h: toMm(r.height) });
    }
  }
  return rects;
}

function path(poly: readonly Point[]): string {
  return polygonToPath(poly, 1);
}

function pxPath(polys: readonly (readonly Point[])[]): string {
  return polys.map((p) => polygonToPath(p, PX_PER_MM)).join('');
}

function isFullRect(poly: readonly Point[], w: number, h: number): boolean {
  return (
    poly.length === 4 &&
    poly.every((p) => (Math.abs(p.x) < 1e-6 || Math.abs(p.x - w) < 1e-6) && (Math.abs(p.y) < 1e-6 || Math.abs(p.y - h) < 1e-6))
  );
}

function strokePath(d: string, color: string, width: number, extra: Record<string, string | number> = {}): SVGPathElement {
  return s('path', { attrs: { d, fill: 'none', stroke: color, 'stroke-width': width, 'stroke-linejoin': 'round', ...extra } });
}

/** 把一份規劃畫到紙上。 */
function draw(paper: HTMLElement, content: HTMLElement | null, plan: EffectPlan, c: ConditionData): void {
  const w = plan.width;
  const ph = plan.height;
  const id = `fx${++uid}`;
  const layer = h('div', { class: 'fx-layer', attrs: { 'aria-hidden': 'true' } });
  const svg = s('svg', { class: 'fx-svg', attrs: { viewBox: `0 0 ${w} ${ph}`, preserveAspectRatio: 'none' } });
  const defs = s('defs');
  defs.append(
    s(
      'radialGradient',
      { attrs: { id: `${id}-fox` } },
      s('stop', { attrs: { offset: '0%', 'stop-color': 'rgb(120 70 20)', 'stop-opacity': '0.55' } }),
      s('stop', { attrs: { offset: '60%', 'stop-color': 'rgb(150 95 35)', 'stop-opacity': '0.25' } }),
      s('stop', { attrs: { offset: '100%', 'stop-color': 'rgb(170 120 50)', 'stop-opacity': '0' } }),
    ),
    s(
      'radialGradient',
      { attrs: { id: `${id}-smear` } },
      s('stop', { attrs: { offset: '0%', 'stop-color': 'rgb(25 22 20)', 'stop-opacity': '0.6' } }),
      s('stop', { attrs: { offset: '100%', 'stop-color': 'rgb(25 22 20)', 'stop-opacity': '0' } }),
    ),
    s(
      'radialGradient',
      { attrs: { id: `${id}-wax` } },
      s('stop', { attrs: { offset: '0%', 'stop-color': 'rgb(255 253 245)', 'stop-opacity': '0.95' } }),
      s('stop', { attrs: { offset: '100%', 'stop-color': 'rgb(236 228 205)', 'stop-opacity': '0.8' } }),
    ),
  );
  svg.appendChild(defs);

  // 揉皺：明暗兩道細線
  for (const line of plan.creases) {
    const d = `M${line.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join('L')}`;
    svg.append(
      strokePath(d, 'rgb(80 55 25 / 0.07)', 3.2, { transform: 'translate(0.8 0.8)' }),
      strokePath(d, 'rgb(90 65 30 / 0.32)', 0.55, { transform: 'translate(0.2 0.2)' }),
      strokePath(d, 'rgb(255 255 250 / 0.6)', 0.4),
    );
  }
  // 污漬與杯底圓環
  for (const e of plan.stains) {
    svg.appendChild(
      s('ellipse', {
        class: 'fx-stain',
        attrs: { cx: e.cx, cy: e.cy, rx: e.rx, ry: e.ry, transform: `rotate(${e.rotate.toFixed(1)} ${e.cx} ${e.cy})` },
      }),
    );
  }
  for (const r of plan.rings) {
    const circ = 2 * Math.PI * r.r;
    svg.appendChild(
      s('circle', {
        class: 'fx-ring',
        attrs: {
          cx: r.cx,
          cy: r.cy,
          r: r.r,
          'stroke-width': Math.max(0.6, r.r * 0.06),
          'stroke-dasharray': `${(circ * r.arc).toFixed(2)} ${circ.toFixed(2)}`,
          transform: `rotate(${r.rotate.toFixed(1)} ${r.cx} ${r.cy})`,
        },
      }),
    );
  }
  for (const c0 of plan.spots) svg.appendChild(s('circle', { attrs: { cx: c0.cx, cy: c0.cy, r: c0.r, fill: `url(#${id}-fox)` } }));
  for (const m of plan.mold) {
    svg.appendChild(s('circle', { class: 'fx-mold-halo', attrs: { cx: m.cx, cy: m.cy, r: m.r } }));
    for (const d of m.dots) svg.appendChild(s('circle', { class: 'fx-mold', attrs: { cx: d.cx, cy: d.cy, r: d.r } }));
  }
  // 鏽痕：迴紋針的形狀
  if (plan.rust) {
    const b = plan.rust;
    const r = b.w / 2;
    const d = `M${b.x + r} ${b.y + b.h - r} L${b.x + r} ${b.y + r} A${r} ${r} 0 0 1 ${b.x + b.w} ${b.y + r} L${b.x + b.w} ${b.y + b.h - r * 0.6} A${r * 0.7} ${r * 0.7} 0 0 1 ${b.x + b.w - r * 1.4} ${b.y + b.h - r * 0.6} L${b.x + b.w - r * 1.4} ${b.y + r * 1.6}`;
    svg.appendChild(
      s(
        'g',
        { attrs: { transform: `rotate(${b.rotate.toFixed(1)} ${b.x + b.w / 2} ${b.y + b.h / 2})` } },
        strokePath(d, 'rgb(140 70 25 / 0.28)', 2.2, { 'stroke-linecap': 'round' }),
        strokePath(d, 'rgb(120 55 20 / 0.55)', 0.7, { 'stroke-linecap': 'round' }),
      ),
    );
  }
  // 膠帶
  for (const t of plan.tape) {
    svg.appendChild(
      s('rect', {
        class: 'fx-tape',
        attrs: { x: t.x, y: t.y, width: t.w, height: t.h, transform: `rotate(${t.rotate.toFixed(1)} ${t.x + t.w / 2} ${t.y + t.h / 2})` },
      }),
    );
  }
  // 滴蠟
  for (const x of plan.wax) {
    svg.append(
      s('path', { attrs: { d: path(x.drip), fill: `url(#${id}-wax)`, stroke: 'rgb(150 135 95 / 0.75)', 'stroke-width': 0.3, transform: 'translate(0.25 0.25)' } }),
      s('path', { attrs: { d: path(x.blob), fill: `url(#${id}-wax)`, stroke: 'rgb(150 135 95 / 0.8)', 'stroke-width': 0.35 } }),
    );
  }
  // 浸水：潮線與皺紋（模糊另外用 backdrop-filter）
  if (plan.water) {
    const region = plan.water.polygons[0] ?? [];
    const k = plan.water.strength / 100;
    svg.append(
      s('path', { attrs: { d: plan.water.polygons.map(path).join(''), 'fill-rule': 'evenodd', fill: `rgb(255 252 245 / ${0.12 + 0.18 * k})` } }),
      strokePath(path(region), `rgb(140 100 50 / ${0.18 + 0.25 * k})`, 1.8),
      strokePath(path(region), `rgb(110 75 35 / ${0.35 + 0.3 * k})`, 0.35),
    );
  }
  for (const sm of plan.smudges) svg.appendChild(s('path', { attrs: { d: path(sm), fill: `url(#${id}-smear)` } }));
  // 紙邊樣式
  const outlineD = path(plan.outline);
  if (plan.edge === 'burnt') {
    for (const [color, width] of [
      ['rgb(150 95 40 / 0.18)', 9],
      ['rgb(90 50 20 / 0.35)', 4.5],
      ['rgb(45 25 10 / 0.7)', 1.8],
      ['rgb(15 10 5 / 0.95)', 0.7],
    ] as const) {
      svg.appendChild(strokePath(outlineD, color, width));
    }
  } else if (plan.edge === 'torn' || plan.edge === 'half') {
    svg.append(strokePath(outlineD, 'rgb(253 251 244 / 0.95)', 0.9), strokePath(outlineD, 'rgb(120 95 60 / 0.25)', 0.25, { transform: 'translate(0.3 0.3)' }));
  } else if (plan.edge === 'mouse') {
    svg.appendChild(strokePath(outlineD, 'rgb(110 80 45 / 0.35)', 0.5));
  }
  for (const hole of plan.holes) {
    const d = path(hole.polygon);
    if (hole.kind === 'burn') {
      for (const [color, width] of [
        ['rgb(150 95 40 / 0.2)', 6],
        ['rgb(60 30 10 / 0.6)', 2.2],
        ['rgb(10 6 3 / 0.95)', 0.8],
      ] as const) {
        svg.appendChild(strokePath(d, color, width));
      }
    } else if (hole.kind === 'pin') {
      svg.appendChild(strokePath(d, 'rgb(120 70 30 / 0.5)', 0.6));
    } else {
      svg.appendChild(strokePath(d, 'rgb(110 80 40 / 0.45)', 0.3));
    }
  }
  layer.appendChild(svg);

  // 浸水與抹糊：只在那一塊範圍內模糊底下的字
  if (plan.water && plan.water.strength > 0) {
    const blur = 0.3 + (plan.water.strength / 100) * 1.9;
    layer.appendChild(
      h('div', {
        class: 'fx-blur',
        style: {
          'backdrop-filter': `blur(${blur.toFixed(2)}px)`,
          '-webkit-backdrop-filter': `blur(${blur.toFixed(2)}px)`,
          'clip-path': `path(evenodd, '${pxPath(plan.water.polygons)}')`,
        },
      }),
    );
  }
  if (plan.smudges.length > 0) {
    layer.appendChild(
      h('div', {
        class: 'fx-blur',
        style: {
          'backdrop-filter': 'blur(1.6px)',
          '-webkit-backdrop-filter': 'blur(1.6px)',
          'clip-path': `path('${pxPath(plan.smudges)}')`,
        },
      }),
    );
  }
  // 必毀區：濃墨塗抹，蓋在模糊層之上，字完全看不出來
  if (plan.blots.length > 0) {
    const ink = s('svg', { class: 'fx-svg', attrs: { viewBox: `0 0 ${w} ${ph}`, preserveAspectRatio: 'none' } });
    for (const b of plan.blots) {
      ink.append(strokePath(path(b), 'rgb(28 22 18 / 0.3)', 1.4), s('path', { attrs: { d: path(b), fill: 'rgb(30 24 19)' } }));
    }
    layer.appendChild(ink);
  }
  // 摺痕（對摺、四摺、三摺），交叉處磨白
  for (const y of plan.folds.horizontal) layer.appendChild(h('div', { class: 'fold fold-h', style: { top: `${y * 100}%` } }));
  for (const x of plan.folds.vertical) layer.appendChild(h('div', { class: 'fold fold-v', style: { left: `${x * 100}%` } }));
  for (const y of plan.folds.horizontal) {
    for (const x of plan.folds.vertical) layer.appendChild(h('div', { class: 'fold-wear', style: { top: `${y * 100}%`, left: `${x * 100}%` } }));
  }
  // 日曬褪色
  if (plan.sun) {
    const k = plan.sun.amount / 100;
    layer.appendChild(
      h('div', {
        class: 'fx-sun',
        style: { background: `linear-gradient(to ${plan.sun.side}, transparent 25%, rgb(255 250 232 / ${(0.65 * k).toFixed(2)}) 100%)` },
      }),
    );
  }
  // 鉛筆擦掉後殘留的字
  if (plan.pencil) {
    layer.appendChild(
      h('div', {
        class: 'fx-pencil vt hand',
        text: plan.pencil.text,
        style: {
          left: `${plan.pencil.x}mm`,
          top: `${plan.pencil.y}mm`,
          'font-size': '5mm',
          transform: `rotate(${plan.pencil.rotate.toFixed(1)}deg)`,
        },
      }),
    );
  }
  paper.appendChild(layer);

  // 紙張外形與破洞
  const clipped = !isFullRect(plan.outline, w, ph) || plan.holes.length > 0;
  if (clipped) {
    paper.style.setProperty('clip-path', `path(evenodd, '${pxPath([plan.outline, ...plan.holes.map((x) => x.polygon)])}')`);
  }
  // 墨水漸淡（直排由右往左讀，越往左越淡）
  if (content) {
    if (c.inkFade > 0) {
      const end = (1 - 0.65 * (c.inkFade / 100)).toFixed(2);
      content.style.setProperty('mask-image', `linear-gradient(to left, #000 15%, rgb(0 0 0 / ${end}) 100%)`);
      content.style.setProperty('-webkit-mask-image', `linear-gradient(to left, #000 15%, rgb(0 0 0 / ${end}) 100%)`);
    } else {
      content.style.removeProperty('mask-image');
      content.style.removeProperty('-webkit-mask-image');
    }
  }
  // 列印用的「沿此剪下」裁切線：畫在紙面外（不被 clip-path 剪掉）
  if (c.cutGuide && clipped && paper.parentElement) {
    const guide = s(
      'svg',
      {
        class: 'fx-guide',
        attrs: { viewBox: `0 0 ${w} ${ph}`, preserveAspectRatio: 'none', 'aria-hidden': 'true' },
        style: {
          left: `${paper.offsetLeft}px`,
          top: `${paper.offsetTop}px`,
          width: `${w}mm`,
          height: `${ph}mm`,
        },
      },
      ...[plan.outline, ...plan.holes.filter((x) => x.kind === 'burn').map((x) => x.polygon)].map((poly) =>
        strokePath(path(poly), 'rgb(120 120 120 / 0.55)', 0.25, { 'stroke-dasharray': '1.5 1' }),
      ),
    );
    paper.parentElement.insertBefore(guide, paper);
  }
}

/** 對 root 底下所有已登記的紙面畫上紙張狀況。需在內容排好、掛進文件之後呼叫。 */
export function applyPaperEffects(root: ParentNode): void {
  for (const paper of root.querySelectorAll<HTMLElement>('.paper')) {
    const spec = registry.get(paper);
    if (!spec) continue;
    paper.querySelector('.fx-layer')?.remove();
    paper.parentElement?.querySelectorAll(':scope > .fx-guide').forEach((g) => g.remove());
    const plan = planEffects({
      width: spec.width,
      height: spec.height,
      settings: spec.conditions,
      protect: measureMarks(paper, 'protect'),
      destroy: measureMarks(paper, 'destroy'),
      crop: spec.crop,
      variant: spec.variant,
    });
    draw(paper, paper.querySelector<HTMLElement>('.paper-content'), plan, spec.conditions);
  }
}
