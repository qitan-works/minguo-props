// 電報：欄位定義與預設內容。

import { agingFields, paperOptions } from './common.ts';
import type { DataOf, Field } from './schema.ts';

export const telegramFields = [
  { key: 'paper', type: 'select', label: '紙張', group: '版面', options: paperOptions(['a5-landscape', 'a4-landscape', 'a4-portrait', 'a5-portrait']) },
  { key: 'office', type: 'text', label: '電報局', group: '電報紙', maxLength: 12, hint: '預設為虛構局名。' },
  {
    key: 'formKind',
    type: 'select',
    label: '種類',
    group: '電報紙',
    options: [
      { value: 'receive', label: '收報紙' },
      { value: 'send', label: '發報紙' },
    ],
  },
  { key: 'serial', type: 'text', label: '號數', group: '電報紙', maxLength: 12 },
  { key: 'origin', type: 'text', label: '發報局', group: '電報紙', maxLength: 12 },
  { key: 'addressee', type: 'text', label: '收報人住址姓名', group: '電報紙', maxLength: 40 },
  { key: 'receivedTime', type: 'text', label: '收發時刻', group: '電報紙', maxLength: 16 },
  { key: 'clerk', type: 'text', label: '譯電員', group: '電報紙', maxLength: 6 },
  { key: 'stamp', type: 'checkbox', label: '加蓋局戳', group: '電報紙' },

  {
    key: 'body',
    type: 'textarea',
    label: '電文',
    group: '電文',
    maxLength: 200,
    rows: 5,
    hint: '每個字旁會標上四碼中文電碼；查不到的字會以紅框標示，並列在下方。',
  },
  { key: 'signature', type: 'text', label: '署名', group: '電文', maxLength: 12, hint: '署名與代日字會接在電文之後一起編碼。' },
  {
    key: 'dateMode',
    type: 'select',
    label: '落款日期',
    group: '電文',
    options: [
      { value: 'yunmu', label: '韻目代日（例如廿一日＝馬）' },
      { value: 'yunmu-month', label: '地支代月＋韻目代日（例如五月廿一日＝辰馬）' },
      { value: 'none', label: '不寫日期' },
    ],
  },
  { key: 'date', type: 'date', label: '發報日期', group: '電文', min: '1912-01-01', max: '1949-12-31' },
  { key: 'yunmuAlternate', type: 'checkbox', label: '代日用別用字（例如一日用「先」）', group: '電文', showIf: { key: 'dateMode', in: ['yunmu', 'yunmu-month'] } },
  { key: 'dropPunctuation', type: 'checkbox', label: '略去標點（舊式電文不拍發標點）', group: '電文' },
  {
    key: 'codeDisplay',
    type: 'select',
    label: '方格內容',
    group: '電文',
    options: [
      { value: 'both', label: '字＋旁註電碼' },
      { value: 'chars', label: '只有字' },
      { value: 'codes', label: '只有電碼（讓玩家查電碼本自行譯電）' },
    ],
  },

  ...agingFields('紙張效果'),
] as const satisfies readonly Field[];

export type TelegramData = DataOf<typeof telegramFields>;

export const telegramDefaults: TelegramData = {
  paper: 'a5-landscape',
  office: '霧港電報總局',
  formKind: 'receive',
  serial: '第三八七號',
  origin: '漢口',
  addressee: '霧港柳巷十七號林守義',
  receivedTime: '下午三時二十分',
  clerk: '陳',
  stamp: true,
  body: '舊宅地窖萬勿開啟，所藏木箱即刻焚毀。兄已見其物，詳情面談。切切。',
  signature: '守仁',
  dateMode: 'yunmu',
  date: '1928-11-21',
  yunmuAlternate: false,
  dropPunctuation: true,
  codeDisplay: 'both',
  aging: 'light',
  folds: true,
  stains: false,
  effectSeed: 190331,
};
