// 整版報紙的紙面座標（純邏輯）：把紙張大小、報頭位置換算成排版格子與各區的公釐座標。
//
// 報頭位置：
// - right：右側直排的大報頭框（框內有報名、日期、舊曆、英文報名、號數、定價），新聞從框的左邊與下方排起；
// - corner-right／corner-left：右上角或左上角的橫排報頭框，四周排新聞；
// - top：頂部橫排一整條（第二版的樣式）；
// - none：不要報頭（內頁），只有報眉。
// 報眉是版面最上方一條細欄（第幾張、日期、報名、第幾版）。

import type { Rect } from '../geometry.ts';
import type { Obstacle } from './broadsheet.ts';
import { cellSizeFor } from './page.ts';

export type MastheadLayout = 'right' | 'corner-right' | 'corner-left' | 'top' | 'none';

export const MASTHEAD_LAYOUTS: readonly { value: Exclude<MastheadLayout, 'none'>; label: string }[] = [
  { value: 'right', label: '右側直排大報頭框' },
  { value: 'corner-right', label: '右上角橫排報頭框' },
  { value: 'corner-left', label: '左上角橫排報頭框' },
  { value: 'top', label: '頂部橫排' },
];

export function isMastheadLayout(v: string): v is MastheadLayout {
  return v === 'right' || v === 'corner-right' || v === 'corner-left' || v === 'top' || v === 'none';
}

export interface BroadsheetGeometry {
  /** 內文字高（公釐）。 */
  readonly cell: number;
  /** 一行的寬（公釐）。 */
  readonly pitch: number;
  readonly cols: number;
  readonly rows: number;
  /** 排版格子的範圍（紙面座標）。 */
  readonly area: Rect;
  /** 報眉；不要時為 null。 */
  readonly header: Rect | null;
  /** 報頭框；不要時為 null。 */
  readonly masthead: Rect | null;
  readonly layout: MastheadLayout;
  /** 報頭框在格子裡佔的位置（right、corner-*）。 */
  readonly obstacle?: Obstacle;
}

export interface BroadsheetGeometryOptions {
  readonly width: number;
  readonly height: number;
  readonly layout: MastheadLayout;
  readonly header: boolean;
  readonly margin?: number;
}

export function broadsheetGeometry(o: BroadsheetGeometryOptions): BroadsheetGeometry {
  const margin = o.margin ?? 8;
  const cell = cellSizeFor(o.width, o.height);
  const pitch = Math.round(cell * 1.14 * 1000) / 1000;
  let top = margin;
  let header: Rect | null = null;
  if (o.header) {
    header = { x: margin, y: margin, w: o.width - 2 * margin, h: cell * 1.25 };
    top += header.h + cell * 0.45;
  }
  let masthead: Rect | null = null;
  if (o.layout === 'top') {
    const h = Math.round(Math.min(o.width, o.height) * 0.15);
    masthead = { x: margin, y: top, w: o.width - 2 * margin, h };
    top += h + 2.5;
  }
  const usableW = o.width - 2 * margin;
  const usableH = o.height - top - margin;
  const cols = Math.max(8, Math.floor(usableW / pitch));
  const rows = Math.max(20, Math.floor(usableH / cell));
  const area: Rect = { x: margin + (usableW - cols * pitch) / 2, y: top, w: cols * pitch, h: rows * cell };
  const colX = (col: number): number => area.x + area.w - (col + 1) * pitch;
  let obstacle: Obstacle | undefined;
  if (o.layout === 'right') {
    obstacle = { col: 0, row: 0, cols: Math.max(6, Math.round(cols * 0.19)), rows: Math.max(16, Math.round(rows * 0.42)) };
  } else if (o.layout === 'corner-right' || o.layout === 'corner-left') {
    const w = Math.max(10, Math.round(cols * 0.47));
    obstacle = { col: o.layout === 'corner-right' ? 0 : cols - w, row: 0, cols: w, rows: Math.max(10, Math.round(rows * 0.17)) };
  }
  if (obstacle) {
    masthead = { x: colX(obstacle.col + obstacle.cols - 1), y: area.y + obstacle.row * cell, w: obstacle.cols * pitch, h: obstacle.rows * cell };
  }
  return { cell, pitch, cols, rows, area, header, masthead, layout: o.layout, ...(obstacle ? { obstacle } : {}) };
}

/** 第 col 行的左緣（公釐）。 */
export function colLeft(g: BroadsheetGeometry, col: number): number {
  return g.area.x + g.area.w - (col + 1) * g.pitch;
}

/** 第 row 格的上緣（公釐）。 */
export function rowTop(g: BroadsheetGeometry, row: number): number {
  return g.area.y + row * g.cell;
}
