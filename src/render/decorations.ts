// 把裝飾畫到紙面上（在紙張狀況之上、被紙邊裁切）。可在預覽上拖曳移動、滾輪縮放、Shift＋滾輪旋轉。
// 血跡、黏液等用 SVG 漸層（中心淡、邊緣深）與擾動濾鏡（feTurbulence＋feDisplacementMap）讓邊緣不規則；
// 手印用遮罩留出掌紋與按壓不均的缺塊。

import { decorationShape, type DecorationShape, type Primitive } from '../lib/decorations.ts';
import type { Decoration } from '../props/extras.ts';
import { s } from '../ui/dom.ts';

let layerUid = 0;

function primitiveNode(p: Primitive, ref: (local: string) => string, filters: { rough: string; fine: string }): SVGElement {
  if (p.kind === 'path') {
    const fill = p.fill.startsWith('grad:') ? `url(#${ref(p.fill.slice(5))})` : p.fill;
    return s('path', {
      attrs: {
        d: p.d,
        fill,
        stroke: p.stroke ?? null,
        'stroke-width': p.width ?? null,
        'stroke-dasharray': p.dash ?? null,
        'stroke-linecap': p.cap ?? null,
        'stroke-linejoin': p.stroke ? 'round' : null,
        opacity: p.opacity ?? null,
        filter: p.filter ? `url(#${filters[p.filter]})` : null,
      },
    });
  }
  return s('text', {
    class: ['deco-text', p.font === 'hand' ? 'deco-hand' : 'deco-title', p.vertical && 'deco-vertical'],
    attrs: {
      x: p.x,
      y: p.y,
      fill: p.fill,
      'font-size': p.size,
      'font-weight': p.weight ?? null,
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
    },
    text: p.text,
  });
}

function roughFilter(id: string, frequency: number, scale: number, seed: number): SVGFilterElement {
  return s(
    'filter',
    { attrs: { id, x: '-20%', y: '-20%', width: '140%', height: '140%', 'color-interpolation-filters': 'sRGB' } },
    s('feTurbulence', { attrs: { type: 'fractalNoise', baseFrequency: frequency, numOctaves: 2, seed, result: 'noise' } }),
    s('feDisplacementMap', { attrs: { in: 'SourceGraphic', in2: 'noise', scale, xChannelSelector: 'R', yChannelSelector: 'G' } }),
  );
}

function shapeDefs(shape: DecorationShape, ref: (local: string) => string, maskId: string, filters: { rough: string; fine: string }): SVGElement[] {
  const defs: SVGElement[] = [];
  for (const g of shape.gradients ?? []) {
    defs.push(
      s(
        'radialGradient',
        { attrs: { id: ref(g.id), cx: g.cx, cy: g.cy, r: g.r, gradientUnits: 'userSpaceOnUse' } },
        ...g.stops.map(([offset, color]) => s('stop', { attrs: { offset, 'stop-color': color } })),
      ),
    );
  }
  if (shape.mask) {
    defs.push(
      s(
        'mask',
        { attrs: { id: maskId, maskUnits: 'userSpaceOnUse', x: -45, y: -45, width: 90, height: 90 } },
        ...shape.mask.map((p) => primitiveNode(p, ref, filters)),
      ),
    );
  }
  return defs;
}

/** 在每張紙上加一層裝飾（依疊放順序排列）。 */
export function drawDecorations(root: ParentNode, decorations: readonly Decoration[], selectedId: string | null): void {
  if (decorations.length === 0) return;
  for (const paper of root.querySelectorAll<HTMLElement>('.paper')) {
    const uid = ++layerUid;
    const w = paper.offsetWidth / (96 / 25.4);
    const h = paper.offsetHeight / (96 / 25.4);
    const filters = { rough: `deco-rough-${uid}`, fine: `deco-fine-${uid}` };
    const defs = s('defs', {}, roughFilter(filters.rough, 0.55, 1.1, 7), roughFilter(filters.fine, 1.6, 0.42, 13));
    const svg = s('svg', {
      class: 'deco-layer',
      attrs: { viewBox: `0 0 ${w.toFixed(2)} ${h.toFixed(2)}`, preserveAspectRatio: 'none' },
    }, defs);
    for (const d of [...decorations].sort((a, b) => a.z - b.z)) {
      const shape = decorationShape(d.type, d.seed, d.text, d.dry);
      const ref = (local: string): string => `deco-${uid}-${d.id}-${local}`;
      const maskId = ref('mask');
      defs.append(...shapeDefs(shape, ref, maskId, filters));
      const body = s('g', { attrs: { mask: shape.mask ? `url(#${maskId})` : null } }, ...shape.primitives.map((p) => primitiveNode(p, ref, filters)));
      const g = s(
        'g',
        {
          class: ['deco', d.id === selectedId && 'deco-selected'],
          dataset: { decoId: d.id },
          attrs: {
            transform: `translate(${d.x.toFixed(2)} ${d.y.toFixed(2)}) rotate(${d.rotate.toFixed(1)}) scale(${d.scale.toFixed(3)})`,
            opacity: d.opacity.toFixed(2),
            filter: shape.inky ? 'url(#f-ink)' : null,
          },
        },
        // 透明的點選範圍（方便拖曳）
        s('circle', { class: 'deco-hit', attrs: { cx: 0, cy: 0, r: shape.radius } }),
        body,
      );
      svg.appendChild(g);
    }
    paper.appendChild(svg);
  }
}
