import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { rewriteFontCss } from '../scripts/lib/fonts.ts';
import { scanTextChars } from '../scripts/lib/text-chars.ts';
import { woff2Coverage } from '../scripts/lib/woff2.ts';
import { ADS, NOTICES, SHORT_NEWS, VOCAB } from '../src/data/fillers.ts';
import { FONTS, fontStack, type FontsourceFont } from '../src/fonts.ts';
import { buildFillerPool } from '../src/lib/newspaper/fillers.ts';
import { defaultState } from '../src/state.ts';

const root = new URL('..', import.meta.url);
const read = (p: string): string => readFileSync(new URL(p, root), 'utf8');
const pkg = JSON.parse(read('package.json')) as { devDependencies: Record<string, string> };
const big5 = (JSON.parse(read('src/data/big5-level1.json')) as { chars: string[] }).chars.join('');
/** Fontsource 套件的字型（自行產生的字型見 test/generated-fonts.test.ts）。 */
const FONTSOURCE = FONTS.filter((f): f is FontsourceFont => f.source === 'fontsource');

/** 預設內容與填版素材（含程式產生的）用到的所有字。 */
function appChars(): Set<string> {
  let text = JSON.stringify(defaultState().props) + JSON.stringify([ADS, NOTICES, SHORT_NEWS, VOCAB]);
  for (const seed of [1, 2, 3, 19281105]) {
    const pool = buildFillerPool({ seed });
    text += JSON.stringify(pool.fillers) + JSON.stringify(pool.tiny);
  }
  return new Set([...text].filter((c) => /[\p{Script=Han}、-〿！-￯]/u.test(c)));
}

describe('字型清單與授權資料一致', () => {
  it('每套字型的版本與 package.json 的開發依賴相同', () => {
    for (const font of FONTSOURCE) assert.equal(pkg.devDependencies[font.pkg], font.version, font.pkg);
  });

  it('每套字型都附授權全文，且著作權聲明與授權檔一致', () => {
    for (const font of FONTSOURCE) {
      const path = `licenses/${font.licenseFiles.join()}`;
      assert.ok(existsSync(new URL(path, root)), path);
      const text = read(path);
      assert.ok(text.includes(font.copyright), `${path} 的著作權聲明不符`);
      assert.match(text, /SIL OPEN FONT LICENSE Version 1\.1/);
    }
  });

  it('THIRD_PARTY_NOTICES 與 README 都列出每套字型與版本', () => {
    const notices = read('THIRD_PARTY_NOTICES.md');
    const readme = read('README.md');
    for (const font of FONTSOURCE) {
      for (const [name, text] of [
        ['THIRD_PARTY_NOTICES.md', notices],
        ['README.md', readme],
      ] as const) {
        assert.ok(text.includes(`${font.pkg}`) && text.includes(font.version), `${name} 沒有列出 ${font.pkg}@${font.version}`);
        assert.ok(text.includes(font.licenseFiles.join()), `${name} 沒有連到 ${font.licenseFiles.join()}`);
      }
    }
  });

  it('字型編號不重複，字型堆疊含備援', () => {
    assert.equal(new Set(FONTS.map((f) => f.id)).size, FONTS.length);
    assert.equal(fontStack('iansui', 'body'), "'Iansui', var(--font-hand)");
    assert.equal(fontStack('cactus', 'title'), "'Cactus Classical Serif', var(--font-serif)");
    assert.equal(fontStack('nope', 'hand'), 'var(--font-hand)');
  });
});

describe('字型實際涵蓋的字（讀 woff2 的 cmap）', () => {
  const needed = appChars();

  it('pnpm fonts:generate 掃描原始碼得到的字，涵蓋實際產生的預設與填版文字', async () => {
    const scanned = new Set(await scanTextChars(fileURLToPath(root)));
    const missed = [...needed].filter((c) => !scanned.has(c));
    assert.deepEqual(missed, [], `掃描漏掉了程式產生的字：${missed.join('')}（請檢查 scripts/lib/text-chars.ts 的 TEXT_SOURCES）`);
  });

  for (const font of FONTSOURCE) {
    it(`${font.label}：SHA-256、Big5 常用字、預設與填版文字`, () => {
      const dir = new URL(`node_modules/${font.pkg}/`, root);
      const { files } = rewriteFontCss(readFileSync(new URL(font.css, dir), 'utf8'), font.dir);
      assert.equal(files.length, font.fileCount);
      const hash = createHash('sha256');
      const coverage = new Set<number>();
      for (const file of [...files].sort()) {
        const buf = readFileSync(new URL(`files/${file}`, dir));
        hash.update(buf);
        for (const cp of woff2Coverage(buf)) coverage.add(cp);
      }
      assert.equal(hash.digest('hex'), font.sha256, '字型檔的 SHA-256 與登記值不符');
      const missing = [...big5].filter((c) => !coverage.has(c.codePointAt(0) as number)).join('');
      assert.equal(missing, font.missingBig5, 'Big5 常用字的缺字與登記的不同');
      const missingApp = [...needed].filter((c) => !coverage.has(c.codePointAt(0) as number));
      assert.deepEqual(missingApp, [], `無法顯示預設或填版文字：${missingApp.join('')}`);
    });
  }
});
