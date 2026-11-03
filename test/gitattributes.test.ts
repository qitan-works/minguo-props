import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const root = new URL('../', import.meta.url);
const attributes = readFileSync(new URL('.gitattributes', root), 'utf8');
const rules = attributes
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line !== '' && !line.startsWith('#'))
  .map((line) => line.split(/\s+/));

describe('.gitattributes', () => {
  it('文字檔一律以 LF 存放與取出', () => {
    assert.ok(rules.some(([pattern, ...attrs]) => pattern === '*' && attrs.includes('text=auto') && attrs.includes('eol=lf')));
  });

  it('字型與圖片標成二進位', () => {
    for (const ext of ['woff', 'woff2', 'ttf', 'jpg', 'png']) {
      assert.ok(rules.some(([pattern, ...attrs]) => pattern === `*.${ext}` && attrs.includes('binary')), `*.${ext} 要標成 binary`);
    }
  });

  it('含 CR 的授權檔都排除在換行轉換之外（否則會被改成 LF，和上游不再逐位元組相同）', () => {
    const dir = new URL('licenses/', root);
    const withCr = readdirSync(dir).filter((name) => readFileSync(new URL(name, dir)).includes(0x0d));
    for (const name of withCr) {
      assert.ok(rules.some(([pattern, ...attrs]) => pattern === `licenses/${name}` && attrs.includes('-text')), `licenses/${name} 要設 -text`);
    }
  });
});
