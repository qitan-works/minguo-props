import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, it } from 'node:test';

import { checkCss } from '../scripts/lib/css-check.ts';

describe('CSS 結構檢查（建置時執行）', () => {
  it('專案裡的每一個 CSS 都通過：括號成對、沒有巢狀規則', () => {
    const dir = new URL('../src/styles/', import.meta.url);
    const files = readdirSync(dir).filter((f) => f.endsWith('.css'));
    assert.ok(files.length >= 3);
    for (const f of files) assert.deepEqual(checkCss(readFileSync(new URL(f, dir), 'utf8')), [], f);
  });

  it('抓得到第五版整合時的錯：區段少了結尾的 }，後面的規則變成巢狀', () => {
    // 兩個分支各自在檔尾加一段，解衝突時共同的結尾 } 只留了一個
    const broken = ['@media screen {', '  .fx-hit { cursor: move; }', '', '.nf-mh-ear-head {', '  font-weight: 700;', '', '.dc-vt {', '  writing-mode: vertical-rl;', '}', ''].join('\n');
    const problems = checkCss(broken);
    const lines = problems.map((p) => p.line);
    assert.ok(lines.includes(1) && lines.includes(4), JSON.stringify(problems));
    assert.ok(problems.some((p) => p.line === 7 && /少了一個 }/.test(p.message)), '.dc-vt 被當成 .nf-mh-ear-head 的巢狀規則');
    assert.ok(problems.some((p) => /沒有結尾的 }/.test(p.message)));
  });

  it('不准有巢狀規則；@media、@supports 裡的規則、@keyframes 的 from／to／百分比、@page 都可以', () => {
    assert.deepEqual(checkCss('@media print { .a { color: red; } @supports (display: grid) { .b { display: grid; } } }\n@keyframes k { from { opacity: 0; } 50% { opacity: .5; } to { opacity: 1; } }\n@page a4 { size: 210mm 297mm; margin: 0; }\n'), []);
    assert.equal(checkCss('.a { .b { color: red; } }').length, 1);
    assert.equal(checkCss('.a { & .b { color: red; } }').length, 1);
    assert.equal(checkCss('.a { @media print { color: red; } }').length, 1);
    assert.equal(checkCss('@keyframes k { .x { opacity: 0; } }').length, 1);
  });

  it('註解與字串裡的括號不算；多一個 } 也抓得到', () => {
    assert.deepEqual(checkCss("/* { 這不是規則 */ .a::before { content: '{'; } .b { background: url(\"x}.svg\"); }"), []);
    assert.equal(checkCss('.a { color: red; } }').length, 1);
    assert.equal(checkCss('.a { color: red;\n\n.b { color: blue; }')[0]?.line, 3, '行號指向被吞進去的那條規則');
  });
});
