// 把「紙張狀況」畫到紙面上：先量出保護區（[保:…]）與必毀區（[毀:…]）的位置，
// 由 src/lib/effects.ts 依種子規劃，再畫成 clip-path、SVG 與少量 CSS 濾鏡。
//
// 取捨：大部分效果是向量（SVG 線條、漸層），PDF 小、列印不卡。只有浸水與抹糊的墨跡用了
// 模糊（字的複製品加 CSS filter，只顯示在那一塊範圍內），列印時瀏覽器會把那一塊轉成點陣圖。

import { planEffects, type CharMarks, type EffectPlan } from '../lib/effects.ts';
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

/** 焦痕：由外往內一圈圈疊上淡黃、褐、深褐、焦黑，再加灰燼碎片與焦裂。 */
function charColor(i: number, count: number): string {
  // t：0 為最深（離紙邊最遠，淡黃）、1 為紙邊（焦黑）；顏色依淡黃 → 褐 → 焦黑內插，越近紙邊越不透明
  const t = count <= 1 ? 1 : i / (count - 1);
  const stops: [number, number, number][] = [[214, 176, 92], [150, 92, 36], [58, 30, 12], [12, 7, 4]];
  const x = t * (stops.length - 1);
  const k = Math.min(stops.length - 2, Math.floor(x));
  const f = x - k;
  const a = stops[k] as [number, number, number];
  const b = stops[k + 1] as [number, number, number];
  const mix = (j: 0 | 1 | 2): number => Math.round(a[j] + (b[j] - a[j]) * f);
  const alpha = 0.07 + 0.55 * Math.pow(t, 1.8) + (t > 0.95 ? 0.35 : 0);
  return `rgb(${mix(0)} ${mix(1)} ${mix(2)} / ${Math.min(0.97, alpha).toFixed(2)})`;
}

function drawChar(svg: SVGSVGElement, marks: CharMarks | null): void {
  if (!marks) return;
  const edge = path(marks.edge);
  marks.bands.forEach((band, i) => {
    svg.appendChild(s('path', { attrs: { d: edge + path(band.line), 'fill-rule': 'evenodd', fill: charColor(i, marks.bands.length) } }));
  });
  for (const f of marks.flakes) svg.appendChild(s('path', { attrs: { d: path(f.polygon), fill: f.ash ? 'rgb(118 112 102 / 0.85)' : 'rgb(10 6 3 / 0.95)' } }));
  for (const c of marks.cracks) {
    svg.appendChild(s('path', { attrs: { d: `M${c.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join('L')}`, fill: 'none', stroke: 'rgb(20 10 5 / 0.8)', 'stroke-width': 0.18, 'stroke-linecap': 'round' } }));
  }
}

/** 字的複製品（拿掉標記與編號），模糊並染色後只顯示在指定範圍內。 */
function bleedLayer(content: HTMLElement, polygons: readonly (readonly Point[])[], evenodd: boolean, filter: string, opacity: number): HTMLElement {
  const clone = content.cloneNode(true) as HTMLElement;
  for (const el of clone.querySelectorAll('[data-mark]')) el.removeAttribute('data-mark');
  for (const el of clone.querySelectorAll('[data-block-id]')) el.removeAttribute('data-block-id');
  for (const el of clone.querySelectorAll('[id]')) el.removeAttribute('id');
  clone.removeAttribute('id');
  clone.classList.add('fx-bleed-text');
  clone.setAttribute('aria-hidden', 'true');
  clone.style.setProperty('filter', filter);
  clone.style.setProperty('opacity', opacity.toFixed(2));
  return h('div', { class: 'fx-bleed', style: { 'clip-path': `path(${evenodd ? 'evenodd, ' : ''}'${pxPath(polygons)}')` } }, clone);
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
  // 浸水：先用紙色把原本的字洗淡，再畫乾掉後的潮線與起皺的紋路（暈開的字另外畫在上面，見 bleedLayer）
  if (plan.water) {
    const region = plan.water.polygons[0] ?? [];
    const k = plan.water.strength / 100;
    svg.append(
      s('path', { attrs: { d: plan.water.polygons.map(path).join(''), 'fill-rule': 'evenodd', fill: `rgb(250 244 228 / ${(0.22 + 0.4 * k).toFixed(2)})` } }),
      s('path', { attrs: { d: plan.water.polygons.map(path).join(''), 'fill-rule': 'evenodd', fill: plan.water.tint === 'blue' ? `rgb(120 140 165 / ${(0.05 + 0.07 * k).toFixed(2)})` : `rgb(165 125 70 / ${(0.06 + 0.08 * k).toFixed(2)})` } }),
      strokePath(path(region), `rgb(140 100 50 / ${0.22 + 0.25 * k})`, 1.8),
      strokePath(path(region), `rgb(110 75 35 / ${0.4 + 0.3 * k})`, 0.35),
    );
    plan.water.tides.forEach((tide, i) => svg.appendChild(strokePath(path(tide), `rgb(125 88 42 / ${(0.28 - i * 0.06 + 0.12 * k).toFixed(2)})`, 0.3 - i * 0.05)));
    for (const w of plan.water.wrinkles) {
      const d = `M${w.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join('L')}`;
      svg.append(
        s('path', { attrs: { d, fill: 'none', stroke: `rgb(255 252 244 / ${(0.35 + 0.3 * k).toFixed(2)})`, 'stroke-width': 0.35, 'stroke-linecap': 'round' } }),
        s('path', { attrs: { d, fill: 'none', stroke: `rgb(110 85 50 / ${(0.18 + 0.2 * k).toFixed(2)})`, 'stroke-width': 0.18, 'stroke-linecap': 'round', transform: 'translate(0.25 0.3)' } }),
      );
    }
  }
  for (const sm of plan.smudges) svg.appendChild(s('path', { attrs: { d: path(sm), fill: `url(#${id}-smear)` } }));
  // 紙邊樣式
  const outlineD = path(plan.outline);
  if (plan.edge === 'burnt') {
    drawChar(svg, plan.char.edge);
    svg.appendChild(strokePath(outlineD, 'rgb(8 5 3)', 0.5));
  } else if (plan.edge === 'torn' || plan.edge === 'half') {
    svg.append(strokePath(outlineD, 'rgb(253 251 244 / 0.95)', 0.9), strokePath(outlineD, 'rgb(120 95 60 / 0.25)', 0.25, { transform: 'translate(0.3 0.3)' }));
  } else if (plan.edge === 'mouse') {
    svg.appendChild(strokePath(outlineD, 'rgb(110 80 45 / 0.35)', 0.5));
  }
  for (const marks of plan.char.holes) drawChar(svg, marks);
  for (const hole of plan.holes) {
    const d = path(hole.polygon);
    if (hole.kind === 'burn') {
      svg.appendChild(strokePath(d, 'rgb(8 5 3)', 0.45));
    } else if (hole.kind === 'pin') {
      svg.appendChild(strokePath(d, 'rgb(120 70 30 / 0.5)', 0.6));
    } else {
      svg.appendChild(strokePath(d, 'rgb(110 80 40 / 0.45)', 0.3));
    }
  }
  layer.appendChild(svg);

  // 浸水與抹糊：把字複製一份、模糊並染色，只顯示在那一塊範圍內（墨水暈開、字邊擴散）。
  // 用一般的 CSS filter 而不是 backdrop-filter：後者在列印成 PDF 時不會畫出來，預覽和 PDF 會不一樣。
  if (content && plan.water && plan.water.strength > 0) {
    const k = plan.water.strength / 100;
    const tint = plan.water.tint === 'blue' ? 'sepia(1) hue-rotate(175deg) saturate(2.4) brightness(1.15)' : 'sepia(0.9) saturate(1.5) brightness(1.18)';
    layer.appendChild(bleedLayer(content, plan.water.polygons, true, `blur(${(0.45 + 1.5 * k).toFixed(2)}px) ${tint}`, 0.5 + 0.38 * k));
  }
  if (content && plan.smudges.length > 0) {
    layer.appendChild(bleedLayer(content, plan.smudges, false, 'blur(1.4px)', 0.9));
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
