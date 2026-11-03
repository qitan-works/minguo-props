// 信箋：欄位定義與預設內容。

import { fontFields, paperOptions } from './common.ts';
import { FONT_OPTIONS } from '../fonts.ts';
import { conditionDefaults, conditionFields } from './conditions.ts';
import type { DataOf, Field } from './schema.ts';

/** 強度大於 0 時才顯示的選項（showIf 只能比對固定值，所以列出所有非 0 的刻度）。 */
const MADNESS_ON = Array.from({ length: 20 }, (_, i) => (i + 1) * 5);

export const letterFields = [
  { key: 'paper', type: 'select', label: '紙張', group: '信紙', options: paperOptions(['a4-portrait', 'a5-portrait']) },
  {
    key: 'columns',
    type: 'select',
    label: '行數',
    group: '信紙',
    hint: '八行箋是民國書信最常見的紅格信紙。',
    options: [
      { value: '8', label: '八行' },
      { value: '10', label: '十行' },
      { value: '12', label: '十二行' },
      { value: '14', label: '十四行' },
    ],
  },
  {
    key: 'ink',
    type: 'select',
    label: '墨色',
    group: '信紙',
    options: [
      { value: 'black', label: '墨黑' },
      { value: 'blue', label: '藍黑墨水' },
      { value: 'brown', label: '褪色褐墨' },
    ],
  },
  { key: 'stationer', type: 'text', label: '箋紙店號', group: '信紙', maxLength: 12, hint: '印在信紙左下角的小字，可留空。' },

  { key: 'salutation', type: 'text', label: '稱謂', group: '內容', maxLength: 20 },
  { key: 'body', type: 'textarea', label: '正文', group: '內容', maxLength: 2000, rows: 10, hint: '每段另起一行。' },
  { key: 'indent', type: 'checkbox', label: '段首空兩格', group: '內容' },
  { key: 'closing', type: 'textarea', label: '結尾敬語', group: '內容', maxLength: 60, rows: 2, hint: '第二行（如「近安」）會另起一行頂格書寫。' },
  { key: 'signature', type: 'text', label: '署名', group: '內容', maxLength: 20 },
  {
    key: 'dateMode',
    type: 'select',
    label: '日期寫法',
    group: '內容',
    options: [
      { value: 'year', label: '十七年十一月五日' },
      { value: 'minguo', label: '民國十七年十一月五日' },
      { value: 'monthday', label: '十一月五日' },
      { value: 'none', label: '不寫日期' },
    ],
  },
  { key: 'date', type: 'date', label: '日期', group: '內容', min: '1912-01-01', max: '1949-12-31', showIf: { key: 'dateMode', in: ['year', 'minguo', 'monthday'] } },
  { key: 'dayStyle', type: 'checkbox', label: '日期用「廿」「卅」', group: '內容', showIf: { key: 'dateMode', in: ['year', 'minguo', 'monthday'] } },

  { key: 'madness', type: 'range', label: '越寫越亂', group: '瘋狂手寫', min: 0, max: 100, step: 5, unit: '%', hint: '每個字隨機偏移、旋轉、縮放、筆壓深淺，越往後越亂。' },
  { key: 'madStart', type: 'range', label: '從第幾個字開始', group: '瘋狂手寫', min: 0, max: 600, step: 5, unit: '字', showIf: { key: 'madness', in: MADNESS_ON } },
  { key: 'madRewrite', type: 'checkbox', label: '夾雜塗改後重寫', group: '瘋狂手寫', showIf: { key: 'madness', in: MADNESS_ON } },
  { key: 'madRepeat', type: 'checkbox', label: '同一句重複', group: '瘋狂手寫', showIf: { key: 'madness', in: MADNESS_ON } },
  { key: 'madOverflow', type: 'checkbox', label: '字擠出邊界', group: '瘋狂手寫', showIf: { key: 'madness', in: MADNESS_ON } },
  { key: 'madFillPage', type: 'checkbox', label: '同一句寫滿整頁', group: '瘋狂手寫', hint: '開始變亂後的第一句一直重複，寫滿整張信紙（結尾敬語與署名不再出現）。', showIf: { key: 'madness', in: MADNESS_ON } },
  {
    key: 'madFont',
    type: 'select',
    label: '亂到一半換字型',
    group: '瘋狂手寫',
    options: [{ value: '', label: '不換' }, ...FONT_OPTIONS],
    hint: '越亂的後半段改用這個手寫字型，例如從鋼筆行楷換成清松手寫體 7 飄逸。',
    showIf: { key: 'madness', in: MADNESS_ON },
  },
  ...fontFields('字型'),
  ...conditionFields('紙張狀況', '更多痕跡'),
] as const satisfies readonly Field[];

export type LetterData = DataOf<typeof letterFields>;

export const letterDefaults: LetterData = {
  paper: 'a4-portrait',
  columns: '12',
  ink: 'black',
  stationer: '霧港松煙齋製',
  salutation: '守義吾弟如晤：',
  body: [
    '別後月餘，時以為念。前承寄來拓片三紙，兄連日細加比勘，其文字既非篆籀，亦非梵文，與館中所藏諸碑皆不相類。',
    '弟信中言及宅中夜半常聞低吟之聲，兄深以為憂。若無十分把握，萬勿獨自下窖。拓片原件，兄當於下月初親自送還，屆時再為詳談。',
  ].join('\n'),
  indent: false,
  closing: '草此奉覆　順頌\n近安',
  signature: '兄　守仁　手書',
  dateMode: 'year',
  date: '1928-11-05',
  dayStyle: false,
  madness: 0,
  madStart: 40,
  madRewrite: false,
  madRepeat: false,
  madOverflow: false,
  madFillPage: false,
  madFont: '',
  fontTitle: 'noto-serif',
  fontBody: 'noto-serif',
  fontHand: 'lxgw',
  ...conditionDefaults({ aging: 'light', folds: true, foldStyle: 'thirds', stains: true, effectSeed: 61493 }),
};
