// 「從整版剪下」的剪裁範圍。純邏輯。

import { intersectRects, type Rect } from '../geometry.ts';

export interface Margins {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/** 剪裁範圍：錨點矩形向外多留邊（可為負數），並限制在紙面內。 */
export function cutFrame(anchor: Rect, margins: Margins, bounds: Rect): Rect {
  const raw: Rect = {
    x: anchor.x - margins.left,
    y: anchor.y - margins.top,
    w: anchor.w + margins.left + margins.right,
    h: anchor.h + margins.top + margins.bottom,
  };
  const safe: Rect = raw.w > 5 && raw.h > 5 ? raw : { x: anchor.x, y: anchor.y, w: Math.max(5, anchor.w), h: Math.max(5, anchor.h) };
  return intersectRects(safe, bounds) ?? bounds;
}
