import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { generatedFontCss, rewriteFontCss } from '../scripts/lib/fonts.ts';
import { findRootUrls } from '../scripts/lib/relative-urls.ts';

const SAMPLE = `@font-face {
  font-family: 'LXGW WenKai TC';
  src: url(./files/lxgw-wenkai-tc-0-400-normal.woff2) format('woff2'), url(./files/lxgw-wenkai-tc-0-400-normal.woff) format('woff');
  unicode-range: U+3401;
}
@font-face {
  font-family: 'Noto Serif TC Variable';
  src: url(./files/noto-serif-tc-1-wght-normal.woff2) format('woff2-variations');
}`;

describe('字型 CSS 改寫', () => {
  it('只保留 woff2，路徑改到輸出目錄，並列出用到的檔案', () => {
    const { css, files } = rewriteFontCss(SAMPLE, 'fonts-dir');
    assert.equal(css.includes('.woff)'), false);
    assert.equal(css.includes('./files/'), false);
    assert.match(css, /url\(\.\/fonts-dir\/lxgw-wenkai-tc-0-400-normal\.woff2\) format\('woff2'\);/);
    assert.deepEqual(files, ['lxgw-wenkai-tc-0-400-normal.woff2', 'noto-serif-tc-1-wght-normal.woff2']);
  });

  it('拒絕可疑的檔名與外部網址', () => {
    assert.throws(() => rewriteFontCss("src: url(./files/../x.woff2) format('woff2');", 'd'));
    assert.throws(() => rewriteFontCss("src: url(https://example.com/x.woff2) format('woff2');", 'd'));
  });
});

describe('自行產生的字型的 @font-face', () => {
  const files = [
    { file: 'wang-te-hei-00.woff2', unicodeRange: 'U+20-7e,U+4e00' },
    { file: 'wang-te-hei-01.woff2', unicodeRange: 'U+4e01-4e05' },
  ];

  it('每個檔一條規則，相對網址、unicode-range、字重範圍', () => {
    const css = generatedFontCss('MP Wang Te Hei', 'wang-te-hei', 'woff2', files);
    assert.equal(css.match(/@font-face/g)?.length, 2);
    assert.match(css, /src: url\(\.\/wang-te-hei\/wang-te-hei-01\.woff2\) format\('woff2'\);\n {2}unicode-range: U\+4e01-4e05;/);
    assert.match(css, /font-family: 'MP Wang Te Hei';/);
    assert.match(css, /font-weight: 100 900;/);
    assert.deepEqual(findRootUrls(css, 'css'), []);
    const single = generatedFontCss('MP Chenyu Luoyan', 'chenyu-luoyan', 'woff', [{ file: 'a.woff', unicodeRange: null }]);
    assert.match(single, /format\('woff'\);\n\}/);
    assert.equal(single.includes('unicode-range'), false);
  });

  it('拒絕可疑的家族名稱、目錄、檔名與 unicode-range', () => {
    assert.throws(() => generatedFontCss("x'; }", 'd', 'woff2', files));
    assert.throws(() => generatedFontCss('X', '../d', 'woff2', files));
    assert.throws(() => generatedFontCss('X', 'd', 'woff2', [{ file: '../a.woff2', unicodeRange: null }]));
    assert.throws(() => generatedFontCss('X', 'd', 'woff2', [{ file: 'a.woff2', unicodeRange: 'U+41; } body { color: red' }]));
  });
});
