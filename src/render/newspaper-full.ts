// 整版報紙與「從整版剪下」（第四版）。版面由 src/lib/newspaper/sections.ts 以分段網格計算
// （每一行放哪些字都已固定），這裡把報頭、報眉、各區塊、欄線與段線畫到紙上，
// 每個區塊照它自己的樣式（標題字型、大小、空心字、黑底白字、加框、陰影、括號，內文大小與割注，
// 框線與花邊）畫出來，再加上鉛字印刷的質感與透背。
// 剪下時整張版面照樣排好，再用 clip-path 沿剪線裁切，所以壓在剪線上的字會真的被切成一半。

import { cutPolygon, isCutStyle } from '../lib/cutline.ts';
import { PX_PER_MM, polygonToPath, unionRects, type Point, type Rect } from '../lib/geometry.ts';
import { formatLunar, ganzhiYear, toLunar } from '../lib/lunar.ts';
import { formatMinguoDate, parseIsoDate, type SimpleDate } from '../lib/minguo.ts';
import { layoutAd, type AdItem } from '../lib/newspaper/ads.ts';
import { cutFrame } from '../lib/newspaper/blocks.ts';
import { EMPTY_BLOCK_EXTRAS, type BlockEdit, type BlockStyle, type Frame } from '../lib/newspaper/blockstyle.ts';
import { createContent } from '../lib/newspaper/content.ts';
import { adFromFiller, buildBroadsheetPool, flowFromFiller, type BroadsheetPool } from '../lib/newspaper/fillers.ts';
import type { FlowItem, FlowLine } from '../lib/newspaper/flow.ts';
import { isPageType, planPage, resolveBlocks, type PageType, type PlannedBlock } from '../lib/newspaper/pageplan.ts';
import { columnSkew, pagePlacement, pressGlyph, ruleInk } from '../lib/newspaper/press.ts';
import { isPunctuationMode, type Glyph, type PunctuationMode } from '../lib/newspaper/punctuation.ts';
import { layoutSections, type PlacedBlock, type SectionLayout } from '../lib/newspaper/sections.ts';
import { broadsheetGeometry, colLeft, isMastheadLayout, rowTop, type BroadsheetGeometry } from '../lib/newspaper/sheetgeom.ts';
import { rngFor } from '../lib/random.ts';
import { fontStack } from '../fonts.ts';
import { PAPER_SIZES, fontsOf, isPaperKey, type PaperKey } from '../props/common.ts';
import { pickConditions } from '../props/conditions.ts';
import { headlineMix } from '../props/eras.ts';
import type { NewspaperExtras } from '../props/extras.ts';
import type { NewspaperData } from '../props/newspaper.ts';
import { h, s } from '../ui/dom.ts';
import { setPaperCrop } from './effects.ts';
import { outlineTextSvg, patternFrameSvg, pictureSvg } from './illustrations.ts';
import { createPaperSurface, createSheet } from './sheet.ts';

export interface FullPageRender {
  readonly sheet: HTMLElement;
  readonly layout: SectionLayout;
  readonly geometry: BroadsheetGeometry;
  readonly pool: BroadsheetPool;
  /** 這一版的區塊（版面類型排的起點，已套上使用者的修改）。 */
  readonly blocks: readonly PlannedBlock[];
  /** 剪下模式的剪線（紙面座標）。 */
  readonly cut: { readonly polygon: readonly Point[]; readonly frame: Rect } | null;
}

/** 第四版的字比第三版小，一段才放得下八九個字：A4 2.7 mm、A5 2.3 mm。 */
export function v4Cell(width: number, height: number): number {
  const area = width * height;
  return area >= 60000 ? 2.7 : area <= 32000 ? 2.3 : 2.5;
}

/** 「自動」段數依紙張：A4 直式 10 段，其餘 8 段。 */
export function autoSections(paper: PaperKey): number {
  return paper === 'a4-portrait' ? 10 : paper === 'a5-portrait' ? 9 : 8;
}

export function sectionsOf(data: Pick<NewspaperData, 'sections' | 'paper'>): number {
  const paper = isPaperKey(data.paper) ? data.paper : 'a4-portrait';
  const n = Number(data.sections);
  return Number.isInteger(n) && n >= 8 && n <= 12 ? n : autoSections(paper);
}

function mm(n: number): string {
  return `${n.toFixed(3)}mm`;
}

const ROLE_FONT: Readonly<Record<FlowLine['role'], string>> = {
  h1: 'var(--f-title)',
  h2: 'var(--f-h2)',
  h3: 'var(--f-h3)',
  sub: 'var(--f-sub)',
  kicker: 'var(--f-body)',
  body: 'var(--f-body)',
  row: 'var(--f-body)',
  tiny: 'var(--f-body)',
};

interface Ctx {
  readonly g: BroadsheetGeometry;
  readonly press: number;
  readonly seed: number;
}

/** 一串字畫成 DOM：需要時每個字一個 span（鉛字質感、圈點、文字層標記）。 */
function fillGlyphs(el: HTMLElement, glyphs: readonly Glyph[], ctx: Ctx, key: string): void {
  const needSpans = ctx.press > 0 || glyphs.some((gl) => gl.pm || gl.mark);
  if (!needSpans) {
    el.textContent = glyphs.map((gl) => gl.ch).join('');
    return;
  }
  const rng = rngFor(ctx.seed, `press:${key}`);
  let container: HTMLElement = el;
  let currentMark: string | undefined;
  for (const gl of glyphs) {
    const mark = gl.mark === 'rewrite' ? 'strike' : gl.mark;
    if (mark !== currentMark) {
      currentMark = mark;
      container = el;
      if (mark) {
        container = h('span', { class: ['mk', `mk-${mark}`], dataset: { mark } });
        el.appendChild(container);
      }
    }
    if (ctx.press <= 0 && !gl.pm) {
      container.appendChild(document.createTextNode(gl.ch));
      continue;
    }
    const span = h('span', { class: ['gl', gl.pm && 'pm'], text: gl.ch, dataset: gl.pm ? { pm: gl.pm } : {} });
    if (ctx.press > 0 && gl.ch !== '　') {
      const p = pressGlyph(rng, ctx.press);
      span.style.setProperty('transform', `translate(${p.dx.toFixed(3)}em, ${p.dy.toFixed(3)}em) rotate(${p.rot.toFixed(2)}deg)`);
      if (p.ink < 0.98) span.style.setProperty('--a', p.ink.toFixed(2));
      if (p.chip) span.classList.add(`chip${p.chip}`);
    }
    container.appendChild(span);
  }
}

/** 區塊的範圍（紙面座標）。 */
export function blockRect(g: BroadsheetGeometry, b: Pick<PlacedBlock, 'col' | 'w' | 'top' | 'bottom'>): Rect {
  const x = colLeft(g, b.col + b.w - 1);
  return { x, y: rowTop(g, b.top), w: b.w * g.pitch, h: (b.bottom - b.top) * g.cell };
}

/** 框線的位置：區塊範圍略內縮，上方留出段線。 */
function frameRect(g: BroadsheetGeometry, b: PlacedBlock): Rect {
  const r = blockRect(g, b);
  const top = b.gapTop ? g.cell * 0.55 : g.cell * 0.12;
  return { x: r.x + g.pitch * 0.1, y: r.y + top, w: r.w - g.pitch * 0.2, h: r.h - top - g.cell * 0.15 };
}

/** 框線（SVG）：單線、雙線、粗細線、點線；花邊另外畫。 */
function frameSvg(r: Rect, frame: Exclude<Frame, 'none' | 'pattern'> | 'corners', ctx: Ctx, key: string): SVGSVGElement {
  const svg = s('svg', {
    class: 'nf-framebox',
    attrs: { viewBox: `0 0 ${r.w.toFixed(3)} ${r.h.toFixed(3)}`, 'aria-hidden': 'true', 'data-frame': frame },
    style: { left: mm(r.x), top: mm(r.y), width: mm(r.w), height: mm(r.h) },
  });
  const rng = rngFor(ctx.seed, `frame:${key}`);
  const rect = (inset: number, base: number, extra: Record<string, string> = {}): void => {
    const ink = ruleInk(rng, ctx.press, base, r.w + r.h);
    svg.appendChild(
      s('rect', {
        attrs: {
          x: inset.toFixed(3),
          y: inset.toFixed(3),
          width: Math.max(0.1, r.w - 2 * inset).toFixed(3),
          height: Math.max(0.1, r.h - 2 * inset).toFixed(3),
          fill: 'none',
          stroke: 'currentColor',
          'stroke-width': String(ink.width),
          opacity: String(ink.opacity),
          ...extra,
        },
      }),
    );
  };
  switch (frame) {
    case 'double':
      rect(0.3, 0.22);
      rect(0.95, 0.22);
      break;
    case 'thickthin':
      rect(0.45, 0.75);
      rect(1.35, 0.2);
      break;
    case 'dotted':
      rect(0.4, 0.42, { 'stroke-dasharray': '0.01 0.85', 'stroke-linecap': 'round' });
      rect(1.15, 0.18);
      break;
    default:
      rect(0.35, 0.3);
  }
  return svg;
}

function drawFrame(out: Element[], r: Rect, style: BlockStyle, ctx: Ctx, key: string): void {
  if (style.frame === 'none') return;
  if (style.frame === 'pattern') out.push(patternFrameSvg(r, style.pattern, Math.min(ctx.g.pitch * 0.7, Math.min(r.w, r.h) * 0.12)));
  else out.push(frameSvg(r, style.frame, ctx, key));
}

const TITLE_ROLES = new Set<FlowLine['role']>(['h1', 'h2', 'h3']);

/** 一行字：一般的直排、割注（一行兩小行），或套上區塊標題樣式的標題。 */
function lineElements(b: PlacedBlock, line: FlowLine, ctx: Ctx, key: string, titleStyled: boolean): Element[] {
  const { g } = ctx;
  const leftSlot = b.slots[line.slot + line.span - 1] ?? b.slots[line.slot];
  const x = colLeft(g, leftSlot?.col ?? 0);
  const width = line.span * g.pitch;
  const top = rowTop(g, line.top);
  const height = line.length * g.cell;
  const style = b.style;
  if (titleStyled && style.titleStyle === 'outline') {
    const chars = line.glyphs.map((gl) => gl.ch);
    return [outlineTextSvg(chars, { x, y: top, w: width, h: height }, line.size * g.cell, 'v', ROLE_FONT[line.role])];
  }
  const make = (left: number, w: number, glyphs: readonly Glyph[], k: string, extra: string | false = false): HTMLElement => {
    const el = h('div', {
      class: ['nl', `nl-${line.role}`, line.align === 'center' && 'nl-center', extra],
      style: { left: mm(left), top: mm(top), width: mm(w), height: mm(height), 'font-size': mm(line.size * g.cell), 'line-height': mm(w), 'font-family': ROLE_FONT[line.role] },
    });
    if (ctx.press > 0) {
      const skew = columnSkew(rngFor(ctx.seed, `skew:${k}`), ctx.press);
      if (Math.abs(skew) > 0.01) el.style.setProperty('transform', `rotate(${skew.toFixed(3)}deg)`);
    }
    fillGlyphs(el, glyphs, ctx, k);
    return el;
  };
  if (line.split) {
    // 割注：前一半在右、後一半在左
    const per = Math.max(1, Math.floor(line.length / line.size));
    const right = line.glyphs.slice(0, per);
    const left = line.glyphs.slice(per);
    return [make(x + width / 2, width / 2, right, `${key}r`, 'nl-split'), make(x, width / 2, left, `${key}l`, 'nl-split')];
  }
  const el = make(x, width, line.glyphs, key, titleStyled && `ttl ttl-${style.titleStyle}`);
  if (titleStyled && (style.titleStyle === 'inverted' || style.titleStyle === 'boxed')) {
    // 黑底與框貼著字：只框住有字的那一段
    const used = line.glyphs.length * line.size * g.cell + line.size * g.cell * 0.5;
    const t = top + Math.max(0, (height - used) / 2);
    el.style.setProperty('top', mm(t));
    el.style.setProperty('height', mm(Math.min(height, used)));
  }
  return [el];
}

/** 文字區塊（新聞、短訊、社論、專電、啟事、連載）。 */
function flowRegion(b: PlacedBlock, ctx: Ctx): Element[] {
  const out: Element[] = [];
  const { g } = ctx;
  b.lines.forEach((line, i) => {
    const titled = line.itemId === b.headItemId && TITLE_ROLES.has(line.role);
    out.push(...lineElements(b, line, ctx, `${b.id}:${i}`, titled));
  });
  const r = blockRect(g, b);
  if (b.tag) {
    const firstCol = b.col + b.inset.cols;
    const top = b.top + (b.gapTop ? 1 : 0) + b.inset.rows;
    out.push(
      h('div', {
        class: 'nf-tag',
        text: b.tag.text,
        style: { left: mm(colLeft(g, firstCol) + g.pitch * 0.06), top: mm(rowTop(g, top) + g.cell * 0.1), width: mm(g.pitch * 0.88), height: mm((b.tag.rows - 0.3) * g.cell), 'font-size': mm(g.cell * 0.82) },
      }),
    );
  }
  if (b.band) {
    const inner = { x: r.x + b.inset.cols * g.pitch, w: r.w - 2 * b.inset.cols * g.pitch };
    const top = rowTop(g, b.top + (b.gapTop ? 1 : 0) + b.inset.rows);
    b.band.lines.forEach((line, i) => {
      const size = line.size * g.cell;
      const chars = Array.from(line.text);
      const y = top + line.row * g.cell;
      if (b.style.titleStyle === 'outline') {
        out.push(outlineTextSvg(chars, { x: inner.x, y, w: inner.w, h: size * 1.08 }, size, 'h', 'var(--f-title)'));
        return;
      }
      const hug = b.style.titleStyle === 'inverted' || b.style.titleStyle === 'boxed';
      const w = hug ? Math.min(inner.w, chars.length * size + size * 0.6) : inner.w;
      const el = h('div', {
        class: ['nf-band', `ttl`, `ttl-${b.style.titleStyle}`],
        style: { left: mm(inner.x + (inner.w - w) / 2), top: mm(y), width: mm(w), height: mm(size * 1.08), 'font-size': mm(size), 'line-height': mm(size * 1.08) },
      });
      fillGlyphs(el, chars.map((ch) => ({ ch })), { ...ctx, press: ctx.press * 0.6 }, `${b.id}:band:${i}`);
      out.push(el);
    });
  }
  drawFrame(out, frameRect(g, b), b.style, ctx, b.id);
  return out;
}

/** 廣告：特大字、說明、價目與發行所，依區塊樣式加框、空心字、黑底白字或插圖。 */
function adRegion(b: PlacedBlock, ctx: Ctx): Element[] {
  const { g } = ctx;
  const out: Element[] = [];
  const ad = b.ad;
  if (!ad) return out;
  const r0 = frameRect(g, b);
  const inverted = b.style.titleStyle === 'inverted';
  let box: Rect = { x: r0.x + 0.6, y: r0.y + 0.6, w: r0.w - 1.2, h: r0.h - 1.2 };
  if (b.style.frame === 'pattern') {
    const band = Math.min(g.pitch * 0.7, Math.min(r0.w, r0.h) * 0.12);
    box = { x: r0.x + band + 0.4, y: r0.y + band + 0.4, w: r0.w - 2 * band - 0.8, h: r0.h - 2 * band - 0.8 };
  }
  // 插圖：寬的廣告放在左邊，高的放在下方
  if (b.style.picture !== 'none' && box.w > 16 && box.h > 14) {
    if (box.w >= box.h * 0.9) {
      const pw = Math.min(box.w * 0.34, box.h);
      out.push(pictureSvg(b.style.picture, { x: box.x + 0.5, y: box.y + (box.h - pw) / 2, w: pw, h: pw }));
      box = { ...box, x: box.x + pw + 0.8, w: box.w - pw - 0.8 };
    } else {
      const ph = Math.min(box.h * 0.36, box.w);
      out.push(pictureSvg(b.style.picture, { x: box.x + (box.w - ph) / 2, y: box.y + box.h - ph, w: ph, h: ph }));
      box = { ...box, h: box.h - ph - 0.6 };
    }
  }
  const layout = layoutAd(ad, box, rngFor(ctx.seed, `ad:${b.id}`)() * 2 ** 30, g.cell);
  if (inverted) out.unshift(h('div', { class: 'nf-ad-ink', style: { left: mm(r0.x), top: mm(r0.y), width: mm(r0.w), height: mm(r0.h) } }));
  else if (b.style.frame !== 'none') drawFrame(out, r0, b.style, ctx, b.id);
  layout.texts.forEach((t, i) => {
    const big = t.role === 'big';
    if (big && b.style.titleStyle === 'outline') {
      out.push(outlineTextSvg(Array.from(t.text), { x: t.x, y: t.y, w: t.w, h: t.h }, t.size, t.dir, 'var(--f-ad, var(--f-title))'));
      return;
    }
    const el = h('div', {
      class: ['nf-adt', `nf-adt-${t.role}`, t.dir === 'v' ? 'nf-adt-v' : 'nf-adt-h', big && `ttl-${b.style.titleStyle}`],
      style: { left: mm(t.x), top: mm(t.y), width: mm(t.w), height: mm(t.h), 'font-size': mm(t.size), 'line-height': mm(t.dir === 'v' ? t.w : t.h) },
    });
    fillGlyphs(el, Array.from(t.text).map((ch) => ({ ch })), { ...ctx, press: ctx.press * (big ? 0.5 : 1) }, `adt:${b.id}:${i}`);
    out.push(el);
  });
  if (layout.divider !== null) {
    out.push(h('div', { class: 'nf-ad-divider', style: { left: mm(layout.frame.x + 1.2), top: mm(layout.divider), width: mm(layout.frame.w - 2.4) } }));
  }
  return out;
}

/** 直排的一格文字：字太多時縮小。 */
function cellText(text: string, x: number, y: number, w: number, hgt: number, size: number, cls: string): HTMLElement {
  const n = Math.max(1, Array.from(text).length);
  const fs = Math.max(0.6, Math.min(size, (hgt * 0.94) / n, w * 0.88));
  return h('div', {
    class: ['nf-cell', cls],
    text,
    style: { left: mm(x), top: mm(y + Math.max(0, (hgt - n * fs) / 2)), width: mm(w), height: mm(Math.min(hgt, n * fs + 0.2)), 'font-size': mm(fs), 'line-height': mm(w) },
  });
}

/** 格線表格：最右一行是表名，其次是欄位名，之後每一行一項（由右而左），每一欄一格。 */
function tableRegion(b: PlacedBlock, ctx: Ctx): Element[] {
  const { g } = ctx;
  const t = b.table;
  const out: Element[] = [];
  if (!t) return out;
  const r = frameRect(g, b);
  const pad = 0.5;
  const inner: Rect = { x: r.x + pad, y: r.y + pad, w: r.w - 2 * pad, h: r.h - 2 * pad };
  const colW = g.pitch;
  const cols = Math.max(2, Math.floor(inner.w / colW));
  const itemCols = Math.max(1, cols - 2);
  const items = t.items.slice(0, itemCols);
  const used = (items.length + 2) * colW;
  const x0 = inner.x + inner.w - used;
  const rowH = inner.h / t.fields.length;
  const svg = s('svg', { class: 'nf-table-grid', attrs: { viewBox: `0 0 ${inner.w.toFixed(3)} ${inner.h.toFixed(3)}`, 'aria-hidden': 'true' }, style: { left: mm(inner.x), top: mm(inner.y), width: mm(inner.w), height: mm(inner.h) } });
  const line = (x1: number, y1: number, x2: number, y2: number, w = 0.18): void => {
    svg.appendChild(s('line', { attrs: { x1: x1.toFixed(3), y1: y1.toFixed(3), x2: x2.toFixed(3), y2: y2.toFixed(3), stroke: 'currentColor', 'stroke-width': String(w) } }));
  };
  const lx = x0 - inner.x;
  line(lx, 0, inner.w, 0, 0.3);
  line(lx, inner.h, inner.w, inner.h, 0.3);
  for (let k = 0; k <= items.length + 2; k++) line(lx + k * colW, 0, lx + k * colW, inner.h, k === items.length + 1 || k === items.length + 2 || k === 0 ? 0.3 : 0.16);
  for (let f = 1; f < t.fields.length; f++) line(lx, f * rowH, lx + (items.length + 1) * colW, f * rowH, f === 1 ? 0.28 : 0.14);
  out.push(svg);
  // 表名（黑底白字或加框）
  const titleX = x0 + (items.length + 1) * colW;
  const title = cellText(b.style.title.trim() || t.title, titleX, inner.y, colW, inner.h, g.cell * 1.15, `nf-cell-title ttl ttl-${b.style.titleStyle}`);
  out.push(title);
  t.fields.forEach((field, f) => out.push(cellText(field, x0 + items.length * colW, inner.y + f * rowH, colW, rowH, g.cell * 0.85, 'nf-cell-field')));
  items.forEach((item, k) => {
    const x = x0 + (items.length - 1 - k) * colW;
    item.forEach((v, f) => out.push(cellText(v, x, inner.y + f * rowH, colW, rowH, g.cell * 0.82, f === 0 ? 'nf-cell-name' : 'nf-cell-value')));
  });
  drawFrame(out, r, b.style, ctx, b.id);
  return out;
}

/** 目錄框：最右是標題，每一行一條：篇名在上、頁碼在下，中間點線引導。 */
function tocRegion(b: PlacedBlock, ctx: Ctx): Element[] {
  const { g } = ctx;
  const t = b.toc;
  const out: Element[] = [];
  if (!t) return out;
  const r = frameRect(g, b);
  const heavy = b.style.frame === 'double' || b.style.frame === 'thickthin' || b.style.frame === 'pattern';
  const pad = heavy ? 1.6 : 0.8;
  const inner: Rect = { x: r.x + pad, y: r.y + pad, w: r.w - 2 * pad, h: r.h - 2 * pad };
  const colW = g.pitch;
  const cols = Math.max(2, Math.floor(inner.w / colW));
  const x0 = inner.x + inner.w;
  out.push(cellText(b.style.title.trim() || t.title, x0 - colW, inner.y, colW, inner.h, g.cell * 1.1, `nf-cell-title ttl ttl-${b.style.titleStyle}`));
  const entries = t.entries.slice(0, cols - 1);
  const svg = s('svg', { class: 'nf-toc-leaders', attrs: { viewBox: `0 0 ${inner.w.toFixed(3)} ${inner.h.toFixed(3)}`, 'aria-hidden': 'true' }, style: { left: mm(inner.x), top: mm(inner.y), width: mm(inner.w), height: mm(inner.h) } });
  entries.forEach((e, k) => {
    const x = x0 - (k + 2) * colW;
    const textLen = Array.from(e.text).length;
    const size = Math.min(g.cell * 0.9, (inner.h * 0.7) / Math.max(1, textLen));
    out.push(h('div', { class: 'nf-cell nf-toc-text', text: e.text, style: { left: mm(x), top: mm(inner.y), width: mm(colW), height: mm(textLen * size + 0.2), 'font-size': mm(size), 'line-height': mm(colW) } }));
    const pageSize = g.cell * 0.85;
    const pageLen = Array.from(e.page).length;
    out.push(h('div', { class: 'nf-cell nf-toc-page', text: e.page, style: { left: mm(x), top: mm(inner.y + inner.h - pageLen * pageSize - 0.2), width: mm(colW), height: mm(pageLen * pageSize + 0.2), 'font-size': mm(pageSize), 'line-height': mm(colW) } }));
    // 點線引導
    const lx = x - inner.x + colW / 2;
    const y1 = textLen * size + 1;
    const y2 = inner.h - pageLen * pageSize - 1;
    if (y2 > y1) svg.appendChild(s('line', { attrs: { x1: lx.toFixed(3), y1: y1.toFixed(3), x2: lx.toFixed(3), y2: y2.toFixed(3), stroke: 'currentColor', 'stroke-width': '0.32', 'stroke-dasharray': '0.01 0.9', 'stroke-linecap': 'round' } }));
  });
  out.push(svg);
  drawFrame(out, r, b.style, ctx, b.id);
  return out;
}

/** 插圖：線條圖畫在框裡，最左一行是圖說；使用者的照片也放在這種區塊。 */
function pictureRegion(b: PlacedBlock, ctx: Ctx, photo: string): Element[] {
  const { g } = ctx;
  const out: Element[] = [];
  const pic = b.picture;
  if (!pic) return out;
  const r = frameRect(g, b);
  const capW = g.pitch;
  const area: Rect = { x: r.x + capW + 0.6, y: r.y + 1, w: r.w - capW - 1.6, h: r.h - 2 };
  if (b.plan.id === 'photo' && photo) {
    out.push(h('div', { class: 'nf-photo', style: { left: mm(area.x), top: mm(area.y), width: mm(area.w), height: mm(area.h) } }, h('img', { attrs: { src: photo, alt: '新聞照片' } })));
  } else {
    out.push(pictureSvg(pic.kind, area));
  }
  const caption = b.style.title.trim() || pic.caption;
  out.push(cellText(caption, r.x + 0.3, r.y + 1, capW, r.h - 2, g.cell * 0.82, 'nf-cell-caption'));
  drawFrame(out, r, b.style, ctx, b.id);
  return out;
}

function rulesSvg(layout: SectionLayout, ctx: Ctx): SVGSVGElement {
  const { g } = ctx;
  const svg = s('svg', {
    class: 'nf-rules',
    attrs: { viewBox: `0 0 ${g.area.w.toFixed(3)} ${g.area.h.toFixed(3)}`, 'aria-hidden': 'true' },
    style: { left: mm(g.area.x), top: mm(g.area.y), width: mm(g.area.w), height: mm(g.area.h) },
  });
  layout.rules.forEach((rule, i) => {
    const rng = rngFor(ctx.seed, `rule:${i}`);
    let x1: number;
    let y1: number;
    let x2: number;
    let y2: number;
    if (rule.dir === 'v') {
      x1 = x2 = g.area.w - rule.at * g.pitch + g.pitch * 0.06;
      y1 = rule.from * g.cell + (rule.from > 0 ? g.cell * 0.5 : 0);
      y2 = rule.to * g.cell + (rule.to < layout.rows ? g.cell * 0.5 : 0);
    } else {
      y1 = y2 = rule.at * g.cell + g.cell * 0.5;
      x1 = g.area.w - rule.to * g.pitch + g.pitch * 0.06;
      x2 = g.area.w - rule.from * g.pitch + g.pitch * 0.06;
    }
    const length = Math.hypot(x2 - x1, y2 - y1);
    // 段線比欄線粗
    const ink = ruleInk(rng, ctx.press, rule.dir === 'h' ? 0.34 : 0.17, length);
    const attrs: Record<string, string> = {
      x1: x1.toFixed(3),
      y1: y1.toFixed(3),
      x2: x2.toFixed(3),
      y2: y2.toFixed(3),
      stroke: 'currentColor',
      'stroke-width': String(ink.width),
      opacity: String(ink.opacity),
      class: rule.dir === 'h' ? 'nf-rule-section' : 'nf-rule-col',
    };
    if (ink.dash) attrs['stroke-dasharray'] = ink.dash;
    svg.appendChild(s('line', { attrs }));
  });
  return svg;
}

function dateTexts(data: NewspaperData): { date: string; weekday: string; lunar: string; d: SimpleDate | null } {
  const d = parseIsoDate(data.date);
  if (!d) return { date: '', weekday: '', lunar: '', d: null };
  const full = formatMinguoDate(d, { weekday: true });
  const [date = '', weekday = ''] = full.split('　');
  const l = data.showLunar ? toLunar(d) : null;
  const lunar = l ? `舊曆${ganzhiYear(l.year)}年${formatLunar(l)}` : '';
  return { date, weekday, lunar, d };
}

function headerStrip(data: NewspaperData, g: BroadsheetGeometry): HTMLElement | null {
  if (!g.header) return null;
  const { date, weekday } = dateTexts(data);
  const r = g.header;
  return h(
    'header',
    { class: 'nf-header', style: { left: mm(r.x), top: mm(r.y), width: mm(r.w), height: mm(r.h), 'font-size': mm(g.cell * 0.82) } },
    h('div', { class: 'rtl-line', text: data.sheetLabel }),
    h('div', { class: 'rtl-line', text: `▷${[date, weekday, data.masthead].filter(Boolean).join('　')}◁` }),
    h('div', { class: 'rtl-line', text: data.pageLabel }),
  );
}

function mastheadBox(data: NewspaperData, g: BroadsheetGeometry, r: Rect): HTMLElement {
  const { date, weekday, lunar } = dateTexts(data);
  const name = Array.from(data.masthead.trim() || '　');
  const box = h('header', { class: ['nf-mh', `nf-mh-${g.layout}`], style: { left: mm(r.x), top: mm(r.y), width: mm(r.w), height: mm(r.h) } });
  const small = Math.max(2.6, g.cell * 0.95);
  if (g.layout === 'right') {
    // 右緣一行郵政掛號字樣；上方報名大字直排；下方由右而左排日期、舊曆、號數、定價，最左是英文報名
    const pad = 1.6;
    const lines = [date, [weekday, lunar].filter(Boolean).join('　'), data.issue, data.price].filter(Boolean);
    const noteW = small * 1.25;
    const innerW = r.w - 2 * pad - noteW - 0.6;
    const titleSize = Math.max(small * 2, Math.min(innerW / 1.08, ((r.h - 2 * pad) * 0.6) / name.length));
    const titleH = name.length * titleSize * 1.04;
    const noteX = r.w - pad - noteW;
    box.appendChild(h('div', { class: 'nf-mh-note vt', text: '中華郵政特准掛號認為新聞紙類', style: { left: mm(noteX), top: mm(pad + 1), width: mm(noteW), height: mm(r.h - 2 * pad - 2), 'font-size': mm(small * 0.8) } }));
    box.appendChild(h('div', { class: 'nf-mh-title vt', text: name.join(''), style: { left: mm(pad + (innerW - titleSize * 1.08) / 2), top: mm(pad + 1.2), width: mm(titleSize * 1.08), height: mm(titleH), 'font-size': mm(titleSize) } }));
    const top = pad + 1.2 + titleH + 1.5;
    const restH = r.h - top - pad - 0.5;
    const infoW = Math.min(small * 1.45, innerW / (lines.length + (data.englishName ? 1 : 0)));
    let x = noteX - 0.6;
    box.appendChild(h('div', { class: 'nf-mh-rule', style: { left: mm(pad + 0.4), top: mm(top - 0.9), width: mm(innerW - 0.4) } }));
    for (const text of lines) {
      x -= infoW;
      const size = Math.min(small, infoW / 1.25, restH / Math.max(6, Array.from(text).length));
      box.appendChild(h('div', { class: 'nf-mh-line vt', text, style: { left: mm(x), top: mm(top), width: mm(infoW), height: mm(restH), 'font-size': mm(size) } }));
    }
    if (data.englishName) {
      const enW = Math.max(infoW, x - pad);
      box.appendChild(h('div', { class: 'nf-mh-en', text: data.englishName.toUpperCase(), style: { left: mm(pad), top: mm(top), width: mm(Math.min(enW, x - pad)), height: mm(restH), 'font-size': mm(Math.min(small * 0.95, restH / Math.max(12, data.englishName.length * 0.7))) } }));
    }
  } else {
    // 角落或頂部橫排
    const pad = 1.4;
    const infoH = small * 1.25;
    const rowsOfInfo = 2 + (data.englishName ? 1 : 0);
    const titleSize = Math.min((r.h - 2 * pad - rowsOfInfo * infoH) * 0.95, ((r.w - 2 * pad) * 0.9) / name.length);
    box.appendChild(h('div', { class: 'nf-mh-title rtl-line', text: name.join(''), style: { left: mm(pad), top: mm(pad), width: mm(r.w - 2 * pad), height: mm(titleSize * 1.1), 'font-size': mm(titleSize), 'line-height': mm(titleSize * 1.1) } }));
    let y = pad + titleSize * 1.12;
    if (data.englishName) {
      box.appendChild(h('div', { class: 'nf-mh-en-h', text: data.englishName.toUpperCase(), style: { left: mm(pad), top: mm(y), width: mm(r.w - 2 * pad), height: mm(infoH), 'font-size': mm(small * 0.9), 'line-height': mm(infoH) } }));
      y += infoH;
    }
    const row1 = [date, weekday].filter(Boolean).join('　') + (lunar ? `（即${lunar}）` : '');
    const row2 = [data.issue, data.price].filter(Boolean).join('　　');
    for (const text of [row1, row2]) {
      box.appendChild(h('div', { class: 'nf-mh-info rtl-line', text, style: { left: mm(pad), top: mm(y), width: mm(r.w - 2 * pad), height: mm(infoH), 'font-size': mm(Math.min(small, ((r.w - 2 * pad) / Math.max(10, Array.from(text).length)) * 0.98)), 'line-height': mm(infoH) } }));
      y += infoH;
    }
  }
  return box;
}

/** 使用者的內容：主新聞、第二則、自己加的新聞、短訊、啟事與廣告。 */
function userContent(data: NewspaperData, extras: NewspaperExtras): { lead: FlowItem; second: FlowItem | null; items: FlowItem[]; notices: FlowItem[]; ads: AdItem[] } {
  const lead: FlowItem = {
    id: 'main',
    source: 'user',
    level: 1,
    title: data.headline,
    subtitles: data.subheadline.split(/[　 ]+/).filter(Boolean),
    ...(data.dateline ? { kicker: data.dateline } : {}),
    paragraphs: (data.body || '（內文）').split(/\r?\n/).map((p) => p.trim()).filter(Boolean),
  };
  const second: FlowItem | null =
    data.secondTitle || data.secondBody ? { id: 'second', source: 'user', level: 2, title: data.secondTitle, subtitles: [], paragraphs: data.secondBody.split(/\r?\n/).filter(Boolean) } : null;
  const items: FlowItem[] = [];
  const notices: FlowItem[] = [];
  const ads: AdItem[] = [];
  for (const item of extras.items) {
    if (!item.title && !item.body) continue;
    if (item.kind === 'ad') ads.push(adFromFiller({ id: item.id, kind: 'ad', title: item.title, body: item.body }, 'user'));
    else if (item.kind === 'notice') notices.push(flowFromFiller({ id: item.id, kind: 'notice', title: item.title, body: item.body }, 'user', 3));
    else items.push(flowFromFiller({ id: item.id, kind: item.kind, title: item.title, body: item.body }, 'user', item.kind === 'news' ? 2 : 3));
  }
  return { lead, second, items, notices, ads };
}

interface BuildResult {
  readonly layout: SectionLayout;
  readonly blocks: PlannedBlock[];
  readonly pool: BroadsheetPool;
}

/** 排出一版（版面類型的起點＋使用者的修改＋內容）。 */
export function buildPage(data: NewspaperData, extras: NewspaperExtras, g: BroadsheetGeometry, options: { seedShift?: number; ghost?: boolean } = {}): BuildResult {
  const shift = options.seedShift ?? 0;
  const pageType: PageType = isPageType(data.pageType) ? data.pageType : 'news';
  const mode: PunctuationMode = isPunctuationMode(data.punctuation) ? data.punctuation : 'circle';
  const blocksExtras = options.ghost ? EMPTY_BLOCK_EXTRAS : (extras.blocks ?? EMPTY_BLOCK_EXTRAS);
  const pool = buildBroadsheetPool({ seed: data.fillSeed + shift, ...(options.ghost ? {} : { locked: extras.locked, removed: extras.removed }) });
  const user = options.ghost ? null : userContent(data, extras);
  const sections = sectionsOf(data);
  let plan = planPage({ pageType, seed: data.layoutSeed + shift, sections, cols: g.cols, mainHorizontal: data.mainHorizontal, hasSecond: !!user?.second });
  if (!options.ghost && data.photo) {
    const at = plan.findIndex((p) => p.source === 'lead');
    const photo: PlannedBlock = {
      id: 'photo',
      zone: 'flow',
      source: 'picture',
      style: { kind: 'picture', title: data.photoCaption, titleFont: '', titleSize: 5, titleDir: 'v', titleStyle: 'plain', titleMark: 'none', bodyFont: '', bodySize: 'm', frame: 'single', pattern: 'meander', span: 2, width: Math.max(8, Math.round(g.cols * 0.16)), picture: 'ship' },
    };
    plan = [...plan.slice(0, at + 1), photo, ...plan.slice(at + 1)];
  }
  const blocks = resolveBlocks(plan, blocksExtras);
  const locked = new Map<string, BlockEdit>(blocksExtras.edits.filter((e) => e.locked).map((e) => [e.id, e]));
  const fallbackLead = pool.items[0] ?? { id: 'ghost', source: 'filler' as const, level: 1 as const, title: '', subtitles: [], paragraphs: [] };
  const content = createContent({
    seed: data.fillSeed + shift,
    pageType,
    lead: user?.lead ?? fallbackLead,
    second: user?.second ?? null,
    userItems: user?.items ?? [],
    userNotices: user?.notices ?? [],
    userAds: user?.ads ?? [],
    pool,
    locked,
  });
  const layout = layoutSections({ cols: g.cols, rows: g.rows, sections, mode, aspect: g.pitch / g.cell, ...(g.obstacle ? { obstacle: g.obstacle } : {}), blocks, content });
  return { layout, blocks, pool };
}

/** 透背：用另一個種子排一版只有填版素材的報紙，左右翻轉、極淡地畫在底下。 */
function showThrough(data: NewspaperData, extras: NewspaperExtras, g: BroadsheetGeometry, strength: number): HTMLElement | null {
  if (strength <= 0) return null;
  const { layout } = buildPage(data, extras, g, { seedShift: 7919, ghost: true });
  const layer = h('div', { class: 'nf-ghost', attrs: { 'aria-hidden': 'true' }, style: { opacity: (0.04 + (strength / 100) * 0.1).toFixed(3) } });
  const ctx: Ctx = { g, press: 0, seed: 1 };
  for (const b of layout.blocks) {
    if (b.kind === 'ad' || b.kind === 'picture' || b.kind === 'table') {
      const r = blockRect(g, b);
      layer.appendChild(h('div', { class: 'nf-ghost-ad', style: { left: mm(r.x + 1), top: mm(r.y + 1.5), width: mm(r.w - 2), height: mm(r.h - 2.5) } }));
      continue;
    }
    b.lines.forEach((line, k) => layer.append(...lineElements(b, line, ctx, `g${b.id}:${k}`, false)));
  }
  return layer;
}

function blockElement(b: PlacedBlock, ctx: Ctx, data: NewspaperData, selected: boolean, locked: boolean): HTMLElement {
  const style = b.style;
  const wrap = h('div', {
    class: ['nr', `nr-${b.kind}`, b.filler && 'nr-filler', selected && 'nr-selected', locked && 'nr-locked', b.lines.some((l) => l.source === 'user') && 'nr-user'],
    dataset: { regionId: b.id, kind: b.kind },
  });
  if (style.titleFont) {
    const stack = fontStack(style.titleFont, 'title');
    for (const v of ['--f-title', '--f-h2', '--f-h3', '--f-ad']) wrap.style.setProperty(v, stack);
  }
  if (style.bodyFont) {
    const stack = fontStack(style.bodyFont, 'body');
    for (const v of ['--f-body', '--f-sub']) wrap.style.setProperty(v, stack);
  }
  let parts: Element[];
  switch (b.kind) {
    case 'ad':
      parts = adRegion(b, ctx);
      break;
    case 'table':
      parts = tableRegion(b, ctx);
      break;
    case 'toc':
      parts = tocRegion(b, ctx);
      break;
    case 'picture':
      parts = pictureRegion(b, ctx, data.photo);
      break;
    default:
      parts = flowRegion(b, ctx);
  }
  if (style.titleStyle === 'inverted' && b.kind === 'ad') wrap.classList.add('nb-inverted');
  wrap.append(...parts);
  return wrap;
}

export function renderNewspaperFull(data: NewspaperData, extras: NewspaperExtras, selectedBlock: string | null = null): FullPageRender {
  const paperKey = isPaperKey(data.paper) ? data.paper : 'a4-portrait';
  const size = PAPER_SIZES[paperKey];
  const layoutKind = data.showMasthead && isMastheadLayout(data.mastheadLayout) ? data.mastheadLayout : 'none';
  const g = broadsheetGeometry({ width: size.width, height: size.height, layout: layoutKind, header: data.headerStrip, cell: v4Cell(size.width, size.height) });
  const { layout, blocks, pool } = buildPage(data, extras, g);
  const mode = isPunctuationMode(data.punctuation) ? data.punctuation : 'circle';

  const sheet = createSheet(paperKey);
  const tone = data.paperTone === 'scan' ? 'scan' : data.paperTone === 'aged' ? 'aged' : 'newsprint';
  const { paper, content } = createPaperSurface({
    width: size.width,
    height: size.height,
    conditions: pickConditions(data),
    fonts: fontsOf(data),
    crop: extras.crop,
    className: `nf-paper tone-${tone}`,
    grain: tone === 'scan' ? 'gray' : 'warm',
  });
  const mix = headlineMix(data.era, data.fontTitle, data.fontBody);
  content.style.setProperty('--f-h2', fontStack(mix.h2, 'title'));
  content.style.setProperty('--f-h3', fontStack(mix.h3, 'title'));
  content.style.setProperty('--f-sub', fontStack(mix.sub, 'body'));
  content.classList.add('nf', `nf-${mode}`);
  content.style.setProperty('--cell', mm(g.cell));
  content.style.setProperty('--pitch', mm(g.pitch));
  content.style.setProperty('--spread', `${((data.press / 100) * 0.16).toFixed(3)}mm`);
  sheet.appendChild(paper);

  const ghost = showThrough(data, extras, g, data.showThrough);
  if (ghost) content.appendChild(ghost);

  const page = h('div', { class: 'nf-page' });
  if (data.press > 0) {
    const p = pagePlacement(rngFor(data.layoutSeed, 'page'), data.press);
    page.style.setProperty('transform', `translate(${p.dx.toFixed(2)}mm, ${p.dy.toFixed(2)}mm) rotate(${p.rotate.toFixed(3)}deg)`);
  }
  const ctx: Ctx = { g, press: data.press, seed: data.layoutSeed };
  const header = headerStrip(data, g);
  if (header) page.appendChild(header);
  if (g.masthead && layoutKind !== 'none') {
    // 報頭框的高度對齊段線
    const r = layout.mastheadRows > 0 && g.obstacle ? { ...g.masthead, h: layout.mastheadRows * g.cell - g.cell * 0.45 } : g.masthead;
    page.appendChild(mastheadBox(data, g, r));
  }
  const a = g.area;
  page.appendChild(h('div', { class: 'nf-frame', style: { left: mm(a.x - 0.9), top: mm(a.y - 0.9), width: mm(a.w + 1.8), height: mm(a.h + 1.8) } }));
  page.appendChild(rulesSvg(layout, ctx));
  const lockedIds = new Set((extras.blocks?.edits ?? []).filter((e) => e.locked).map((e) => e.id));
  const blocksEl = h('div', { class: 'nf-blocks', attrs: { 'data-fit': '', 'data-overflow': layout.overflow ? 'true' : null } });
  for (const b of layout.blocks) blocksEl.appendChild(blockElement(b, ctx, data, b.id === selectedBlock, lockedIds.has(b.id)));
  const chosen = selectedBlock ? layout.blocks.find((b) => b.id === selectedBlock) : undefined;
  if (chosen) {
    const r = blockRect(g, chosen);
    blocksEl.appendChild(h('div', { class: 'nr-outline', attrs: { 'aria-hidden': 'true' }, style: { left: mm(r.x), top: mm(r.y + (chosen.gapTop ? g.cell * 0.5 : 0)), width: mm(r.w), height: mm(r.h - (chosen.gapTop ? g.cell * 0.5 : 0)) } }));
  }
  page.appendChild(blocksEl);
  content.appendChild(page);

  let cut: FullPageRender['cut'] = null;
  if (data.fit === 'cut') {
    const which = data.cutAnchor === 'user' ? 'user' : 'main';
    const chosenBlocks = layout.blocks.filter((b) =>
      which === 'main' ? b.plan.source === 'lead' || b.id === 'photo' : b.plan.source === 'lead' || b.id === 'photo' || b.lines.some((l) => l.source === 'user') || b.ad?.source === 'user',
    );
    const rects = chosenBlocks.map((b) => blockRect(g, b));
    if (data.cutMasthead && g.masthead) rects.push(g.masthead);
    const anchor = unionRects(rects) ?? g.area;
    const frame = cutFrame(anchor, { top: data.cutTop, right: data.cutRight, bottom: data.cutBottom, left: data.cutLeft }, { x: 0, y: 0, w: size.width, h: size.height });
    const style = isCutStyle(data.cutStyle) ? data.cutStyle : 'scissors';
    const polygon = cutPolygon(frame, style, data.cutSeed);
    cut = { polygon, frame };
    paper.style.setProperty('clip-path', `path('${polygonToPath(extras.crop ?? polygon, PX_PER_MM)}')`);
    setPaperCrop(paper, extras.crop ?? polygon);
    sheet.classList.add('sheet--cut');
    paper.style.setProperty('left', mm(size.width / 2 - (frame.x + frame.w / 2)));
    paper.style.setProperty('top', mm(size.height / 2 - (frame.y + frame.h / 2)));
  }
  return { sheet, layout, geometry: g, pool, blocks, cut };
}
