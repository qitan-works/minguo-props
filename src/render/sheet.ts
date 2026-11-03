// 紙張與做舊效果。全部用 CSS 漸層與 SVG 濾鏡（feTurbulence 等）即時產生，
// 不使用任何圖片素材。濾鏡定義在 index.html 的 <svg class="svg-defs">。

import { PAPER_SIZES, type PaperKey } from '../props/common.ts';
import { h, s } from '../ui/dom.ts';

export interface AgingOptions {
  readonly aging: string;
  readonly folds: boolean;
  readonly stains: boolean;
  readonly stainSeed: string;
}

export interface FoldLines {
  /** 水平摺痕位置（0～1，由上往下）。 */
  readonly horizontal: readonly number[];
  /** 垂直摺痕位置（0～1，由左往右）。 */
  readonly vertical: readonly number[];
}

/** 可重現的亂數（mulberry32），同一個種子永遠得到同樣的污漬位置。 */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 建立一張「頁面」：列印時剛好是一頁紙。 */
export function createSheet(paper: PaperKey): HTMLDivElement {
  const size = PAPER_SIZES[paper];
  return h('div', {
    class: 'sheet',
    dataset: { page: size.page },
    style: { '--sheet-w': `${size.width}mm`, '--sheet-h': `${size.height}mm` },
  });
}

export interface PaperSurfaceOptions extends AgingOptions {
  readonly width: number;
  readonly height: number;
  readonly foldLines: FoldLines;
  /** 剪報的不規則剪裁邊緣。 */
  readonly roughEdge?: boolean;
  /** 不同道具用不同的種子偏移，避免污漬總在同一處。 */
  readonly seedOffset: number;
  readonly className: string;
}

/** 建立紙面（道具本體），回傳紙面與放內容的容器。 */
export function createPaperSurface(options: PaperSurfaceOptions): { paper: HTMLDivElement; content: HTMLDivElement } {
  const level = ['none', 'light', 'medium', 'heavy'].includes(options.aging) ? options.aging : 'none';
  const content = h('div', { class: 'paper-content' });
  const paper = h(
    'div',
    {
      class: ['paper', options.className, `aging-${level}`],
      style: { '--paper-w': `${options.width}mm`, '--paper-h': `${options.height}mm` },
    },
    content,
  );

  if (level !== 'none') {
    paper.appendChild(h('div', { class: 'age-layer age-tone', attrs: { 'aria-hidden': 'true' } }));
    paper.appendChild(grainLayer());
  }
  if (options.folds) {
    for (const y of options.foldLines.horizontal) {
      paper.appendChild(h('div', { class: 'age-layer fold fold-h', style: { top: `${y * 100}%` }, attrs: { 'aria-hidden': 'true' } }));
    }
    for (const x of options.foldLines.vertical) {
      paper.appendChild(h('div', { class: 'age-layer fold fold-v', style: { left: `${x * 100}%` }, attrs: { 'aria-hidden': 'true' } }));
    }
  }
  if (options.stains) {
    const seed = Number.parseInt(options.stainSeed, 10) || 1;
    paper.appendChild(stainLayer(options.width, options.height, seed * 7919 + options.seedOffset));
  }
  if (options.roughEdge) {
    const seed = (Number.parseInt(options.stainSeed, 10) || 1) * 104729 + options.seedOffset;
    paper.style.setProperty('clip-path', roughEdgePolygon(options.width, options.height, seed));
    paper.classList.add('rough-edge');
  }
  return { paper, content };
}

const GRAIN_SIZE = 256;
let grainUrl: string | null = null;

/**
 * 紙紋：用 canvas 產生一小塊可無縫重複的雜訊（多層平滑雜訊＋細顆粒），轉成 PNG 後平鋪。
 * 不用 SVG feTurbulence 鋪滿整頁，是因為那會讓瀏覽器把整頁轉成高解析度點陣圖，PDF 會大到十幾 MB。
 */
function grainTexture(): string | null {
  if (grainUrl !== null) return grainUrl;
  const canvas = document.createElement('canvas');
  canvas.width = GRAIN_SIZE;
  canvas.height = GRAIN_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const rand = seededRandom(20261105);
  const n = GRAIN_SIZE;
  // 可平鋪的格點雜訊：每層在 n/cell 的格點上取亂數，雙線性內插，座標取模以無縫銜接。
  const layer = (cell: number): Float32Array => {
    const g = n / cell;
    const grid = Float32Array.from({ length: g * g }, () => rand());
    const out = new Float32Array(n * n);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const gx = x / cell;
        const gy = y / cell;
        const x0 = Math.floor(gx) % g;
        const y0 = Math.floor(gy) % g;
        const x1 = (x0 + 1) % g;
        const y1 = (y0 + 1) % g;
        const fx = gx - Math.floor(gx);
        const fy = gy - Math.floor(gy);
        const v = (i: number, j: number): number => grid[j * g + i] ?? 0;
        const top = v(x0, y0) * (1 - fx) + v(x1, y0) * fx;
        const bottom = v(x0, y1) * (1 - fx) + v(x1, y1) * fx;
        out[y * n + x] = top * (1 - fy) + bottom * fy;
      }
    }
    return out;
  };
  const coarse = layer(64);
  const mid = layer(16);
  const fine = layer(4);
  const img = ctx.createImageData(n, n);
  for (let i = 0; i < n * n; i++) {
    const v = 0.35 * (coarse[i] ?? 0) + 0.3 * (mid[i] ?? 0) + 0.2 * (fine[i] ?? 0) + 0.15 * rand();
    const alpha = Math.max(0, Math.min(1, (v - 0.35) * 1.6));
    img.data[i * 4] = 112;
    img.data[i * 4 + 1] = 82;
    img.data[i * 4 + 2] = 38;
    img.data[i * 4 + 3] = Math.round(alpha * 150);
  }
  ctx.putImageData(img, 0, 0);
  grainUrl = canvas.toDataURL('image/png');
  return grainUrl;
}

function grainLayer(): HTMLElement {
  const url = grainTexture();
  return h('div', {
    class: 'age-layer age-grain',
    attrs: { 'aria-hidden': 'true' },
    style: { 'background-image': url ? `url("${url}")` : null },
  });
}

function stainLayer(width: number, height: number, seed: number): SVGSVGElement {
  const rand = seededRandom(seed);
  const svg = s('svg', {
    class: 'age-layer age-stains',
    attrs: { 'aria-hidden': 'true', viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: 'xMidYMid slice' },
  });
  const scale = Math.min(width, height);
  // 兩三團水漬
  const blots = 2 + Math.floor(rand() * 2);
  for (let i = 0; i < blots; i++) {
    const cx = width * (0.1 + rand() * 0.8);
    const cy = height * (0.1 + rand() * 0.8);
    const r = scale * (0.05 + rand() * 0.08);
    svg.appendChild(
      s('ellipse', {
        class: 'stain-blot',
        attrs: { cx, cy, rx: r, ry: r * (0.7 + rand() * 0.5), filter: 'url(#f-stain)' },
      }),
    );
  }
  // 一個茶杯或咖啡杯底的圓環（不一定完整）
  const cx = width * (0.15 + rand() * 0.7);
  const cy = height * (0.15 + rand() * 0.7);
  const r = scale * (0.07 + rand() * 0.04);
  const circumference = 2 * Math.PI * r;
  svg.appendChild(
    s('circle', {
      class: 'stain-ring',
      attrs: {
        cx,
        cy,
        r,
        'stroke-width': Math.max(0.6, scale * 0.006),
        'stroke-dasharray': `${circumference * (0.55 + rand() * 0.4)} ${circumference}`,
        transform: `rotate(${Math.floor(rand() * 360)} ${cx} ${cy})`,
        filter: 'url(#f-ring)',
      },
    }),
  );
  // 幾點細小斑點（霉斑）
  const specks = 6 + Math.floor(rand() * 8);
  for (let i = 0; i < specks; i++) {
    svg.appendChild(
      s('circle', {
        class: 'stain-speck',
        attrs: { cx: width * rand(), cy: height * rand(), r: 0.2 + rand() * 0.7 },
      }),
    );
  }
  return svg;
}

/**
 * 剪刀剪出的邊緣：沿四邊大約每 3 公釐取一點，向內隨機偏移。
 * 位置用百分比表示，紙面寬度改變（例如剪報貼合內容）時仍然正確。
 */
export function roughEdgePolygon(width: number, height: number, seed: number): string {
  const rand = seededRandom(seed);
  const jitter = (): string => (rand() * 0.9).toFixed(2);
  const nx = Math.max(8, Math.round(width / 3));
  const ny = Math.max(8, Math.round(height / 3));
  const pct = (i: number, n: number): string => `${((i / n) * 100).toFixed(2)}%`;
  const pts: string[] = [];
  for (let i = 0; i < nx; i++) pts.push(`${pct(i, nx)} ${jitter()}mm`);
  for (let i = 0; i < ny; i++) pts.push(`calc(100% - ${jitter()}mm) ${pct(i, ny)}`);
  for (let i = nx; i > 0; i--) pts.push(`${pct(i, nx)} calc(100% - ${jitter()}mm)`);
  for (let i = ny; i > 0; i--) pts.push(`${jitter()}mm ${pct(i, ny)}`);
  return `polygon(${pts.join(', ')})`;
}

/** 檢查標了 data-fit 的區塊是否有內容超出（超出部分不會印出）。 */
export function findOverflow(root: ParentNode): boolean {
  for (const el of root.querySelectorAll<HTMLElement>('[data-fit]')) {
    if (el.dataset['overflow'] === 'true') return true;
    if (el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 2) return true;
  }
  return false;
}
