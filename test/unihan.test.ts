import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { crc32, deflateRawSync } from 'node:zlib';

import {
  buildTelegraphData,
  buildVariantFallback,
  parseTaiwanTelegraph,
  parseUnihanField,
  parseUnihanVariants,
  serializeTelegraphData,
} from '../scripts/lib/unihan.ts';
import { extractZipFile, listZipEntries } from '../scripts/lib/zip.ts';

/** 在測試裡組一個最小的 ZIP 檔（每個檔案可選擇不壓縮或 deflate）。 */
function makeZip(files: { name: string; content: string; method: 0 | 8 }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const raw = Buffer.from(file.content, 'utf8');
    const data = file.method === 8 ? deflateRawSync(raw) : raw;
    const crc = crc32(raw) >>> 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(file.method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(file.method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + data.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

const SAMPLE = [
  '# Unihan_OtherMappings.txt',
  '# Unicode Version 17.0.0',
  '',
  'U+4E00\tkTaiwanTelegraph\t0001',
  'U+4E00\tkBigFive\tA440',
  'U+4E2D\tkTaiwanTelegraph\t0022',
  'U+4E01\tkTaiwanTelegraph\t0002',
  'U+5875\tkTaiwanTelegraph\t1057 7775',
  'U+20000\tkTaiwanTelegraph\t9999',
  '',
].join('\n');

describe('ZIP 讀取（node:zlib）', () => {
  it('讀出 deflate 與不壓縮的檔案', () => {
    const zip = makeZip([
      { name: 'ReadMe.txt', content: 'hello', method: 0 },
      { name: 'Unihan_OtherMappings.txt', content: SAMPLE, method: 8 },
    ]);
    assert.deepEqual(
      listZipEntries(zip).map((e) => e.name),
      ['ReadMe.txt', 'Unihan_OtherMappings.txt'],
    );
    assert.equal(extractZipFile(zip, 'ReadMe.txt').toString('utf8'), 'hello');
    assert.equal(extractZipFile(zip, 'Unihan_OtherMappings.txt').toString('utf8'), SAMPLE);
  });

  it('找不到檔案或不是 ZIP 時丟出錯誤', () => {
    const zip = makeZip([{ name: 'a.txt', content: 'a', method: 8 }]);
    assert.throws(() => extractZipFile(zip, 'b.txt'), /找不到/);
    assert.throws(() => listZipEntries(Buffer.from('not a zip at all, definitely not')), /EOCD/);
  });

  it('內容遭竄改時 CRC-32 驗證失敗', () => {
    const zip = makeZip([{ name: 'a.txt', content: 'abcdef', method: 0 }]);
    const i = zip.indexOf('abcdef');
    zip[i] = 'x'.charCodeAt(0);
    assert.throws(() => extractZipFile(zip, 'a.txt'), /CRC-32/);
  });
});

describe('Unihan 欄位解析', () => {
  it('只取指定欄位', () => {
    const entries = parseUnihanField(SAMPLE, 'kBigFive');
    assert.deepEqual(entries, [{ codePoint: 0x4e00, char: '一', value: 'A440' }]);
  });

  it('kTaiwanTelegraph：含多碼與擴充區的字', () => {
    const entries = parseTaiwanTelegraph(SAMPLE);
    assert.equal(entries.length, 5);
    assert.equal(entries.find((e) => e.char === '塵')?.value, '1057 7775');
    assert.equal(entries.find((e) => e.codePoint === 0x20000)?.char, '𠀀');
  });

  it('格式錯誤時丟出錯誤', () => {
    assert.throws(() => parseTaiwanTelegraph('U+4E00\tkTaiwanTelegraph\t12'), /格式不符/);
    assert.throws(() => parseTaiwanTelegraph('garbage line'), /格式不符/);
    assert.throws(
      () => parseTaiwanTelegraph('U+4E00\tkTaiwanTelegraph\t0001\nU+4E00\tkTaiwanTelegraph\t0002'),
      /重複/,
    );
  });

  it('產生的 JSON 依電碼排序、可解析', () => {
    const data = buildTelegraphData(parseTaiwanTelegraph(SAMPLE), { 弌: '一' }, {
      unicodeVersion: '17.0.0',
      source: 'test',
      sha256: '0'.repeat(64),
    });
    assert.deepEqual(Object.keys(data.codes), ['一', '丁', '中', '塵', '𠀀']);
    assert.equal(data.count, 5);
    assert.equal(data.variantCount, 1);
    const text = serializeTelegraphData(data);
    assert.ok(text.endsWith('\n'));
    assert.deepEqual(JSON.parse(text), data);
  });
  it('代查表不得包含本身已有電碼的字，或目標沒有電碼', () => {
    const entries = parseTaiwanTelegraph(SAMPLE);
    const meta = { unicodeVersion: '17.0.0', source: 'test', sha256: '0'.repeat(64) };
    assert.throws(() => buildTelegraphData(entries, { 一: '丁' }, meta), /本身已有電碼/);
    assert.throws(() => buildTelegraphData(entries, { 弌: '乙' }, meta), /沒有電碼/);
  });
});

describe('異體字代查表', () => {
  const VARIANTS = [
    'U+5373\tkSemanticVariant\tU+537D<kLau,kMatthews', // 即 → 卽
    'U+555F\tkSemanticVariant\tU+5553<kLau,kMatthews', // 啟 → 啓
    'U+555F\tkSpoofingVariant\tU+5553',
    'U+5553\tkSemanticVariant\tU+555F<kLau', // 啓 本身有電碼，不需代查
    'U+56FD\tkTraditionalVariant\tU+570B', // 国 → 國
    'U+53D1\tkTraditionalVariant\tU+53D1 U+767C U+9AEE', // 发 → 發／髮，兩個都有電碼，不代查
    'U+88E1\tkSpecializedSemanticVariant\tU+88CF<kMeyerWempe', // 不採用
    'U+6237\tkZVariant\tU+6236 U+6238', // 户 → 第一個有電碼的 Z 異體字
  ].join('\n');
  const TELEGRAPH = [
    'U+537D\tkTaiwanTelegraph\t0794',
    'U+5553\tkTaiwanTelegraph\t0796',
    'U+570B\tkTaiwanTelegraph\t0948',
    'U+767C\tkTaiwanTelegraph\t4099',
    'U+9AEE\tkTaiwanTelegraph\t7915',
    'U+88CF\tkTaiwanTelegraph\t5937',
    'U+6238\tkTaiwanTelegraph\t2073',
  ].join('\n');

  it('解析異體字欄位（含來源標註）', () => {
    const map = parseUnihanVariants(VARIANTS);
    assert.deepEqual(map.get(0x5373), { kSemanticVariant: [0x537d] });
    assert.deepEqual(map.get(0x53d1), { kTraditionalVariant: [0x53d1, 0x767c, 0x9aee] });
    assert.equal(map.has(0x88e1), false);
  });

  it('依規則挑選代查字', () => {
    const fallback = buildVariantFallback(parseTaiwanTelegraph(TELEGRAPH), parseUnihanVariants(VARIANTS));
    assert.deepEqual(fallback, { 即: '卽', 啟: '啓', 国: '國', 户: '戸' });
  });
});
