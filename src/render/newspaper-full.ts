// 整版報紙與「從整版剪下」的版面。排版由 src/lib/newspaper/layout.ts 計算（每一行的字都固定），
// 這裡只負責把區塊畫到紙上。剪下時整張版面照樣排好，再用 clip-path 沿剪線裁切，
// 所以壓在剪線上的字會真的被切成一半，鄰近新聞的標題殘字與欄線斷頭也會留著。

import { cutPolygon, isCutStyle } from '../lib/cutline.ts';
import { PX_PER_MM, polygonToPath, type Point, type Rect } from '../lib/geometry.ts';
import { formatMinguoDate, parseIsoDate } from '../lib/minguo.ts';
import { anchorRect, cutFrame, userBlocks } from '../lib/newspaper/blocks.ts';
import { buildFillerPool, type FillerPool } from '../lib/newspaper/fillers.ts';
import { packPage, type PageLayout, type PlacedBlock, type TextLine } from '../lib/newspaper/layout.ts';
import { blockRect, pageGeometry, type PageGeometry } from '../lib/newspaper/page.ts';
import { PAPER_SIZES, isPaperKey } from '../props/common.ts';
import type { NewspaperExtras } from '../props/extras.ts';
import type { NewspaperData } from '../props/newspaper.ts';
import { pickConditions } from '../props/conditions.ts';
import { h } from '../ui/dom.ts';
import { fillMarkedLine } from '../ui/marked.ts';
import { setPaperCrop } from './effects.ts';
import { createPaperSurface, createSheet } from './sheet.ts';

export interface FullPageRender {
  readonly sheet: HTMLElement;
  readonly layout: PageLayout;
  readonly geometry: PageGeometry;
  readonly pool: FillerPool;
  /** 剪下模式的剪線（紙面座標）。 */
  readonly cut: { readonly polygon: readonly Point[]; readonly frame: Rect } | null;
}

function mm(n: number): string {
  return `${n.toFixed(3)}mm`;
}

const CENTERED = new Set(['big', 'center', 'heading']);

function lineElement(line: TextLine, geom: PageGeometry, height: number): HTMLElement {
  const el = h('div', {
    class: ['nl', `nl-${line.style}`],
    style: {
      'font-size': mm(geom.cell * line.size),
      'inline-size': mm(height),
      'block-size': mm(geom.pitch * line.size),
      'line-height': mm(geom.pitch * line.size),
      'text-align': CENTERED.has(line.style) ? 'center' : 'start',
    },
  });
  return fillMarkedLine(el, line.text, line.marks);
}

function blockElement(block: PlacedBlock, geom: PageGeometry, photo: string, locked: boolean): HTMLElement {
  const r = blockRect(geom, block);
  const el = h('div', {
    class: ['nb', `nb-${block.kind}`, block.boxed && 'nb-boxed', locked && 'nb-locked', block.source === 'user' && 'nb-user'],
    dataset: { blockId: block.id, source: block.source },
    style: { left: mm(r.x), top: mm(r.y), width: mm(r.w), height: mm(r.h) },
  });
  const inner = h('div', { class: 'nb-inner' });
  const lineHeight = block.boxed ? r.h - geom.cell : r.h;
  if (block.kind === 'photo') {
    const photoW = (block.slots - block.lines.length) * geom.pitch;
    inner.appendChild(
      h(
        'div',
        { class: 'nb-photo', style: { width: mm(photoW - 0.8), height: mm(Math.min(r.h, photoW * 0.85)) } },
        h('img', { attrs: { src: photo, alt: '新聞照片' } }),
      ),
    );
  }
  for (const line of block.lines) inner.appendChild(lineElement(line, geom, lineHeight));
  el.appendChild(inner);
  return el;
}

function masthead(data: NewspaperData, geom: PageGeometry): HTMLElement {
  const date = parseIsoDate(data.date);
  const dateText = date ? formatMinguoDate(date, { weekday: true }) : '';
  const m = geom.masthead;
  const style = { left: mm(m.x), top: mm(m.y), width: mm(m.w), height: mm(m.h) };
  if (!data.showMasthead) {
    const short = date ? formatMinguoDate(date, { prefix: 'short', weekday: true }) : '';
    return h(
      'header',
      { class: 'nf-running', style },
      h('div', { class: 'rtl-line', text: [data.masthead, short, data.section].filter(Boolean).join('　') }),
    );
  }
  return h(
    'header',
    { class: 'nf-masthead', style },
    h('div', { class: 'np-mh-side' }, h('div', { class: 'vt', text: dateText })),
    h('div', { class: 'rtl-line nf-title', text: data.masthead, style: { 'font-size': mm(m.h * 0.62) } }),
    h('div', { class: 'np-mh-side' }, h('div', { class: 'vt', text: data.issue }), h('div', { class: 'vt', text: data.price })),
  );
}

export function renderNewspaperFull(data: NewspaperData, extras: NewspaperExtras): FullPageRender {
  const paperKey = isPaperKey(data.paper) ? data.paper : 'a4-portrait';
  const size = PAPER_SIZES[paperKey];
  const geom = pageGeometry({
    width: size.width,
    height: size.height,
    tiers: data.pageTiers,
    mastheadHeight: data.showMasthead ? Math.round(Math.min(size.width, size.height) * 0.15) : 7,
  });
  const pool = buildFillerPool({ seed: data.fillSeed, locked: extras.locked, removed: extras.removed });
  const photoSlots = Math.max(6, Math.round(38 / geom.pitch));
  const layout = packPage({
    grid: geom.grid,
    userBlocks: userBlocks(data, extras.items, photoSlots),
    fillers: pool.fillers,
    tinyFillers: pool.tiny,
  });

  const sheet = createSheet(paperKey);
  const { paper, content } = createPaperSurface({
    width: size.width,
    height: size.height,
    conditions: pickConditions(data),
    crop: extras.crop,
    className: 'nf-paper',
  });
  content.classList.add('nf');
  content.style.setProperty('--cell', mm(geom.cell));
  content.style.setProperty('--pitch', mm(geom.pitch));
  sheet.appendChild(paper);

  content.appendChild(masthead(data, geom));
  // 版面外框與段間橫線
  const a = geom.area;
  content.appendChild(h('div', { class: 'nf-frame', style: { left: mm(a.x - 0.8), top: mm(a.y - 1), width: mm(a.w + 1.6), height: mm(a.h + 2) } }));
  for (let t = 1; t < geom.grid.tiers; t++) {
    const y = a.y + t * geom.tierHeight + (t - 0.5) * geom.tierGap;
    // 跨段的區塊（主新聞）底下不畫段間橫線
    const blocked = layout.blocks
      .filter((b) => b.tier < t && t < b.tier + b.tierSpan)
      .map((b) => [b.slot, b.slot + b.slots] as const)
      .sort((p, q) => p[0] - q[0]);
    let from = 0;
    const segments: [number, number][] = [];
    for (const [s, e] of blocked) {
      if (s > from) segments.push([from, s]);
      from = Math.max(from, e);
    }
    if (from < geom.grid.slots) segments.push([from, geom.grid.slots]);
    for (const [s, e] of segments) {
      const right = a.x + a.w - s * geom.pitch;
      const left = a.x + a.w - e * geom.pitch;
      content.appendChild(h('div', { class: 'nf-rule', style: { left: mm(left), top: mm(y), width: mm(right - left) } }));
    }
  }
  const lockedIds = new Set(extras.locked.map((l) => l.id));
  const blocksLayer = h('div', {
    class: 'nf-blocks',
    attrs: { 'data-fit': '', 'data-overflow': layout.overflow ? 'true' : null },
  });
  for (const block of layout.blocks) blocksLayer.appendChild(blockElement(block, geom, data.photo, lockedIds.has(block.id)));
  content.appendChild(blocksLayer);

  let cut: FullPageRender['cut'] = null;
  if (data.fit === 'cut') {
    const which = data.cutAnchor === 'user' ? 'user' : 'main';
    const anchor =
      anchorRect(layout.blocks, (b) => blockRect(geom, b), which, data.cutMasthead ? geom.masthead : undefined) ?? geom.area;
    const frame = cutFrame(
      anchor,
      { top: data.cutTop, right: data.cutRight, bottom: data.cutBottom, left: data.cutLeft },
      { x: 0, y: 0, w: size.width, h: size.height },
    );
    const style = isCutStyle(data.cutStyle) ? data.cutStyle : 'scissors';
    const polygon = cutPolygon(frame, style, data.cutSeed);
    cut = { polygon, frame };
    paper.style.setProperty('clip-path', `path('${polygonToPath(extras.crop ?? polygon, PX_PER_MM)}')`);
    setPaperCrop(paper, extras.crop ?? polygon);
    // 把剪下的紙片放到列印紙張的正中央
    sheet.classList.add('sheet--cut');
    paper.style.setProperty('left', mm(size.width / 2 - (frame.x + frame.w / 2)));
    paper.style.setProperty('top', mm(size.height / 2 - (frame.y + frame.h / 2)));
  }
  return { sheet, layout, geometry: geom, pool, cut };
}
