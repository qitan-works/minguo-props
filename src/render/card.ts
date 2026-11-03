// 名片與請帖：90×54 mm（或直式 54×90 mm），可單張列印或在 A4 上拼版 10 張。

import { formatMonthDay, parseIsoDate, weekdayOf } from '../lib/minguo.ts';
import { toChineseDigits } from '../lib/numerals.ts';
import type { CardData } from '../props/card.ts';
import type { PaperKey } from '../props/common.ts';
import type { Polygon } from '../lib/geometry.ts';
import { pickConditions } from '../props/conditions.ts';
import { h } from '../ui/dom.ts';
import { createPaperSurface, createSheet } from './sheet.ts';

function vcol(className: string, text: string): HTMLElement | null {
  return text ? h('div', { class: ['cd-col', 'vt', className], text }) : null;
}

function cardContent(data: CardData): HTMLElement[] {
  if (data.style === 'invite') {
    const date = parseIsoDate(data.inviteDate);
    const when = date ? `${formatMonthDay(date)}（星期${weekdayOf(date)}）${data.inviteTime}` : data.inviteTime;
    return [
      vcol('cd-inv-line', `謹訂於${when}`),
      vcol('cd-inv-line', `${data.inviteOccasion}　敬備菲酌`),
      vcol('cd-inv-line', '恭候'),
      vcol('cd-inv-line cd-raise', '台光'),
      vcol('cd-inv-host', data.inviteHost ? `${data.inviteHost}　謹訂` : ''),
      vcol('cd-inv-venue', data.inviteVenue ? `席設${data.inviteVenue}` : ''),
    ].filter((el): el is HTMLElement => el !== null);
  }
  const orgLine = [data.org, data.title].filter(Boolean).join('　');
  const info = h(
    'div',
    { class: 'cd-col cd-info vt' },
    data.native ? h('p', { text: data.native }) : null,
    data.address ? h('p', { text: `寓${data.address}` }) : null,
    data.phone ? h('p', { text: `電話${toChineseDigits(data.phone)}` }) : null,
  );
  return [
    vcol('cd-org', orgLine),
    vcol('cd-name', data.name),
    vcol('cd-courtesy', data.courtesy ? `字${data.courtesy}` : ''),
    info,
  ].filter((el): el is HTMLElement => el !== null);
}

function cardSurface(data: CardData, width: number, height: number, index: number, crop: Polygon | null): HTMLElement {
  const { paper, content } = createPaperSurface({
    width,
    height,
    conditions: pickConditions(data),
    variant: index,
    crop,
    className: `cd-paper stock-${data.stock}`,
  });
  content.classList.add('cd', data.style === 'invite' ? 'cd-invite' : 'cd-card', width > height ? 'cd-landscape' : 'cd-portrait');
  const row = h('div', { class: 'cd-row', attrs: { 'data-fit': '' } }, ...cardContent(data));
  content.appendChild(row);
  return paper;
}

export function renderCard(data: CardData, crop: Polygon | null = null): HTMLElement {
  const landscape = data.orientation === 'landscape';
  const width = landscape ? 90 : 54;
  const height = landscape ? 54 : 90;

  if (data.sheet === 'a4') {
    // 橫式名片：A4 直式 2 欄 × 5 列；直式名片：A4 橫式 5 欄 × 2 列。
    const page: PaperKey = landscape ? 'a4-portrait' : 'a4-landscape';
    const sheet = createSheet(page);
    sheet.classList.add('sheet--imposed');
    const grid = h('div', {
      class: 'cd-imposition',
      style: {
        '--cols': landscape ? '2' : '5',
        '--rows': landscape ? '5' : '2',
        '--card-w': `${width}mm`,
        '--card-h': `${height}mm`,
      },
    });
    for (let i = 0; i < 10; i++) grid.appendChild(h('div', { class: 'cd-slot' }, cardSurface(data, width, height, i, crop)));
    sheet.appendChild(grid);
    return sheet;
  }

  const sheet = createSheet(landscape ? 'card-landscape' : 'card-portrait');
  sheet.appendChild(cardSurface(data, width, height, 0, crop));
  return sheet;
}
