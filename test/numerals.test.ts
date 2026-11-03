import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { toChineseDigits, toChineseNumber, toFinancialNumber } from '../src/lib/numerals.ts';

describe('toChineseNumber', () => {
  const cases: [number, string][] = [
    [0, '零'],
    [1, '一'],
    [9, '九'],
    [10, '十'],
    [11, '十一'],
    [15, '十五'],
    [20, '二十'],
    [21, '二十一'],
    [99, '九十九'],
    [100, '一百'],
    [101, '一百零一'],
    [105, '一百零五'],
    [110, '一百一十'],
    [115, '一百一十五'],
    [1000, '一千'],
    [1005, '一千零五'],
    [1010, '一千零一十'],
    [1050, '一千零五十'],
    [1928, '一千九百二十八'],
    [3210, '三千二百一十'],
    [10000, '一萬'],
    [10005, '一萬零五'],
    [100000, '十萬'],
    [100005, '十萬零五'],
    [110000, '十一萬'],
    [100500, '十萬零五百'],
    [123456, '十二萬三千四百五十六'],
    [1000000, '一百萬'],
    [100000000, '一億'],
    [100000005, '一億零五'],
    [102000000, '一億零二百萬'],
    [120000000, '一億二千萬'],
  ];
  for (const [n, expected] of cases) {
    it(`${n} → ${expected}`, () => assert.equal(toChineseNumber(n), expected));
  }

  it('日期寫法用廿、卅', () => {
    assert.equal(toChineseNumber(20, { date: true }), '廿');
    assert.equal(toChineseNumber(21, { date: true }), '廿一');
    assert.equal(toChineseNumber(29, { date: true }), '廿九');
    assert.equal(toChineseNumber(30, { date: true }), '卅');
    assert.equal(toChineseNumber(31, { date: true }), '卅一');
    assert.equal(toChineseNumber(15, { date: true }), '十五');
  });

  it('可指定零的寫法', () => {
    assert.equal(toChineseNumber(105, { zero: '〇' }), '一百〇五');
    assert.equal(toChineseNumber(0, { zero: '〇' }), '〇');
  });

  it('拒絕負數、小數與過大的數', () => {
    assert.throws(() => toChineseNumber(-1), RangeError);
    assert.throws(() => toChineseNumber(1.5), RangeError);
    assert.throws(() => toChineseNumber(Number.NaN), RangeError);
    assert.throws(() => toChineseNumber(10 ** 16), RangeError);
  });
});

describe('toFinancialNumber', () => {
  it('大寫數字', () => {
    assert.equal(toFinancialNumber(0), '零');
    assert.equal(toFinancialNumber(10), '壹拾');
    assert.equal(toFinancialNumber(105), '壹佰零伍');
    assert.equal(toFinancialNumber(3210), '參仟貳佰壹拾');
    assert.equal(toFinancialNumber(20000), '貳萬');
  });
});

describe('toChineseDigits', () => {
  it('逐字轉換半形與全形數字，其他字保留', () => {
    assert.equal(toChineseDigits('42315'), '四二三一五');
    assert.equal(toChineseDigits('1908'), '一九〇八');
    assert.equal(toChineseDigits('電話２０５'), '電話二〇五');
    assert.equal(toChineseDigits('柳巷17號'), '柳巷一七號');
  });
});
