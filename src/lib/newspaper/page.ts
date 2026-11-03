// 整版報紙的版面尺寸：把排版引擎的「格」換算成紙上的公釐座標。純邏輯。

import type { Rect } from '../geometry.ts';
import type { GridSpec, PlacedBlock } from './layout.ts';

export interface PageGeometry {
  /** 內文字的大小（公釐）。 */
  readonly cell: number;
  /** 行距（一行佔的寬度，公釐）。 */
  readonly pitch: number;
  /** 每段的高度（公釐）。 */
  readonly tierHeight: number;
  /** 段與段之間的間隔（公釐）。 */
  readonly tierGap: number;
  readonly grid: GridSpec;
  /** 報頭區（紙面座標）。 */
  readonly masthead: Rect;
  /** 排版區（紙面座標）；區塊由這個矩形的右上角開始排。 */
  readonly area: Rect;
}

export interface PageOptions {
  readonly width: number;
  readonly height: number;
  readonly tiers: number;
  /** 紙邊留白（公釐）。 */
  readonly margin?: number;
  /** 報頭高度（公釐）；0 表示不要報頭（內頁）。 */
  readonly mastheadHeight?: number;
}

/** A4 用 3.3 mm 的字，A5 用 2.8 mm，介於中間的按比例。 */
export function cellSizeFor(width: number, height: number): number {
  const area = width * height;
  return area >= 60000 ? 3.3 : area <= 32000 ? 2.8 : 3.0;
}

export function pageGeometry(options: PageOptions): PageGeometry {
  const margin = options.margin ?? 8;
  const cell = cellSizeFor(options.width, options.height);
  const pitch = Math.round(cell * 1.14 * 1000) / 1000;
  const mastheadHeight = options.mastheadHeight ?? Math.round(options.height * 0.11);
  const masthead: Rect = { x: margin, y: margin, w: options.width - 2 * margin, h: mastheadHeight };
  const top = margin + mastheadHeight + (mastheadHeight > 0 ? 2.5 : 0);
  const usableH = options.height - top - margin;
  const usableW = options.width - 2 * margin;
  const tierGap = Math.round(cell * 0.9 * 1000) / 1000;
  const tiers = Math.max(1, options.tiers);
  const rawTier = (usableH - tierGap * (tiers - 1)) / tiers;
  const chars = Math.max(4, Math.floor(rawTier / cell));
  const tierHeight = chars * cell;
  const slots = Math.max(4, Math.floor(usableW / pitch));
  const areaW = slots * pitch;
  const areaH = tierHeight * tiers + tierGap * (tiers - 1);
  const area: Rect = {
    x: margin + (usableW - areaW) / 2,
    y: top + (usableH - areaH) / 2,
    w: areaW,
    h: areaH,
  };
  return {
    cell,
    pitch,
    tierHeight,
    tierGap,
    grid: { tiers, slots, chars, gapChars: tierGap / cell },
    masthead,
    area,
  };
}

/** 區塊在紙面上的矩形。 */
export function blockRect(geom: PageGeometry, block: Pick<PlacedBlock, 'tier' | 'tierSpan' | 'slot' | 'slots'>): Rect {
  const right = geom.area.x + geom.area.w - block.slot * geom.pitch;
  return {
    x: right - block.slots * geom.pitch,
    y: geom.area.y + block.tier * (geom.tierHeight + geom.tierGap),
    w: block.slots * geom.pitch,
    h: block.tierSpan * geom.tierHeight + (block.tierSpan - 1) * geom.tierGap,
  };
}

/** 區塊內每一行在紙面上的矩形（由右而左）。照片區塊的照片本身不算行。 */
export function lineRects(geom: PageGeometry, block: PlacedBlock): Rect[] {
  const outer = blockRect(geom, block);
  const rects: Rect[] = [];
  let offset = block.boxed ? 0.5 : 0;
  for (const line of block.lines) {
    const w = line.size * geom.pitch;
    const chars = Array.from(line.text).length;
    rects.push({
      x: outer.x + outer.w - (offset + line.size) * geom.pitch,
      y: outer.y + (block.boxed ? geom.cell * 0.5 : 0),
      w,
      h: Math.min(outer.h, chars * geom.cell * line.size),
    });
    offset += line.size;
  }
  return rects;
}
