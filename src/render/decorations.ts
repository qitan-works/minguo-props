// 把裝飾畫到紙面上（在紙張狀況之上、被紙邊裁切）。可在預覽上拖曳移動、滾輪縮放、Shift＋滾輪旋轉。

import { decorationShape, type Primitive } from '../lib/decorations.ts';
import type { Decoration } from '../props/extras.ts';
import { s } from '../ui/dom.ts';

function primitiveNode(p: Primitive): SVGElement {
  if (p.kind === 'path') {
    return s('path', {
      attrs: {
        d: p.d,
        fill: p.fill,
        stroke: p.stroke ?? null,
        'stroke-width': p.width ?? null,
        'stroke-dasharray': p.dash ?? null,
        'stroke-linecap': p.cap ?? null,
        'stroke-linejoin': p.stroke ? 'round' : null,
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

/** 在每張紙上加一層裝飾（依疊放順序排列）。 */
export function drawDecorations(root: ParentNode, decorations: readonly Decoration[], selectedId: string | null): void {
  if (decorations.length === 0) return;
  for (const paper of root.querySelectorAll<HTMLElement>('.paper')) {
    const w = paper.offsetWidth / (96 / 25.4);
    const h = paper.offsetHeight / (96 / 25.4);
    const svg = s('svg', {
      class: 'deco-layer',
      attrs: { viewBox: `0 0 ${w.toFixed(2)} ${h.toFixed(2)}`, preserveAspectRatio: 'none' },
    });
    for (const d of [...decorations].sort((a, b) => a.z - b.z)) {
      const shape = decorationShape(d.type, d.seed, d.text);
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
        ...shape.primitives.map(primitiveNode),
      );
      svg.appendChild(g);
    }
    paper.appendChild(svg);
  }
}
