// 第四版：各區塊的內容從哪裡來（純邏輯）。依填版種子把素材分給各區塊：
// 主新聞與第二則是使用者寫的；社論、專電、連載、副刊詩文、啟事、廣告各有自己的素材；
// 一般新聞與短訊從共用佇列取（使用者自己加的排最前面）；表格、目錄、插圖由種子產生。
// 鎖定的區塊用鎖定時存下的內容，換一批也不變。

import { EDITORIALS, LITERARY, PICTURE_CAPTIONS, SERIALS, WIRES } from '../../data/fillers4.ts';
import type { FillerItem } from '../../data/fillers.ts';
import { pick, rngFor, shuffle } from '../random.ts';
import type { AdItem } from './ads.ts';
import type { BlockEdit, PictureKind } from './blockstyle.ts';
import { adFromFiller, flowFromFiller, type BroadsheetPool } from './fillers.ts';
import type { FlowItem } from './flow.ts';
import type { PageType, PlannedBlock } from './pageplan.ts';
import type { ContentProvider } from './sections.ts';
import { fxTable, goodsTable, shipsTable, tocData } from './tables.ts';

export interface ContentOptions {
  readonly seed: number;
  readonly pageType: PageType;
  readonly lead: FlowItem;
  readonly second: FlowItem | null;
  /** 使用者自己加的新聞與短訊。 */
  readonly userItems: readonly FlowItem[];
  /** 使用者自己加的啟事。 */
  readonly userNotices: readonly FlowItem[];
  readonly userAds: readonly AdItem[];
  readonly pool: BroadsheetPool;
  /** 鎖定的區塊存下的內容。 */
  readonly locked: ReadonlyMap<string, BlockEdit>;
}

/** 區塊內容的種子：鎖定時用存下的，否則由填版種子與區塊 id 決定。 */
export function contentSeed(seed: number, blockId: string, locked?: BlockEdit): number {
  if (locked?.contentSeed !== undefined) return locked.contentSeed;
  let h = seed >>> 0;
  for (const ch of blockId) h = (Math.imul(h ^ ch.charCodeAt(0), 2654435761) >>> 0) % 2147483647;
  return h;
}

export function createContent(o: ContentOptions): ContentProvider {
  const rng = rngFor(o.seed, `content:${o.pageType}`);
  const kindOf = (id: string): FillerItem['kind'] | undefined => o.pool.byId.get(id)?.kind;
  const queue: FlowItem[] = [...o.userItems, ...o.pool.items.filter((i) => kindOf(i.id) !== 'notice')];
  const notices: FlowItem[] = [...o.userNotices, ...o.pool.items.filter((i) => kindOf(i.id) === 'notice')];
  const ads: AdItem[] = [...o.userAds, ...o.pool.ads];
  const editorials = shuffle(rng, EDITORIALS).map((e) => flowFromFiller(e, 'filler', 2));
  const wires = shuffle(rng, WIRES).map((w): FlowItem => ({ id: w.id, source: 'filler', level: 3, title: '', subtitles: [], kicker: `${w.from}電`, paragraphs: [w.body] }));
  const serials = shuffle(rng, SERIALS).map((s): FlowItem => ({ id: s.id, source: 'filler', level: 2, title: s.novel, subtitles: [s.chapter], paragraphs: s.body.split('\n') }));
  const literary = shuffle(rng, LITERARY).map((l) => flowFromFiller(l, 'filler', 2));
  let leadUsed = false;
  let secondUsed = false;

  const takeQueue = (wantNews: boolean): FlowItem[] => {
    const k = queue.findIndex((q) => (wantNews ? q.level <= 2 : q.level === 3) && !q.rows);
    const at = k >= 0 ? k : queue.findIndex((q) => !q.rows);
    if (at < 0) return [];
    return queue.splice(at, 1);
  };
  const lockedFlow = (block: PlannedBlock): FlowItem[] | null => {
    const content = o.locked.get(block.id)?.content;
    if (!content || content.length === 0) return null;
    return content.map((c) => flowFromFiller(c, 'filler', c.kind === 'news' ? 2 : 3));
  };

  return {
    queue,
    tiny: [...o.pool.tiny],
    userStory: (source) => (source === 'lead' ? o.lead : o.second),
    flow(block) {
      const locked = lockedFlow(block);
      if (locked) return locked;
      switch (block.source) {
        case 'lead':
          if (!leadUsed) {
            leadUsed = true;
            return [o.lead];
          }
          return takeQueue(true);
        case 'second':
          if (o.second && !secondUsed) {
            secondUsed = true;
            return [o.second];
          }
          return takeQueue(true);
        case 'editorial':
          return editorials.splice(0, 1);
        case 'wire':
          return wires.splice(0, Math.min(wires.length, block.style.span > 1 ? 5 : 3));
        case 'serial':
          return serials.length > 0 ? serials.splice(0, 1) : takeQueue(true);
        case 'literary':
          return literary.length > 0 ? literary.splice(0, 1) : takeQueue(block.style.kind === 'news');
        case 'notice': {
          const n = notices.shift();
          return n ? [{ ...n, level: 3 }] : takeQueue(false);
        }
        default:
          return takeQueue(block.style.kind !== 'short');
      }
    },
    ad(block) {
      const content = o.locked.get(block.id)?.content?.[0];
      if (content) return adFromFiller(content);
      return ads.shift() ?? null;
    },
    table(block) {
      const r = rngFor(contentSeed(o.seed, block.id, o.locked.get(block.id)), 'table');
      return block.source === 'table-ships' ? shipsTable(r) : block.source === 'table-fx' ? fxTable(r) : goodsTable(r);
    },
    toc(block) {
      return tocData(rngFor(contentSeed(o.seed, block.id, o.locked.get(block.id)), 'toc'), o.pageType === 'supplement');
    },
    picture(block) {
      const r = rngFor(contentSeed(o.seed, block.id, o.locked.get(block.id)), 'picture');
      const kind: PictureKind = block.style.picture !== 'none' ? block.style.picture : pick(r, ['ship', 'clock', 'watch'] as const);
      return { kind, caption: pick(r, PICTURE_CAPTIONS[kind]) };
    },
  };
}
