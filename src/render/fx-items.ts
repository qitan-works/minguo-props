// 把逐一放置的紙張效果（src/lib/fx/）畫到紙上：
// - 向量圖形畫在紙面裡的一層 SVG（依疊放順序；要避開保護區的項目用 clipPath 挖掉線索那幾塊）；
// - 浸水、抹糊用字的複製品染色、模糊（同 src/render/bleed.ts），外面再包一層避開保護區；
// - 挖掉的範圍（燒穿、撕掉、蟲蛀）與紙張外形一起做成一串 SVG clipPath：每一段是「整片減掉一組不重疊的洞」，
//   串起來就是全部的交集，所以洞與洞重疊、洞跨出紙邊都正確（單一路徑的 evenodd 會讓重疊處又長回紙）。
//   預覽與列印用同一份 DOM，PDF 裡仍是向量。
// - 點選、拖曳用的透明範圍畫在紙外的一層（不被紙的 clip-path 剪掉），只在螢幕上出現。

import type { Rgb } from '../lib/effects.ts';
import { closedPath, clockwise, type FxBleed, type FxPlan, type FxPrim } from '../lib/fx/plan.ts';
import { PX_PER_MM, inflateRect, polygonArea, polygonBounds, rectsOverlap, type Point, type Rect } from '../lib/geometry.ts';
import { s, h } from '../ui/dom.ts';
import { bleedLayer, inkTintFilter, pxPath } from './bleed.ts';

let uid = 0;

/** 把重疊的矩形合併成外接矩形（evenodd 挖洞時，重疊的兩塊會互相抵銷）。 */
export function mergeRects(rects: readonly Rect[]): Rect[] {
  const out = rects.map((r) => ({ ...r }));
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < out.length && !merged; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i] as Rect;
        const b = out[j] as Rect;
        if (!rectsOverlap(a, b)) continue;
        const x = Math.min(a.x, b.x);
        const y = Math.min(a.y, b.y);
        out[i] = { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
        out.splice(j, 1);
        merged = true;
        break;
      }
    }
  }
  return out;
}

/** 把挖洞的範圍分組：同一組裡的洞彼此不重疊（外接矩形不相交），可以放在同一段 evenodd 路徑裡。 */
export function groupCuts(cuts: readonly (readonly Point[])[]): Point[][][] {
  const groups: { polys: Point[][]; boxes: Rect[] }[] = [];
  for (const poly of cuts) {
    const box = inflateRect(polygonBounds(poly), 0.05);
    const g = groups.find((x) => !x.boxes.some((b) => rectsOverlap(b, box)));
    if (g) {
      g.polys.push([...poly]);
      g.boxes.push(box);
    } else groups.push({ polys: [[...poly]], boxes: [box] });
  }
  return groups.map((g) => g.polys);
}

function rectPoly(r: Rect): Point[] {
  return [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }];
}

function primNode(p: FxPrim, gradient: (stops: FxPrim & { t: 'radial' }) => string): SVGElement {
  if (p.t === 'radial') return s('circle', { attrs: { cx: p.cx.toFixed(2), cy: p.cy.toFixed(2), r: p.r.toFixed(2), fill: `url(#${gradient(p)})` } });
  if (p.t === 'fill') return s('path', { attrs: { d: p.d, fill: p.color, 'fill-rule': p.evenodd ? 'evenodd' : null } });
  return s('path', { attrs: { d: p.d, fill: 'none', stroke: p.color, 'stroke-width': p.width, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'stroke-dasharray': p.dash ?? null } });
}

export interface FxDrawOptions {
  readonly paper: HTMLElement;
  readonly content: HTMLElement | null;
  /** 紙面大小（公釐），與紙張狀況那一層相同。 */
  readonly width: number;
  readonly height: number;
  readonly plans: readonly FxPlan[];
  /** 保護區（量到的原始位置，未外擴）。 */
  readonly protect: readonly Rect[];
  readonly selectedId: string | null;
}

/** 畫上向量圖形與暈開的字；回傳要從紙上挖掉的範圍（交給 applyPaperClip）。 */
export function drawFxItems(o: FxDrawOptions): Point[][] {
  const { plans, width: w, height: ph } = o;
  if (plans.length === 0) return [];
  const id = `fxi${++uid}`;
  const layer = h('div', { class: ['fx-layer', 'fx-items'], attrs: { 'aria-hidden': 'true' } });
  const svg = s('svg', { class: 'fx-svg', attrs: { viewBox: `0 0 ${w} ${ph}`, preserveAspectRatio: 'none' } });
  const defs = s('defs');
  svg.appendChild(defs);
  const guard = mergeRects(o.protect.map((r) => inflateRect(r, 1.2)));
  const outer: Rect = { x: -200, y: -200, w: w + 400, h: ph + 400 };
  if (guard.length) {
    defs.appendChild(
      s('clipPath', { attrs: { id: `${id}-np`, clipPathUnits: 'userSpaceOnUse' } }, s('path', { attrs: { d: [rectPoly(outer), ...guard.map(rectPoly)].map(closedPath).join(''), 'clip-rule': 'evenodd' } })),
    );
  }
  const gradients = new Map<string, string>();
  const gradient = (p: FxPrim & { t: 'radial' }): string => {
    const key = p.stops.map(([o2, c]) => `${o2}:${c}`).join('|');
    let gid = gradients.get(key);
    if (!gid) {
      gid = `${id}-g${gradients.size}`;
      gradients.set(key, gid);
      // 預設以圓的外接方框為準，所以每個大小不同的圓可以共用同一個漸層
      defs.appendChild(s('radialGradient', { attrs: { id: gid } }, ...p.stops.map(([offset, color]) => s('stop', { attrs: { offset, 'stop-color': color } }))));
    }
    return gid;
  };
  const blurs = new Map<string, string>();
  const blurFilter = (b: number): string => {
    const key = b.toFixed(2);
    let fid = blurs.get(key);
    if (!fid) {
      fid = `${id}-b${blurs.size}`;
      blurs.set(key, fid);
      defs.appendChild(s('filter', { attrs: { id: fid, x: '-30%', y: '-30%', width: '160%', height: '160%' } }, s('feGaussianBlur', { attrs: { stdDeviation: key } })));
    }
    return fid;
  };
  const cuts: Point[][] = [];
  const bleeds: FxBleed[] = [];
  for (const plan of plans) {
    cuts.push(...plan.cuts);
    bleeds.push(...plan.bleeds);
    if (plan.prims.length === 0) continue;
    const body = s('g', { attrs: { filter: plan.blur >= 0.05 ? `url(#${blurFilter(plan.blur)})` : null } }, ...plan.prims.map((p) => primNode(p, gradient)));
    svg.appendChild(s('g', { dataset: { fxItem: plan.id }, attrs: { 'clip-path': plan.avoidProtect && guard.length ? `url(#${id}-np)` : null } }, body));
  }
  layer.appendChild(svg);

  // 暈開的字：同樣的染色、模糊、透明度合併成一層（範圍取聯集），減少字的複製品
  if (o.content && bleeds.length) {
    const groups = new Map<string, { b: FxBleed; polys: Point[][] }>();
    for (const b of bleeds) {
      const key = [b.tint?.join(',') ?? 'ink', b.blur.toFixed(1), b.opacity.toFixed(1), b.wash.toFixed(1), b.dx.toFixed(1), b.dy.toFixed(1)].join('/');
      const g = groups.get(key) ?? { b, polys: [] };
      g.polys.push(...b.polygons.map((p) => clockwise(p)));
      groups.set(key, g);
    }
    const tints = new Map<string, string>();
    const tintId = (rgb: Rgb): string => {
      const key = rgb.join(',');
      let tid = tints.get(key);
      if (!tid) {
        tid = `${id}-t${tints.size}`;
        tints.set(key, tid);
        defs.appendChild(inkTintFilter(tid, rgb));
      }
      return tid;
    };
    const bleedBox = h('div', {
      class: 'fx-bleed',
      style: guard.length ? { 'clip-path': `path(evenodd, '${pxPath([rectPoly(outer), ...guard.map(rectPoly)])}')` } : {},
    });
    for (const { b, polys } of groups.values()) {
      bleedBox.appendChild(
        bleedLayer(o.content, polys, false, {
          ...(b.tint ? { tint: tintId(b.tint) } : {}),
          blur: b.blur * PX_PER_MM,
          opacity: b.opacity,
          wash: b.wash,
          dx: b.dx * PX_PER_MM,
          dy: b.dy * PX_PER_MM,
        }),
      );
    }
    layer.appendChild(bleedBox);
  }
  o.paper.appendChild(layer);
  drawHitLayer(o);
  return cuts;
}

/** 點選與拖曳用的透明範圍（紙外的一層，只在螢幕上）；選取中的項目畫虛線框與中心點。 */
function drawHitLayer(o: FxDrawOptions): void {
  const parent = o.paper.parentElement;
  if (!parent) return;
  const svg = s('svg', {
    class: 'fx-hit-layer',
    attrs: { viewBox: `0 0 ${o.width} ${o.height}`, preserveAspectRatio: 'none', 'aria-hidden': 'true' },
    style: { left: `${o.paper.offsetLeft}px`, top: `${o.paper.offsetTop}px`, width: `${o.width}mm`, height: `${o.height}mm` },
  });
  for (const plan of [...o.plans].reverse()) {
    const small = Math.abs(polygonArea(plan.outline)) < 1600;
    svg.appendChild(
      s(
        'g',
        { class: ['fx-hit', plan.id === o.selectedId && 'fx-hit-selected'], dataset: { fxId: plan.id } },
        s('path', { class: small ? 'fx-hit-area' : 'fx-hit-edge', attrs: { d: closedPath(plan.outline) } }),
        s('circle', { class: 'fx-hit-dot', attrs: { cx: plan.center.x.toFixed(2), cy: plan.center.y.toFixed(2), r: 2.4 } }),
      ),
    );
  }
  parent.insertBefore(svg, o.paper.nextSibling);
}

/**
 * 紙張外形：base（外形，含原本紙張狀況的破洞，evenodd）再減掉 cuts。
 * 沒有 cuts 時照舊用 CSS 的 path()；有的話改成一串 SVG clipPath（放在紙旁邊、一起列印）。
 */
export function applyPaperClip(paper: HTMLElement, base: readonly (readonly Point[])[], cuts: readonly (readonly Point[])[], width: number, height: number): void {
  if (cuts.length === 0) {
    paper.style.setProperty('clip-path', `path(evenodd, '${pxPath(base)}')`);
    return;
  }
  const parent = paper.parentElement;
  if (!parent) return;
  const id = `fxc${++uid}`;
  const all = [...base, ...cuts].flat();
  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y);
  const outer: Rect = { x: Math.min(0, ...xs) - 20, y: Math.min(0, ...ys) - 20, w: 0, h: 0 };
  const big = { ...outer, w: Math.max(width, ...xs) + 20 - outer.x, h: Math.max(height, ...ys) + 20 - outer.y };
  const defs = s('defs');
  defs.appendChild(s('clipPath', { attrs: { id: `${id}-0`, clipPathUnits: 'userSpaceOnUse' } }, s('path', { attrs: { d: pxPath(base), 'clip-rule': 'evenodd' } })));
  const groups = groupCuts(cuts);
  groups.forEach((g, i) => {
    defs.appendChild(
      s(
        'clipPath',
        { attrs: { id: `${id}-${i + 1}`, clipPathUnits: 'userSpaceOnUse', 'clip-path': `url(#${id}-${i})` } },
        s('path', { attrs: { d: pxPath([rectPoly(big), ...g]), 'clip-rule': 'evenodd' } }),
      ),
    );
  });
  const holder = s('svg', { class: 'fx-clipdefs', attrs: { width: 0, height: 0, 'aria-hidden': 'true', focusable: 'false' } }, defs);
  parent.insertBefore(holder, paper);
  paper.style.setProperty('clip-path', `url(#${id}-${groups.length})`);
}
