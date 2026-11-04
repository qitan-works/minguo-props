// 民國日常文件（第五版）：船票、火車票、當票、醫院病歷、驗屍報告、地契、信封。
// 全部是虛構的機構、店號與編號；不做任何貨幣、鈔票或現行證件。欄位定義、預設內容與各種文件的範本。

import { fontEraField, fontFields } from './common.ts';
import { conditionDefaults, conditionFields } from './conditions.ts';
import type { DataOf, Field } from './schema.ts';

export const DOC_TYPES = [
  { value: 'ship', label: '船票' },
  { value: 'train', label: '火車票' },
  { value: 'pawn', label: '當票' },
  { value: 'medical', label: '醫院病歷' },
  { value: 'autopsy', label: '驗屍報告' },
  { value: 'deed', label: '地契（賣契）' },
  { value: 'envelope', label: '信封（郵票、郵戳）' },
] as const;
export type DocType = (typeof DOC_TYPES)[number]['value'];

export const documentFields = [
  {
    key: 'docType',
    type: 'select',
    label: '文件種類',
    group: '文件',
    options: DOC_TYPES,
    hint: '換種類時，下面的機構、編號、欄位與正文會換成那種文件的範本（內容全部虛構），再自行修改。',
  },
  { key: 'docOrg', type: 'text', label: '機構或店號', group: '文件', maxLength: 20 },
  { key: 'docNo', type: 'text', label: '編號', group: '文件', maxLength: 16 },
  { key: 'docDate', type: 'date', label: '日期', group: '文件', min: '1912-01-01', max: '1949-12-31' },
  {
    key: 'docLines',
    type: 'textarea',
    label: '欄位',
    group: '文件',
    maxLength: 800,
    rows: 8,
    hint: '每行一欄，寫成「標籤：內容」。信封的收件地址、收件人、寄件人也寫在這裡。',
  },
  { key: 'docBody', type: 'textarea', label: '正文或附記', group: '文件', maxLength: 800, rows: 5, hint: '地契的契文、病歷的記錄、驗屍的檢驗結果、票券背面的規則。' },
  { key: 'docStamp', type: 'text', label: '印文（留空則不蓋）', group: '文件', maxLength: 12, hint: '信封是郵戳上的地名與日期。' },
  { key: 'docRed', type: 'checkbox', label: '編號印成紅色', group: '文件' },
  fontEraField('字型'),
  ...fontFields('字型'),
  ...conditionFields('紙張狀況', '更多痕跡'),
] as const satisfies readonly Field[];

export type DocumentData = DataOf<typeof documentFields>;

/** 各種文件的範本（全部虛構）。 */
export const DOC_TEMPLATES: Readonly<Record<DocType, Pick<DocumentData, 'docOrg' | 'docNo' | 'docLines' | 'docBody' | 'docStamp'>>> = {
  ship: {
    docOrg: '霧港輪船股份有限公司',
    docNo: '第〇四二一七號',
    docLines: ['船名：海晏號', '艙位：二等艙', '由：霧港', '至：上海', '開船：十一月七日上午八時', '鋪位：十四號', '票價：大洋八元'].join('\n'),
    docBody: '此票限乘本輪一次，過期作廢。旅客行李每人以五十斤為限，違禁物品概不承運。',
    docStamp: '霧港輪船公司',
  },
  train: {
    docOrg: '霧港鐵路管理局',
    docNo: '〇〇七三二',
    docLines: ['等級：三等', '由：霧港站', '至：長汀站', '車次：第十一次快車', '日期：十一月六日', '票價：大洋一元二角'].join('\n'),
    docBody: '此票當日有效，中途下車作廢。請妥為保存，以備查驗。',
    docStamp: '霧港站',
  },
  pawn: {
    docOrg: '霧港裕昌當',
    docNo: '天字第一二〇八號',
    docLines: ['當物：舊銅香爐一座　缺一耳　底有異紋', '當本：大洋三元', '月息：三分', '限期：十八個月', '取贖：認票不認人'].join('\n'),
    docBody: '蟲蛀鼠咬　各安天命　過期不贖　任憑變賣',
    docStamp: '裕昌當',
  },
  medical: {
    docOrg: '私立霧港濟生醫院',
    docNo: '病歷第三一七號',
    docLines: ['姓名：陳阿水', '性別：男', '年齡：三十四歲', '籍貫：霧港', '職業：漁夫', '入院：十一月二日', '主訴：夜不能寐，常聞水聲', '診斷：神經衰弱（待查）'].join('\n'),
    docBody: '患者自言連夜夢見海底城郭，醒後口中有鹹水味。脈數而弱，兩手指間有細鱗狀皮疹，原因不明。給予鎮靜劑，囑靜養，勿近海邊。',
    docStamp: '濟生醫院',
  },
  autopsy: {
    docOrg: '霧港地方法院檢驗處',
    docNo: '驗字第四十二號',
    docLines: ['死者：無名男屍', '年齡：約四十歲', '發現地點：鎮海祠下沙灘', '發現時間：十一月四日清晨', '檢驗員：周某', '死因：溺斃（存疑）'].join('\n'),
    docBody: '屍身無外傷，肺中積水甚多，然口鼻並無泥沙。左胸有圓形印痕三處，大小如錢，排列成弧，似為吸盤所致。指甲縫中有黑色黏液，乾後不褪。',
    docStamp: '檢驗處印',
  },
  deed: {
    docOrg: '',
    docNo: '',
    docLines: ['立賣契人：林阿土', '坐落：霧港東郊鎮海祠後', '田畝：旱田三畝', '東至：海岸', '西至：官道', '南至：陳姓田', '北至：祠產', '價銀：大洋一百二十元', '中人：王某', '代筆：李某'].join('\n'),
    docBody: '立賣契人林阿土，今因乏用，願將祖遺旱田三畝，憑中出賣與林守仁名下為業。當日三面言定價銀，即日收足，並無短少。此田自賣之後，任憑買主耕種管業，賣主不得異言。恐口無憑，立此賣契存照。',
    docStamp: '霧港縣印',
  },
  envelope: {
    docOrg: '霧港郵政',
    docNo: '',
    docLines: ['收件地址：霧港柳巷十七號', '收件人：林守義　先生　台啟', '寄件人：上海　守仁　緘'].join('\n'),
    docBody: '',
    docStamp: '霧港',
  },
};

export const documentDefaults: DocumentData = {
  docType: 'pawn',
  ...DOC_TEMPLATES.pawn,
  docDate: '1928-11-05',
  docRed: true,
  fontEra: 'custom',
  fontMasthead: 'wang-zhong-li',
  fontTitle: 'wang-zhong-ming',
  fontBody: 'wang-zhong-ming',
  fontAd: 'wang-yan-kai',
  fontHand: 'wang-gangbi-xingkai',
  ...conditionDefaults({ aging: 'medium', folds: true, foldStyle: 'half', spots: 25, effectSeed: 90617 }),
};

/** 把「標籤：內容」的每一行拆開；沒有冒號的行當成只有內容。 */
export function parseDocLines(text: string): { label: string; value: string }[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m = /^([^：:]{1,8})[：:](.*)$/.exec(l);
      return m ? { label: (m[1] ?? '').trim(), value: (m[2] ?? '').trim() } : { label: '', value: l };
    });
}

/** 換文件種類時套上那種文件的範本。 */
export function applyDocType(current: DocumentData, type: string): DocumentData {
  const t = DOC_TYPES.find((d) => d.value === type)?.value;
  if (!t) return current;
  return { ...current, docType: t, ...DOC_TEMPLATES[t], docRed: t !== 'deed' && t !== 'envelope' };
}
