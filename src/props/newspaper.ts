// 報紙剪報：欄位定義與預設內容。

import { agingFields, paperOptions } from './common.ts';
import type { DataOf, Field } from './schema.ts';

/**
 * 預設與建議的報頭一律虛構。以下為本專案確認過「不得作為預設」的真實民國報紙名稱，
 * 測試會檢查預設報頭不在其中（清單不可能完整，只用來防止明顯的撞名）。
 */
export const REAL_NEWSPAPER_NAMES = [
  '申報',
  '大公報',
  '新聞報',
  '時報',
  '民國日報',
  '益世報',
  '晨報',
  '京報',
  '時事新報',
  '中央日報',
  '世界日報',
  '新民報',
  '立報',
  '晶報',
  '神州日報',
  '民立報',
  '北平晨報',
  '掃蕩報',
  '新華日報',
  '解放日報',
  '中華日報',
  '大陸報',
  '字林西報',
  '鷺江報',
] as const;

/** 虛構報頭建議（已用網路搜尋確認查無同名的民國報刊；無法保證完全沒有）。 */
export const FICTIONAL_MASTHEADS = ['霧港日報', '海隅晚報', '江左異聞報', '滄瀛新報'] as const;

export const newspaperFields = [
  { key: 'paper', type: 'select', label: '紙張', group: '版面', options: paperOptions(['a4-portrait', 'a4-landscape', 'a5-portrait', 'a5-landscape']) },
  {
    key: 'tiers',
    type: 'select',
    label: '分段',
    group: '版面',
    hint: '直排報紙由上而下分成數段，每段內文由右而左。',
    options: [
      { value: '2', label: '兩段' },
      { value: '3', label: '三段' },
      { value: '4', label: '四段' },
    ],
  },
  { key: 'showMasthead', type: 'checkbox', label: '顯示報頭（剪下報頭一角）', group: '版面' },
  { key: 'clipEdge', type: 'checkbox', label: '剪報毛邊', group: '版面' },

  { key: 'masthead', type: 'text', label: '報頭', group: '報頭', maxLength: 8, hint: '預設為虛構報名，請勿使用真實報紙名稱。', showIf: { key: 'showMasthead', in: [true] } },
  { key: 'date', type: 'date', label: '出刊日期', group: '報頭', min: '1912-01-01', max: '1949-12-31', hint: '自動換算民國紀年與星期。' },
  { key: 'issue', type: 'text', label: '號數', group: '報頭', maxLength: 16, showIf: { key: 'showMasthead', in: [true] } },
  { key: 'price', type: 'text', label: '售價', group: '報頭', maxLength: 16, showIf: { key: 'showMasthead', in: [true] } },
  { key: 'section', type: 'text', label: '版名', group: '報頭', maxLength: 8 },

  { key: 'headline', type: 'text', label: '標題', group: '新聞', maxLength: 24 },
  { key: 'subheadline', type: 'text', label: '副題', group: '新聞', maxLength: 40, hint: '可用全形空白分隔多句。' },
  { key: 'dateline', type: 'text', label: '電頭', group: '新聞', maxLength: 12, hint: '例如「本埠訊」「專電」。' },
  { key: 'body', type: 'textarea', label: '內文', group: '新聞', maxLength: 3000, rows: 10 },

  { key: 'photo', type: 'image', label: '照片', group: '照片', hint: '照片只在你的瀏覽器內處理，不會上傳。' },
  { key: 'photoCaption', type: 'text', label: '圖說', group: '照片', maxLength: 30 },

  { key: 'secondTitle', type: 'text', label: '短訊標題', group: '短訊（可留空）', maxLength: 24 },
  { key: 'secondBody', type: 'textarea', label: '短訊內文', group: '短訊（可留空）', maxLength: 1000, rows: 4 },

  ...agingFields('紙張效果'),
] as const satisfies readonly Field[];

export type NewspaperData = DataOf<typeof newspaperFields>;

export const newspaperDefaults: NewspaperData = {
  paper: 'a4-portrait',
  tiers: '3',
  showMasthead: true,
  clipEdge: true,
  masthead: '霧港日報',
  date: '1928-11-05',
  issue: '第三千二百一十號',
  price: '每份銅元四枚',
  section: '本埠新聞',
  headline: '柳巷古宅夜半怪聲',
  subheadline: '鄰里驚疑不安　巡警查勘一無所獲　宅主行蹤成謎',
  dateline: '本埠訊',
  body: [
    '柳巷十七號林宅，自上月下旬起，每逢夜半，輒聞宅內有低吟之聲，似歌非歌，似泣非泣，四鄰為之不安。前晚十一時許，更有居民目睹宅後窗內青光閃爍，歷時約一刻鐘方滅。',
    '翌晨，巡警二名奉命前往查勘，叩門良久無人應答，乃由後門入內，但見屋內陳設如常，惟書齋案頭散置古籍數冊，所載文字非華非洋，無人能識；地窖入口則以新磚封砌，灰漿未乾。',
    '據鄰人云，宅主林君係本埠大學教員，平日深居簡出，約於半月前攜一木箱返家，此後即未再見其蹤影。警署已將古籍封存，並函請大學方面協助辨識。記者昨再往探訪，宅門緊閉，門縫中隱有異香，不知所自。本案詳情，容續探報。',
  ].join('\n'),
  photo: '',
  photoCaption: '柳巷十七號林宅外觀（本報記者攝）',
  secondTitle: '港口連日濃霧　輪船誤期',
  secondBody:
    '本埠連日濃霧，自前日黃昏起，港內能見度不及十丈，往來輪船多停泊口外，不敢駛入。據海關報告，昨日進口輪船僅二艘，較平日減少大半。有老船戶謂，此霧色微帶青灰，入夜猶不散，數十年來僅見一次云。',
  aging: 'medium',
  folds: true,
  stains: true,
  stainSeed: '3',
};
