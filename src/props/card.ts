// 名片／請帖：欄位定義與預設內容。尺寸為 90×54 mm（可選直式），亦可拼版印在 A4 上。

import { fontEraField, fontFields } from './common.ts';
import { conditionDefaults, conditionFields } from './conditions.ts';
import type { DataOf, Field } from './schema.ts';

const CARD = { key: 'style', in: ['card'] } as const;
const INVITE = { key: 'style', in: ['invite'] } as const;

export const cardFields = [
  {
    key: 'style',
    type: 'select',
    label: '種類',
    group: '版面',
    options: [
      { value: 'card', label: '名片' },
      { value: 'invite', label: '請帖' },
    ],
  },
  {
    key: 'orientation',
    type: 'select',
    label: '方向',
    group: '版面',
    options: [
      { value: 'portrait', label: '直式（54×90 mm）' },
      { value: 'landscape', label: '橫式（90×54 mm）' },
    ],
  },
  {
    key: 'sheet',
    type: 'select',
    label: '列印方式',
    group: '版面',
    hint: 'A4 拼版會在一張 A4 上排 10 張，附裁切線。',
    options: [
      { value: 'single', label: '單張（紙張大小即名片大小）' },
      { value: 'a4', label: 'A4 拼版 10 張' },
    ],
  },
  {
    key: 'stock',
    type: 'select',
    label: '紙色',
    group: '版面',
    options: [
      { value: 'ivory', label: '米白' },
      { value: 'white', label: '粉白' },
      { value: 'red', label: '大紅（請帖常用）' },
    ],
  },

  { key: 'name', type: 'text', label: '姓名', group: '名片', maxLength: 8, showIf: CARD },
  { key: 'courtesy', type: 'text', label: '字號', group: '名片', maxLength: 8, hint: '例如「子方」，會印成「字子方」。', showIf: CARD },
  { key: 'org', type: 'text', label: '機關', group: '名片', maxLength: 16, showIf: CARD },
  { key: 'title', type: 'text', label: '職銜', group: '名片', maxLength: 16, showIf: CARD },
  { key: 'native', type: 'text', label: '籍貫', group: '名片', maxLength: 8, hint: '例如「浙江鄞縣」，可留空。', showIf: CARD },
  { key: 'address', type: 'text', label: '住址', group: '名片', maxLength: 24, showIf: CARD },
  { key: 'phone', type: 'text', label: '電話', group: '名片', maxLength: 10, hint: '阿拉伯數字會自動轉成中文數字。', showIf: CARD },

  { key: 'inviteOccasion', type: 'text', label: '事由', group: '請帖', maxLength: 20, showIf: INVITE },
  { key: 'inviteDate', type: 'date', label: '日期', group: '請帖', min: '1912-01-01', max: '1949-12-31', showIf: INVITE },
  { key: 'inviteTime', type: 'text', label: '時間', group: '請帖', maxLength: 10, showIf: INVITE },
  { key: 'inviteVenue', type: 'text', label: '席設', group: '請帖', maxLength: 16, showIf: INVITE },
  { key: 'inviteHost', type: 'text', label: '主人', group: '請帖', maxLength: 16, showIf: INVITE },

  fontEraField('字型'),
  ...fontFields('字型'),
  ...conditionFields('紙張狀況', '更多痕跡'),
] as const satisfies readonly Field[];

export type CardData = DataOf<typeof cardFields>;

export const cardDefaults: CardData = {
  style: 'card',
  orientation: 'portrait',
  sheet: 'single',
  stock: 'ivory',
  name: '林守義',
  courtesy: '子方',
  org: '霧港大學文學院',
  title: '教授',
  native: '浙江鄞縣',
  address: '霧港柳巷十七號',
  phone: '42315',
  inviteOccasion: '為舍弟洗塵',
  inviteDate: '1928-11-15',
  inviteTime: '下午六時',
  inviteVenue: '霧港聚雲樓',
  inviteHost: '林守仁',
  fontEra: 'custom',
  fontMasthead: 'noto-serif',
  fontTitle: 'noto-serif',
  fontBody: 'noto-serif',
  fontAd: 'noto-serif',
  fontHand: 'lxgw',
  ...conditionDefaults({ aging: 'light', folds: false, foldStyle: 'half', stains: false, effectSeed: 52817 }),
};
