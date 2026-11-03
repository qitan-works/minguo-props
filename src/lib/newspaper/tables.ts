// 第四版：格線表格（行情表、船期表、金融行情）與目錄的內容（純邏輯，由種子產生，全部虛構）。

import { TOC_SETS } from '../../data/fillers4.ts';
import { VOCAB } from '../../data/fillers.ts';
import { toChineseNumber } from '../numerals.ts';
import { int, pick, shuffle, type Rng } from '../random.ts';

export interface TableData {
  readonly title: string;
  /** 欄位名稱（由上而下）。 */
  readonly fields: readonly string[];
  /** 每一項一行（由右而左），值依欄位順序。 */
  readonly items: readonly (readonly string[])[];
}

export interface TocData {
  readonly title: string;
  readonly entries: readonly { readonly text: string; readonly page: string }[];
}

const cn = (n: number): string => toChineseNumber(n);

/** 價錢寫成短的中文數字，例如「十一元四」「三角五」。 */
function price(rng: Rng, lo: number, hi: number, unit: '元' | '角'): string {
  const whole = int(rng, lo, hi);
  const tenth = int(rng, 0, 9);
  return `${cn(whole)}${unit}${tenth > 0 ? cn(tenth) : ''}`;
}

export function goodsTable(rng: Rng): TableData {
  const goods = shuffle(rng, VOCAB.goods);
  const items = goods.map(([name, unit, lo, hi, cur]) => {
    const today = price(rng, lo, hi, cur);
    const move = pick(rng, ['漲', '跌', '平', '平', '漲']);
    return [name, unit.replace('每', ''), today, move];
  });
  return { title: pick(rng, ['本埠行情', '昨日市價', '米糧雜貨行情']), fields: ['貨名', '單位', '價目', '漲落'], items };
}

export function shipsTable(rng: Rng): TableData {
  const ships = shuffle(rng, VOCAB.ships);
  const items = ships.map((ship) => {
    const port = pick(rng, VOCAB.ports.filter((p) => p !== '霧港'));
    return [ship.replace('輪', ''), port, `${cn(int(rng, 1, 30))}日`, `${pick(rng, ['上午', '下午'])}${cn(int(rng, 1, 12))}時`];
  });
  return { title: pick(rng, ['輪船班期', '各輪開行日期', '本埠出口船期']), fields: ['船名', '開往', '日期', '時刻'], items };
}

const FX = ['英金', '美金', '日金', '港紙', '法郎', '標金', '大條', '銀元', '銅元', '公債'];

export function fxTable(rng: Rng): TableData {
  const items = shuffle(rng, FX).map((name) => {
    const buy = int(rng, 20, 90);
    return [name, cn(buy), cn(buy + int(rng, 1, 4))];
  });
  return { title: pick(rng, ['金融行情', '匯兌行市']), fields: ['名目', '買進', '賣出'], items };
}

export function tocData(rng: Rng, supplement: boolean): TocData {
  const set = TOC_SETS[supplement ? 0 : 1] ?? TOC_SETS[0];
  if (!set) return { title: '目錄', entries: [] };
  const entries = set.entries.map(([text, page]) => ({ text, page }));
  return { title: set.title, entries: rng() < 0.5 ? entries : entries };
}
