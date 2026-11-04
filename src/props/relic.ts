// 古物（第五版）：古籍殘頁、碑文拓片、符籙。欄位定義與預設內容。內容全部原創、虛構（地名沿用霧港一帶）。

import { fontEraField, fontFields } from './common.ts';
import { conditionDefaults, conditionFields } from './conditions.ts';
import type { DataOf, Field } from './schema.ts';

const BOOK = { key: 'relicType', in: ['book'] } as const;
const RUB = { key: 'relicType', in: ['rubbing'] } as const;
const TAL = { key: 'relicType', in: ['talisman'] } as const;

const num = (values: readonly number[]): { value: string; label: string }[] => values.map((v) => ({ value: String(v), label: `${v}` }));

export const RELIC_TYPES = [
  { value: 'book', label: '古籍殘頁（線裝書的一頁）' },
  { value: 'rubbing', label: '碑文拓片' },
  { value: 'talisman', label: '符咒（黃紙朱砂）' },
] as const;

export const relicFields = [
  { key: 'relicType', type: 'select', label: '種類', group: '版面', options: RELIC_TYPES },
  {
    key: 'relicSeed',
    type: 'seed',
    label: '隨機',
    button: '換一個',
    group: '版面',
    hint: '朱筆圈的位置、碑文剝落的地方、拓包的深淺、符的筆畫都由這個種子決定，預覽與列印一致。',
  },

  {
    key: 'bookLayout',
    type: 'select',
    label: '頁面',
    group: '古籍',
    showIf: BOOK,
    options: [
      { value: 'half', label: '單頁（半葉，A5 直式）' },
      { value: 'spread', label: '對開（整葉攤開，版心在中間，A4 橫式）' },
    ],
  },
  { key: 'bookTitle', type: 'text', label: '書名（印在版心）', group: '古籍', maxLength: 12, showIf: BOOK },
  { key: 'bookVolume', type: 'text', label: '卷次', group: '古籍', maxLength: 6, showIf: BOOK },
  { key: 'bookPage', type: 'text', label: '頁碼', group: '古籍', maxLength: 6, showIf: BOOK },
  {
    key: 'bookText',
    type: 'textarea',
    label: '正文',
    group: '古籍',
    maxLength: 1500,
    rows: 8,
    showIf: BOOK,
    hint: '可以寫標點：刻本不印標點，開了朱筆句讀時，句讀以紅點點在字的右下。排不下的字不印。',
  },
  { key: 'bookCols', type: 'select', label: '每半葉行數', group: '古籍', options: num([7, 8, 9, 10]), showIf: BOOK },
  { key: 'bookPerCol', type: 'select', label: '每行字數', group: '古籍', options: num([16, 18, 20, 22]), showIf: BOOK },
  {
    key: 'bookFrame',
    type: 'select',
    label: '版框',
    group: '古籍',
    showIf: BOOK,
    options: [
      { value: 'double', label: '四周雙邊' },
      { value: 'single', label: '四周單邊' },
      { value: 'sides', label: '左右雙邊' },
    ],
  },
  {
    key: 'bookFish',
    type: 'select',
    label: '魚尾',
    group: '古籍',
    showIf: BOOK,
    options: [
      { value: 'single', label: '單魚尾' },
      { value: 'double', label: '雙魚尾（上下相向）' },
      { value: 'none', label: '無魚尾' },
    ],
  },
  { key: 'woodblock', type: 'range', label: '木刻字的質感', group: '古籍', min: 0, max: 100, step: 5, unit: '%', showIf: BOOK, hint: '越高字邊越毛、墨色越不均，像版木磨損後印出來的。' },
  { key: 'redMarks', type: 'checkbox', label: '朱筆句讀（字旁紅點）', group: '古籍', showIf: BOOK },
  { key: 'redCircles', type: 'range', label: '朱筆圈（強調的字）', group: '古籍', min: 0, max: 100, step: 5, unit: '%', showIf: BOOK },
  { key: 'headNote', type: 'text', label: '眉批（朱筆，寫在天頭）', group: '古籍', maxLength: 40, showIf: BOOK },
  { key: 'bindingHoles', type: 'checkbox', label: '裝訂孔（四眼訂）', group: '古籍', showIf: BOOK },

  { key: 'stoneTitle', type: 'text', label: '碑額', group: '拓片', maxLength: 10, showIf: RUB },
  { key: 'stoneText', type: 'textarea', label: '碑文', group: '拓片', maxLength: 600, rows: 6, showIf: RUB, hint: '標點會拿掉；排不下的字不印。' },
  { key: 'stoneCols', type: 'select', label: '行數', group: '拓片', options: num([6, 7, 8, 9, 10, 11, 12]), showIf: RUB },
  { key: 'stonePerCol', type: 'select', label: '每行字數', group: '拓片', options: num([10, 12, 14, 16, 18]), showIf: RUB },
  { key: 'damage', type: 'range', label: '殘缺剝落', group: '拓片', min: 0, max: 100, step: 5, unit: '%', showIf: RUB },
  { key: 'inkTone', type: 'range', label: '墨色深淺', group: '拓片', min: 30, max: 100, step: 5, unit: '%', showIf: RUB, hint: '拓包拍打的深淺不均、摺疊收藏的摺痕都會隨墨色一起變化。' },
  { key: 'sealText', type: 'text', label: '收藏印（留空則不蓋）', group: '拓片', maxLength: 8, showIf: RUB },
  { key: 'sealText2', type: 'text', label: '第二方印（朱文）', group: '拓片', maxLength: 8, showIf: RUB },

  {
    key: 'talismanSize',
    type: 'select',
    label: '尺寸',
    group: '符咒',
    showIf: TAL,
    options: [
      { value: 'large', label: '大（90×260 mm，印在 A4 上）' },
      { value: 'small', label: '小（60×180 mm，印在 A4 上）' },
    ],
  },
  { key: 'talismanText', type: 'text', label: '符膽中的字', group: '符咒', maxLength: 6, showIf: TAL, hint: '直排寫在符的中央。用原創的字句，不抄任何真實流派的符。' },
  { key: 'talismanSide', type: 'text', label: '兩側小字（以 | 分成右、左兩行）', group: '符咒', maxLength: 24, showIf: TAL },
  { key: 'complexity', type: 'range', label: '筆畫繁簡', group: '符咒', min: 0, max: 100, step: 5, unit: '%', showIf: TAL },
  { key: 'talismanSeal', type: 'text', label: '朱印（留空則不蓋）', group: '符咒', maxLength: 6, showIf: TAL },

  fontEraField('字型'),
  ...fontFields('字型'),
  ...conditionFields('紙張狀況', '更多痕跡'),
] as const satisfies readonly Field[];

export type RelicData = DataOf<typeof relicFields>;

export const relicDefaults: RelicData = {
  relicType: 'book',
  relicSeed: 31337,
  bookLayout: 'half',
  bookTitle: '霧港異聞錄',
  bookVolume: '卷三',
  bookPage: '十七',
  bookText: [
    '海東有港曰霧港，其水深黑，終歲不見底。父老相傳，前朝時有漁人夜泊港口，聞水下有聲如誦經，其音非人間所有。',
    '明日視之，舟中三人皆失其魂，唯留濕痕滿板，作鱗甲之形。里人懼，立祠於岸，歲以牲醴祀之，曰鎮海祠。',
    '祠成之夕，潮退數里，沙上見巨石一方，刻文數行，字皆不可識。有遊方道士過之，拓其文而去，自是不知所終。',
    '或曰其文乃水底之語，讀之者夢入深淵，見城郭宮室，非人所居。余嘗得其拓本殘紙，藏之箱中，每至陰雨之夜，紙上若有水氣出焉。',
  ].join('\n'),
  bookCols: '9',
  bookPerCol: '18',
  bookFrame: 'double',
  bookFish: 'single',
  woodblock: 55,
  redMarks: true,
  redCircles: 30,
  headNote: '此段與縣志所載不合，存疑。',
  bindingHoles: true,

  stoneTitle: '重修鎮海祠記',
  stoneText:
    '鎮海祠者里人所以祀海神也祠始建於前朝歲久傾頹今歲秋潮大至祠垣盡沒里中耆老相與募資重修凡三月而工竣其下得古石一方刻文奇詭莫能辨識因并刻於碑陰以俟博雅君子考焉是役也董其事者林氏守仁書丹者陳某民國十七年冬月立',
  stoneCols: '9',
  stonePerCol: '14',
  damage: 40,
  inkTone: 85,
  sealText: '霧港林氏珍藏',
  sealText2: '守仁審定',

  talismanSize: 'large',
  talismanText: '鎮淵息浪',
  talismanSide: '霧海之下勿聞其名|潮退之時勿拾其石',
  complexity: 65,
  talismanSeal: '鎮海祠印',

  fontEra: 'custom',
  fontMasthead: 'wang-zhong-li',
  fontTitle: 'wang-zhong-li',
  fontBody: 'wang-zhong-ming',
  fontAd: 'wang-yan-kai',
  fontHand: 'wang-gangbi-xingkai',
  ...conditionDefaults({ aging: 'medium', wormHoles: 6, spots: 35, effectSeed: 70123 }),
};
