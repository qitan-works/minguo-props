// 報紙剪報的版面：直排（writing-mode: vertical-rl）、分段欄線、報頭或報眉。

import { formatMinguoDate, parseIsoDate } from '../lib/minguo.ts';
import { PAPER_SIZES, isPaperKey } from '../props/common.ts';
import type { NewspaperData } from '../props/newspaper.ts';
import type { Polygon } from '../lib/geometry.ts';
import { pickConditions } from '../props/conditions.ts';
import { h, paragraphs } from '../ui/dom.ts';
import { fillMarked } from '../ui/marked.ts';
import { createPaperSurface, createSheet } from './sheet.ts';

/** 民國時期橫寫多由右而左。以 bidi-override 呈現，文字的邏輯順序不變。 */
function rtl(text: string, className: string): HTMLElement {
  return h('div', { class: ['rtl-line', className], text });
}

export function renderNewspaper(data: NewspaperData, crop: Polygon | null = null): HTMLElement {
  const paperKey = isPaperKey(data.paper) ? data.paper : 'a4-portrait';
  const size = PAPER_SIZES[paperKey];
  // A5（約 3.1 萬平方公釐）用較小的字級與留白；A4 約 6.2 萬。
  const small = size.width * size.height < 40000;
  const margin = small ? 7 : 10;
  const width = size.width - margin * 2;
  const height = size.height - margin * 2;

  const sheet = createSheet(paperKey);
  const { paper, content } = createPaperSurface({
    width,
    height,
    conditions: pickConditions(data),
    roughEdge: data.clipEdge,
    crop,
    className: 'np-paper',
  });
  sheet.appendChild(paper);
  sheet.classList.add('sheet--margin');
  if (data.fit === 'content') paper.classList.add('np-fit');
  content.classList.add('np', small ? 'np--small' : 'np--large');

  const date = parseIsoDate(data.date);
  const dateText = date ? formatMinguoDate(date, { weekday: true }) : '';
  const shortDate = date ? formatMinguoDate(date, { prefix: 'short', weekday: true }) : '';

  // 版面尺寸（公釐）：報頭／報眉高度，用來算出每一段的高度。
  const pad = small ? 4 : 6;
  const headHeight = data.showMasthead ? (small ? 26 : 36) : small ? 7 : 9;
  const tiers = Math.min(4, Math.max(2, Number.parseInt(data.tiers, 10) || 3));
  const tierGap = small ? 3 : 4;
  const bodyHeight = height - pad * 2 - headHeight - 3;
  const tierHeight = (bodyHeight - tierGap * (tiers - 1)) / tiers;
  content.style.setProperty('--np-pad', `${pad}mm`);
  content.style.setProperty('--np-head-h', `${headHeight}mm`);
  content.style.setProperty('--np-tiers', String(tiers));
  content.style.setProperty('--np-tier-gap', `${tierGap}mm`);
  content.style.setProperty('--np-tier-h', `${tierHeight.toFixed(2)}mm`);

  if (data.showMasthead) {
    content.appendChild(
      h(
        'header',
        { class: 'np-masthead' },
        h('div', { class: 'np-mh-side np-mh-right' }, h('div', { class: 'vt', text: dateText })),
        rtl(data.masthead, 'np-mh-title'),
        h(
          'div',
          { class: 'np-mh-side np-mh-left' },
          h('div', { class: 'vt', text: data.issue }),
          h('div', { class: 'vt', text: data.price }),
        ),
      ),
    );
  } else {
    content.appendChild(
      h('header', { class: 'np-running-head' }, rtl([data.masthead, shortDate, data.section].filter(Boolean).join('　'), 'np-rh-text')),
    );
  }

  const area = h('div', { class: 'np-area' });
  content.appendChild(area);

  // 標題欄（最右）：版名、標題、副題
  const headline = h('div', { class: 'np-headline vt' });
  if (data.section && data.showMasthead) headline.appendChild(h('div', { class: 'np-section', text: data.section }));
  if (data.headline) headline.appendChild(h('h2', { class: 'np-title', text: data.headline }));
  for (const line of data.subheadline.split(/[　 ]+/).filter(Boolean)) {
    headline.appendChild(h('p', { class: 'np-subtitle', text: line }));
  }
  area.appendChild(headline);

  // 內文：多欄（直排時為由上而下的「段」）
  const columns = h('div', { class: 'np-columns vt', attrs: { 'data-fit': '' } });
  if (data.photo) {
    columns.appendChild(
      h(
        'figure',
        { class: 'np-figure' },
        h('div', { class: 'np-photo' }, h('img', { attrs: { src: data.photo, alt: data.photoCaption || '新聞照片' } })),
        data.photoCaption ? h('figcaption', { class: 'vt', text: data.photoCaption }) : null,
      ),
    );
  }
  paragraphs(data.body).forEach((text, i) => {
    const p = h('p', { class: 'np-p' });
    if (i === 0 && data.dateline) p.appendChild(h('span', { class: 'np-dateline', text: `【${data.dateline}】` }));
    fillMarked(p, text);
    columns.appendChild(p);
  });
  if (data.secondTitle || data.secondBody) {
    const second = h('section', { class: 'np-second' });
    if (data.secondTitle) second.appendChild(h('h3', { class: 'np-second-title', text: data.secondTitle }));
    for (const text of paragraphs(data.secondBody)) second.appendChild(fillMarked(h('p', { class: 'np-p' }), text));
    columns.appendChild(second);
  }
  area.appendChild(columns);

  return sheet;
}


const PX_PER_MM = 96 / 25.4;

function fits(el: HTMLElement | null): boolean {
  return !el || (el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1);
}

/** 報頭是由右往左排的 flex，超出時溢向左邊，scrollWidth 量不到，所以改加總子元素寬度。 */
function headFits(head: HTMLElement | null): boolean {
  if (!head) return true;
  let needed = 0;
  for (const child of head.children) if (child instanceof HTMLElement) needed += child.offsetWidth;
  return needed + 4 * PX_PER_MM <= head.clientWidth;
}

/**
 * 「貼合內容」：剪報掛到頁面上之後，用二分搜尋找出能容納全部內容的最小寬度，
 * 讓剪報像真的從報上剪下來的一則新聞。寬度以公釐寫回，列印時與預覽一致。
 */
export function fitNewspaperToContent(sheet: HTMLElement): void {
  const paper = sheet.querySelector<HTMLElement>('.np-paper.np-fit');
  if (!paper) return;
  const columns = paper.querySelector<HTMLElement>('.np-columns');
  const head = paper.querySelector<HTMLElement>('.np-masthead, .np-running-head');
  const maxW = paper.offsetWidth;
  if (maxW === 0) return;
  const ok = (w: number): boolean => {
    paper.style.setProperty('width', `${w}px`);
    return fits(columns) && headFits(head);
  };
  if (!ok(maxW)) {
    paper.style.removeProperty('width');
    return;
  }
  let lo = Math.min(maxW, 40 * PX_PER_MM);
  let hi = maxW;
  if (ok(lo)) hi = lo;
  while (hi - lo > PX_PER_MM) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) hi = mid;
    else lo = mid;
  }
  const widthMm = Math.min(maxW, hi + 2 * PX_PER_MM) / PX_PER_MM;
  paper.style.setProperty('width', `${widthMm.toFixed(1)}mm`);
}
