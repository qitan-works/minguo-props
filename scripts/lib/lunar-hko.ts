// 解析香港天文台《公曆與農曆日期對照表》的文字檔（每年一個檔，例如 T1928c.txt），
// 整理成每個農曆年的「正月初一是公曆哪一天、各月幾天、閏哪個月」。純邏輯。
//
// 檔案每行的格式（以空白分欄）：「1928年03月22日  閏二月  星期四  …」。
// 第二欄是農曆日期：每月初一寫月名（「二月」「閏二月」「十一月」），其餘寫「初二」「十五」「廿九」「三十」。

import type { LunarYear } from '../../src/lib/lunar.ts';

export type { LunarYear };

const MONTHS = ['正月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
const DAYS = ['初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
  '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
  '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十'];

export interface HkoDay {
  readonly date: string;
  /** 1～12；當天是某月初一時才有值。 */
  readonly monthStart?: { readonly month: number; readonly leap: boolean };
  /** 1～30。 */
  readonly day: number;
}

/** 解析一個年度檔的每一天。 */
export function parseHkoYear(text: string): HkoDay[] {
  const days: HkoDay[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^(\d{4})年(\d{2})月(\d{2})日\s+(\S+)/.exec(line);
    if (!m) continue;
    const date = `${m[1]}-${m[2]}-${m[3]}`;
    const token = m[4] as string;
    const leap = token.startsWith('閏');
    const monthIndex = MONTHS.indexOf(leap ? token.slice(1) : token);
    if (monthIndex >= 0) {
      days.push({ date, monthStart: { month: monthIndex + 1, leap }, day: 1 });
      continue;
    }
    const day = DAYS.indexOf(token) + 1;
    if (day <= 0) throw new Error(`看不懂的農曆日期：${line.trim()}`);
    days.push({ date, day });
  }
  return days;
}

/**
 * 由連續多年的逐日資料整理出各農曆年。只輸出「正月初一」和「下一個正月初一」都在資料範圍內的完整年度。
 */
export function buildLunarYears(allDays: readonly HkoDay[]): LunarYear[] {
  // 每個月的開頭：位置與月份
  const starts: { index: number; month: number; leap: boolean }[] = [];
  allDays.forEach((d, index) => {
    if (d.monthStart) starts.push({ index, ...d.monthStart });
  });
  // 檢查逐日連續：月初之間的日數字必須是 1、2、3…
  for (let i = 0; i < allDays.length; i++) {
    const d = allDays[i] as HkoDay;
    if (i > 0 && !d.monthStart && d.day !== (allDays[i - 1] as HkoDay).day + 1) {
      throw new Error(`${d.date} 的農曆日不連續`);
    }
  }
  const years: LunarYear[] = [];
  for (let s = 0; s < starts.length; s++) {
    const start = starts[s] as (typeof starts)[number];
    if (start.month !== 1 || start.leap) continue;
    const months: number[] = [];
    let leap = 0;
    let k = s;
    let complete = false;
    while (k + 1 < starts.length) {
      const cur = starts[k] as (typeof starts)[number];
      const next = starts[k + 1] as (typeof starts)[number];
      months.push(next.index - cur.index);
      if (cur.leap) leap = cur.month;
      k++;
      if (next.month === 1 && !next.leap) {
        complete = true;
        break;
      }
    }
    if (!complete) continue;
    const date = (allDays[start.index] as HkoDay).date;
    years.push({ year: Number(date.slice(0, 4)), newYear: date, leap, months });
  }
  return years;
}

/** 輸出成 TypeScript 模組（執行期直接 import，不必另外下載）。 */
export function serializeLunarYears(years: readonly LunarYear[], source: string): string {
  const lines = years.map((y) => `  { year: ${y.year}, newYear: '${y.newYear}', leap: ${y.leap}, months: [${y.months.join(', ')}] },`);
  return [
    '// 由 scripts/lunar-table.ts 產生，請勿手動修改（pnpm data:lunar 重新產生，pnpm data:lunar-check 比對）。',
    `// 來源：${source}`,
    '',
    "import type { LunarYear } from '../lib/lunar.ts';",
    '',
    'export const LUNAR_YEARS: readonly LunarYear[] = [',
    ...lines,
    '];',
    '',
  ].join('\n');
}
