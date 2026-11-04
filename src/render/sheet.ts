// 紙張：頁面（列印時的一頁）與紙面（道具本體）。
// 紙面在建立時只放泛黃色調與紙紋；紙邊、破洞、浸水、斑點等「紙張狀況」要等內容排好、
// 量出保護區與必毀區的位置之後，才由 src/render/effects.ts 畫上去（見 applyPaperEffects）。
// 全部用 CSS、SVG 與 canvas 即時產生，不使用任何圖片素材。

import { fontStack, fontVertical } from '../fonts.ts';
import type { Point, Polygon } from '../lib/geometry.ts';
import { mulberry32 } from '../lib/random.ts';
import { PAPER_SIZES, type FontChoice, type PaperKey } from '../props/common.ts';
import type { ConditionData } from '../props/conditions.ts';
import { h } from '../ui/dom.ts';
import { registerPaper } from './effects.ts';

/** 可重現的亂數（mulberry32）。 */
export function seededRandom(seed: number): () => number {
  return mulberry32(seed);
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

export interface PaperSurfaceOptions {
  readonly width: number;
  readonly height: number;
  readonly conditions: ConditionData;
  /** 同一頁有多張紙（名片拼版）時用來讓每張的隨機效果不同。 */
  readonly variant?: number;
  /** 第一版的「剪報毛邊」（只在沒有選擇其他紙邊樣式時使用）。 */
  readonly roughEdge?: boolean;
  /** 自由裁切或「從整版剪下」的外形（紙面座標，公釐）。 */
  readonly crop?: Polygon | null;
  readonly className: string;
  /** 紙紋的顏色：一般泛黃或灰階（掃描感）。 */
  readonly grain?: 'warm' | 'gray';
  /** 報頭、標題、內文、廣告大字、手寫部分的字型（src/fonts.ts 的 id）。 */
  readonly fonts?: FontChoice;
}

/** 建立紙面（道具本體），回傳紙面與放內容的容器。 */
export function createPaperSurface(options: PaperSurfaceOptions): { paper: HTMLDivElement; content: HTMLDivElement } {
  const c = options.conditions;
  const level = ['none', 'light', 'medium', 'heavy'].includes(c.aging) ? c.aging : 'none';
  const content = h('div', { class: 'paper-content' });
  if (options.fonts) {
    content.style.setProperty('--f-masthead', fontStack(options.fonts.masthead, 'title'));
    content.style.setProperty('--f-title', fontStack(options.fonts.title, 'title'));
    content.style.setProperty('--f-ad', fontStack(options.fonts.ad, 'title'));
    content.style.setProperty('--f-body', fontStack(options.fonts.body, 'body'));
    content.style.setProperty('--f-hand', fontStack(options.fonts.hand, 'hand'));
    // 有些手寫字型（清松 7、8）直排時上字的長筆畫會碰到下字：加大字距
    const v = fontVertical(options.fonts.hand);
    if (v.letterSpacing) content.style.setProperty('--hand-ls', `${v.letterSpacing}em`);
  }
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
    paper.appendChild(grainLayer(options.grain ?? 'warm'));
  }
  if (options.roughEdge && c.edge === 'none' && !options.crop) {
    paper.style.setProperty('clip-path', roughEdgePolygon(options.width, options.height, c.effectSeed * 104729 + (options.variant ?? 0)));
    paper.classList.add('rough-edge');
  }
  registerPaper(paper, {
    width: options.width,
    height: options.height,
    conditions: c,
    crop: options.crop ?? null,
    variant: options.variant ?? 0,
  });
  return { paper, content };
}

const GRAIN_SIZE = 256;
const grainUrls = new Map<string, string>();

/**
 * 紙紋：用 canvas 產生一小塊可無縫重複的雜訊（多層平滑雜訊＋細顆粒），轉成 PNG 後平鋪。
 * 不用 SVG feTurbulence 鋪滿整頁，是因為那會讓瀏覽器把整頁轉成高解析度點陣圖，PDF 會大到十幾 MB。
 */
function grainTexture(kind: 'warm' | 'gray'): string | null {
  const cached = grainUrls.get(kind);
  if (cached !== undefined) return cached;
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
    if (kind === 'gray') {
      // 掃描感：灰階雜訊，外加零星的黑點（掃描與影印留下的雜點）
      const speck = rand() < 0.0035;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = speck ? 20 : 70;
      img.data[i * 4 + 3] = speck ? 200 : Math.round(alpha * 120);
      continue;
    }
    img.data[i * 4] = 112;
    img.data[i * 4 + 1] = 82;
    img.data[i * 4 + 2] = 38;
    img.data[i * 4 + 3] = Math.round(alpha * 150);
  }
  ctx.putImageData(img, 0, 0);
  const url = canvas.toDataURL('image/png');
  grainUrls.set(kind, url);
  return url;
}

function grainLayer(kind: 'warm' | 'gray'): HTMLElement {
  const url = grainTexture(kind);
  return h('div', {
    class: 'age-layer age-grain',
    attrs: { 'aria-hidden': 'true' },
    style: { 'background-image': url ? `url("${url}")` : null },
  });
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

/**
 * 與 roughEdgePolygon 相同的剪刀毛邊，換算成紙面公釐的多邊形（同一個種子、同樣的抖動順序）。
 * width、height 是原本的紙面大小（決定取幾個點），actualW、actualH 是排版後實際的大小。
 */
export function roughEdgePoints(width: number, height: number, seed: number, actualW = width, actualH = height): Point[] {
  const rand = seededRandom(seed);
  const jitter = (): number => Number((rand() * 0.9).toFixed(2));
  const nx = Math.max(8, Math.round(width / 3));
  const ny = Math.max(8, Math.round(height / 3));
  const pts: Point[] = [];
  for (let i = 0; i < nx; i++) pts.push({ x: (actualW * i) / nx, y: jitter() });
  for (let i = 0; i < ny; i++) pts.push({ x: actualW - jitter(), y: (actualH * i) / ny });
  for (let i = nx; i > 0; i--) pts.push({ x: (actualW * i) / nx, y: actualH - jitter() });
  for (let i = ny; i > 0; i--) pts.push({ x: jitter(), y: (actualH * i) / ny });
  return pts;
}
