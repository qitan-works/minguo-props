import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  daysInMonth,
  formatMinguoDate,
  formatMonthDay,
  fromMinguoYear,
  isValidDate,
  minguoYearNumeral,
  parseIsoDate,
  toMinguoYear,
  weekdayOf,
} from '../src/lib/minguo.ts';

describe('民國紀年換算', () => {
  it('1912 年為民國元年', () => {
    assert.deepEqual(toMinguoYear(1912), { era: '民國', year: 1 });
    assert.equal(minguoYearNumeral(1), '元');
  });
  it('常見年份', () => {
    assert.deepEqual(toMinguoYear(1928), { era: '民國', year: 17 });
    assert.deepEqual(toMinguoYear(1937), { era: '民國', year: 26 });
    assert.deepEqual(toMinguoYear(2026), { era: '民國', year: 115 });
  });
  it('1911 年以前為民國前', () => {
    assert.deepEqual(toMinguoYear(1911), { era: '民國前', year: 1 });
    assert.deepEqual(toMinguoYear(1900), { era: '民國前', year: 12 });
  });
  it('反向換算', () => {
    assert.equal(fromMinguoYear(1), 1912);
    assert.equal(fromMinguoYear(17), 1928);
    assert.equal(fromMinguoYear(1, '民國前'), 1911);
    for (let y = 1880; y <= 2100; y++) {
      const m = toMinguoYear(y);
      assert.equal(fromMinguoYear(m.year, m.era), y);
    }
    assert.throws(() => fromMinguoYear(0), RangeError);
  });
});

describe('日期', () => {
  it('閏年與每月天數', () => {
    assert.equal(daysInMonth(1928, 2), 29);
    assert.equal(daysInMonth(1900, 2), 28);
    assert.equal(daysInMonth(2000, 2), 29);
    assert.equal(daysInMonth(1929, 2), 28);
    assert.equal(daysInMonth(1929, 4), 30);
    assert.equal(daysInMonth(1929, 12), 31);
  });
  it('驗證與解析 YYYY-MM-DD', () => {
    assert.deepEqual(parseIsoDate('1928-11-05'), { year: 1928, month: 11, day: 5 });
    assert.equal(parseIsoDate('1929-02-29'), null);
    assert.equal(parseIsoDate('1928-13-01'), null);
    assert.equal(parseIsoDate('1928-1-5'), null);
    assert.equal(parseIsoDate(''), null);
    assert.equal(isValidDate({ year: 1928, month: 2, day: 29 }), true);
  });
  it('星期', () => {
    // 1912-01-01 中華民國成立當天為星期一。
    assert.equal(weekdayOf({ year: 1912, month: 1, day: 1 }), '一');
    assert.equal(weekdayOf({ year: 1928, month: 11, day: 5 }), '一');
    assert.equal(weekdayOf({ year: 1937, month: 7, day: 7 }), '三');
    assert.equal(weekdayOf({ year: 2026, month: 11, day: 5 }), '四');
  });
});

describe('formatMinguoDate', () => {
  const d = { year: 1928, month: 11, day: 21 };
  it('完整寫法', () => {
    assert.equal(formatMinguoDate(d), '中華民國十七年十一月二十一日');
  });
  it('簡寫、廿卅寫法與星期', () => {
    assert.equal(formatMinguoDate(d, { prefix: 'short' }), '民國十七年十一月二十一日');
    assert.equal(formatMinguoDate(d, { prefix: 'none', dayStyle: 'date' }), '十七年十一月廿一日');
    assert.equal(formatMinguoDate({ year: 1928, month: 11, day: 5 }, { weekday: true }), '中華民國十七年十一月五日　星期一');
  });
  it('元年與民國前', () => {
    assert.equal(formatMinguoDate({ year: 1912, month: 1, day: 1 }), '中華民國元年一月一日');
    assert.equal(formatMinguoDate({ year: 1911, month: 10, day: 10 }), '民國前一年十月十日');
  });
  it('只寫月日', () => {
    assert.equal(formatMonthDay(d), '十一月二十一日');
    assert.equal(formatMonthDay({ year: 1928, month: 5, day: 30 }, 'date'), '五月卅日');
  });
  it('不合法的日期丟出錯誤', () => {
    assert.throws(() => formatMinguoDate({ year: 1929, month: 2, day: 29 }), RangeError);
  });
});
