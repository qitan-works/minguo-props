import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  annotateTelegram,
  countWords,
  createCodebook,
  encodeTelegram,
  isHan,
  missingChars,
  substitutedChars,
} from '../src/lib/telegraph.ts';

interface TelegraphJson {
  unicodeVersion: string;
  field: string;
  count: number;
  sha256: string;
  variantCount: number;
  codes: Record<string, string>;
  variants: Record<string, string>;
}

const data = JSON.parse(
  readFileSync(new URL('../src/data/telegraph.json', import.meta.url), 'utf8'),
) as TelegraphJson;
const book = createCodebook(data.codes, data.variants);

describe('電碼資料檔', () => {
  it('來源與筆數', () => {
    assert.equal(data.field, 'kTaiwanTelegraph');
    assert.equal(data.unicodeVersion, '17.0.0');
    assert.match(data.sha256, /^[0-9a-f]{64}$/);
    assert.equal(Object.keys(data.codes).length, data.count);
    assert.equal(book.size, data.count);
    assert.ok(data.count > 9000);
  });

  it('異體字代查表：來源字沒有電碼、目標字有電碼', () => {
    assert.equal(Object.keys(data.variants).length, data.variantCount);
    for (const [from, to] of Object.entries(data.variants)) {
      assert.equal(from in data.codes, false, from);
      assert.equal(to in data.codes, true, to);
    }
  });

  it('電碼不重複（每個電碼只對應一個字）', () => {
    const seen = new Set<string>();
    for (const value of Object.values(data.codes)) {
      for (const code of value.split(' ')) {
        assert.equal(seen.has(code), false, `電碼 ${code} 重複`);
        seen.add(code);
      }
    }
  });
});

describe('電碼查詢', () => {
  it('常用字', () => {
    assert.deepEqual(book.lookup('一'), { codes: ['0001'] });
    assert.deepEqual(book.lookup('中'), { codes: ['0022'] });
    assert.deepEqual(book.lookup('馬'), { codes: ['7456'] });
    assert.deepEqual(book.lookup('電'), { codes: ['7193'] });
  });

  it('少數字有兩個電碼', () => {
    assert.deepEqual(book.lookup('塵'), { codes: ['1057', '7775'] });
  });

  it('電碼本收舊字形時，改用異體字代查並記下所用的字', () => {
    assert.equal(book.lookup('啟')?.via, '啓');
    assert.deepEqual(book.lookup('啟')?.codes, book.lookup('啓')?.codes);
    assert.equal(book.lookup('即')?.via, '卽');
    assert.equal(book.lookup('為')?.via, '爲');
    // 簡體字只有一個對應的繁體字有電碼時才代查；「发」對應「發」「髮」兩字，不代查。
    assert.equal(book.lookup('国')?.via, '國');
    assert.equal(book.lookup('发'), undefined);
  });

  it('查不到時回傳 undefined', () => {
    assert.equal(book.lookup('〇'), undefined);
    assert.equal(book.lookup('发'), undefined);
    assert.equal(book.lookup('a'), undefined);
  });

  it('相容表意字以 NFC 正規化後查詢', () => {
    // U+F900 豈（相容字）正規化為 U+8C48 豈。
    const compat = '\uF900';
    assert.notEqual(compat, compat.normalize('NFC'));
    assert.deepEqual(book.lookup(compat), book.lookup('\u8C48'));
  });

  it('拒絕格式錯誤的電碼表', () => {
    assert.throws(() => createCodebook({ 一: '1' }));
    assert.throws(() => createCodebook({ 一二: '0001' }));
    assert.throws(() => createCodebook({ 一: '0001' }, { 壹貳: '一' }));
  });

  it('代查目標沒有電碼時忽略', () => {
    const small = createCodebook({ 一: '0001' }, { 壹: '一', 弌: '乙' });
    assert.deepEqual(small.lookup('壹'), { codes: ['0001'], via: '一' });
    assert.equal(small.lookup('弌'), undefined);
  });
});

describe('電文標註', () => {
  it('略去標點與空白，標上電碼', () => {
    const cells = annotateTelegram('父病，速歸。', book);
    assert.deepEqual(
      cells.map((c) => c.char),
      ['父', '病', '速', '歸'],
    );
    assert.ok(cells.every((c) => c.kind === 'han'));
    assert.equal(countWords(cells), 4);
  });

  it('保留標點時，標點不編碼也不算缺字', () => {
    const cells = annotateTelegram('速歸。', book, { dropPunctuation: false });
    assert.deepEqual(
      cells.map((c) => c.kind),
      ['han', 'han', 'other'],
    );
    assert.deepEqual(missingChars(cells), []);
  });

  it('查不到的字標成 missing，並依出現順序不重複列出', () => {
    const cells = annotateTelegram('吉发发祥〇', book);
    assert.deepEqual(missingChars(cells), ['发', '〇']);
    assert.equal(cells[1]?.kind, 'missing');
  });

  it('非漢字（阿拉伯數字、拉丁字母）不編碼也不算缺字', () => {
    const cells = annotateTelegram('第3號A', book);
    assert.deepEqual(
      cells.map((c) => c.kind),
      ['han', 'other', 'han', 'other'],
    );
    assert.deepEqual(missingChars(cells), []);
  });

  it('忽略換行與異體字選擇符', () => {
    const cells = annotateTelegram('速\n歸\uFE00', book);
    assert.deepEqual(
      cells.map((c) => c.char),
      ['速', '歸'],
    );
  });

  it('列出改用異體字代查的字', () => {
    const cells = annotateTelegram('啟程即歸啟', book);
    assert.deepEqual(substitutedChars(cells), [
      ['啟', '啓'],
      ['即', '卽'],
    ]);
    assert.deepEqual(missingChars(cells), []);
  });

  it('轉成電碼串', () => {
    assert.equal(encodeTelegram(annotateTelegram('一中发', book)), '0001 0022 ????');
  });

  it('isHan', () => {
    assert.equal(isHan('漢'), true);
    assert.equal(isHan('𠮷'), true);
    assert.equal(isHan('a'), false);
    assert.equal(isHan('。'), false);
  });
});
