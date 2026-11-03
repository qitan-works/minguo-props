import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildFillerPool } from '../src/lib/newspaper/fillers.ts';
import { breakLines, toFullWidth } from '../src/lib/newspaper/layout.ts';

describe('斷行', () => {
  it('依寬度斷行，第一行可縮排', () => {
    assert.deepEqual(breakLines('一二三四五六七', 3), ['一二三', '四五六', '七']);
    assert.deepEqual(breakLines('一二三四五', 3, 1), ['　一二', '三四五']);
  });

  it('避頭點：行首不放逗號句號', () => {
    const lines = breakLines('一二三，四五六。', 3);
    for (const line of lines) assert.equal(/^[，。]/.test(line), false, line);
    assert.equal(lines.join(''), '一二三，四五六。');
    for (const line of lines) assert.ok(Array.from(line).length <= 3);
  });

  it('半形英數轉全形', () => {
    assert.equal(toFullWidth('No.3 A'), 'Ｎｏ．３　Ａ');
  });
});

describe('填版素材池', () => {
  it('素材不含重複編號', () => {
    const pool = buildFillerPool({ seed: 2 });
    const ids = pool.fillers.map((b) => b.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it('鎖定的素材換一批後仍在最前面，刪除的不再出現', () => {
    const first = buildFillerPool({ seed: 5 });
    const keep = first.byId.get(first.fillers[3]!.id)!;
    const drop = first.fillers[4]!.id;
    const next = buildFillerPool({ seed: 6, locked: [keep], removed: [drop] });
    assert.equal(next.fillers[0]!.id, keep.id);
    assert.equal(next.fillers.some((b) => b.id === drop), false);
  });
});
