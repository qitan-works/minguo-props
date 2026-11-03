// 舊曆（農曆）：把 1912～1949 年的公曆日期換算成農曆，供報紙日期寫「（即舊曆九月二十四日）」。純邏輯。
// 資料是 src/data/lunar.ts 的對照表（香港天文台《公曆與農曆日期對照表》，見 scripts/lunar-table.ts），
// 不用瀏覽器內建的農曆：各瀏覽器支援不一，而且 1917、1922 年的閏月和當年的曆書不同。

import { LUNAR_YEARS } from '../data/lunar.ts';
import type { SimpleDate } from './minguo.ts';
import { toChineseNumber } from './numerals.ts';

export interface LunarYear {
  /** 農曆年（以該年正月初一所在的公曆年表示，例如 1928 = 戊辰年）。 */
  readonly year: number;
  /** 正月初一的公曆日期（YYYY-MM-DD）。 */
  readonly newYear: string;
  /** 閏幾月（0 表示沒有閏月）。 */
  readonly leap: number;
  /** 依序各月的天數（有閏月時共 13 個月，閏月緊接在同名的月之後）。 */
  readonly months: readonly number[];
}

export interface LunarDate {
  /** 農曆年（同 LunarYear.year）。 */
  readonly year: number;
  readonly month: number;
  readonly leap: boolean;
  readonly day: number;
}

/** 對照表涵蓋的公曆範圍。 */
export const LUNAR_RANGE = { from: '1912-01-01', to: '1949-12-31' } as const;

function dayNumber(year: number, month: number, day: number): number {
  return Math.round(Date.UTC(year, month - 1, day) / 86_400_000);
}

function isoDayNumber(iso: string): number {
  return dayNumber(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), Number(iso.slice(8, 10)));
}

/** 公曆日期換算成農曆；超出 1912～1949 年時回傳 null。 */
export function toLunar(date: SimpleDate, table: readonly LunarYear[] = LUNAR_YEARS): LunarDate | null {
  if (date.year < 1912 || date.year > 1949) return null;
  const n = dayNumber(date.year, date.month, date.day);
  for (let i = table.length - 1; i >= 0; i--) {
    const y = table[i] as LunarYear;
    let offset = n - isoDayNumber(y.newYear);
    if (offset < 0) continue;
    let month = 0;
    for (let k = 0; k < y.months.length; k++) {
      const len = y.months[k] as number;
      const isLeap = y.leap > 0 && k === y.leap;
      if (!isLeap) month++;
      if (offset < len) return { year: y.year, month, leap: isLeap, day: offset + 1 };
      offset -= len;
    }
    return null;
  }
  return null;
}

const STEMS = '甲乙丙丁戊己庚辛壬癸';
const BRANCHES = '子丑寅卯辰巳午未申酉戌亥';

/** 干支紀年：1928 → 戊辰。 */
export function ganzhiYear(year: number): string {
  const i = (((year - 4) % 60) + 60) % 60;
  return `${STEMS[i % 10]}${BRANCHES[i % 12]}`;
}

const MONTH_NAMES = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];

/** 農曆月名：「九月」「閏二月」「正月」。 */
export function lunarMonthName(d: Pick<LunarDate, 'month' | 'leap'>): string {
  return `${d.leap ? '閏' : ''}${MONTH_NAMES[d.month - 1] ?? ''}月`;
}

/** 農曆日：「初五」「十一」「二十四」「三十」。 */
export function lunarDayName(day: number): string {
  if (day <= 10) return `初${toChineseNumber(day)}`;
  return toChineseNumber(day);
}

/** 「九月二十四日」「閏二月初一日」。 */
export function formatLunar(d: LunarDate): string {
  return `${lunarMonthName(d)}${lunarDayName(d.day)}日`;
}
