// 把表單內容與使用者自己加的新聞轉成排版用的區塊，並計算「從整版剪下」的剪裁範圍。純邏輯。

import type { NewsItem } from '../../props/extras.ts';
import { intersectRects, unionRects, type Rect } from '../geometry.ts';
import type { PlacedBlock, SourceBlock } from './layout.ts';

export interface MainArticle {
  readonly headline: string;
  readonly subheadline: string;
  readonly dateline: string;
  readonly body: string;
  readonly photo: string;
  readonly photoCaption: string;
  readonly secondTitle: string;
  readonly secondBody: string;
}

/** 使用者的區塊：主新聞、照片、短訊、再加上自己新增的新聞與啟事（依序）。 */
export function userBlocks(main: MainArticle, items: readonly NewsItem[], photoSlots: number): SourceBlock[] {
  const blocks: SourceBlock[] = [
    {
      id: 'main',
      kind: 'news',
      title: main.headline,
      subtitle: main.subheadline,
      dateline: main.dateline,
      body: main.body || '（內文）',
      source: 'user',
    },
  ];
  if (main.photo) blocks.push({ id: 'photo', kind: 'photo', body: main.photoCaption, photoSlots, source: 'user' });
  if (main.secondTitle || main.secondBody) {
    blocks.push({ id: 'second', kind: 'short', title: main.secondTitle, body: main.secondBody, source: 'user' });
  }
  for (const item of items) {
    if (!item.title && !item.body) continue;
    blocks.push({ id: item.id, kind: item.kind, title: item.title, body: item.body, source: 'user' });
  }
  return blocks;
}

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

/** 剪下哪幾則：主新聞，或全部使用者區塊。 */
export function anchorRect(blocks: readonly PlacedBlock[], rectOf: (b: PlacedBlock) => Rect, which: 'main' | 'user', extra?: Rect): Rect | null {
  const chosen = blocks.filter((b) => (which === 'main' ? b.id === 'main' || b.id === 'photo' : b.source === 'user'));
  const rects = chosen.map(rectOf);
  if (extra) rects.push(extra);
  return unionRects(rects);
}
