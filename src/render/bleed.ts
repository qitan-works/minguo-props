// 浸水、抹糊共用：把字複製一份，染色、模糊後只顯示在指定範圍內（src/render/effects.ts 與 fx-items.ts 共用）。

import type { Rgb } from '../lib/effects.ts';
import { PX_PER_MM, polygonToPath, type Point } from '../lib/geometry.ts';
import { h, s } from '../ui/dom.ts';

export function pxPath(polys: readonly (readonly Point[])[]): string {
  return polys.map((p) => polygonToPath(p, PX_PER_MM)).join('');
}

/**
 * 把墨色換成指定顏色的濾鏡（給暈開的字用）：顏色一律換成 rgb，透明度照原本的，越淺的顏色（例如紅色格線）越淡。
 * CSS 的 sepia()、brightness() 改不動接近黑色的墨，所以用 SVG 的 feColorMatrix。
 */
export function inkTintFilter(id: string, [r, g, b]: Rgb): SVGFilterElement {
  const c = (v: number): string => (v / 255).toFixed(3);
  return s(
    'filter',
    { attrs: { id, 'color-interpolation-filters': 'sRGB' } },
    s('feColorMatrix', { attrs: { type: 'matrix', values: `0 0 0 0 ${c(r)}  0 0 0 0 ${c(g)}  0 0 0 0 ${c(b)}  -0.25 -0.45 -0.08 1 0` } }),
  );
}

export interface BleedStyle {
  /** 換墨色的 SVG 濾鏡 id（見 inkTintFilter）。 */
  readonly tint?: string;
  /** 模糊（CSS 像素）。 */
  readonly blur: number;
  readonly opacity: number;
  /** 先蓋一層紙色把底下清楚的字洗掉（0～1）。 */
  readonly wash?: number;
  /** 字整片錯開（CSS 像素，拖長的抹痕）。 */
  readonly dx?: number;
  readonly dy?: number;
}

/**
 * 字的複製品（拿掉標記與編號），模糊並染色後只顯示在指定範圍內。
 * 換色的濾鏡放在字上，模糊與透明度放在外層；都是一般的 CSS filter，預覽與列印的 PDF 相同。
 */
export function bleedLayer(content: HTMLElement, polygons: readonly (readonly Point[])[], evenodd: boolean, style: BleedStyle): HTMLElement {
  const clone = content.cloneNode(true) as HTMLElement;
  for (const el of clone.querySelectorAll('[data-mark]')) el.removeAttribute('data-mark');
  for (const el of clone.querySelectorAll('[data-block-id]')) el.removeAttribute('data-block-id');
  for (const el of clone.querySelectorAll('[id]')) el.removeAttribute('id');
  clone.removeAttribute('id');
  clone.classList.add('fx-bleed-text');
  clone.setAttribute('aria-hidden', 'true');
  if (style.tint) clone.style.setProperty('filter', `url(#${style.tint})`);
  const shifted = style.dx || style.dy ? `translate(${(style.dx ?? 0).toFixed(2)}px, ${(style.dy ?? 0).toFixed(2)}px)` : null;
  const blurred = h('div', { class: 'fx-bleed-blur', style: { filter: `blur(${style.blur.toFixed(2)}px)`, opacity: style.opacity.toFixed(2), transform: shifted } }, clone);
  const wash = style.wash ?? 0;
  const paperWash = wash > 0 ? [h('div', { class: 'fx-bleed-wash', style: { background: `rgb(250 244 228 / ${wash.toFixed(2)})` } })] : [];
  return h('div', { class: 'fx-bleed', style: { 'clip-path': `path(${evenodd ? 'evenodd, ' : ''}'${pxPath(polygons)}')` } }, ...paperWash, blurred);
}

