// 報紙廣告的版型（純邏輯）：給一個框（公釐），把廣告的特大字、說明、價目與發行所排滿。
// 民國報紙的廣告常見兩到七個特大字佔滿框，同一則廣告橫排直排混用，底下一行價目。
// 版型依框的長寬比與種子決定：
// - hbig：特大字橫排（由右而左）佔上方，說明直排在下，價目橫排在底；
// - vbig：特大字直排在正中，說明分在兩側直排，價目橫排在底；
// - grid：四個特大字排成田字，說明在下。

import type { Rect } from '../geometry.ts';
import { rngFor } from '../random.ts';

export interface AdItem {
  readonly id: string;
  readonly source: 'user' | 'filler';
  /** 特大字（兩到七個字）。 */
  readonly big: string;
  /** 說明文字，每一句一行。 */
  readonly lines: readonly string[];
  readonly price?: string;
  /** 發行所、地址。 */
  readonly maker?: string;
}

export type AdTextRole = 'big' | 'small' | 'price' | 'maker';

export interface AdText {
  readonly role: AdTextRole;
  readonly text: string;
  /** 文字框（公釐，紙面座標）。 */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** 字高（公釐）。 */
  readonly size: number;
  readonly dir: 'h' | 'v';
}

export interface AdLayout {
  readonly variant: 'hbig' | 'vbig' | 'grid';
  /** 框線的位置（公釐）。 */
  readonly frame: Rect;
  readonly texts: readonly AdText[];
  /** 價目上方的分隔線（公釐，y 座標）；沒有時為 null。 */
  readonly divider: number | null;
}

function chars(text: string): string[] {
  return Array.from(text.replace(/\s+/g, ''));
}

/** 直排的說明文字：從 right 往左排幾行，每行最多放得下的字。 */
function verticalLines(lines: readonly string[], right: number, top: number, width: number, height: number, size: number): AdText[] {
  const pitch = size * 1.25;
  const per = Math.max(1, Math.floor(height / size));
  const out: AdText[] = [];
  let x = right;
  for (const line of lines) {
    const cs = chars(line);
    for (let i = 0; i < cs.length; i += per) {
      if (x - pitch < right - width - 0.01) return out;
      x -= pitch;
      out.push({ role: 'small', text: cs.slice(i, i + per).join(''), x, y: top, w: pitch, h: height, size, dir: 'v' });
    }
  }
  return out;
}

export function layoutAd(ad: AdItem, box: Rect, seed: number, cell: number): AdLayout {
  const rng = rngFor(seed, `ad:${ad.id}`);
  const pad = Math.max(0.9, Math.min(box.w, box.h) * 0.05);
  const frame: Rect = { x: box.x + pad * 0.5, y: box.y + pad * 0.5, w: box.w - pad, h: box.h - pad };
  const inner: Rect = { x: frame.x + pad, y: frame.y + pad, w: frame.w - 2 * pad, h: frame.h - 2 * pad };
  const big = chars(ad.big).slice(0, 7);
  const n = Math.max(1, big.length);
  const small = Math.max(cell * 0.72, Math.min(cell * 1.05, inner.w / 9));
  const texts: AdText[] = [];

  // 底部：價目一行（橫排）＋發行所
  let bottom = inner.y + inner.h;
  let divider: number | null = null;
  if (ad.maker) {
    const size = Math.min(small, inner.w / Math.max(4, chars(ad.maker).length));
    texts.push({ role: 'maker', text: chars(ad.maker).join(''), x: inner.x, y: bottom - size * 1.15, w: inner.w, h: size * 1.15, size, dir: 'h' });
    bottom -= size * 1.35;
  }
  if (ad.price) {
    const size = Math.min(small * 1.15, inner.w / Math.max(4, chars(ad.price).length));
    texts.push({ role: 'price', text: chars(ad.price).join(''), x: inner.x, y: bottom - size * 1.2, w: inner.w, h: size * 1.2, size, dir: 'h' });
    bottom -= size * 1.5;
    divider = bottom + size * 0.12;
  }
  const area: Rect = { x: inner.x, y: inner.y, w: inner.w, h: Math.max(cell * 2, bottom - inner.y) };
  const aspect = area.h / Math.max(1, area.w);
  const variant: AdLayout['variant'] =
    n === 4 && area.w > cell * 7 && area.h > area.w * 0.75 && rng() < 0.5 ? 'grid' : aspect > 1.15 && rng() < 0.75 ? 'vbig' : 'hbig';

  if (variant === 'hbig') {
    const rows = n > 4 && area.w / n < area.h * 0.22 ? 2 : 1;
    const per = Math.ceil(n / rows);
    const size = Math.min((area.w / per) * 0.96, (area.h * (ad.lines.length ? 0.55 : 0.92)) / rows);
    for (let r = 0; r < rows; r++) {
      const text = big.slice(r * per, (r + 1) * per).join('');
      texts.push({ role: 'big', text, x: area.x, y: area.y + r * size * 1.04, w: area.w, h: size * 1.04, size, dir: 'h' });
    }
    const top = area.y + rows * size * 1.04 + size * 0.12;
    const restH = area.y + area.h - top;
    if (restH > small * 2) texts.push(...verticalLines(ad.lines, area.x + area.w - (area.w - Math.min(area.w, ad.lines.length * small * 1.25 * 2)) / 2, top, area.w, restH, small));
  } else if (variant === 'vbig') {
    const colsOfBig = n > 4 && area.h / n < area.w * 0.32 ? 2 : 1;
    const per = Math.ceil(n / colsOfBig);
    const sideRoom = ad.lines.length ? 0.42 : 0.04;
    const size = Math.min((area.h / per) * 0.96, (area.w * (1 - sideRoom)) / colsOfBig / 1.06);
    const bigW = size * 1.06 * colsOfBig;
    const bigX = area.x + (area.w - bigW) / 2;
    for (let c = 0; c < colsOfBig; c++) {
      const text = big.slice(c * per, (c + 1) * per).join('');
      texts.push({ role: 'big', text, x: bigX + bigW - (c + 1) * size * 1.06, y: area.y + (area.h - per * size * 1.0) / 2, w: size * 1.06, h: per * size, size, dir: 'v' });
    }
    const half = Math.ceil(ad.lines.length / 2);
    const sideW = (area.w - bigW) / 2;
    texts.push(...verticalLines(ad.lines.slice(0, half), area.x + area.w, area.y, sideW, area.h, small));
    texts.push(...verticalLines(ad.lines.slice(half), bigX, area.y, sideW, area.h, small));
  } else {
    const size = Math.min((area.w / 2) * 0.94, (area.h * (ad.lines.length ? 0.68 : 0.95)) / 2);
    const gx = area.x + (area.w - size * 2.04) / 2;
    // 田字：右上、右下、左上、左下（直排的讀法）
    const order = [
      [1, 0],
      [1, 1],
      [0, 0],
      [0, 1],
    ] as const;
    big.slice(0, 4).forEach((ch, i) => {
      const [cx, cy] = order[i] as readonly [number, number];
      texts.push({ role: 'big', text: ch, x: gx + cx * size * 1.04, y: area.y + cy * size * 1.02, w: size * 1.02, h: size * 1.02, size, dir: 'h' });
    });
    const top = area.y + size * 2.08;
    const restH = area.y + area.h - top;
    if (restH > small * 2) texts.push(...verticalLines(ad.lines, area.x + area.w, top, area.w, restH, small));
  }
  return { variant, frame, texts, divider };
}
