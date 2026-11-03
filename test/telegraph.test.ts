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
} from '../src/lib/telegraph.ts';

interface TelegraphJson {
  unicodeVersion: string;
  field: string;
  count: number;
  sha256: string;
  codes: Record<string, string>;
}

const data = JSON.parse(
  readFileSync(new URL('../src/data/telegraph.json', import.meta.url), 'utf8'),
) as TelegraphJson;
const book = createCodebook(data.codes);

describe('電碼資料檔', () => {
  it('來源與筆數', () => {
    assert.equal(data.field, 'kTaiwanTelegraph');
    assert.equal(data.unicodeVersion, '17.0.0');
    assert.match(data.sha256, /^[0-9a-f]{64}$/);
    assert.equal(Object.keys(data.codes).length, data.count);
    assert.equal(book.size, data.count);
    assert.ok(data.count > 9000);
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
    assert.deepEqual(book.lookup('一'), ['0001']);
    assert.deepEqual(book.lookup('中'), ['0022']);
    assert.deepEqual(book.lookup('馬'), ['7456']);
    assert.deepEqual(book.lookup('電'), ['7193']);
  });

  it('少數字有兩個電碼', () => {
    assert.deepEqual(book.lookup('塵'), ['1057', '7775']);
  });

  it('查不到時回傳 undefined', () => {
    assert.equal(book.lookup('𠮷'), undefined);
    assert.equal(book.lookup('a'), undefined);
  });

  it('相容表意字以 NFC 正規化後查詢', () => {
    // U+F900 豈（相容字）正規化為 U+8C48 豈。
    const compat = '豈';
    assert.notEqual(compat, compat.normalize('NFC'));
    assert.deepEqual(book.lookup(compat), book.lookup('豈'));
  });

  it('拒絕格式錯誤的電碼表', () => {
    assert.throws(() => createCodebook({ 一: '1' }));
    assert.throws(() => createCodebook({ 一二: '0001' }));
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
    const cells = annotateTelegram('吉𠮷𠮷祥〇', book);
    assert.deepEqual(missingChars(cells), ['𠮷', '〇']);
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
    const cells = annotateTelegram('速\n歸︀', book);
    assert.deepEqual(
      cells.map((c) => c.char),
      ['速', '歸'],
    );
  });

  it('轉成電碼串', () => {
    assert.equal(encodeTelegram(annotateTelegram('一中𠮷', book)), '0001 0022 ????');
  });

  it('isHan', () => {
    assert.equal(isHan('漢'), true);
    assert.equal(isHan('𠮷'), true);
    assert.equal(isHan('a'), false);
    assert.equal(isHan('。'), false);
  });
});
