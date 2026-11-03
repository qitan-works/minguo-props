import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { findRootUrls, kindOf } from '../scripts/lib/relative-urls.ts';

const root = fileURLToPath(new URL('..', import.meta.url));

describe('網址一律用相對路徑（GitHub Pages 子路徑）', () => {
  it('抓得到 HTML、CSS、JS 裡以「/」開頭的網址', () => {
    assert.equal(findRootUrls('<link rel="stylesheet" href="/css/app.css" />', 'html').length, 1);
    assert.equal(findRootUrls('<script type="module" src=/js/main.js></script>', 'html').length, 1);
    assert.equal(findRootUrls('<a href="/">首頁</a>', 'html').length, 1);
    assert.equal(findRootUrls('<img src="//cdn.example/x.png">', 'html').length, 1);
    assert.equal(findRootUrls("src: url('/fonts/a.woff2') format('woff2');", 'css').length, 1);
    assert.equal(findRootUrls('@import "/css/print.css";', 'css').length, 1);
    assert.equal(findRootUrls("const res = await fetch('/data/telegraph.json');", 'js').length, 1);
    assert.equal(findRootUrls("import { a } from '/js/lib/a.js';", 'js').length, 1);
    assert.equal(findRootUrls("await import('/js/lazy.js');", 'js').length, 1);
    assert.equal(findRootUrls("link.href = '/licenses/x.txt';", 'js').length, 1);
    assert.equal(findRootUrls("h('a', { attrs: { href: '/licenses/x.txt' } });", 'js').length, 1);
  });

  it('相對路徑、頁內錨點、註解與一般字串不算', () => {
    const html = '<link href="css/app.css"><a href="licenses/x.txt">授權</a><use href="#grain"/><meta content="default-src \'self\'">';
    assert.deepEqual(findRootUrls(html, 'html'), []);
    assert.deepEqual(findRootUrls("src: url(./noto/a.woff2); filter: url(#rough);", 'css'), []);
    const js = [
      "const res = await fetch('data/telegraph.json');",
      "import { h } from './ui/dom.js';",
      '// 這是註解 /x/y',
      "const parts = text.split('/');",
      'const re = /\\/+$/;',
      "el.style.fill = `url(#${id}-fox)`;",
    ].join('\n');
    assert.deepEqual(findRootUrls(js, 'js'), []);
  });

  it('回報行號', () => {
    const refs = findRootUrls('a\nb\n<img src="/x.png">', 'html');
    assert.equal(refs[0]?.line, 3);
  });

  it('副檔名對應', () => {
    assert.equal(kindOf('dist/index.html'), 'html');
    assert.equal(kindOf('dist/css/app.css'), 'css');
    assert.equal(kindOf('dist/js/main.js'), 'js');
    assert.equal(kindOf('src/main.ts'), 'js');
    assert.equal(kindOf('dist/fonts/a.woff2'), null);
  });

  it('src/ 裡會上線的檔案（HTML、CSS、TypeScript）都沒有根路徑網址', async () => {
    const problems: string[] = [];
    for (const entry of await readdir(path.join(root, 'src'), { withFileTypes: true, recursive: true })) {
      if (!entry.isFile()) continue;
      const kind = kindOf(entry.name);
      if (!kind) continue;
      const file = path.join(entry.parentPath, entry.name);
      for (const ref of findRootUrls(await readFile(file, 'utf8'), kind)) {
        problems.push(`${path.relative(root, file)}:${ref.line} ${ref.match}`);
      }
    }
    assert.deepEqual(problems, []);
  });
});
