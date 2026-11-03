// 電報紙：表頭、欄位格、正文方格（每字旁附四碼電碼）、局戳。

import { formatMinguoDate, minguoYearNumeral, parseIsoDate, toMinguoYear } from '../lib/minguo.ts';
import { toChineseNumber } from '../lib/numerals.ts';
import { annotateTelegram, countWords, type Codebook, type TelegramCell } from '../lib/telegraph.ts';
import { telegramDateCode } from '../lib/yunmu.ts';
import { PAPER_SIZES, isPaperKey } from '../props/common.ts';
import type { TelegramData } from '../props/telegram.ts';
import { h, s } from '../ui/dom.ts';
import { createPaperSurface, createSheet } from './sheet.ts';

export interface TelegramRender {
  readonly sheet: HTMLElement;
  readonly cells: readonly TelegramCell[];
  /** 電碼表還沒載入或載入失敗時為 false。 */
  readonly coded: boolean;
  readonly capacity: number;
}

/** 依落款設定組出實際拍發的全文（電文＋署名＋代日字）。 */
export function telegramFullText(data: TelegramData): string {
  let text = data.body + data.signature;
  const date = parseIsoDate(data.date);
  if (date && (data.dateMode === 'yunmu' || data.dateMode === 'yunmu-month')) {
    text += telegramDateCode(date.month, date.day, {
      withMonth: data.dateMode === 'yunmu-month',
      alternate: data.yunmuAlternate,
    });
  }
  return text;
}

function rtl(text: string, className: string): HTMLElement {
  return h('div', { class: ['rtl-line', className], text });
}

function metaCell(label: string, value: string, className = ''): HTMLElement {
  return h(
    'div',
    { class: ['tg-meta-cell', className] },
    h('span', { class: 'tg-label', text: label }),
    h('span', { class: 'tg-value hand', text: value }),
  );
}

function stamp(office: string, dateLines: readonly string[]): SVGSVGElement {
  const id = 'tg-stamp-arc';
  return s(
    'svg',
    { class: 'tg-stamp', attrs: { viewBox: '0 0 100 100', 'aria-hidden': 'true' } },
    s(
      'g',
      { attrs: { filter: 'url(#f-ink)' } },
      s('circle', { attrs: { cx: 50, cy: 50, r: 46, fill: 'none', 'stroke-width': 3.2 } }),
      s('circle', { attrs: { cx: 50, cy: 50, r: 33, fill: 'none', 'stroke-width': 1.4 } }),
      s('path', { attrs: { id, d: 'M 14 50 A 36 36 0 0 1 86 50', fill: 'none', stroke: 'none' } }),
      s(
        'text',
        { class: 'tg-stamp-arc-text', attrs: { 'text-anchor': 'middle' } },
        s('textPath', { attrs: { href: `#${id}`, startOffset: '50%' }, text: office }),
      ),
      ...dateLines.map((line, i) =>
        s('text', {
          class: 'tg-stamp-date',
          attrs: { x: 50, y: 50 + (i - (dateLines.length - 1) / 2) * 15 + 5, 'text-anchor': 'middle' },
          text: line,
        }),
      ),
    ),
  );
}

export function renderTelegram(data: TelegramData, book: Codebook | null): TelegramRender {
  const paperKey = isPaperKey(data.paper) ? data.paper : 'a5-landscape';
  const size = PAPER_SIZES[paperKey];
  const small = size.width * size.height < 40000;
  const k = small ? 1 : 1.25;

  const sheet = createSheet(paperKey);
  const { paper, content } = createPaperSurface({
    width: size.width,
    height: size.height,
    aging: data.aging,
    folds: data.folds,
    stains: data.stains,
    stainSeed: data.stainSeed,
    foldLines: size.width > size.height ? { horizontal: [], vertical: [0.5] } : { horizontal: [0.5], vertical: [] },
    seedOffset: 23,
    className: 'tg-paper',
  });
  sheet.appendChild(paper);
  content.classList.add('tg');
  content.style.setProperty('--k', String(k));

  const fullText = telegramFullText(data);
  const cells: TelegramCell[] = book
    ? annotateTelegram(fullText, book, { dropPunctuation: data.dropPunctuation })
    : annotateTelegram(fullText, { lookup: () => undefined, size: 0 }, { dropPunctuation: data.dropPunctuation }).map(
        (c) => (c.kind === 'missing' ? { kind: 'other', char: c.char } : c),
      );

  // 方格大小與數量：依紙張計算。
  const inset = 8 * k;
  const frameW = size.width - inset * 2;
  const frameH = size.height - inset * 2;
  const fixed = (12 + 12 + 9 + 13) * k + 4 * 4; // 表頭、欄位、收報人、頁尾與間距
  const cellH = 10.5 * k;
  const cellW = data.codeDisplay === 'chars' ? cellH : 14.5 * k;
  const rows = Math.max(3, Math.floor((frameH - fixed) / cellH));
  const cols = Math.max(3, Math.floor((frameW - 4) / cellW));
  const capacity = rows * cols;
  content.style.setProperty('--cell-h', `${cellH}mm`);
  content.style.setProperty('--cell-w', `${cellW}mm`);
  content.style.setProperty('--rows', String(rows));
  content.style.setProperty('--cols', String(cols));

  const date = parseIsoDate(data.date);
  const dateText = date ? formatMinguoDate(date, { prefix: 'none', dayStyle: 'date' }) : '';
  const formTitle = data.formKind === 'send' ? '發報紙' : '收報紙';

  const frame = h('div', { class: 'tg-frame' });
  content.appendChild(frame);

  frame.appendChild(
    h('header', { class: 'tg-header' }, rtl(data.office, 'tg-office'), rtl(formTitle, 'tg-form-title')),
  );
  frame.appendChild(
    h(
      'div',
      { class: 'tg-meta' },
      metaCell('號數', data.serial),
      metaCell(data.formKind === 'send' ? '收報局' : '發報局', data.origin),
      metaCell('字數', cells.length > 0 ? toChineseNumber(countWords(cells)) : ''),
      metaCell('日期', dateText, 'tg-meta-wide'),
      metaCell(data.formKind === 'send' ? '發報時刻' : '收報時刻', data.receivedTime, 'tg-meta-wide'),
    ),
  );
  frame.appendChild(
    h(
      'div',
      { class: 'tg-addr' },
      h('span', { class: 'tg-label', text: '收報人住址姓名' }),
      h('span', { class: 'tg-value hand', text: data.addressee }),
    ),
  );

  const grid = h('div', {
    class: ['tg-grid', `tg-show-${data.codeDisplay}`],
    attrs: { 'data-fit': '', 'data-overflow': cells.length > capacity ? 'true' : null },
  });
  for (const cell of cells) {
    const code = cell.kind === 'han' ? (cell.codes[0] ?? '') : cell.kind === 'missing' ? '？？？？' : '';
    grid.appendChild(
      h(
        'div',
        {
          class: ['tg-cell', `tg-${cell.kind}`, cell.kind === 'han' && cell.via !== undefined && 'tg-variant'],
          attrs: {
            title:
              cell.kind === 'missing'
                ? `查無「${cell.char}」的電碼`
                : cell.kind === 'han' && cell.via !== undefined
                  ? `以「${cell.via}」的電碼代替`
                  : null,
          },
        },
        h('span', { class: 'tg-code', text: code }),
        h('span', { class: 'tg-char hand', text: cell.char }),
      ),
    );
  }
  for (let i = cells.length; i < capacity; i++) grid.appendChild(h('div', { class: 'tg-cell tg-empty' }));
  frame.appendChild(grid);

  const foot = h(
    'footer',
    { class: 'tg-foot' },
    h('div', { class: 'tg-notice', text: '此電如有錯誤或遲延，請持本紙至局查詢。' }),
    h(
      'div',
      { class: 'tg-clerk' },
      h('span', { class: 'tg-label', text: '譯電員' }),
      h('span', { class: 'tg-value hand', text: data.clerk }),
    ),
  );
  frame.appendChild(foot);

  if (data.stamp) {
    const lines = date ? [`${minguoYearNumeral(toMinguoYear(date.year).year)}年`, `${toChineseNumber(date.month)}月${toChineseNumber(date.day, { date: true })}日`] : [];
    content.appendChild(stamp(data.office, lines));
  }

  return { sheet, cells, coded: book !== null, capacity };
}
