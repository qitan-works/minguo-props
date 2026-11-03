// 把裝飾畫到紙面上（在紙張狀況之上、被紙邊裁切）。可在預覽上拖曳移動、Alt＋滾輪縮放、Alt＋Shift＋滾輪旋轉。
// 血跡用 SVG 漸層與「污漬質感」濾鏡：雜訊擾動讓邊緣不規則、略為模糊讓邊緣柔和（沒有硬邊框），
// 再用另一層雜訊（feTurbulence）控制透明度，做出斑駁、深淺不均。
// 血手印整個畫在遮罩裡（灰階＝按壓輕重），上面只有一塊血色。

import { decorationShape, type DecorationShape, type GradientDef, type Primitive, type StainTexture } from '../lib/decorations.ts';
import type { Decoration } from '../props/extras.ts';
import { s } from '../ui/dom.ts';

let layerUid = 0;

interface Refs {
  readonly ref: (local: string) => string;
  readonly filters: { readonly rough: string; readonly fine: string };
}

const blurId = (blur: number): string => `blur-${blur.toFixed(2).replace('.', '_')}`;

function primitiveNode(p: Primitive, r: Refs): SVGElement {
  if (p.kind === 'group') {
    return s('g', { attrs: { filter: p.blur ? `url(#${r.ref(blurId(p.blur))})` : null } }, ...p.children.map((c) => primitiveNode(c, r)));
  }
  if (p.kind === 'path') {
    const fill = p.fill.startsWith('grad:') ? `url(#${r.ref(p.fill.slice(5))})` : p.fill;
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
        filter: p.filter ? `url(#${r.filters[p.filter]})` : null,
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

/**
 * 污漬質感：邊緣擾動 → 略為模糊 → 乘上一層雜訊做成的透明度。
 * 雜訊的座標單位是裝飾本身的公釐，所以縮放裝飾時質感跟著縮放。
 */
export function stainFilter(id: string, t: StainTexture): SVGFilterElement {
  const [slope, intercept] = t.mottle;
  return s(
    'filter',
    { attrs: { id, x: '-25%', y: '-25%', width: '150%', height: '150%', 'color-interpolation-filters': 'sRGB' } },
    s('feTurbulence', { attrs: { type: 'fractalNoise', baseFrequency: t.warpFrequency, numOctaves: 3, seed: t.seed, result: 'warp' } }),
    s('feDisplacementMap', { attrs: { in: 'SourceGraphic', in2: 'warp', scale: t.warp * 2, xChannelSelector: 'R', yChannelSelector: 'G', result: 'shape' } }),
    s('feGaussianBlur', { attrs: { in: 'shape', stdDeviation: t.soften, result: 'soft' } }),
    s('feTurbulence', { attrs: { type: 'fractalNoise', baseFrequency: t.mottleFrequency, numOctaves: 4, seed: t.seed + 17, result: 'noise' } }),
    s('feColorMatrix', { attrs: { in: 'noise', type: 'matrix', values: `0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  ${slope} 0 0 0 ${intercept}`, result: 'mottle' } }),
    s('feComposite', { attrs: { in: 'soft', in2: 'mottle', operator: 'in' } }),
  );
}

function gradientNode(g: GradientDef, id: string): SVGElement {
  const stops = g.stops.map(([offset, color]) => s('stop', { attrs: { offset, 'stop-color': color } }));
  return g.kind === 'radial'
    ? s('radialGradient', { attrs: { id, cx: g.cx, cy: g.cy, r: g.r, gradientUnits: 'userSpaceOnUse' } }, ...stops)
    : s('linearGradient', { attrs: { id, x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2, gradientUnits: 'userSpaceOnUse' } }, ...stops);
}

function blurValues(prims: readonly Primitive[], out = new Set<number>()): Set<number> {
  for (const p of prims) {
    if (p.kind !== 'group') continue;
    if (p.blur) out.add(p.blur);
    blurValues(p.children, out);
  }
  return out;
}

function shapeDefs(shape: DecorationShape, r: Refs, maskId: string): SVGElement[] {
  const defs: SVGElement[] = (shape.gradients ?? []).map((g) => gradientNode(g, r.ref(g.id)));
  for (const blur of blurValues([...shape.primitives, ...(shape.mask ?? [])])) {
    defs.push(s('filter', { attrs: { id: r.ref(blurId(blur)), x: '-10%', y: '-10%', width: '120%', height: '120%' } }, s('feGaussianBlur', { attrs: { stdDeviation: blur } })));
  }
  if (shape.texture) defs.push(stainFilter(r.ref('stain'), shape.texture));
  if (shape.mask) {
    defs.push(
      s(
        'mask',
        { attrs: { id: maskId, maskUnits: 'userSpaceOnUse', x: -45, y: -45, width: 90, height: 90 } },
        ...shape.mask.map((p) => primitiveNode(p, r)),
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
      const refs: Refs = { ref: (local) => `deco-${uid}-${d.id}-${local}`, filters };
      const maskId = refs.ref('mask');
      defs.append(...shapeDefs(shape, refs, maskId));
      // 濾鏡要包在遮罩外面：先遮出形狀（手印），再整體套上污漬質感
      const masked = s('g', { attrs: { mask: shape.mask ? `url(#${maskId})` : null } }, ...shape.primitives.map((p) => primitiveNode(p, refs)));
      const body = shape.texture ? s('g', { attrs: { filter: `url(#${refs.ref('stain')})` } }, masked) : masked;
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
