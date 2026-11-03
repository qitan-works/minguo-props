import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { crc32, deflateRawSync } from 'node:zlib';

import { buildTelegraphData, parseTaiwanTelegraph, parseUnihanField, serializeTelegraphData } from '../scripts/lib/unihan.ts';
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
    const data = buildTelegraphData(parseTaiwanTelegraph(SAMPLE), {
      unicodeVersion: '17.0.0',
      source: 'test',
      sha256: '0'.repeat(64),
    });
    assert.deepEqual(Object.keys(data.codes), ['一', '丁', '中', '塵', '𠀀']);
    assert.equal(data.count, 5);
    const text = serializeTelegraphData(data);
    assert.ok(text.endsWith('\n'));
    assert.deepEqual(JSON.parse(text), data);
  });
});
