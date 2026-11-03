import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DIZHI_MONTHS,
  YUNMU_DAYS,
  dayToYunmu,
  dizhiToMonth,
  monthToDizhi,
  telegramDateCode,
  yunmuToDay,
} from '../src/lib/yunmu.ts';

// 平水韻韻目次序（維基文庫〈平水韻〉），用來檢查「第 N 日取第 N 韻」的規則。
const SHANG_PING = '東冬江支微魚虞齊佳灰真文元寒刪';
const XIA_PING = '先蕭肴豪歌麻陽庚青蒸尤侵覃鹽咸';
// 上聲二十九韻（「琰」韻在電報代日中寫作「儉」）。
const SHANG_SHENG = '董腫講紙尾語麌薺蟹賄軫吻阮旱潸銑篠巧皓哿馬養梗迥有寢感儉豏';
// 去聲三十韻。
const QU_SHENG = '送宋絳寘未御遇霽泰卦隊震問願翰諫霰嘯效號箇禡漾敬徑宥沁勘豔陷';

describe('韻目代日對照表', () => {
  it('涵蓋 1～31 日', () => {
    assert.equal(YUNMU_DAYS.length, 31);
    YUNMU_DAYS.forEach((entry, i) => assert.equal(entry.day, i + 1));
  });

  it('1～15 日：常用字為上平聲第 N 韻，別用字為下平聲第 N 韻', () => {
    for (let day = 1; day <= 15; day++) {
      assert.equal(dayToYunmu(day), SHANG_PING[day - 1]);
      assert.equal(dayToYunmu(day, true), XIA_PING[day - 1]);
    }
  });

  it('16～29 日：取上聲或去聲的第 N 韻', () => {
    for (let day = 16; day <= 29; day++) {
      const char = dayToYunmu(day);
      const fromShang = SHANG_SHENG[day - 1];
      const fromQu = QU_SHENG[day - 1];
      assert.ok(char === fromShang || char === fromQu, `${day} 日的「${char}」應為「${fromShang}」或「${fromQu}」`);
    }
  });

  it('30、31 日', () => {
    assert.equal(dayToYunmu(30), '卅');
    assert.equal(dayToYunmu(30, true), '陷');
    assert.equal(QU_SHENG[29], '陷');
    assert.equal(dayToYunmu(31), '世');
    assert.equal(dayToYunmu(31, true), '引');
  });

  it('史例：以韻目字命名的事件與通電', () => {
    assert.equal(dayToYunmu(21), '馬'); // 馬日事變，1927 年 5 月 21 日
    assert.equal(dayToYunmu(12), '文'); // 文夕大火，1938 年 11 月 12 日夜
    assert.equal(dayToYunmu(29), '豔'); // 豔電，1938 年 12 月 29 日
    assert.equal(dayToYunmu(19), '皓'); // 皓電，1940 年 10 月 19 日
    assert.equal(dayToYunmu(9), '佳'); // 佳電，1940 年 11 月 9 日
    assert.equal(dayToYunmu(8), '齊'); // 齊電，1940 年 12 月 8 日
  });

  it('字 → 日，接受別用字與常見異體', () => {
    assert.equal(yunmuToDay('馬'), 21);
    assert.equal(yunmuToDay('先'), 1);
    assert.equal(yunmuToDay('艷'), 29);
    assert.equal(yunmuToDay('艳'), 29);
    assert.equal(yunmuToDay('删'), 15);
    assert.equal(yunmuToDay('号'), 20);
    assert.equal(yunmuToDay('陷'), 30);
    assert.equal(yunmuToDay('引'), 31);
    assert.equal(yunmuToDay('天'), undefined);
  });

  it('每個字只對應一個日', () => {
    const seen = new Map<string, number>();
    for (const entry of YUNMU_DAYS) {
      for (const char of [entry.primary, ...entry.alternates]) {
        assert.equal(seen.has(char), false, `「${char}」重複`);
        seen.set(char, entry.day);
        assert.equal(yunmuToDay(char), entry.day);
      }
    }
  });

  it('超出範圍丟出錯誤', () => {
    assert.throws(() => dayToYunmu(0), RangeError);
    assert.throws(() => dayToYunmu(32), RangeError);
    assert.throws(() => dayToYunmu(1.5), RangeError);
  });
});

describe('地支代月與電報落款', () => {
  it('子＝一月……亥＝十二月', () => {
    assert.equal(DIZHI_MONTHS.length, 12);
    assert.equal(monthToDizhi(1), '子');
    assert.equal(monthToDizhi(5), '辰');
    assert.equal(monthToDizhi(12), '亥');
    for (let m = 1; m <= 12; m++) assert.equal(dizhiToMonth(monthToDizhi(m)), m);
    assert.equal(dizhiToMonth('甲'), undefined);
    assert.throws(() => monthToDizhi(13), RangeError);
  });

  it('組合落款', () => {
    assert.equal(telegramDateCode(11, 21), '馬');
    assert.equal(telegramDateCode(5, 21, { withMonth: true }), '辰馬');
    assert.equal(telegramDateCode(1, 1, { alternate: true }), '先');
  });
});
