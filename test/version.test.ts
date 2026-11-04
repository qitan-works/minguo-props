import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { buildVersion, checkVersionedRefs, contentHash, fileHash, isVersion, versionFontUrls, versionIndexHtml } from '../scripts/lib/version.ts';

const V = 'abcdef012345';

describe('部署版本', () => {
  it('不同 commit 版本一定不同；同一個 commit 與內容重建時相同；內容不同也不同', () => {
    const files = new Map([['js/main.js', 'a'], ['css/app.css', 'b']]);
    const h = contentHash(files);
    const a = buildVersion('1111111111111111111111111111111111111111', h);
    const b = buildVersion('2222222222222222222222222222222222222222', h);
    assert.ok(isVersion(a) && isVersion(b));
    assert.notEqual(a, b);
    assert.equal(a, buildVersion('1111111111111111111111111111111111111111', h));
    assert.notEqual(a, buildVersion('1111111111111111111111111111111111111111', contentHash(new Map([['js/main.js', 'a2'], ['css/app.css', 'b']]))));
    // 沒有 git 時用內容雜湊
    assert.ok(isVersion(buildVersion('', h)));
    // 內容雜湊與列出的順序無關
    assert.equal(h, contentHash(new Map([['css/app.css', 'b'], ['js/main.js', 'a']])));
  });

  it('index.html 的 JS、CSS 與 fonts.css 指到版本資料夾，其他連結不動', () => {
    const html = readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');
    const out = versionIndexHtml(html, V);
    for (const ref of ['v/abcdef012345/fonts.css', 'v/abcdef012345/css/app.css', 'v/abcdef012345/css/props.css', 'v/abcdef012345/css/print.css', 'v/abcdef012345/js/main.js']) {
      assert.ok(out.includes(`"${ref}"`), ref);
    }
    assert.ok(out.includes('href="licenses/THIRD_PARTY_NOTICES.txt"'), '授權文件的連結不加版本');
    assert.deepEqual(checkVersionedRefs(new Map([['index.html', out]]), V), []);
    assert.throws(() => versionIndexHtml(html, 'not-a-version'));
  });

  it('字型網址改成相對於版本資料夾，並帶各自內容的雜湊', () => {
    const css = "@font-face { src: url(./wang-zhong-ming/wang-zhong-ming-0.woff2) format('woff2'); }\n@font-face { src: url(./chenyu-luoyan/x.woff) format('woff'); }";
    const out = versionFontUrls(css, (dir, file) => fileHash(`${dir}/${file}`));
    assert.match(out, /url\(\.\.\/\.\.\/fonts\/wang-zhong-ming\/wang-zhong-ming-0\.woff2\?v=[0-9a-f]{12}\)/);
    assert.match(out, /url\(\.\.\/\.\.\/fonts\/chenyu-luoyan\/x\.woff\?v=[0-9a-f]{12}\)/);
    assert.notEqual(fileHash('a'), fileHash('b'), '內容不同，網址就不同');
    assert.throws(() => versionFontUrls('src: url(../x.woff2)', () => 'abc12345'), /沒有加版本/);
    assert.deepEqual(checkVersionedRefs(new Map([[`v/${V}/fonts.css`, out]]), V), []);
  });

  it('檢查會抓出沒有加版本的引用', () => {
    const bad = new Map<string, string>([
      ['index.html', '<link rel="stylesheet" href="css/app.css"><script type="module" src="js/main.js"></script>'],
      ['js/main.js', 'export {};'],
      [`v/${V}/js/main.js`, "import { a } from '../../../js/lib/a.js';\nconst r = await fetch('data/telegraph.json');"],
      [`v/${V}/fonts.css`, 'src: url(../../fonts/a/b.woff2);'],
      [`v/${V}/css/app.css`, 'background: url(../../../img/x.png);'],
    ]);
    const problems = checkVersionedRefs(bad, V);
    const files = problems.map((p) => p.file);
    assert.equal(files.filter((f) => f === 'index.html').length, 2, 'index.html 的兩個引用');
    assert.ok(files.includes('js/main.js'), '版本資料夾外的 JS');
    assert.equal(files.filter((f) => f === `v/${V}/js/main.js`).length, 2, '跳出版本資料夾的 import 與相對網頁的 fetch');
    assert.ok(files.includes(`v/${V}/fonts.css`), '沒有雜湊的字型網址');
    assert.ok(files.includes(`v/${V}/css/app.css`), '跳出版本資料夾的 url()');
    // 正確的寫法不會被誤報
    const good = new Map<string, string>([
      [`v/${V}/js/main.js`, "import { a } from './lib/a.js';\nconst r = await fetch(new URL('../data/telegraph.json', import.meta.url));"],
      [`v/${V}/js/lib/a.js`, "import { b } from '../ui/b.js';\nexport const a = 1;"],
      [`v/${V}/css/app.css`, "background: url('data:image/svg+xml,%3Csvg/%3E'); filter: url('#f-ink');"],
    ]);
    assert.deepEqual(checkVersionedRefs(good, V), []);
  });

  it('不用 Service Worker', () => {
    const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
    assert.equal(/serviceWorker/.test(main), false);
  });
});
