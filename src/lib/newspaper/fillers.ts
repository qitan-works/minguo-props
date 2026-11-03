// 填版素材池：手寫素材（src/data/fillers.ts）＋依種子產生的船期、物價、天氣、啟事與一行小訊。
// 同一個種子永遠得到同樣的素材與順序；「換一批」就是換種子。

import { ADS, BANNER_ADS, FEATURE_NEWS, NOTICES, SHORT_NEWS, VOCAB, type FillerItem } from '../../data/fillers.ts';
import type { AdItem } from './ads.ts';
import type { FlowItem } from './flow.ts';
import { toChineseNumber } from '../numerals.ts';
import { int, pick, rngFor, shuffle, type Rng } from '../random.ts';
import type { SourceBlock } from './layout.ts';

function cn(n: number): string {
  return toChineseNumber(n);
}

function personName(rng: Rng): string {
  const surname = pick(rng, VOCAB.surnames);
  const a = pick(rng, VOCAB.givenChars);
  let b = pick(rng, VOCAB.givenChars);
  if (b === a) b = pick(rng, VOCAB.givenChars);
  return surname + a + b;
}

function shipList(rng: Rng, id: string): FillerItem {
  const ships = shuffle(rng, VOCAB.ships).slice(0, int(rng, 4, 6));
  const rows = ships.map((ship) => {
    const port = pick(rng, VOCAB.ports.filter((p) => p !== '霧港'));
    const day = int(rng, 1, 30);
    const hour = int(rng, 1, 12);
    return `${ship}　${cn(day)}日${pick(rng, ['上午', '下午'])}${cn(hour)}時開往${port}`;
  });
  return { id, kind: 'list', title: pick(rng, ['輪船班期', '本埠出口船期', '各輪開行日期']), body: rows.join('\n') };
}

function priceList(rng: Rng, id: string): FillerItem {
  const goods = shuffle(rng, VOCAB.goods).slice(0, int(rng, 4, 6));
  const rows = goods.map(([name, unit, lo, hi, cur]) => {
    const whole = int(rng, lo, hi);
    const tenth = int(rng, 0, 9);
    return `${name}　${unit}${cur === '元' ? '大洋' : '小洋'}${cn(whole)}${cur}${tenth > 0 ? `${cn(tenth)}${cur === '元' ? '角' : '分'}` : ''}`;
  });
  return { id, kind: 'list', title: pick(rng, ['本埠物價', '昨日市價', '米糧雜貨行情']), body: rows.join('\n') };
}

function weather(rng: Rng, id: string): FillerItem {
  const w = pick(rng, VOCAB.weathers);
  const wind = pick(rng, VOCAB.winds);
  const temp = int(rng, 48, 88);
  return {
    id,
    kind: 'short',
    title: '天氣',
    body: `本埠昨日天氣${w}，${wind}，最高溫度華氏${cn(temp)}度，最低${cn(temp - int(rng, 6, 14))}度。測候所預測今日${pick(rng, VOCAB.weathers)}，海上${pick(rng, ['風浪平靜', '略有風浪', '霧大宜慎'])}。`,
  };
}

function lostNotice(rng: Rng, id: string): FillerItem {
  const item = pick(rng, VOCAB.lostItems);
  const place = pick(rng, VOCAB.places);
  return {
    id,
    kind: 'notice',
    title: '遺失聲明',
    body: `本月${cn(int(rng, 1, 28))}日在${place}附近遺失${item}，如有仁人君子拾得送還，願酬謝大洋${cn(int(rng, 2, 20))}元，決不食言。${personName(rng)}啟`,
  };
}

function missingNotice(rng: Rng, id: string): FillerItem {
  const rel = pick(rng, VOCAB.relations);
  const name = personName(rng);
  const age = int(rng, 9, 40);
  return {
    id,
    kind: 'notice',
    title: '尋人',
    body: `${rel}${name.slice(1)}，年${cn(age)}歲，身穿${pick(rng, ['藍布長衫', '灰色短褂', '黑色學生裝', '白布衫'])}，於${cn(int(rng, 1, 28))}日離家未歸。如有知其下落者，請通知${pick(rng, VOCAB.places)}${personName(rng)}，必當重謝。`,
  };
}

function familyNotice(rng: Rng, id: string): FillerItem {
  if (rng() < 0.5) {
    const groom = personName(rng);
    const bride = personName(rng);
    return {
      id,
      kind: 'notice',
      title: '結婚啟事',
      body: `我倆承${personName(rng)}先生介紹，謹於本月${cn(int(rng, 1, 28))}日在霧港${pick(rng, ['青年會', '聚雲樓', '大禮堂'])}舉行婚禮，恐親友未及週知，特此登報。${groom}　${bride}同啟`,
    };
  }
  const name = personName(rng);
  return {
    id,
    kind: 'notice',
    title: '訃告',
    body: `先嚴${name.slice(0, 1)}公諱${name.slice(1)}，痛於本月${cn(int(rng, 1, 28))}日壽終正寢，享壽${cn(int(rng, 58, 86))}歲。謹擇吉日開弔，哀此訃聞。孤哀子${name.slice(0, 1)}${pick(rng, VOCAB.givenChars)}${pick(rng, VOCAB.givenChars)}泣血叩首`,
  };
}

function policeShort(rng: Rng, id: string): FillerItem {
  const place = pick(rng, VOCAB.places);
  const name = personName(rng);
  const what = pick(rng, ['竊取鄰居衣物', '聚賭抽頭', '酗酒滋事', '私售煙土', '冒充警察詐財', '深夜爬牆入室']);
  return {
    id,
    kind: 'short',
    title: pick(rng, ['拘獲竊賊', '警局拿人', '分局拘押']),
    body: `${place}分局昨日拘獲${name}一名，年${cn(int(rng, 18, 50))}歲，因在${pick(rng, VOCAB.places)}一帶${what}，經人告發，當場人贓並獲。訊據供認不諱，已解送法院依法究辦。`,
  };
}

function courtShort(rng: Rng, id: string): FillerItem {
  const a = personName(rng);
  const b = personName(rng);
  const matter = pick(rng, ['債務糾葛', '房屋租賃', '遺產分析', '貨款拖欠', '婚約解除']);
  return {
    id,
    kind: 'short',
    title: '法院判決',
    body: `${a}與${b}因${matter}涉訟一案，地方法院於昨日宣判，判令被告於${cn(int(rng, 1, 3))}個月內清償大洋${cn(int(rng, 50, 900))}元，訴訟費用由被告負擔。兩造均表示將再行考慮。`,
  };
}

const AD_PREFIX = ['瀛', '霧', '潮', '蜃', '鯨', '汀', '嵐', '鷗'];
const AD_GOODS: readonly (readonly [string, string])[] = [
  ['補腦汁', '健腦益智　讀書辦事不倦'],
  ['花露水', '芬芳馥郁　消暑辟穢'],
  ['肥皂', '去污力強　不傷衣料'],
  ['清涼丹', '暈船嘔吐　行旅必備'],
  ['膠鞋', '堅固耐穿　雨天不濕'],
  ['墨水', '色澤經久　書寫流利'],
  ['餅乾', '香脆可口　老少咸宜'],
  ['汽水', '清涼解渴　消暑妙品'],
];

function productAd(rng: Rng, id: string): FillerItem {
  const [goods, slogan] = pick(rng, AD_GOODS);
  const brand = `${pick(rng, AD_PREFIX)}${pick(rng, ['光', '華', '峯', '泉', '雲', '帆'])}牌${goods}`;
  return {
    id,
    kind: 'ad',
    title: brand,
    body: `${slogan}\n每${pick(rng, ['瓶', '盒', '包', '打'])}${pick(rng, ['大洋', '小洋'])}${cn(int(rng, 1, 9))}角\n${pick(rng, VOCAB.places)}總發行所`,
  };
}

function rentNotice(rng: Rng, id: string): FillerItem {
  return {
    id,
    kind: 'notice',
    title: pick(rng, ['房屋招租', '舖面招頂', '空屋出租']),
    body: `${pick(rng, VOCAB.places)}有${pick(rng, ['平房', '樓房', '舖面', '石庫門房屋'])}${cn(int(rng, 1, 6))}間，${pick(rng, ['光線充足', '臨街便於營業', '附有後院', '自來水電燈俱全'])}，月租大洋${cn(int(rng, 4, 40))}元，欲租者請向${personName(rng)}接洽。`,
  };
}

const TINY_TEMPLATES: readonly ((rng: Rng) => string)[] = [
  (rng) => `◎今日潮汐　早潮${cn(int(rng, 1, 11))}時${cn(int(rng, 1, 5) * 10)}分　晚潮${cn(int(rng, 1, 11))}時${cn(int(rng, 1, 5) * 10)}分`,
  (rng) => `▲本報代售各種郵票印花　${pick(rng, ['營業部', '分銷處'])}均有`,
  () => '▲本報廣告刊例從廉　請向營業部接洽',
  (rng) => `○${pick(rng, VOCAB.places)}電車　明日起改為每${cn(int(rng, 8, 15))}分鐘一班`,
  (rng) => `▲${pick(rng, VOCAB.ships)}因霧延期　改於${cn(int(rng, 1, 28))}日開行`,
  (rng) => `◎昨日本埠出生${cn(int(rng, 8, 40))}人　死亡${cn(int(rng, 5, 30))}人`,
  (rng) => `○${pick(rng, VOCAB.places)}自來水今日停供　修理水管`,
  (rng) => `▲失物招領　皮包${cn(int(rng, 1, 3))}隻　請至本報認領`,
  (rng) => `◎本日銀洋兌換　每元合銅元${cn(int(rng, 250, 320))}枚`,
  (rng) => `○郵局今日${pick(rng, ['照常辦公', '提早收班', '加開夜班'])}`,
];

function tinyLine(rng: Rng, id: string): SourceBlock {
  return { id, kind: 'tiny', body: pick(rng, TINY_TEMPLATES)(rng), source: 'filler' };
}

function toSource(item: FillerItem): SourceBlock {
  return { id: item.id, kind: item.kind, title: item.title, body: item.body, source: 'filler' };
}

export interface FillerPoolOptions {
  readonly seed: number;
  /** 鎖定的素材：完整內容保留在存檔中，換一批時不變，並排在最前面。 */
  readonly locked?: readonly FillerItem[];
  /** 刪除的素材編號。 */
  readonly removed?: readonly string[];
}

export interface FillerPool {
  readonly fillers: readonly SourceBlock[];
  readonly tiny: readonly SourceBlock[];
  /** 依編號查原始素材（鎖定時要存下完整內容）。 */
  readonly byId: ReadonlyMap<string, FillerItem>;
}

/** 產生一個種子的填版素材池。 */
export function buildFillerPool(options: FillerPoolOptions): FillerPool {
  const { seed } = options;
  const removed = new Set(options.removed ?? []);
  const generated: FillerItem[] = [];
  const gen = (label: string, count: number, make: (rng: Rng, id: string) => FillerItem): void => {
    for (let i = 0; i < count; i++) {
      const id = `g${seed.toString(36)}-${label}${i}`;
      generated.push(make(rngFor(seed, id), id));
    }
  };
  gen('ship', 6, shipList);
  gen('price', 6, priceList);
  gen('wx', 4, weather);
  gen('lost', 10, lostNotice);
  gen('miss', 8, missingNotice);
  gen('family', 12, familyNotice);
  gen('police', 10, policeShort);
  gen('court', 8, courtShort);
  gen('prod', 12, productAd);
  gen('rent', 8, rentNotice);

  const all = [...SHORT_NEWS, ...ADS, ...NOTICES, ...generated];
  const byId = new Map<string, FillerItem>();
  for (const item of [...all, ...(options.locked ?? [])]) byId.set(item.id, item);

  const lockedIds = new Set((options.locked ?? []).map((l) => l.id));
  const rest = shuffle(rngFor(seed, 'order'), all.filter((i) => !removed.has(i.id) && !lockedIds.has(i.id)));
  const lockedFirst = (options.locked ?? []).filter((i) => !removed.has(i.id));
  const fillers = [...lockedFirst, ...rest].map(toSource);

  const tiny: SourceBlock[] = [];
  for (let i = 0; i < 240; i++) {
    const id = `t${seed.toString(36)}-${i}`;
    if (!removed.has(id)) tiny.push(tinyLine(rngFor(seed, id), id));
  }
  return { fillers, tiny, byId };
}

/** 素材總字數（測試用：確認夠排滿兩版）。 */
export function poolCharCount(pool: FillerPool): number {
  return pool.fillers.reduce((n, b) => n + Array.from((b.title ?? '') + b.body).length, 0);
}

// ---------- 第三版：不規則版面用的素材池 ----------

const PRICE_RE = /大洋|小洋|銅元|每[瓶盒包罐打套刀擔斤石份]|[元角分]$/;
const MAKER_RE = /發行|地址|出售|均有|均售|總行|公司$|藥房$|號$|行$|局$|莊$|社$|廠$/;

/** 素材（或鎖定時存下的內容）轉成廣告：第一個像價目的一行當價目，像店名地址的一行當發行所。 */
export function adFromFiller(item: FillerItem, source: 'user' | 'filler' = 'filler'): AdItem {
  const lines = item.body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let price = item.price;
  let maker = item.maker;
  const rest: string[] = [];
  for (const line of lines) {
    if (!price && PRICE_RE.test(line)) price = line;
    else if (!maker && MAKER_RE.test(line)) maker = line;
    else rest.push(line);
  }
  return { id: item.id, source, big: item.title, lines: rest, ...(price ? { price } : {}), ...(maker ? { maker } : {}) };
}

/** 素材轉成文字流排的一則。 */
export function flowFromFiller(item: FillerItem, source: 'user' | 'filler' = 'filler', level?: 1 | 2 | 3): FlowItem {
  const paragraphs = item.body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return {
    id: item.id,
    source,
    level: level ?? (item.kind === 'news' ? 2 : 3),
    title: item.title,
    subtitles: (item.subtitle ?? '').split(/[　 ]+/).filter(Boolean),
    paragraphs,
    ...(item.kind === 'list' ? { rows: true } : {}),
  };
}

function bannerToFiller(b: (typeof BANNER_ADS)[number]): FillerItem {
  return { id: b.id, kind: 'ad', title: b.big, body: b.lines.join('\n'), ...(b.price ? { price: b.price } : {}), ...(b.maker ? { maker: b.maker } : {}) };
}

export interface BroadsheetPool {
  /** 文字素材（鎖定的在最前面）。 */
  readonly items: readonly FlowItem[];
  readonly ads: readonly AdItem[];
  readonly tiny: readonly FlowItem[];
  readonly byId: ReadonlyMap<string, FillerItem>;
}

/** 不規則版面用的素材池：同一種子永遠相同；鎖定的排最前面、刪除的不出現。 */
export function buildBroadsheetPool(options: FillerPoolOptions): BroadsheetPool {
  const base = buildFillerPool(options);
  const removed = new Set(options.removed ?? []);
  const lockedIds = new Set((options.locked ?? []).map((l) => l.id));
  const byId = new Map(base.byId);
  const banners = BANNER_ADS.map(bannerToFiller);
  for (const item of [...FEATURE_NEWS, ...banners]) if (!byId.has(item.id)) byId.set(item.id, item);
  for (const item of options.locked ?? []) byId.set(item.id, item);

  const rng = rngFor(options.seed, 'broadsheet-order');
  const fresh = (items: readonly FillerItem[]): FillerItem[] => items.filter((i) => !removed.has(i.id) && !lockedIds.has(i.id));
  const locked = (options.locked ?? []).filter((i) => !removed.has(i.id));

  const textSources = [...base.fillers.map((b) => byId.get(b.id)).filter((i): i is FillerItem => !!i && i.kind !== 'ad'), ...fresh(FEATURE_NEWS)];
  const textRest = shuffle(rng, textSources.filter((i) => !lockedIds.has(i.id)));
  const items = [...locked.filter((i) => i.kind !== 'ad'), ...textRest].map((i) => flowFromFiller(i, 'filler', i.kind === 'short' && rng() < 0.22 ? 2 : undefined));

  const adSources = [...base.fillers.map((b) => byId.get(b.id)).filter((i): i is FillerItem => !!i && i.kind === 'ad'), ...fresh(banners)];
  const adRest = shuffle(rng, adSources.filter((i) => !lockedIds.has(i.id)));
  const ads = [...locked.filter((i) => i.kind === 'ad'), ...adRest].map((i) => adFromFiller(i));

  const tiny = base.tiny.map((t) => ({ id: t.id, source: 'filler' as const, level: 3 as const, title: '', subtitles: [], paragraphs: [t.body] }));
  return { items, ads, tiny, byId };
}
