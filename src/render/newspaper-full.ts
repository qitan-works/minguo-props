// 整版報紙與「從整版剪下」的版面（第三版）。版面配置由 src/lib/newspaper/broadsheet.ts 計算
// （每一行放哪些字都已固定），這裡只負責把報頭、報眉、各區塊、欄線、廣告畫到紙上，
// 再加上鉛字印刷的質感與透背。剪下時整張版面照樣排好，再用 clip-path 沿剪線裁切，
// 所以壓在剪線上的字會真的被切成一半。

import { cutPolygon, isCutStyle } from '../lib/cutline.ts';
import { PX_PER_MM, polygonToPath, unionRects, type Point, type Rect } from '../lib/geometry.ts';
import { formatLunar, ganzhiYear, toLunar } from '../lib/lunar.ts';
import { formatMinguoDate, parseIsoDate, type SimpleDate } from '../lib/minguo.ts';
import { layoutAd } from '../lib/newspaper/ads.ts';
import { cutFrame } from '../lib/newspaper/blocks.ts';
import { layoutBroadsheet, type Broadsheet, type Region } from '../lib/newspaper/broadsheet.ts';
import { buildBroadsheetPool, adFromFiller, flowFromFiller, type BroadsheetPool } from '../lib/newspaper/fillers.ts';
import type { FlowItem, FlowLine } from '../lib/newspaper/flow.ts';
import { columnSkew, pagePlacement, pressGlyph, ruleInk } from '../lib/newspaper/press.ts';
import { isPunctuationMode, type Glyph } from '../lib/newspaper/punctuation.ts';
import { broadsheetGeometry, colLeft, isMastheadLayout, rowTop, type BroadsheetGeometry } from '../lib/newspaper/sheetgeom.ts';
import { rngFor } from '../lib/random.ts';
import { COLUMN_TAGS } from '../data/fillers.ts';
import { fontStack } from '../fonts.ts';
import { PAPER_SIZES, fontsOf, isPaperKey } from '../props/common.ts';
import { pickConditions } from '../props/conditions.ts';
import { headlineMix } from '../props/eras.ts';
import type { NewspaperExtras } from '../props/extras.ts';
import type { NewspaperData } from '../props/newspaper.ts';
import { h, s } from '../ui/dom.ts';
import { setPaperCrop } from './effects.ts';
import { createPaperSurface, createSheet } from './sheet.ts';

export interface FullPageRender {
  readonly sheet: HTMLElement;
  readonly layout: Broadsheet;
  readonly geometry: BroadsheetGeometry;
  readonly pool: BroadsheetPool;
  /** 剪下模式的剪線（紙面座標）。 */
  readonly cut: { readonly polygon: readonly Point[]; readonly frame: Rect } | null;
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

function regionRect(g: BroadsheetGeometry, region: Region): Rect {
  const left = Math.max(...region.columns.map((c) => c.col));
  const right = Math.min(...region.columns.map((c) => c.col));
  const top = Math.min(...region.columns.map((c) => c.top));
  const bottom = Math.max(...region.columns.map((c) => c.bottom));
  const x = colLeft(g, left);
  return { x, y: rowTop(g, top), w: colLeft(g, right) + g.pitch - x, h: (bottom - top) * g.cell };
}

function lineElement(region: Region, line: FlowLine, ctx: Ctx, key: string): HTMLElement {
  const { g } = ctx;
  const leftSlot = region.slots[line.slot + line.span - 1] ?? region.slots[line.slot];
  const x = colLeft(g, leftSlot?.col ?? 0);
  const width = line.span * g.pitch;
  const el = h('div', {
    class: ['nl', `nl-${line.role}`, line.align === 'center' && 'nl-center'],
    style: {
      left: mm(x),
      top: mm(rowTop(g, line.top)),
      width: mm(width),
      height: mm(line.length * g.cell),
      'font-size': mm(line.size * g.cell),
      'line-height': mm(width),
      'font-family': ROLE_FONT[line.role],
    },
  });
  if (ctx.press > 0) {
    const skew = columnSkew(rngFor(ctx.seed, `skew:${key}`), ctx.press);
    if (Math.abs(skew) > 0.01) el.style.setProperty('transform', `rotate(${skew.toFixed(3)}deg)`);
  }
  fillGlyphs(el, line.glyphs, ctx, key);
  return el;
}

/** 文字區塊：同一則新聞的各行包在一個 display: contents 的元素裡（點選鎖定、刪除用）。 */
function textRegion(region: Region, index: number, ctx: Ctx, lockedIds: ReadonlySet<string>): Element[] {
  const out: Element[] = [];
  const { g } = ctx;
  const groups = new Map<string, HTMLElement>();
  region.lines.forEach((line, i) => {
    let wrap = groups.get(line.itemId);
    if (!wrap) {
      wrap = h('div', {
        class: ['nb', `nb-${region.kind}`, line.source === 'user' && 'nb-user', lockedIds.has(line.itemId) && 'nb-locked'],
        dataset: { blockId: line.itemId, source: line.source },
      });
      groups.set(line.itemId, wrap);
      out.push(wrap);
    }
    wrap.appendChild(lineElement(region, line, ctx, `${index}:${i}`));
  });
  if (region.tag) {
    const first = region.columns[0];
    if (first) {
      const top = first.top + (region.gapTop ? 1 : 0);
      out.push(
        h('div', {
          class: 'nf-tag',
          text: region.tag.text,
          style: { left: mm(colLeft(g, first.col) + g.pitch * 0.06), top: mm(rowTop(g, top) + g.cell * 0.1), width: mm(g.pitch * 0.88), height: mm((region.tag.rows - 0.3) * g.cell), 'font-size': mm(g.cell * 0.82) },
        }),
      );
    }
  }
  if (region.band && region.columns.length > 0) {
    const r = regionRect(g, region);
    const top = rowTop(g, (region.columns[0]?.top ?? 0) + (region.gapTop ? 1 : 0));
    const band = region.band;
    const source = band.source ?? 'user';
    const wrap = h('div', {
      class: ['nb', `nb-${region.kind}`, source === 'user' && 'nb-user', lockedIds.has(band.itemId ?? '') && 'nb-locked'],
      dataset: { blockId: band.itemId ?? 'main', source },
    });
    band.lines.forEach((line, i) => {
      const el = h('div', {
        class: ['nf-band', region.kind !== 'main' && 'nf-band-2'],
        style: { left: mm(r.x), top: mm(top + line.row * g.cell), width: mm(r.w), height: mm(line.size * g.cell * 1.08), 'font-size': mm(line.size * g.cell), 'line-height': mm(line.size * g.cell * 1.08) },
      });
      fillGlyphs(el, Array.from(line.text).map((ch) => ({ ch })), { ...ctx, press: ctx.press * 0.6 }, `band:${i}`);
      wrap.appendChild(el);
    });
    out.push(wrap);
  }
  if (region.kind === 'box') {
    const r = regionRect(g, region);
    const inset = { x: r.x + g.pitch * 0.12, y: r.y + (region.gapTop ? g.cell : 0) + g.cell * 0.3, w: r.w - g.pitch * 0.24, h: r.h - (region.gapTop ? g.cell : 0) - g.cell * 0.5 };
    out.push(frameSvg(inset, region.frame ?? 'plain', ctx, `box:${index}`));
  }
  return out;
}

/** 框線（SVG）：雙線、粗細線、點線、角花、單線。 */
function frameSvg(r: Rect, style: NonNullable<Region['frame']>, ctx: Ctx, key: string): SVGSVGElement {
  const svg = s('svg', {
    class: 'nf-framebox',
    attrs: { viewBox: `0 0 ${r.w.toFixed(3)} ${r.h.toFixed(3)}`, 'aria-hidden': 'true' },
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
  switch (style) {
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
    case 'corners': {
      rect(0.4, 0.3);
      const c = Math.min(r.w, r.h) * 0.12;
      for (const [x, y, sx, sy] of [
        [0.4, 0.4, 1, 1],
        [r.w - 0.4, 0.4, -1, 1],
        [0.4, r.h - 0.4, 1, -1],
        [r.w - 0.4, r.h - 0.4, -1, -1],
      ] as const) {
        const d = `M${x + sx * c} ${y} Q${x + sx * c * 0.15} ${y + sy * c * 0.15} ${x} ${y + sy * c} M${x + sx * c * 0.55} ${y + sy * 0.9} a${c * 0.18} ${c * 0.18} 0 1 0 0.01 0`;
        svg.appendChild(s('path', { attrs: { d, fill: 'none', stroke: 'currentColor', 'stroke-width': '0.28' } }));
      }
      break;
    }
    default:
      rect(0.35, 0.32);
  }
  return svg;
}

function adRegion(region: Region, index: number, ctx: Ctx, lockedIds: ReadonlySet<string>): HTMLElement {
  const { g } = ctx;
  const r0 = regionRect(g, region);
  const box: Rect = { x: r0.x + g.pitch * 0.1, y: r0.y + (region.gapTop ? g.cell * 0.55 : g.cell * 0.1), w: r0.w - g.pitch * 0.2, h: r0.h - (region.gapTop ? g.cell * 0.65 : g.cell * 0.2) };
  const ad = region.ad;
  const wrap = h('div', {
    class: ['nb', 'nb-ad', region.inverted && 'nb-inverted', ad?.source === 'user' && 'nb-user', ad && lockedIds.has(ad.id) && 'nb-locked'],
    dataset: { blockId: ad?.id ?? `ad${index}`, source: ad?.source ?? 'filler' },
  });
  if (!ad) return wrap;
  const layout = layoutAd(ad, box, region.styleSeed ?? index, g.cell);
  if (region.inverted) {
    wrap.appendChild(h('div', { class: 'nf-ad-ink', style: { left: mm(layout.frame.x), top: mm(layout.frame.y), width: mm(layout.frame.w), height: mm(layout.frame.h) } }));
  }
  wrap.appendChild(frameSvg(layout.frame, region.inverted ? 'plain' : (region.frame ?? 'plain'), ctx, `ad:${index}`));
  layout.texts.forEach((t, i) => {
    const el = h('div', {
      class: ['nf-adt', `nf-adt-${t.role}`, t.dir === 'v' ? 'nf-adt-v' : 'nf-adt-h'],
      style: { left: mm(t.x), top: mm(t.y), width: mm(t.w), height: mm(t.h), 'font-size': mm(t.size), 'line-height': mm(t.dir === 'v' ? t.w : t.h) },
    });
    fillGlyphs(el, Array.from(t.text).map((ch) => ({ ch })), { ...ctx, press: ctx.press * (t.role === 'big' ? 0.5 : 1) }, `adt:${index}:${i}`);
    wrap.appendChild(el);
  });
  if (layout.divider !== null) {
    wrap.appendChild(h('div', { class: 'nf-ad-divider', style: { left: mm(layout.frame.x + 1.2), top: mm(layout.divider), width: mm(layout.frame.w - 2.4) } }));
  }
  return wrap;
}

function photoRegion(region: Region, ctx: Ctx, photo: string): HTMLElement[] {
  const { g } = ctx;
  const r = regionRect(g, region);
  const top = r.y + (region.gapTop ? g.cell : 0);
  const out: HTMLElement[] = [];
  const imgW = r.w - g.pitch * 1.15;
  out.push(
    h(
      'div',
      { class: ['nb', 'nb-photo', 'nb-user'], dataset: { blockId: 'photo', source: 'user' }, style: { left: mm(r.x + g.pitch * 1.05), top: mm(top + g.cell * 0.2), width: mm(imgW), height: mm(r.y + r.h - top - g.cell * 0.4) } },
      h('img', { attrs: { src: photo, alt: '新聞照片' } }),
    ),
  );
  region.lines.forEach((line, i) => out.push(lineElement(region, line, ctx, `photo:${i}`)));
  return out;
}

function rulesSvg(layout: Broadsheet, ctx: Ctx): SVGSVGElement {
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
    const double = rule.dir === 'h' && rng() < 0.22;
    const ink = ruleInk(rng, ctx.press, double ? 0.14 : 0.2, length);
    const line = (off: number): void => {
      const attrs: Record<string, string> = {
        x1: (x1 + (rule.dir === 'v' ? off : 0)).toFixed(3),
        y1: (y1 + (rule.dir === 'h' ? off : 0)).toFixed(3),
        x2: (x2 + (rule.dir === 'v' ? off : 0)).toFixed(3),
        y2: (y2 + (rule.dir === 'h' ? off : 0)).toFixed(3),
        stroke: 'currentColor',
        'stroke-width': String(ink.width),
        opacity: String(ink.opacity),
      };
      if (ink.dash) attrs['stroke-dasharray'] = ink.dash;
      svg.appendChild(s('line', { attrs }));
    };
    if (double) {
      line(-0.28);
      line(0.28);
    } else line(0);
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

function mastheadBox(data: NewspaperData, g: BroadsheetGeometry): HTMLElement | null {
  const r = g.masthead;
  if (!r) return null;
  const { date, weekday, lunar } = dateTexts(data);
  const name = Array.from(data.masthead.trim() || '　');
  const box = h('header', { class: ['nf-mh', `nf-mh-${g.layout}`], style: { left: mm(r.x), top: mm(r.y), width: mm(r.w), height: mm(r.h) } });
  const small = g.cell * 0.82;
  if (g.layout === 'right') {
    const pad = 1.6;
    const titleSize = Math.min(r.w * 0.5, ((r.h - 2 * pad) * 0.72) / name.length);
    const titleW = titleSize * 1.12;
    const titleX = r.x + r.w - pad - small * 1.6 - titleW;
    box.appendChild(h('div', { class: 'nf-mh-title vt', text: name.join(''), style: { left: mm(titleX - r.x), top: mm(pad + 1), width: mm(titleW), height: mm(name.length * titleSize * 1.04), 'font-size': mm(titleSize) } }));
    box.appendChild(h('div', { class: 'nf-mh-note vt', text: '中華郵政特准掛號認為新聞紙類', style: { right: mm(pad * 0.6), top: mm(pad + 1), width: mm(small * 1.4), height: mm(r.h - 2 * pad), 'font-size': mm(small * 0.86) } }));
    const lines = [date, [weekday, lunar].filter(Boolean).join('　'), data.issue, data.price].filter(Boolean);
    let x = titleX - r.x - small * 0.3;
    for (const text of lines) {
      x -= small * 1.35;
      box.appendChild(h('div', { class: 'nf-mh-line vt', text, style: { left: mm(x), top: mm(pad + titleSize * 0.2), width: mm(small * 1.3), height: mm(r.h - 2 * pad - titleSize * 0.2), 'font-size': mm(small) } }));
    }
    if (data.englishName) {
      box.appendChild(h('div', { class: 'nf-mh-en', text: data.englishName.toUpperCase(), style: { left: mm(pad * 0.4), top: mm(pad), width: mm(small * 1.4), height: mm(r.h - 2 * pad), 'font-size': mm(small * 0.92) } }));
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

/** 使用者的內容：主新聞、短訊、自己加的新聞與啟事、廣告。 */
function userContent(data: NewspaperData, extras: NewspaperExtras): { main: FlowItem; queue: FlowItem[]; ads: ReturnType<typeof adFromFiller>[] } {
  const main: FlowItem = {
    id: 'main',
    source: 'user',
    level: 1,
    title: data.headline,
    subtitles: data.subheadline.split(/[　 ]+/).filter(Boolean),
    ...(data.dateline ? { kicker: data.dateline } : {}),
    paragraphs: (data.body || '（內文）').split(/\r?\n/).map((p) => p.trim()).filter(Boolean),
  };
  const queue: FlowItem[] = [];
  if (data.secondTitle || data.secondBody) {
    queue.push({ id: 'second', source: 'user', level: 2, title: data.secondTitle, subtitles: [], paragraphs: data.secondBody.split(/\r?\n/).filter(Boolean) });
  }
  const ads: ReturnType<typeof adFromFiller>[] = [];
  for (const item of extras.items) {
    if (!item.title && !item.body) continue;
    if (item.kind === 'ad') ads.push(adFromFiller({ id: item.id, kind: 'ad', title: item.title, body: item.body }, 'user'));
    else queue.push(flowFromFiller({ id: item.id, kind: item.kind, title: item.title, body: item.body }, 'user', item.kind === 'news' ? 2 : 3));
  }
  return { main, queue, ads };
}

/** 透背：用另一個種子排一版只有填版素材的報紙，左右翻轉、極淡地畫在底下。 */
function showThrough(data: NewspaperData, g: BroadsheetGeometry, strength: number): HTMLElement | null {
  if (strength <= 0) return null;
  const pool = buildBroadsheetPool({ seed: data.fillSeed + 7919 });
  const [first, ...rest] = pool.items;
  if (!first) return null;
  const ghost = layoutBroadsheet({
    cols: g.cols,
    rows: g.rows,
    seed: data.layoutSeed + 104729,
    tiers: data.pageTiers,
    mode: isPunctuationMode(data.punctuation) ? data.punctuation : 'circle',
    main: { ...first, level: 1 },
    mainHorizontal: false,
    queue: rest,
    ads: pool.ads,
    tiny: [...pool.tiny],
    tags: [],
    aspect: g.pitch / g.cell,
  });
  const layer = h('div', { class: 'nf-ghost', attrs: { 'aria-hidden': 'true' }, style: { opacity: (0.04 + (strength / 100) * 0.1).toFixed(3) } });
  const ctx: Ctx = { g, press: 0, seed: 1 };
  ghost.regions.forEach((region, i) => {
    if (region.kind === 'ad') {
      const r = regionRect(g, region);
      layer.appendChild(h('div', { class: 'nf-ghost-ad', style: { left: mm(r.x + 1), top: mm(r.y + 1), width: mm(r.w - 2), height: mm(r.h - 2) } }));
      return;
    }
    region.lines.forEach((line, k) => layer.appendChild(lineElement(region, line, ctx, `g${i}:${k}`)));
  });
  return layer;
}

export function renderNewspaperFull(data: NewspaperData, extras: NewspaperExtras): FullPageRender {
  const paperKey = isPaperKey(data.paper) ? data.paper : 'a4-portrait';
  const size = PAPER_SIZES[paperKey];
  const layoutKind = data.showMasthead && isMastheadLayout(data.mastheadLayout) ? data.mastheadLayout : 'none';
  const g = broadsheetGeometry({ width: size.width, height: size.height, layout: layoutKind, header: data.headerStrip });
  const pool = buildBroadsheetPool({ seed: data.fillSeed, locked: extras.locked, removed: extras.removed });
  const user = userContent(data, extras);
  const mode = isPunctuationMode(data.punctuation) ? data.punctuation : 'circle';
  const photo = data.photo ? { cols: Math.max(5, Math.round(32 / g.pitch)), rows: Math.max(8, Math.round(36 / g.cell)), caption: data.photoCaption } : undefined;
  const layout = layoutBroadsheet({
    cols: g.cols,
    rows: g.rows,
    seed: data.layoutSeed,
    tiers: data.pageTiers,
    mode,
    ...(g.obstacle ? { obstacle: g.obstacle } : {}),
    main: user.main,
    mainHorizontal: data.mainHorizontal,
    ...(photo ? { photo } : {}),
    queue: [...user.queue, ...pool.items],
    ads: [...user.ads, ...pool.ads],
    tiny: [...pool.tiny],
    tags: COLUMN_TAGS,
    aspect: g.pitch / g.cell,
  });

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

  const ghost = showThrough(data, g, data.showThrough);
  if (ghost) content.appendChild(ghost);

  const page = h('div', { class: 'nf-page' });
  if (data.press > 0) {
    const p = pagePlacement(rngFor(data.layoutSeed, 'page'), data.press);
    page.style.setProperty('transform', `translate(${p.dx.toFixed(2)}mm, ${p.dy.toFixed(2)}mm) rotate(${p.rotate.toFixed(3)}deg)`);
  }
  const ctx: Ctx = { g, press: data.press, seed: data.layoutSeed };
  const header = headerStrip(data, g);
  if (header) page.appendChild(header);
  if (layoutKind === 'top') {
    const box = mastheadBox(data, g);
    if (box) page.appendChild(box);
  } else if (layoutKind !== 'none') {
    const box = mastheadBox(data, g);
    if (box) page.appendChild(box);
  }
  const a = g.area;
  page.appendChild(h('div', { class: 'nf-frame', style: { left: mm(a.x - 0.9), top: mm(a.y - 0.9), width: mm(a.w + 1.8), height: mm(a.h + 1.8) } }));
  page.appendChild(rulesSvg(layout, ctx));
  const lockedIds = new Set(extras.locked.map((l) => l.id));
  const blocks = h('div', { class: 'nf-blocks', attrs: { 'data-fit': '', 'data-overflow': layout.overflow ? 'true' : null } });
  layout.regions.forEach((region, i) => {
    if (region.kind === 'ad') blocks.appendChild(adRegion(region, i, ctx, lockedIds));
    else if (region.kind === 'photo') blocks.append(...photoRegion(region, ctx, data.photo));
    else blocks.append(...textRegion(region, i, ctx, lockedIds));
  });
  page.appendChild(blocks);
  content.appendChild(page);

  let cut: FullPageRender['cut'] = null;
  if (data.fit === 'cut') {
    const which = data.cutAnchor === 'user' ? 'user' : 'main';
    const chosen = layout.regions.filter((r) =>
      which === 'main' ? r.kind === 'main' || r.kind === 'photo' : r.kind === 'main' || r.kind === 'photo' || r.lines.some((l) => l.source === 'user') || r.ad?.source === 'user',
    );
    const rects = chosen.map((r) => regionRect(g, r));
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
  return { sheet, layout, geometry: g, pool, cut };
}
