// 信箋：紅格直排信紙（八行箋等），每一行文字正好落在一格紅線之間。

import { formatMinguoDate, formatMonthDay, parseIsoDate } from '../lib/minguo.ts';
import { PAPER_SIZES, isPaperKey } from '../props/common.ts';
import type { LetterData } from '../props/letter.ts';
import { h, paragraphs } from '../ui/dom.ts';
import { createPaperSurface, createSheet } from './sheet.ts';

export function letterDateText(data: LetterData): string {
  const date = parseIsoDate(data.date);
  if (!date || data.dateMode === 'none') return '';
  const dayStyle = data.dayStyle ? 'date' : 'standard';
  switch (data.dateMode) {
    case 'monthday':
      return formatMonthDay(date, dayStyle);
    case 'minguo':
      return formatMinguoDate(date, { prefix: 'short', dayStyle });
    default:
      return formatMinguoDate(date, { prefix: 'none', dayStyle });
  }
}

export function renderLetter(data: LetterData): HTMLElement {
  const paperKey = isPaperKey(data.paper) ? data.paper : 'a4-portrait';
  const size = PAPER_SIZES[paperKey];
  const k = size.width / 210;
  const columns = Math.min(14, Math.max(6, Number.parseInt(data.columns, 10) || 8));

  const sheet = createSheet(paperKey);
  const { paper, content } = createPaperSurface({
    width: size.width,
    height: size.height,
    aging: data.aging,
    folds: data.folds,
    stains: data.stains,
    effectSeed: data.effectSeed,
    foldLines: { horizontal: [1 / 3, 2 / 3], vertical: [0.5] },
    seedOffset: 37,
    className: 'lt-paper',
  });
  sheet.appendChild(paper);

  const frame = { left: 17 * k, right: 17 * k, top: 34 * k, bottom: 24 * k };
  const frameW = size.width - frame.left - frame.right;
  const frameH = size.height - frame.top - frame.bottom;
  const pitch = frameW / columns;
  const fontSize = Math.min(pitch * 0.6, 9.5 * k);
  content.classList.add('lt', `ink-${data.ink}`);
  content.style.setProperty('--frame-l', `${frame.left}mm`);
  content.style.setProperty('--frame-t', `${frame.top}mm`);
  content.style.setProperty('--frame-w', `${frameW}mm`);
  content.style.setProperty('--frame-h', `${frameH}mm`);
  content.style.setProperty('--pitch', `${pitch.toFixed(3)}mm`);
  content.style.setProperty('--lt-font', `${fontSize.toFixed(2)}mm`);

  content.appendChild(h('div', { class: 'lt-frame', attrs: { 'aria-hidden': 'true' } }));

  const text = h('div', { class: 'lt-text vt hand', attrs: { 'data-fit': '' } });
  if (data.salutation) text.appendChild(h('p', { class: 'lt-salutation', text: data.salutation }));
  for (const para of paragraphs(data.body)) {
    text.appendChild(h('p', { class: ['lt-p', data.indent && 'lt-indent'], text: para }));
  }
  paragraphs(data.closing).forEach((line, i) => {
    text.appendChild(h('p', { class: ['lt-closing', i === 0 ? 'lt-closing-first' : 'lt-closing-raise'], text: line }));
  });
  if (data.signature) text.appendChild(h('p', { class: 'lt-signature', text: data.signature }));
  const dateText = letterDateText(data);
  if (dateText) text.appendChild(h('p', { class: 'lt-date', text: dateText }));
  content.appendChild(text);

  if (data.stationer) content.appendChild(h('div', { class: 'rtl-line lt-stationer', text: data.stationer }));

  return sheet;
}
