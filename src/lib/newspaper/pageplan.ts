// 第四版：一版要排哪些區塊（純邏輯）。
//
// 版面類型決定區塊的種類、比例與位置規則，是排版的起點；使用者個別改過的區塊再覆蓋上去：
// - 廣告版：民初第一張第一版常幾乎全是廣告與啟事，大小不一的廣告格、一條橫貫全版的通欄廣告；
// - 要聞版：頭條在右上、專電群、社論框、各則新聞，版面下方一排廣告；
// - 本埠新聞版：多則本埠新聞（部分加欄名）、插圖、啟事、短訊，下方一排廣告；
// - 商情版：兩三張格線表格（行情、船期、匯兌）、商業新聞，下方一排廣告；
// - 副刊：連載小說橫條、詩文（花邊框）、插圖、目錄框、小廣告。
// 區塊的高度以「段」為單位、寬度以「行」為單位（依版面的行數按比例換算）。

import { int, pick, rngFor, shuffle, type Rng } from '../random.ts';
import { BLOCK_KINDS, EMPTY_BLOCK_EXTRAS, mergeStyle, type BlockExtras, type BlockKind, type BlockStyle, type Frame, type Pattern, type PictureKind, type TitleStyle } from './blockstyle.ts';

export const PAGE_TYPES = [
  { value: 'news', label: '要聞版（頭條、專電、社論）' },
  { value: 'local', label: '本埠新聞版' },
  { value: 'ads', label: '廣告版（廣告與啟事為主）' },
  { value: 'market', label: '商情版（行情表、船期）' },
  { value: 'supplement', label: '副刊（連載、詩文、目錄）' },
] as const;
export type PageType = (typeof PAGE_TYPES)[number]['value'];

export function isPageType(v: unknown): v is PageType {
  return PAGE_TYPES.some((p) => p.value === v);
}

/** 區塊放在哪裡：flow 依閱讀順序（右上起）排，bottom 排在版面最下方一排。 */
export type Zone = 'flow' | 'bottom';

/** 內容從哪裡來。 */
export type ContentSource =
  | 'lead'
  | 'second'
  | 'pool'
  | 'editorial'
  | 'wire'
  | 'serial'
  | 'literary'
  | 'ad'
  | 'notice'
  | 'table-goods'
  | 'table-ships'
  | 'table-fx'
  | 'toc'
  | 'picture';

export interface PlannedBlock {
  readonly id: string;
  readonly style: BlockStyle;
  readonly zone: Zone;
  readonly source: ContentSource;
  /** 欄名（黑底白字，放在第一行頂端）。 */
  readonly tag?: string;
  /** 使用者新增的區塊。 */
  readonly added?: boolean;
  readonly locked?: boolean;
}

export interface PlanOptions {
  readonly pageType: PageType;
  readonly seed: number;
  readonly sections: number;
  readonly cols: number;
  /** 年代預設：主新聞標題橫排。 */
  readonly mainHorizontal: boolean;
  /** 有沒有使用者的第二則新聞。 */
  readonly hasSecond: boolean;
}

/** 一個種類的預設樣式。 */
export function defaultStyle(kind: BlockKind, rng?: Rng): BlockStyle {
  const r = rng ?? rngFor(1, `style:${kind}`);
  const base: BlockStyle = {
    kind,
    title: '',
    titleFont: '',
    titleSize: 4,
    titleDir: 'v',
    titleStyle: 'plain',
    titleMark: 'none',
    bodyFont: '',
    bodySize: 'm',
    frame: 'none',
    pattern: 'meander',
    span: 1,
    width: 8,
    picture: 'none',
  };
  switch (kind) {
    case 'news':
      return { ...base, titleSize: pick(r, [3, 3, 4] as const), span: 2, width: 12 };
    case 'short':
      return { ...base, titleSize: 5, span: 1, width: 8, titleMark: pick(r, ['none', 'none', 'circle'] as const) };
    case 'editorial':
      return { ...base, titleSize: 3, frame: 'double', span: 2, width: 12, bodySize: 'm' };
    case 'wire':
      return { ...base, title: '專電', titleSize: 3, titleStyle: pick(r, ['inverted', 'boxed'] as const), span: 2, width: 10 };
    case 'notice':
      return { ...base, titleSize: 4, titleMark: pick(r, ['lenticular', 'tortoise', 'corner'] as const), frame: 'single', span: 1, width: 7 };
    case 'ad':
      return { ...base, titleStyle: pick(r, ['plain', 'plain', 'outline', 'inverted', 'boxed', 'shadow'] as const), frame: pick(r, ['double', 'thickthin', 'single', 'dotted', 'double'] as const), span: 1, width: 8 };
    case 'table':
      return { ...base, title: '', titleSize: 4, titleStyle: 'boxed', frame: 'single', bodySize: 's', span: 2, width: 14 };
    case 'toc':
      return { ...base, titleSize: 4, titleStyle: 'inverted', frame: 'double', span: 2, width: 8 };
    case 'serial':
      return { ...base, titleSize: 3, titleMark: 'corner', frame: 'thickthin', span: 1, width: 0 };
    case 'picture':
      return { ...base, frame: 'single', span: 2, width: 9, picture: pick(r, ['ship', 'clock', 'watch'] as const) };
  }
}

const AD_PICTURES: readonly PictureKind[] = ['bottle', 'box', 'hat', 'watch', 'clock', 'ship'];
const PATTERN_LIST: readonly Pattern[] = ['meander', 'cloud', 'dots', 'diamond', 'wave'];

interface Recipe {
  readonly kind: BlockKind;
  readonly source: ContentSource;
  readonly zone?: Zone;
  readonly span: readonly [number, number];
  /** 寬度占版面行數的比例；0 表示通欄。 */
  readonly width: readonly [number, number];
  readonly patch?: (rng: Rng, style: BlockStyle) => Partial<BlockStyle>;
  readonly tag?: number;
}

const leadRecipe = (o: PlanOptions): Recipe => ({
  kind: 'news',
  source: 'lead',
  span: [Math.min(3, Math.max(2, Math.round(o.sections * 0.3))), Math.min(3, Math.max(2, Math.round(o.sections * 0.3)))],
  width: [0.24, 0.3],
  patch: () => ({ titleSize: 1, titleDir: o.mainHorizontal ? 'h' : 'v' }),
});

const bottomAds = (n: number, spans: readonly [number, number] = [1, 1]): Recipe[] =>
  Array.from({ length: n }, () => ({ kind: 'ad' as const, source: 'ad' as const, zone: 'bottom' as const, span: spans, width: [0.1, 0.24] as const, patch: adPatch }));

function adPatch(rng: Rng): Partial<BlockStyle> {
  return {
    titleStyle: pick(rng, ['plain', 'plain', 'outline', 'inverted', 'boxed', 'shadow'] as const satisfies readonly TitleStyle[]),
    frame: pick(rng, ['double', 'thickthin', 'single', 'dotted', 'double', 'pattern'] as const satisfies readonly Frame[]),
    pattern: pick(rng, PATTERN_LIST),
    picture: rng() < 0.4 ? pick(rng, AD_PICTURES) : 'none',
  };
}

function recipes(o: PlanOptions, rng: Rng): Recipe[] {
  const news = (n: number, span: readonly [number, number] = [1, 2], tag = 0): Recipe[] =>
    Array.from({ length: n }, () => ({ kind: 'news' as const, source: 'pool' as const, span, width: [0.12, 0.2] as const, tag }));
  const shorts = (n: number): Recipe[] => Array.from({ length: n }, () => ({ kind: 'short' as const, source: 'pool' as const, span: [1, 1] as const, width: [0.08, 0.13] as const }));
  const second: Recipe[] = o.hasSecond ? [{ kind: 'news', source: 'second', span: [1, 2], width: [0.14, 0.2] }] : [];
  switch (o.pageType) {
    case 'news':
      return [
        leadRecipe(o),
        { kind: 'wire', source: 'wire', span: [2, 2], width: [0.14, 0.18] },
        { kind: 'editorial', source: 'editorial', span: [2, 3], width: [0.16, 0.2], tag: 1 },
        ...second,
        { kind: 'wire', source: 'wire', span: [1, 2], width: [0.12, 0.16] },
        ...news(5),
        { kind: 'toc', source: 'toc', span: [1, 2], width: [0.08, 0.1] },
        ...shorts(3),
        ...news(4, [1, 1]),
        ...bottomAds(int(rng, 4, 6), [1, 2]),
      ];
    case 'local':
      return [
        leadRecipe(o),
        ...second,
        ...news(3, [1, 2], 0.45),
        { kind: 'picture', source: 'picture', span: [2, 2], width: [0.13, 0.16] },
        { kind: 'notice', source: 'notice', span: [1, 1], width: [0.08, 0.12] },
        ...news(4, [1, 2], 0.3),
        ...shorts(4),
        { kind: 'notice', source: 'notice', span: [1, 1], width: [0.08, 0.12] },
        ...news(4, [1, 1], 0.2),
        ...bottomAds(int(rng, 4, 6)),
      ];
    case 'ads': {
      const ads: Recipe[] = Array.from({ length: 14 }, () => ({ kind: 'ad' as const, source: 'ad' as const, span: [1, 3] as const, width: [0.1, 0.3] as const, patch: adPatch }));
      const notices: Recipe[] = Array.from({ length: 5 }, () => ({ kind: 'notice' as const, source: 'notice' as const, span: [1, 2] as const, width: [0.08, 0.14] as const }));
      const banner: Recipe = { kind: 'ad', source: 'ad', span: [1, 1], width: [0, 0], patch: (r) => ({ ...adPatch(r), picture: 'none' }) };
      const mixed = shuffle(rng, [...ads.slice(0, 9), ...notices, ...shorts(2)]);
      return [{ ...leadRecipe(o), span: [2, 2], width: [0.16, 0.2], patch: () => ({ titleSize: 2, titleDir: o.mainHorizontal ? 'h' : 'v' }) }, ...mixed.slice(0, 7), banner, ...mixed.slice(7), ...ads.slice(9)];
    }
    case 'market':
      return [
        { ...leadRecipe(o), span: [2, 2], width: [0.18, 0.22] },
        { kind: 'table', source: 'table-goods', span: [2, 3], width: [0.26, 0.32] },
        ...second,
        { kind: 'table', source: 'table-ships', span: [2, 2], width: [0.22, 0.28] },
        ...news(3, [1, 2], 0.3),
        { kind: 'table', source: 'table-fx', span: [1, 2], width: [0.16, 0.2] },
        ...shorts(4),
        ...news(3, [1, 1]),
        ...bottomAds(int(rng, 4, 6)),
      ];
    case 'supplement':
      return [
        { kind: 'serial', source: 'serial', span: [2, 2], width: [0, 0] },
        { ...leadRecipe(o), span: [2, 2], width: [0.18, 0.24], patch: () => ({ titleSize: 2, titleDir: 'v' }) },
        { kind: 'news', source: 'literary', span: [1, 2], width: [0.16, 0.22], patch: (r) => ({ frame: 'pattern', pattern: pick(r, PATTERN_LIST), titleStyle: pick(r, ['boxed', 'outline'] as const) }) },
        { kind: 'toc', source: 'toc', span: [2, 2], width: [0.1, 0.13] },
        { kind: 'short', source: 'literary', span: [1, 1], width: [0.1, 0.13], patch: (r) => ({ frame: 'pattern', pattern: pick(r, PATTERN_LIST), titleSize: 4 }) },
        { kind: 'picture', source: 'picture', span: [1, 2], width: [0.12, 0.15] },
        { kind: 'news', source: 'literary', span: [1, 2], width: [0.14, 0.2], patch: (r) => ({ frame: pick(r, ['pattern', 'double'] as const), pattern: pick(r, PATTERN_LIST) }) },
        { kind: 'serial', source: 'serial', span: [1, 1], width: [0, 0] },
        { kind: 'short', source: 'literary', span: [1, 1], width: [0.1, 0.14], patch: (r) => ({ frame: 'pattern', pattern: pick(r, PATTERN_LIST) }) },
        ...news(3, [1, 1]),
        ...bottomAds(int(rng, 4, 5)),
      ];
  }
}

/** 版面排完主要區塊後，用這一類版面常見的區塊補滿。 */
function fillerRecipes(o: PlanOptions, rng: Rng): Recipe {
  const news: Recipe = { kind: 'news', source: 'pool', span: [1, 2], width: [0.1, 0.2], tag: o.pageType === 'local' ? 0.3 : 0 };
  const short: Recipe = { kind: 'short', source: 'pool', span: [1, 1], width: [0.07, 0.12] };
  const notice: Recipe = { kind: 'notice', source: 'notice', span: [1, 1], width: [0.07, 0.11] };
  const ad: Recipe = { kind: 'ad', source: 'ad', span: [1, 2], width: [0.1, 0.22], patch: adPatch };
  const literary: Recipe = { kind: 'news', source: 'literary', span: [1, 1], width: [0.1, 0.16], patch: (r) => ({ frame: pick(r, ['pattern', 'none', 'none'] as const), pattern: pick(r, PATTERN_LIST) }) };
  switch (o.pageType) {
    case 'ads':
      return pick(rng, [ad, ad, ad, notice, short]);
    case 'market':
      return pick(rng, [news, news, short, short, { kind: 'table', source: 'table-fx', span: [1, 1], width: [0.14, 0.18] }]);
    case 'supplement':
      return pick(rng, [literary, news, short, short]);
    case 'local':
      return pick(rng, [news, news, short, short, notice]);
    default:
      return pick(rng, [news, news, news, short, short, { kind: 'wire', source: 'wire', span: [1, 1], width: [0.1, 0.14] }]);
  }
}

/** 依版面類型與種子排出這一版的區塊（id 依序為 p0、p1……，同一種子永遠相同）。 */
export function planPage(o: PlanOptions): PlannedBlock[] {
  const rng = rngFor(o.seed, `plan:${o.pageType}`);
  const list = recipes(o, rng);
  // 主要區塊之外，用這一類版面常見的區塊補到比整版略多（排不下的不出現）
  const areaOf = (r: Recipe): number => ((r.span[0] + r.span[1]) / 2) * (r.width[1] === 0 ? o.cols : ((r.width[0] + r.width[1]) / 2) * o.cols);
  let area = list.reduce((n, r) => n + areaOf(r), 0);
  const bottomAt = list.findIndex((r) => r.zone === 'bottom');
  const extra: Recipe[] = [];
  for (let guard = 0; area < o.cols * o.sections * 1.02 && guard < 80; guard++) {
    const r = fillerRecipes(o, rng);
    extra.push(r);
    area += areaOf(r);
  }
  if (bottomAt >= 0) list.splice(bottomAt, 0, ...extra);
  else list.push(...extra);
  return list.map((r, i) => {
    const local = rngFor(o.seed, `plan:${o.pageType}:${i}`);
    const style0 = defaultStyle(r.kind, local);
    const width = r.width[1] === 0 ? 0 : Math.max(3, Math.round(o.cols * (r.width[0] + local() * (r.width[1] - r.width[0]))));
    const span = int(local, r.span[0], r.span[1]);
    const style = mergeStyle(style0, { span, width, ...(r.patch ? r.patch(local, style0) : {}) });
    const tag = r.tag && local() < r.tag ? pickTag(local, r.kind) : undefined;
    return { id: `p${i}`, style, zone: r.zone ?? 'flow', source: r.source, ...(tag ? { tag } : {}) };
  });
}

const TAGS = ['本埠新聞', '地方通信', '社會新聞', '海上消息', '教育界', '法界消息', '雜俎'];

function pickTag(rng: Rng, kind: BlockKind): string {
  return kind === 'editorial' ? '社論' : pick(rng, TAGS);
}

/** 使用者新增的區塊從哪裡取內容。 */
export function sourceFor(kind: BlockKind): ContentSource {
  switch (kind) {
    case 'news':
    case 'short':
      return 'pool';
    case 'editorial':
      return 'editorial';
    case 'wire':
      return 'wire';
    case 'ad':
      return 'ad';
    case 'notice':
      return 'notice';
    case 'table':
      return 'table-goods';
    case 'toc':
      return 'toc';
    case 'serial':
      return 'serial';
    case 'picture':
      return 'picture';
  }
}

/**
 * 套上使用者的修改：刪除、新增（插在指定區塊之後）、調整順序、個別樣式。
 * 種類改過時，內容來源跟著改；其他欄位只覆蓋改過的部分。
 */
export function resolveBlocks(plan: readonly PlannedBlock[], extras: BlockExtras = EMPTY_BLOCK_EXTRAS): PlannedBlock[] {
  const removed = new Set(extras.removed);
  const edits = new Map(extras.edits.map((e) => [e.id, e]));
  let list: PlannedBlock[] = plan.filter((b) => !removed.has(b.id));
  for (const a of extras.added) {
    if (removed.has(a.id) || list.some((b) => b.id === a.id)) continue;
    const block: PlannedBlock = { id: a.id, style: defaultStyle(a.kind, rngFor(1, `added:${a.id}`)), zone: 'flow', source: sourceFor(a.kind), added: true };
    const at = a.after === null ? -1 : list.findIndex((b) => b.id === a.after);
    if (at < 0) list.push(block);
    else list.splice(at + 1, 0, block);
  }
  if (extras.order.length > 0) {
    const rank = new Map(extras.order.map((id, i) => [id, i]));
    const indexed = list.map((b, i) => ({ b, i }));
    // 有排名的依排名，沒有的維持原本相對位置（排在前一個有排名的後面）
    let last = -1;
    const keyed = indexed.map(({ b, i }) => {
      const r = rank.get(b.id);
      if (r !== undefined) last = r;
      return { b, key: r !== undefined ? r : last + i / 1e4 + 0.5 };
    });
    list = keyed.sort((x, y) => x.key - y.key).map((x) => x.b);
  }
  return list.map((b) => {
    const e = edits.get(b.id);
    if (!e) return b;
    const style = mergeStyle(b.style, e);
    const kindChanged = style.kind !== b.style.kind;
    const restyled = kindChanged ? mergeStyle(defaultStyle(style.kind, rngFor(1, `kind:${b.id}`)), e) : style;
    return {
      ...b,
      style: restyled,
      source: kindChanged ? (b.source === 'lead' && FLOWISH.has(style.kind) ? 'lead' : sourceFor(style.kind)) : b.source,
      // 改成別的種類時，版面最下方的位置規則不再適用
      zone: kindChanged && b.zone === 'bottom' && style.kind !== 'ad' ? 'flow' : b.zone,
      ...(e.locked ? { locked: true } : {}),
    };
  });
}

const FLOWISH = new Set<BlockKind>(['news', 'short', 'editorial', 'notice', 'serial']);

/** 種類的中文名稱。 */
export function kindLabel(kind: BlockKind): string {
  return BLOCK_KINDS.find((k) => k.value === kind)?.label ?? kind;
}
