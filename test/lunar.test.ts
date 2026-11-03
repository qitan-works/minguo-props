import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { LUNAR_YEARS } from '../src/data/lunar.ts';
import { formatLunar, ganzhiYear, toLunar } from '../src/lib/lunar.ts';
import { buildLunarYears, parseHkoYear } from '../scripts/lib/lunar-hko.ts';

function lunarOf(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const l = toLunar({ year: y, month: m, day: d });
  assert.ok(l, `${iso} 應在對照表範圍內`);
  return `${ganzhiYear(l.year)} ${formatLunar(l)}`;
}

describe('舊曆換算（對照香港天文台《公曆與農曆日期對照表》）', () => {
  // 每一筆都對照天文台 T<年>c.txt 該日那一行（括號內為該行與所在月份的月初行）。
  const cases: [string, string, string][] = [
    ['1912-01-01', '辛亥 十一月十三日', 'T1912c：1912年01月01日 十三（十一月始於 1911 年 12 月）'],
    ['1912-02-18', '壬子 正月初一日', 'T1912c：1912年02月18日 正月'],
    ['1914-06-24', '甲寅 閏五月初二日', 'T1914c：1914年06月23日 閏五月；06月24日 初二'],
    ['1917-03-23', '丁巳 閏二月初一日', 'T1917c：1917年03月23日 閏二月'],
    ['1922-06-25', '壬戌 閏五月初一日', 'T1922c：1922年06月25日 閏五月'],
    ['1925-03-12', '乙丑 二月十八日', 'T1925c：1925年02月23日 二月；03月12日 十八'],
    ['1928-03-22', '戊辰 閏二月初一日', 'T1928c：1928年03月22日 閏二月'],
    ['1928-11-05', '戊辰 九月二十四日', 'T1928c：1928年10月13日 九月；11月05日 廿四'],
    ['1931-09-18', '辛未 八月初七日', 'T1931c：1931年09月12日 八月；09月18日 初七'],
    ['1937-07-07', '丁丑 五月二十九日', 'T1937c：1937年06月09日 五月；07月07日 廿九'],
    ['1949-10-01', '己丑 八月初十日', 'T1949c：1949年09月22日 八月；10月01日 初十'],
    ['1949-12-31', '己丑 十一月十二日', 'T1949c：1949年12月20日 十一月；12月31日 十二'],
  ];
  for (const [iso, expected, source] of cases) {
    it(`${iso} → ${expected}（${source}）`, () => {
      assert.equal(lunarOf(iso), expected);
    });
  }

  it('範圍外回傳 null', () => {
    assert.equal(toLunar({ year: 1911, month: 12, day: 31 }), null);
    assert.equal(toLunar({ year: 1950, month: 1, day: 1 }), null);
  });

  it('對照表本身一致：每年的天數加總剛好接到下一年的正月初一，閏月年有 13 個月', () => {
    for (let i = 0; i + 1 < LUNAR_YEARS.length; i++) {
      const y = LUNAR_YEARS[i]!;
      const next = LUNAR_YEARS[i + 1]!;
      const days = y.months.reduce((a, b) => a + b, 0);
      const diff = (Date.parse(next.newYear) - Date.parse(y.newYear)) / 86_400_000;
      assert.equal(days, diff, `${y.year} 年`);
      assert.equal(y.months.length, y.leap > 0 ? 13 : 12, `${y.year} 年`);
      assert.ok(y.months.every((m) => m === 29 || m === 30));
    }
  });

  it('1912～1949 每一天都換算得出來，且日子連續', () => {
    let prev: ReturnType<typeof toLunar> = null;
    for (let t = Date.UTC(1912, 0, 1); t <= Date.UTC(1949, 11, 31); t += 86_400_000) {
      const d = new Date(t);
      const l = toLunar({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() });
      assert.ok(l);
      if (prev && l.day !== 1) assert.equal(l.day, prev.day + 1);
      prev = l;
    }
  });

  it('干支紀年', () => {
    assert.equal(ganzhiYear(1912), '壬子');
    assert.equal(ganzhiYear(1924), '甲子');
    assert.equal(ganzhiYear(1949), '己丑');
  });

  it('天文台文字檔的解析', () => {
    const text = [
      '1928(戊辰-肖龍)年公曆與農曆日期對照表',
      '公曆日期 農曆日期 星期 節氣',
      '1928年03月20日    廿九    星期二',
      '1928年03月21日    三十    星期三',
      '1928年03月22日    閏二月  星期四',
      '1928年03月23日    初二    星期五',
    ].join('\n');
    const days = parseHkoYear(text);
    assert.equal(days.length, 4);
    assert.deepEqual(days[2], { date: '1928-03-22', monthStart: { month: 2, leap: true }, day: 1 });
    assert.throws(() => buildLunarYears([{ date: '1928-03-20', day: 29 }, { date: '1928-03-21', day: 5 }]), /不連續/);
  });
});
