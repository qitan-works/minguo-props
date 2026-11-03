import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { rewriteFontCss } from '../scripts/lib/fonts.ts';

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
