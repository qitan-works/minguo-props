// 民國紀年：西元 1912 年為中華民國元年，所以民國年 = 西元年 − 1911。
// 1911 年以前寫作「民國前 N 年」（1911 年為民國前一年）。

import { toChineseNumber } from './numerals.ts';

export const MINGUO_EPOCH = 1911;

export interface SimpleDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

export interface MinguoYear {
  /** 「民國」或「民國前」。 */
  readonly era: '民國' | '民國前';
  /** 民國年數（從 1 起算）。 */
  readonly year: number;
}

export function toMinguoYear(gregorianYear: number): MinguoYear {
  if (!Number.isInteger(gregorianYear)) throw new RangeError(`年份必須是整數：${gregorianYear}`);
  if (gregorianYear > MINGUO_EPOCH) return { era: '民國', year: gregorianYear - MINGUO_EPOCH };
  return { era: '民國前', year: MINGUO_EPOCH + 1 - gregorianYear };
}

export function fromMinguoYear(minguoYear: number, era: MinguoYear['era'] = '民國'): number {
  if (!Number.isInteger(minguoYear) || minguoYear < 1) {
    throw new RangeError(`民國年必須是正整數：${minguoYear}`);
  }
  return era === '民國' ? minguoYear + MINGUO_EPOCH : MINGUO_EPOCH + 1 - minguoYear;
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function isValidDate(d: SimpleDate): boolean {
  return (
    Number.isInteger(d.year) &&
    Number.isInteger(d.month) &&
    Number.isInteger(d.day) &&
    d.year >= 1 &&
    d.year <= 9999 &&
    d.month >= 1 &&
    d.month <= 12 &&
    d.day >= 1 &&
    d.day <= daysInMonth(d.year, d.month)
  );
}

/** 解析 `YYYY-MM-DD`（<input type="date"> 的格式）。不合法時回傳 null。 */
export function parseIsoDate(text: string): SimpleDate | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const d = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  return isValidDate(d) ? d : null;
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'] as const;

/** 星期幾（以公曆計算），回傳「日」「一」…「六」。 */
export function weekdayOf(d: SimpleDate): (typeof WEEKDAYS)[number] {
  const date = new Date(Date.UTC(2000, 0, 1));
  date.setUTCFullYear(d.year, d.month - 1, d.day);
  return WEEKDAYS[date.getUTCDay()] ?? '日';
}

/** 民國年的中文寫法：1 → 元，17 → 十七。 */
export function minguoYearNumeral(year: number): string {
  return year === 1 ? '元' : toChineseNumber(year);
}

export interface MinguoFormatOptions {
  /** 開頭寫「中華民國」（full）、「民國」（short）或不寫（none）。預設 full。 */
  readonly prefix?: 'full' | 'short' | 'none';
  /** 日的寫法：standard 為「二十一日」，date 為「廿一日」。預設 standard。 */
  readonly dayStyle?: 'standard' | 'date';
  /** 是否附上「星期X」。預設 false。 */
  readonly weekday?: boolean;
}

/** 例：{1928, 5, 21} → 中華民國十七年五月二十一日 */
export function formatMinguoDate(d: SimpleDate, options: MinguoFormatOptions = {}): string {
  if (!isValidDate(d)) throw new RangeError(`日期不合法：${d.year}-${d.month}-${d.day}`);
  const { era, year } = toMinguoYear(d.year);
  const prefix = options.prefix ?? 'full';
  const dateStyle = options.dayStyle === 'date';
  let eraText: string;
  // 民國成立以前一律寫「民國前」。
  if (era === '民國前') eraText = '民國前';
  else eraText = prefix === 'full' ? '中華民國' : prefix === 'short' ? '民國' : '';
  const yearText = era === '民國前' ? toChineseNumber(year) : minguoYearNumeral(year);
  const monthText = toChineseNumber(d.month);
  const dayText = toChineseNumber(d.day, { date: dateStyle });
  const weekday = options.weekday ? `　星期${weekdayOf(d)}` : '';
  return `${eraText}${yearText}年${monthText}月${dayText}日${weekday}`;
}

/** 只寫月日：五月二十一日 */
export function formatMonthDay(d: SimpleDate, dayStyle: 'standard' | 'date' = 'standard'): string {
  if (!isValidDate(d)) throw new RangeError(`日期不合法：${d.year}-${d.month}-${d.day}`);
  return `${toChineseNumber(d.month)}月${toChineseNumber(d.day, { date: dayStyle === 'date' })}日`;
}
