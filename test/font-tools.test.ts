// 字型處理工具的單元測試：tar 讀取器、SFNT 組裝、WOFF 1.0 編解碼、文字掃描、分片。
// 用到已提交字型（fonts/）的測試在 test/generated-fonts.test.ts。

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { gzipSync } from 'node:zlib';

import { firstSlice, parseUnicodeRange, restSlices, unicodeRanges, VERTICAL_FORMS } from '../scripts/lib/font-slices.ts';
import { buildName, buildSfnt, parseName, readSfnt, sfntTable, tableChecksum, windowsNameRecord } from '../scripts/lib/sfnt.ts';
import { extractTarFile, readTar, readTarGz } from '../scripts/lib/tar.ts';
import { scanTextChars, tsStringContents } from '../scripts/lib/text-chars.ts';
import { assertWellFormedSfnt, decodeWoff, encodeWoff } from '../scripts/lib/woff.ts';

// ---------- tar ----------

function tarHeader(name: string, size: number, type: string): Buffer {
  const h = Buffer.alloc(512);
  h.write(name, 0, 100, 'utf8');
  h.write('0000644\0', 100);
  h.write('0000000\0', 108);
  h.write('0000000\0', 116);
  h.write(`${size.toString(8).padStart(11, '0')}\0`, 124);
  h.write('14753022105\0', 136);
  h.fill(0x20, 148, 156);
  h.write(type, 156);
  h.write('ustar\0', 257);
  h.write('00', 263);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
  return h;
}

function tarEntry(name: string, data: Buffer, type = '0'): Buffer {
  const padded = Buffer.alloc(Math.ceil(data.length / 512) * 512);
  data.copy(padded);
  return Buffer.concat([tarHeader(name, data.length, type), padded]);
}

function paxRecord(key: string, value: string): string {
  const body = ` ${key}=${value}\n`;
  let length = body.length + 1;
  while (String(length).length + Buffer.byteLength(body) !== length) length = String(length).length + Buffer.byteLength(body);
  return `${length}${body}`;
}

describe('tar 讀取器', () => {
  const longName = `wangfonts/${'很長的目錄名稱/'.repeat(10)}字型.ttf`;
  const tar = Buffer.concat([
    tarEntry('wangfonts/', Buffer.alloc(0), '5'),
    tarEntry('wangfonts/a.ttf', Buffer.from('字型資料')),
    tarEntry('././@LongLink', Buffer.from(`${longName}\0`), 'L'),
    tarEntry(longName.slice(0, 99), Buffer.from('long')),
    tarEntry('PaxHeader/x', Buffer.from(paxRecord('path', 'wangfonts/pax-名稱.ttf')), 'x'),
    tarEntry('wangfonts/pax.ttf', Buffer.from('pax')),
    Buffer.alloc(1024),
  ]);

  it('讀出一般檔案、目錄、GNU 長檔名與 pax 路徑', () => {
    const entries = readTarGz(gzipSync(tar));
    assert.deepEqual(
      entries.map((e) => [e.name, e.type, e.size]),
      [
        ['wangfonts/', '5', 0],
        ['wangfonts/a.ttf', '0', 12],
        [longName, '0', 4],
        ['wangfonts/pax-名稱.ttf', '0', 3],
      ],
    );
    assert.equal(extractTarFile(entries, 'wangfonts/a.ttf').toString('utf8'), '字型資料');
    assert.equal(entries[1]?.mtime, 0o14753022105);
  });

  it('檢查碼錯誤或檔案截斷就丟出錯誤；找不到檔案也丟出錯誤', () => {
    const bad = Buffer.from(tar);
    bad[520] = 0x41; // 改到第二個標頭（a.ttf）的檔名
    assert.throws(() => readTar(bad), /檢查碼不符/);
    assert.throws(() => readTar(tar.subarray(0, 1030)), /超出檔案範圍/);
    assert.throws(() => extractTarFile(readTar(tar), 'wangfonts/none.ttf'), /找不到/);
  });
});

// ---------- SFNT 與 WOFF 1.0 ----------

/** 組一個最小的 SFNT：head、name，以及一個無法壓縮的表（測試「壓縮沒變小就不壓縮」）。 */
function tinyFont(): Buffer {
  const head = Buffer.alloc(54);
  head.writeUInt32BE(0x00010000, 0);
  head.writeUInt32BE(0x00025001, 4); // fontRevision 2.3125…
  head.writeUInt32BE(0x5f0f3cf5, 12);
  head.writeUInt16BE(1000, 18);
  const name = buildName([windowsNameRecord(0x409, 0, 'Copyright test'), windowsNameRecord(0x404, 1, '測試字型')]);
  let x = 12345;
  const noise = Buffer.alloc(301);
  for (let i = 0; i < noise.length; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    noise[i] = x >>> 24;
  }
  const zeros = Buffer.alloc(4000);
  return buildSfnt(0x00010000, [
    { tag: 'name', data: name },
    { tag: 'head', data: head },
    { tag: 'zero', data: zeros },
    { tag: 'rand', data: noise },
  ]);
}

describe('SFNT 組裝與 name 表', () => {
  it('表目錄依標籤排序、檢查碼與 checkSumAdjustment 正確（WOFF 編碼器的格式檢查會通過）', () => {
    const font = tinyFont();
    assert.doesNotThrow(() => assertWellFormedSfnt(font));
    const sfnt = readSfnt(font);
    assert.deepEqual(
      sfnt.tables.map((t) => t.tag),
      ['head', 'name', 'rand', 'zero'],
    );
    assert.equal(tableChecksum(font), 0xb1b0afba, '整個字型的檢查碼應為 0xB1B0AFBA');
    const names = parseName(sfntTable(sfnt, 'name') as Buffer);
    assert.deepEqual(
      names.map((r) => [r.languageID, r.nameID, r.value]),
      [
        [0x404, 1, '測試字型'],
        [0x409, 0, 'Copyright test'],
      ],
    );
  });

  it('格式不良的 SFNT 會被拒絕', () => {
    const font = tinyFont();
    const badChecksum = Buffer.from(font);
    badChecksum.writeUInt32BE(1, 12 + 16 + 4); // 第二個表（name）的檢查碼（也會讓整體檢查碼不符）
    assert.throws(() => assertWellFormedSfnt(badChecksum), /不正確/);
    const trailing = Buffer.concat([font, Buffer.alloc(4)]);
    assert.throws(() => assertWellFormedSfnt(trailing), /多餘的資料/);
  });
});

describe('WOFF 1.0 編解碼', () => {
  it('編碼後解回來與原檔逐位元組相同；沒變小的表不壓縮；沒有中繼資料', () => {
    const font = tinyFont();
    const woff = encodeWoff(font);
    assert.equal(woff.readUInt32BE(0), 0x774f4646);
    assert.equal(woff.length % 4, 0);
    const d = decodeWoff(woff);
    assert.equal(Buffer.compare(d.sfnt, font), 0);
    assert.equal(d.metaLength, 0);
    assert.equal(d.privLength, 0);
    assert.deepEqual([d.majorVersion, d.minorVersion], [2, 0x5001]);
    const compressed = Object.fromEntries(d.tables.map((t) => [t.tag, t.compressed]));
    assert.equal(compressed['rand'], false, '壓縮後沒有變小的表應原樣存放');
    assert.equal(compressed['zero'], true);
    assert.equal(Buffer.compare(encodeWoff(font), woff), 0, '編碼應是決定性的');
  });

  it('結構錯誤的 WOFF 會被拒絕', () => {
    const woff = encodeWoff(tinyFont());
    const badLength = Buffer.from(woff);
    badLength.writeUInt32BE(woff.length + 4, 8);
    assert.throws(() => decodeWoff(badLength), /length/);
    const withMeta = Buffer.from(woff);
    withMeta.writeUInt32BE(woff.length, 24);
    assert.throws(() => decodeWoff(withMeta), /中繼資料/);
    assert.throws(() => decodeWoff(Buffer.concat([woff, Buffer.alloc(8)])), /length/);
  });
});

// ---------- 文字掃描 ----------

describe('掃描預設與填版文字', () => {
  it('只取字串與樣板字串，略過註解與正規表示式', () => {
    const source = [
      '// 註解：甲',
      '/* 多行註解：乙 */',
      "const a = '丙'; const b = \"丁\\\"戊\";",
      'const re = /[己]\\/庚/g; const c = 1 / 2 / 3;',
      'const t = `辛${ "壬" + `癸${x}子` }丑`;',
      'if (ok) { const d = { k: `寅` }; }',
      'return /卯/.test(s);',
    ].join('\n');
    const parts = tsStringContents(source).join('|');
    for (const c of '丙丁戊辛壬癸子丑寅') assert.ok(parts.includes(c), `應該取到「${c}」`);
    for (const c of '甲乙己庚卯') assert.ok(!parts.includes(c), `不應取到「${c}」`);
  });

  it('掃描目錄（含子目錄）與 HTML，\\u 跳脫序列換成實際的字，依碼位排序', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'minguo-scan-'));
    try {
      mkdirSync(path.join(dir, 'src', 'lib', 'deep'), { recursive: true });
      writeFileSync(path.join(dir, 'src', 'lib', 'a.ts'), "// 註解\nexport const A = '報紙\\u3000';\n");
      writeFileSync(path.join(dir, 'src', 'lib', 'deep', 'b.ts'), 'export const B = `號外`;\n');
      writeFileSync(path.join(dir, 'src', 'index.html'), '<!-- 不算 --><p title="標題">內文</p>\n');
      const chars = await scanTextChars(dir, ['src/index.html', 'src/lib']);
      const expected = [...new Set('報紙　號外標題內文')].sort((a, b) => (a.codePointAt(0) as number) - (b.codePointAt(0) as number));
      assert.deepEqual(chars, expected);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------- 分片 ----------

describe('分片與 unicode-range', () => {
  const covered = new Set([0x20, 0x41, 0x3001, 0xfe11, 0x300c, 0xfe41, 0x4e00, 0x4e01, 0x4e03, 0x4e08, 0x4e09, 0x4e0a, 0x4e0b, 0x4e0d, 0xff0c, 0xfe10]);

  it('第 0 片含指定的字與它們的直排形式', () => {
    assert.deepEqual(firstSlice(covered, new Set([0x41, 0x3001, 0x4e00, 0x9999])), [0x41, 0x3001, 0x4e00, 0xfe11]);
  });

  it('其餘的字依大小平均分片，直排形式跟著橫排標點走', () => {
    const taken = new Set(firstSlice(covered, new Set([0x41, 0x3001, 0x4e00])));
    const slices = restSlices({ covered, taken, weight: () => 100, budget: 300 });
    assert.equal(slices.length, 4); // 總量 1200（直排形式算在它的橫排標點裡）÷ 每片 300
    const flat = slices.flat().sort((a, b) => a - b);
    assert.deepEqual(flat, [...covered].filter((cp) => !taken.has(cp)).sort((a, b) => a - b));
    for (const [h, v] of VERTICAL_FORMS) {
      if (!covered.has(h) || taken.has(h)) continue;
      assert.ok(slices.some((s) => s.includes(h) && s.includes(v)), `U+${v.toString(16)} 應與 U+${h.toString(16)} 同片`);
    }
  });

  it('unicode-range 只跨過沒有人要求的碼位，彼此不重疊', () => {
    const slices = [
      [0x41, 0x43, 0x4e00],
      [0x4e01, 0x4e05],
    ];
    // 0x42 有人要求但不在任何分片 → 打斷範圍；0x44～0x4dff、0x4e02～0x4e04 沒人要求 → 可以跨過
    const known = new Set([0x41, 0x42, 0x43, 0x4e00, 0x4e01, 0x4e05]);
    assert.deepEqual(unicodeRanges(slices, known), ['U+41,U+43-4e00', 'U+4e01-4e05']);
    assert.throws(() => unicodeRanges([[1], [1]], new Set()), /同時在兩個分片/);
    assert.deepEqual(parseUnicodeRange('U+41,U+4e01-4e05'), [
      [0x41, 0x41],
      [0x4e01, 0x4e05],
    ]);
    assert.throws(() => parseUnicodeRange('U+4e05-4e01'), /顛倒/);
    assert.throws(() => parseUnicodeRange('4e01'), /格式錯誤/);
  });
});
