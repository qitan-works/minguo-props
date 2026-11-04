// 民國日常文件：票券（船票、火車票）、直排文件（當票、地契）、表格（病歷、驗屍報告）、信封。
// 機構、店號、編號全部虛構；郵票是原創圖案、印的是虛構的「霧港郵政」。都接紙張狀況、裝飾、字型與列印。

import { formatMinguoDate, parseIsoDate } from '../lib/minguo.ts';
import type { Polygon } from '../lib/geometry.ts';
import { fontsOf } from '../props/common.ts';
import { pickConditions } from '../props/conditions.ts';
import { parseDocLines, type DocumentData } from '../props/document.ts';
import { h, s } from '../ui/dom.ts';
import { createPaperSurface, createSheet } from './sheet.ts';

const mm = (v: number): string => `${v.toFixed(2)}mm`;

function box(cls: string | readonly (string | false)[], x: number, y: number, w: number, hh: number, extra: Record<string, string> = {}, ...children: (Node | string | null)[]): HTMLElement {
  return h('div', { class: cls, style: { left: mm(x), top: mm(y), width: mm(w), height: mm(hh), ...extra } }, ...children);
}

/** 紅色的圓戳或方印。 */
function stamp(text: string, x: number, y: number, size: number, round: boolean, rotate: number): HTMLElement | null {
  const t = text.trim();
  if (!t) return null;
  const chars = Array.from(t);
  const rows = round ? chars.length : chars.length <= 4 ? 2 : 3;
  const cols = round ? 1 : Math.ceil(chars.length / rows);
  const fs = round ? Math.min(size * 0.22, (size * 1.9) / Math.max(4, chars.length)) : (size * 0.84) / Math.max(rows, cols);
  return h(
    'div',
    { class: ['dc-stamp', round ? 'dc-stamp-round' : 'dc-stamp-square'], style: { left: mm(x), top: mm(y), width: mm(size), height: mm(size), 'font-size': mm(fs), transform: `rotate(${rotate}deg)` } },
    h('span', { class: round ? 'dc-stamp-line' : 'dc-stamp-grid', text: chars.join(''), style: round ? {} : { height: mm(fs * rows * 1.02) } }),
  );
}

function surface(data: DocumentData, w: number, hh: number, crop: Polygon | null, cls: string): { paper: HTMLElement; content: HTMLElement } {
  const r = createPaperSurface({ width: w, height: hh, conditions: pickConditions(data), fonts: fontsOf(data), crop, className: `dc-paper ${cls}` });
  r.content.classList.add('dc');
  return r;
}

function dateText(data: DocumentData): string {
  const d = parseIsoDate(data.docDate);
  return d ? formatMinguoDate(d) : '';
}

// ---- 票券 ----

function renderTicket(data: DocumentData, crop: Polygon | null): HTMLElement {
  const W = 165;
  const H = 76;
  const sheet = createSheet('a4-portrait');
  sheet.classList.add('sheet--margin');
  const { paper, content } = surface(data, W, H, crop, data.docType === 'train' ? 'stock-ticket-green' : 'stock-ticket');
  const lines = parseDocLines(data.docLines);
  const get = (label: string): string => lines.find((l) => l.label === label)?.value ?? '';
  const from = get('由');
  const to = get('至');
  const rest = lines.filter((l) => l.label !== '由' && l.label !== '至');
  const title = data.docType === 'train' ? `${get('等級') || ''}車票` : '船票';
  const stub = 36;
  const no = (x: number, y: number, size: number): HTMLElement => box(['dc-no', data.docRed && 'dc-red'], x, y, 40, size * 1.3, { 'font-size': mm(size) }, data.docNo);
  // 存根
  content.append(
    box('dc-perf', stub, 0, 0.1, H),
    box('dc-tk-stub-title', 2, 4, stub - 4, 6, { 'font-size': mm(3.2) }, `${title}存根`),
    no(2, 12, 3.4),
    box('dc-tk-stub-line', 2, 22, stub - 4, 30, { 'font-size': mm(3) }, h('div', { text: from && to ? `${from} → ${to}` : '' }), h('div', { text: dateText(data) }), h('div', { text: get('艙位') || get('車次') })),
  );
  // 主票
  const x0 = stub + 5;
  const mw = W - x0 - 5;
  content.append(
    box('dc-tk-org', x0, 4, mw - 44, 7, { 'font-size': mm(Math.min(4.4, (mw - 46) / Math.max(6, Array.from(data.docOrg).length))) }, data.docOrg),
    box('dc-tk-title', x0, 11, mw, 11, { 'font-size': mm(8.5) }, title),
    no(W - 45, 4, 3.6),
    box('dc-tk-route', x0, 23, mw, 13, { 'font-size': mm(9) }, h('span', { text: from }), h('span', { class: 'dc-tk-arrow', text: '至' }), h('span', { text: to })),
  );
  const grid = h('div', { class: 'dc-tk-grid', style: { left: mm(x0), top: mm(38), width: mm(mw), height: mm(24), 'font-size': mm(3.3) } });
  for (const l of rest) grid.appendChild(h('div', {}, h('span', { class: 'dc-label', text: l.label ? `${l.label}　` : '' }), h('span', { class: 'dc-value', text: l.value })));
  content.append(grid, box('dc-tk-rule', x0, 63, mw, 10, { 'font-size': mm(2.6) }, data.docBody));
  const st = stamp(data.docStamp, W - 32, H - 34, 24, true, -12);
  if (st) content.appendChild(st);
  sheet.appendChild(paper);
  return sheet;
}

// ---- 直排：當票、地契 ----

function vcol(cls: string | readonly (string | false)[], text: string, x: number, y: number, w: number, hh: number, size: number): HTMLElement {
  return box(cls, x, y, w, hh, { 'font-size': mm(size) }, text);
}

function renderPawn(data: DocumentData, crop: Polygon | null): HTMLElement {
  const W = 148;
  const H = 210;
  const sheet = createSheet('a5-portrait');
  const { paper, content } = surface(data, W, H, crop, 'stock-pawn');
  const F = { x: 10, y: 12, w: W - 20, h: H - 24 };
  content.append(box('dc-frame dc-frame-double', F.x, F.y, F.w, F.h));
  // 上方店號（橫排由右而左）、中間大字「當」、右邊編號
  // 橫排由右而左：把字倒過來排
  content.append(box('dc-pawn-org', F.x + 4, F.y + 3, F.w - 8, 12, { 'font-size': mm(8) }, Array.from(data.docOrg).reverse().join('')));
  content.append(box('dc-rule', F.x + 3, F.y + 17, F.w - 6, 0.1));
  content.append(vcol('dc-pawn-big', '當', F.x + F.w / 2 - 18, F.y + 22, 36, 40, 32));
  content.append(vcol(['dc-vt', 'dc-no', data.docRed && 'dc-red'], data.docNo, F.x + F.w - 14, F.y + 22, 10, 70, 5));
  const lines = parseDocLines(data.docLines);
  const colW = Math.min(14, (F.w - 20) / Math.max(1, lines.length + 1));
  lines.forEach((l, i) => {
    const x = F.x + F.w - 20 - (i + 1) * colW;
    content.append(vcol('dc-vt dc-label', l.label, x, F.y + 66, colW, 22, 4.2), vcol('dc-vt dc-hand', l.value, x, F.y + 90, colW, F.h - 120, 5.4));
  });
  content.append(vcol('dc-vt dc-small', data.docBody, F.x + 4, F.y + 66, 12, F.h - 96, 4.3));
  content.append(vcol('dc-vt dc-hand', dateText(data), F.x + 18, F.y + F.h - 75, 9, 70, 4.6));
  const st = stamp(data.docStamp, F.x + F.w / 2 - 14, F.y + F.h - 42, 28, false, -6);
  if (st) content.appendChild(st);
  sheet.appendChild(paper);
  return sheet;
}

function renderDeed(data: DocumentData, crop: Polygon | null): HTMLElement {
  const W = 297;
  const H = 210;
  const sheet = createSheet('a4-landscape');
  const { paper, content } = surface(data, W, H, crop, 'stock-deed');
  const F = { x: 14, y: 14, w: W - 28, h: H - 28 };
  content.append(box('dc-frame dc-frame-deed', F.x, F.y, F.w, F.h));
  const colW = 12;
  let x = F.x + F.w - 6 - colW * 1.6;
  content.append(vcol('dc-vt dc-deed-title', '賣契', x, F.y + 8, colW * 1.6, 60, 13));
  x -= colW * 0.6;
  // 契文：直排由右往左，一欄放滿再換欄
  const body = Array.from(data.docBody.replace(/\s/g, ''));
  const per = Math.floor((F.h - 20) / (7 * 1.15));
  for (let i = 0; i * per < body.length; i++) {
    x -= colW;
    content.append(vcol('dc-vt dc-hand', body.slice(i * per, (i + 1) * per).join(''), x, F.y + 10, colW, F.h - 20, 7));
  }
  x -= colW * 0.5;
  for (const l of parseDocLines(data.docLines)) {
    x -= colW;
    if (x < F.x + 40) break;
    content.append(vcol('dc-vt dc-hand', l.label ? `${l.label}　${l.value}` : l.value, x, F.y + 10, colW, F.h - 20, 6.4));
  }
  x -= colW * 1.2;
  const date = dateText(data);
  content.append(vcol('dc-vt dc-hand', date ? `${date}　立` : '', Math.max(F.x + 26, x), F.y + 10, colW, F.h - 20, 7));
  const st = stamp(data.docStamp, Math.max(F.x + 16, x - 18), F.y + F.h * 0.42, 34, false, 4);
  if (st) content.appendChild(st);
  // 騎縫印：一半壓在紙邊外
  const half = stamp(data.docStamp, F.x - 17, F.y + 20, 34, false, -3);
  if (half) content.appendChild(half);
  sheet.appendChild(paper);
  return sheet;
}

// ---- 表格：病歷、驗屍報告 ----

function renderForm(data: DocumentData, crop: Polygon | null): HTMLElement {
  const W = 210;
  const H = 297;
  const autopsy = data.docType === 'autopsy';
  const sheet = createSheet('a4-portrait');
  const { paper, content } = surface(data, W, H, crop, 'stock-form');
  const x0 = 20;
  const w = W - 40;
  content.append(
    box('dc-form-org', x0, 16, w, 10, { 'font-size': mm(6.4) }, data.docOrg),
    box('dc-form-title', x0, 27, w, 12, { 'font-size': mm(9) }, autopsy ? '驗　屍　報　告' : '病　歷'),
    box(['dc-no', data.docRed && 'dc-red', 'dc-form-no'], x0, 41, w, 6, { 'font-size': mm(3.6) }, data.docNo),
  );
  const lines = parseDocLines(data.docLines);
  const rowH = 11;
  const table = h('div', { class: 'dc-form-table', style: { left: mm(x0), top: mm(50), width: mm(w), 'font-size': mm(3.8) } });
  for (let i = 0; i < lines.length; i += 2) {
    const row = h('div', { class: 'dc-form-row', style: { height: mm(rowH) } });
    for (const l of lines.slice(i, i + 2)) row.append(h('div', { class: 'dc-form-label', text: l.label }), h('div', { class: 'dc-form-value dc-hand', text: l.value }));
    table.appendChild(row);
  }
  content.appendChild(table);
  const top = 50 + Math.ceil(lines.length / 2) * rowH + 8;
  const diagramW = autopsy ? 46 : 0;
  content.append(box('dc-form-head', x0, top, w, 7, { 'font-size': mm(4) }, autopsy ? '檢驗結果' : '病情記錄'));
  content.append(box('dc-form-notes dc-hand', x0, top + 8, w - diagramW - (autopsy ? 4 : 0), H - top - 60, { 'font-size': mm(5), 'line-height': mm(9) }, data.docBody));
  if (autopsy) content.appendChild(bodyDiagram(x0 + w - diagramW, top + 8, diagramW, Math.min(110, H - top - 60)));
  const date = dateText(data);
  content.append(box('dc-form-sign', x0, H - 46, w, 8, { 'font-size': mm(4) }, h('span', { text: date ? `中華民國${date.replace(/^民國/, '')}` : '' }), h('span', { text: autopsy ? '檢驗員簽章' : '主治醫師簽章' })));
  const st = stamp(data.docStamp, W - 62, H - 60, 28, true, -8);
  if (st) content.appendChild(st);
  sheet.appendChild(paper);
  return sheet;
}

/** 驗屍報告的人形圖（正面），左胸畫上三個圓形印痕。 */
function bodyDiagram(x: number, y: number, w: number, hh: number): HTMLElement {
  const svg = s('svg', { class: 'dc-diagram', attrs: { viewBox: '0 0 40 100', preserveAspectRatio: 'xMidYMid meet' } });
  const p = (d: string, extra: Record<string, string | number> = {}): SVGElement => s('path', { attrs: { d, fill: 'none', stroke: 'currentColor', 'stroke-width': 0.6, 'stroke-linejoin': 'round', ...extra } });
  svg.append(
    s('circle', { attrs: { cx: 20, cy: 8, r: 6, fill: 'none', stroke: 'currentColor', 'stroke-width': 0.6 } }),
    p('M14 16 Q20 18 26 16 L33 22 L36 46 L32 47 L29 27 L28 50 L30 96 L23 96 L20 58 L17 96 L10 96 L12 50 L11 27 L8 47 L4 46 L7 22 Z'),
    ...[0, 1, 2].map((i) => s('circle', { attrs: { cx: 23.5 + i * 1.6, cy: 27 + i * 2.4 - (i === 1 ? 0.8 : 0), r: 1.1, fill: 'none', stroke: 'rgb(170 30 25)', 'stroke-width': 0.5 } })),
  );
  return box('dc-diagram-box', x, y, w, hh, {}, svg, h('div', { class: 'dc-diagram-cap', text: '正面' }));
}

// ---- 信封 ----

function renderEnvelope(data: DocumentData, crop: Polygon | null): HTMLElement {
  const W = 100;
  const H = 210;
  const sheet = createSheet('a4-portrait');
  sheet.classList.add('sheet--margin');
  const { paper, content } = surface(data, W, H, crop, 'stock-envelope');
  const lines = parseDocLines(data.docLines);
  const get = (label: string): string => lines.find((l) => l.label.startsWith(label))?.value ?? '';
  // 中間的紅框（收件人）、右邊地址、左下寄件人
  content.append(
    box('dc-env-frame', W / 2 - 15, 40, 30, 142),
    vcol('dc-vt dc-hand dc-env-name', get('收件人'), W / 2 - 13, 46, 26, 132, 11),
    vcol('dc-vt dc-hand', get('收件地址'), W - 26, 30, 14, 150, 7.5),
    vcol('dc-vt dc-hand', get('寄件人'), 8, 120, 10, 82, 5.6),
  );
  // 郵票（原創圖案：燈塔與浪，印虛構的「霧港郵政」）與郵戳
  content.appendChild(postageStamp(data.docOrg || '霧港郵政', 9, 8));
  const date = dateText(data).replace(/^民國/, '');
  const mark = h(
    'div',
    { class: 'dc-postmark', style: { left: mm(20), top: mm(14), width: mm(26), height: mm(26) } },
    h('div', { class: 'dc-pm-top', text: data.docStamp.trim() }),
    h('div', { class: 'dc-pm-date', text: date }),
  );
  content.appendChild(mark);
  content.appendChild(s('svg', { class: 'dc-cancel', attrs: { viewBox: '0 0 40 14' }, style: { left: mm(40), top: mm(18), width: mm(40), height: mm(14) } }, ...[3, 7, 11].map((y) => s('path', { attrs: { d: `M0 ${y} q5 -3 10 0 t10 0 t10 0 t10 0`, fill: 'none', stroke: 'currentColor', 'stroke-width': 0.7 } }))));
  sheet.appendChild(paper);
  return sheet;
}

function postageStamp(name: string, x: number, y: number): HTMLElement {
  const svg = s('svg', { class: 'dc-postage-svg', attrs: { viewBox: '0 0 22 26' } });
  svg.append(
    s('rect', { attrs: { x: 0.6, y: 0.6, width: 20.8, height: 24.8, fill: 'rgb(238 232 214)', stroke: 'rgb(150 60 50)', 'stroke-width': 0.5, 'stroke-dasharray': '0.9 0.6' } }),
    s('rect', { attrs: { x: 2.4, y: 2.4, width: 17.2, height: 21.2, fill: 'rgb(176 64 52 / 0.12)', stroke: 'rgb(160 50 40)', 'stroke-width': 0.4 } }),
    s('path', { attrs: { d: 'M11 6 L12.4 8 L12.4 16 L9.6 16 L9.6 8 Z M10.2 6 h1.6 v-1 h-1.6 z', fill: 'rgb(160 50 40)' } }),
    s('path', { attrs: { d: 'M3 18 q2 -1.5 4 0 t4 0 t4 0 t4 0', fill: 'none', stroke: 'rgb(160 50 40)', 'stroke-width': 0.5 } }),
    s('path', { attrs: { d: 'M3 20 q2 -1.5 4 0 t4 0 t4 0 t4 0', fill: 'none', stroke: 'rgb(160 50 40)', 'stroke-width': 0.5 } }),
  );
  return h(
    'div',
    { class: 'dc-postage', style: { left: mm(x), top: mm(y), width: mm(22), height: mm(26) } },
    svg,
    h('div', { class: 'dc-postage-name', text: name }),
  );
}

export function renderDocument(data: DocumentData, crop: Polygon | null = null): HTMLElement {
  switch (data.docType) {
    case 'ship':
    case 'train':
      return renderTicket(data, crop);
    case 'deed':
      return renderDeed(data, crop);
    case 'medical':
    case 'autopsy':
      return renderForm(data, crop);
    case 'envelope':
      return renderEnvelope(data, crop);
    default:
      return renderPawn(data, crop);
  }
}
