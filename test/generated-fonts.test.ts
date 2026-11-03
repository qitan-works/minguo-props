// 自行產生、提交在 fonts/ 的字型：檔案與 fonts/manifest.json、src/fonts.ts 一致，
// 收字正確（Big5 常用字、預設與填版文字），分片的 unicode-range 不重疊，授權與著作權聲明齊全，
// 辰宇落雁體與原檔逐位元組相同，HarfBuzz 子集化與 WOFF2 壓縮是決定性的。

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { compress, decompress } from 'woff2-encoder';

import type { FontManifest, ManifestFont, ManifestTable } from '../scripts/lib/font-manifest.ts';
import { inRanges, parseUnicodeRange, VERTICAL_FORMS } from '../scripts/lib/font-slices.ts';
import { RECIPES } from '../scripts/lib/font-sources.ts';
import { subsetFont } from '../scripts/lib/hb-subset.ts';
import { parseName, readSfnt, sfntTable } from '../scripts/lib/sfnt.ts';
import { scanTextChars } from '../scripts/lib/text-chars.ts';
import { decodeWoff } from '../scripts/lib/woff.ts';
import { parseCmap, woff2Coverage, woff2Table } from '../scripts/lib/woff2.ts';
import { FONTS, type GeneratedFont } from '../src/fonts.ts';

const root = new URL('..', import.meta.url);
const read = (p: string): string => readFileSync(new URL(p, root), 'utf8');
const sha256 = (buf: Buffer): string => createHash('sha256').update(buf).digest('hex');
const manifest = JSON.parse(read('fonts/manifest.json')) as FontManifest;
const big5 = (JSON.parse(read('src/data/big5-level1.json')) as { chars: string[] }).chars.join('');
const GENERATED = FONTS.filter((f): f is GeneratedFont => f.source === 'generated');
/** 辰宇落雁體上游 license.txt（commit 6e36815）的 SHA-256：licenses/OFL-Chenyuluoyan.txt 必須原樣照錄。 */
const CHENYU_LICENSE_SHA256 = '393732512d2658fa5841dfaad325e002ccb6755b9037a818500434c0a5c4a6d1';

function entryOf(font: GeneratedFont): ManifestFont {
  const entry = manifest.fonts.find((f) => f.id === font.id);
  assert.ok(entry, `fonts/manifest.json 沒有 ${font.id}，請執行 pnpm fonts:generate`);
  return entry;
}

function fileOf(font: GeneratedFont, file: string): Buffer {
  return readFileSync(new URL(`fonts/${font.id}/${file}`, root));
}

/** 字型檔的 name 表（WOFF2 的 name 表不經轉換，可直接取出；WOFF 1.0 先解碼）。 */
function nameRecords(font: GeneratedFont, file: string): ReturnType<typeof parseName> {
  const buf = fileOf(font, file);
  const name = font.format === 'woff2' ? woff2Table(buf, 'name') : sfntTable(readSfnt(decodeWoff(buf).sfnt), 'name');
  assert.ok(name, `${file} 沒有 name 表`);
  return parseName(name);
}

describe('自行產生的字型：清單、manifest 與檔案一致', () => {
  it('src/fonts.ts、scripts/lib/font-sources.ts 與 fonts/manifest.json 列出同一批字型', () => {
    assert.deepEqual(
      GENERATED.map((f) => f.id),
      RECIPES.map((r) => r.id),
    );
    assert.deepEqual(
      manifest.fonts.map((f) => f.id),
      RECIPES.map((r) => r.id),
    );
    assert.equal(new Set(FONTS.map((f) => f.family)).size, FONTS.length, 'CSS 字型家族名稱重複');
    for (const font of GENERATED) {
      assert.equal(font.dir, font.id, `${font.id} 的輸出目錄應與 id 相同`);
      const recipe = RECIPES.find((r) => r.id === font.id);
      assert.equal(font.modified, recipe?.mode === 'subset', `${font.id} 的 modified 與產生方式不符`);
      assert.equal(font.format, recipe?.mode === 'subset' ? 'woff2' : 'woff');
      if (font.commit) assert.ok(recipe?.source.url.includes(font.commit), `${font.id} 的下載網址不是登記的 commit`);
    }
  });

  for (const font of GENERATED) {
    it(`${font.label}：檔案大小、SHA-256、數量與登記值相同`, () => {
      const entry = entryOf(font);
      assert.equal(entry.format, font.format);
      assert.equal(entry.files.length, font.fileCount, '檔案數與 src/fonts.ts 不符');
      const hash = createHash('sha256');
      for (const f of [...entry.files].sort((a, b) => (a.file < b.file ? -1 : 1))) {
        const buf = fileOf(font, f.file);
        assert.equal(buf.length, f.bytes, `${f.file} 的大小與 manifest 不符`);
        assert.equal(sha256(buf), f.sha256, `${f.file} 的 SHA-256 與 manifest 不符`);
        hash.update(buf);
      }
      const digest = hash.digest('hex');
      assert.equal(digest, entry.sha256, 'manifest 的整體 SHA-256 不符');
      assert.equal(digest, font.sha256, 'src/fonts.ts 的 SHA-256 不符（請執行 pnpm fonts:generate 後更新）');
    });
  }
});

describe('自行產生的字型：收字（讀字型檔的 cmap）', () => {
  const scanned = scanTextChars(fileURLToPath(root));

  for (const font of GENERATED) {
    it(`${font.label}：Big5 常用字、預設與填版文字、分片範圍`, async () => {
      const entry = entryOf(font);
      const coverage = new Set<number>();
      const owner = new Map<number, string>();
      const ranges = new Map<string, [number, number][]>();
      for (const f of entry.files) {
        const buf = fileOf(font, f.file);
        const cps = font.format === 'woff2' ? woff2Coverage(buf) : parseCmap(sfntTable(readSfnt(decodeWoff(buf).sfnt), 'cmap') as Buffer);
        assert.equal(cps.size, f.codepoints, `${f.file} 的碼位數與 manifest 不符`);
        if (f.unicodeRange !== null) {
          const r = parseUnicodeRange(f.unicodeRange);
          ranges.set(f.file, r);
          for (const cp of cps) assert.ok(inRanges(r, cp), `${f.file} 收了 U+${cp.toString(16)}，但不在它的 unicode-range 裡`);
        }
        for (const cp of cps) {
          assert.ok(!owner.has(cp), `U+${cp.toString(16)} 同時在 ${owner.get(cp)} 與 ${f.file}`);
          owner.set(cp, f.file);
          coverage.add(cp);
        }
      }
      // unicode-range 彼此不重疊
      const all = [...ranges.entries()].flatMap(([file, rs]) => rs.map(([a, b]) => ({ file, a, b }))).sort((x, y) => x.a - y.a);
      for (let i = 1; i < all.length; i++) {
        const prev = all[i - 1] as { file: string; b: number };
        const cur = all[i] as { file: string; a: number };
        assert.ok(cur.a > prev.b, `${prev.file} 與 ${cur.file} 的 unicode-range 重疊（U+${cur.a.toString(16)}）`);
      }
      // 直排形式與對應的橫排標點在同一片（字型沒有 vert 功能時 HarfBuzz 才換得到）
      for (const [h, v] of VERTICAL_FORMS) {
        if (owner.has(h) && owner.has(v)) assert.equal(owner.get(v), owner.get(h), `U+${v.toString(16)} 應與 U+${h.toString(16)} 在同一片`);
      }
      // 沒有直排形式的字型，HarfBuzz 能換成直排形式的標點交給備援字型（見 font-sources.ts 的 verticalPunctuation）
      if (RECIPES.find((r) => r.id === font.id)?.verticalPunctuation === 'fallback') {
        for (const [h, v] of VERTICAL_FORMS) {
          if (!coverage.has(v)) assert.ok(!coverage.has(h), `${font.label} 不應收「${String.fromCodePoint(h)}」（直排時交給備援字型）`);
        }
      }

      const missingBig5 = [...big5].filter((c) => !coverage.has(c.codePointAt(0) as number)).join('');
      assert.equal(missingBig5, font.missingBig5, 'Big5 常用字的缺字與 src/fonts.ts 登記的不同');
      assert.equal(entry.missingBig5, font.missingBig5);
      assert.equal(entry.missingText, font.missingText, '原字型缺的預設與填版文字與 src/fonts.ts 登記的不同');

      const known = new Set(font.missingText);
      const missingText = (await scanned).filter((c) => !coverage.has(c.codePointAt(0) as number) && !known.has(c));
      assert.deepEqual(
        missingText,
        [],
        `${font.label} 沒有收「${missingText.join('')}」：預設或填版文字用到了字型裡沒有的字，請執行 pnpm fonts:generate 重新產生字型` +
          '（若原字型本來就沒有這些字，請登記在 src/fonts.ts 的 missingText）。',
      );
      // 第 0 片（預設與填版文字）
      if (font.format === 'woff2') {
        const first = entry.files[0];
        assert.ok(first);
        const firstSet = new Set([...owner].filter(([, file]) => file === first.file).map(([cp]) => cp));
        for (const c of manifest.textChars) {
          const cp = c.codePointAt(0) as number;
          if (coverage.has(cp)) assert.ok(firstSet.has(cp), `預設與填版文字的「${c}」應在第 0 片`);
        }
      }
    });
  }
});

describe('自行產生的字型：授權與著作權聲明', () => {
  const notices = read('THIRD_PARTY_NOTICES.md');
  const readme = read('README.md');

  it('GPL-2.0 全文與辰宇落雁體的授權原文都在 licenses/', () => {
    const gpl = read('licenses/GPL-2.0.txt');
    assert.ok(gpl.startsWith('GNU GENERAL PUBLIC LICENSE\nVersion 2, June 1991'), 'licenses/GPL-2.0.txt 不是 GPL 第 2 版全文');
    for (const part of ['TERMS AND CONDITIONS FOR COPYING, DISTRIBUTION AND MODIFICATION', 'NO WARRANTY', 'END OF TERMS AND CONDITIONS']) {
      assert.ok(gpl.includes(part), `licenses/GPL-2.0.txt 缺少「${part}」`);
    }
    assert.equal(sha256(readFileSync(new URL('licenses/OFL-Chenyuluoyan.txt', root))), CHENYU_LICENSE_SHA256, '辰宇落雁體的 license.txt 必須原樣照錄');
  });

  for (const font of GENERATED) {
    it(`${font.label}：授權檔、字型內的聲明、THIRD_PARTY_NOTICES 與 README`, () => {
      for (const file of font.licenseFiles) {
        assert.ok(existsSync(new URL(`licenses/${file}`, root)), `licenses/${file} 不存在`);
        const text = read(`licenses/${file}`);
        if (font.license === 'OFL-1.1') assert.match(text, /SIL OPEN FONT LICENSE Version 1\.1/);
        else assert.match(text, /GNU GENERAL PUBLIC LICENSE\nVersion 2, June 1991/);
        if (font.id.startsWith('jason-')) assert.ok(text.includes(font.copyright), `${file} 沒有照錄字型內的聲明`);
      }
      const entry = entryOf(font);
      for (const f of entry.files) {
        const records = nameRecords(font, f.file);
        const values = (id: number): string[] => records.filter((r) => r.nameID === id && r.value !== null).map((r) => r.value as string);
        assert.ok(values(0).includes(font.copyright), `${f.file} 的 name 表沒有著作權聲明「${font.copyright}」`);
        if (font.license === 'GPL-2.0-or-later') {
          assert.ok(values(13).some((v) => v.includes('GNU General Public License')), `${f.file} 的 name 表沒有 GPL 授權聲明`);
        }
        const modified = values(10).some((v) => v.includes('Modified by minguo-props'));
        assert.equal(modified, font.modified, font.modified ? `${f.file} 沒有修改聲明` : `${f.file} 不應有修改聲明`);
      }
      for (const [name, text] of [
        ['THIRD_PARTY_NOTICES.md', notices],
        ['README.md', readme],
      ] as const) {
        assert.ok(text.includes(font.label), `${name} 沒有列出 ${font.label}`);
        for (const file of font.licenseFiles) assert.ok(text.includes(file), `${name} 沒有連到 ${file}`);
      }
      assert.ok(notices.includes(entry.source.sha256), `THIRD_PARTY_NOTICES.md 沒有 ${font.label} 原始檔的 SHA-256`);
      assert.ok(notices.includes(font.upstream), `THIRD_PARTY_NOTICES.md 沒有 ${font.label} 的上游網址`);
      if (font.commit) assert.ok(notices.includes(font.commit), `THIRD_PARTY_NOTICES.md 沒有 ${font.label} 的 commit`);
    });
  }
});

describe('自行產生的字型：原封不動與決定性', () => {
  it('辰宇落雁體：WOFF 解回來，每個表都與原字型相同，整個檔與原檔的 SHA-256 相同', () => {
    const entry = manifest.fonts.find((f) => f.format === 'woff');
    const recipe = RECIPES.find((r) => r.mode === 'woff');
    assert.ok(entry?.tables && recipe);
    const file = entry.files[0];
    assert.ok(file && entry.files.length === 1);
    const d = decodeWoff(readFileSync(new URL(`fonts/${entry.id}/${file.file}`, root)));
    assert.equal(d.metaLength, 0, '不得有 WOFF 中繼資料');
    assert.equal(d.privLength, 0, '不得有 WOFF 私有資料');
    assert.deepEqual(
      d.tables.map((t) => t.tag),
      entry.tables.map((t) => t.tag),
    );
    for (const [i, t] of d.tables.entries()) {
      const want: ManifestTable | undefined = entry.tables[i];
      assert.ok(want);
      assert.equal(t.data.length, want.length, `${t.tag} 的長度不同`);
      assert.equal(t.origChecksum.toString(16).padStart(8, '0'), want.checksum, `${t.tag} 的檢查碼不同`);
      assert.equal(sha256(t.data), want.sha256, `${t.tag} 的內容與原字型不同`);
    }
    // 原字型格式良好，依 WOFF 規格解回來的 SFNT 必須與原檔逐位元組相同
    assert.equal(d.sfnt.length, recipe.source.bytes);
    assert.equal(sha256(d.sfnt), recipe.source.sha256, '解回來的字型與原字型檔不同');
    assert.equal(entry.source.fontSha256, recipe.source.sha256);
  });

  it('HarfBuzz 子集化（hb-subset.wasm）收字正確、保留 name 表；子集化與 WOFF2 壓縮都是決定性的', async () => {
    const entry = manifest.fonts.find((f) => f.format === 'woff2');
    const file = entry?.files[1];
    assert.ok(entry && file);
    const ttf = Buffer.from(await decompress(readFileSync(new URL(`fonts/${entry.id}/${file.file}`, root))));
    const wanted = [...parseCmap(sfntTable(readSfnt(ttf), 'cmap') as Buffer)].slice(0, 40);
    const a = await subsetFont(ttf, wanted);
    const b = await subsetFont(ttf, wanted);
    assert.equal(Buffer.compare(a, b), 0, '子集化應是決定性的');
    assert.deepEqual(
      [...parseCmap(sfntTable(readSfnt(a), 'cmap') as Buffer)].sort((x, y) => x - y),
      wanted.sort((x, y) => x - y),
    );
    assert.deepEqual(parseName(sfntTable(readSfnt(a), 'name') as Buffer), parseName(sfntTable(readSfnt(ttf), 'name') as Buffer));
    const wa = Buffer.from(await compress(a));
    const wb = Buffer.from(await compress(b));
    assert.equal(Buffer.compare(wa, wb), 0, 'WOFF2 壓縮應是決定性的');
    assert.equal(woff2Coverage(wa).size, wanted.length);
  });
});
