import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { rectsOverlap, rectContainsRect } from '../src/lib/geometry.ts';
import { buildFillerPool, poolCharCount } from '../src/lib/newspaper/fillers.ts';
import {
  TRUNCATION_MARK,
  breakLines,
  checkCoverage,
  layoutBlock,
  packPage,
  toFullWidth,
  type SourceBlock,
} from '../src/lib/newspaper/layout.ts';
import { blockRect, lineRects, pageGeometry } from '../src/lib/newspaper/page.ts';

const main: SourceBlock = {
  id: 'main',
  kind: 'news',
  title: '柳巷古宅夜半怪聲',
  subtitle: '鄰里驚疑不安　巡警查勘一無所獲',
  dateline: '本埠訊',
  body: '柳巷十七號林宅，自上月下旬起，每逢夜半，輒聞宅內有低吟之聲。\n翌晨，巡警二名奉命前往查勘。',
  source: 'user',
};

function a4(tiers = 5) {
  return pageGeometry({ width: 210, height: 297, tiers });
}

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

describe('區塊排版與截斷', () => {
  it('放得下時不截斷', () => {
    const laid = layoutBlock(main, 13);
    assert.ok(laid);
    assert.equal(laid.truncated, false);
    assert.equal(laid.slots, laid.lines.reduce((s, l) => s + l.size, 0));
  });

  it('放不下時截斷在指定寬度內，最後一行以「（未完）」結尾', () => {
    const laid = layoutBlock(main, 13, 8);
    assert.ok(laid);
    assert.equal(laid.truncated, true);
    assert.ok(laid.slots <= 8);
    const last = laid.lines[laid.lines.length - 1];
    assert.ok(last?.text.endsWith(TRUNCATION_MARK));
    for (const line of laid.lines) assert.ok(Array.from(line.text).length * line.size <= 13);
  });

  it('連標題都放不下時回傳 null', () => {
    assert.equal(layoutBlock(main, 13, 2), null);
  });
});

describe('整版排版', () => {
  for (const tiers of [4, 5, 6]) {
    it(`A4 ${tiers} 段：排滿、沒有重疊、每個區塊都在版面內`, () => {
      const geom = a4(tiers);
      const pool = buildFillerPool({ seed: 1234 + tiers });
      const layout = packPage({ grid: geom.grid, userBlocks: [main], fillers: pool.fillers, tinyFillers: pool.tiny });
      const coverage = checkCoverage(layout);
      assert.deepEqual(coverage.problems, []);
      const rects = layout.blocks.map((b) => blockRect(geom, b));
      for (let i = 0; i < rects.length; i++) {
        assert.ok(rectContainsRect(geom.area, rects[i]!), `區塊 ${layout.blocks[i]?.id} 超出版面`);
        for (let j = i + 1; j < rects.length; j++) {
          assert.equal(rectsOverlap(rects[i]!, rects[j]!), false, `${layout.blocks[i]?.id} 與 ${layout.blocks[j]?.id} 重疊`);
        }
      }
      // 每個區塊的行加起來剛好是它的寬度，每行字數不超過可放的字數
      for (const b of layout.blocks) {
        assert.equal(b.slots, b.lines.reduce((s, l) => s + l.size, 0) + (b.boxed ? 1 : 0) + (b.kind === 'photo' ? 0 : 0));
        for (const line of b.lines) assert.ok(Array.from(line.text).length * line.size <= b.charsPerLine, `${b.id}：${line.text}`);
        for (const r of lineRects(geom, b)) assert.ok(rectContainsRect(blockRect(geom, b), r));
      }
      // 主新聞在右上角、跨兩段
      const first = layout.blocks[0];
      assert.equal(first?.id, 'main');
      assert.equal(first?.slot, 0);
      assert.equal(first?.tier, 0);
      assert.equal(first?.tierSpan, 2);
      assert.equal(layout.overflow, false);
      // 同一版不重複使用素材
      const ids = layout.blocks.map((b) => b.id);
      assert.equal(new Set(ids).size, ids.length);
    });
  }

  it('使用者可加多則新聞，都會排進版面', () => {
    const geom = a4();
    const pool = buildFillerPool({ seed: 5 });
    const extras: SourceBlock[] = Array.from({ length: 4 }, (_, i) => ({
      id: `u${i}`,
      kind: 'short',
      title: `線索${i}`,
      body: '某甲於夜間行經燈塔路，見海面有異光。',
      source: 'user',
    }));
    const layout = packPage({ grid: geom.grid, userBlocks: [main, ...extras], fillers: pool.fillers, tinyFillers: pool.tiny });
    for (const e of extras) assert.ok(layout.blocks.some((b) => b.id === e.id), e.id);
    assert.deepEqual(checkCoverage(layout).problems, []);
  });

  it('使用者內容太多時，最後一則截斷並標示溢出', () => {
    const geom = a4(4);
    const pool = buildFillerPool({ seed: 5 });
    const huge: SourceBlock = { ...main, body: '長'.repeat(4000) };
    const layout = packPage({ grid: geom.grid, userBlocks: [huge], fillers: pool.fillers, tinyFillers: pool.tiny });
    assert.equal(layout.overflow, true);
    const block = layout.blocks.find((b) => b.id === 'main');
    assert.ok(block?.truncated);
    assert.ok(block?.lines[block.lines.length - 1]?.text.endsWith(TRUNCATION_MARK));
    assert.deepEqual(checkCoverage(layout).problems, []);
  });

  it('同一種子排出同樣的版面；換一批後內容不同', () => {
    const geom = a4();
    const run = (seed: number) => {
      const pool = buildFillerPool({ seed });
      return packPage({ grid: geom.grid, userBlocks: [main], fillers: pool.fillers, tinyFillers: pool.tiny });
    };
    assert.deepEqual(run(77), run(77));
    assert.notDeepEqual(
      run(77).blocks.map((b) => b.id),
      run(78).blocks.map((b) => b.id),
    );
  });

  it('鎖定的素材換一批後仍在，刪除的素材不再出現', () => {
    const geom = a4();
    const first = buildFillerPool({ seed: 10 });
    const lockedItem = first.byId.get(first.fillers[3]!.id)!;
    const removedId = first.fillers[0]!.id;
    const pool = buildFillerPool({ seed: 999, locked: [lockedItem], removed: [removedId] });
    const layout = packPage({ grid: geom.grid, userBlocks: [main], fillers: pool.fillers, tinyFillers: pool.tiny });
    assert.ok(layout.blocks.some((b) => b.id === lockedItem.id));
    assert.equal(layout.blocks.some((b) => b.id === removedId), false);
  });
});

describe('填版素材量', () => {
  it('素材總字數至少夠排滿兩版 A4', () => {
    const geom = a4();
    const capacity = geom.grid.tiers * geom.grid.slots * geom.grid.chars;
    const pool = buildFillerPool({ seed: 1 });
    assert.ok(poolCharCount(pool) >= capacity * 2, `素材 ${poolCharCount(pool)} 字，版面 ${capacity} 字`);
  });

  it('連排兩版 A4，第二版不重複第一版用過的素材', () => {
    const geom = a4();
    const pool = buildFillerPool({ seed: 31 });
    const page1 = packPage({ grid: geom.grid, userBlocks: [], fillers: pool.fillers, tinyFillers: pool.tiny });
    const usedIds = new Set(page1.usedFillerIds);
    const rest = pool.fillers.filter((b) => !usedIds.has(b.id));
    const page2 = packPage({ grid: geom.grid, userBlocks: [], fillers: rest, tinyFillers: pool.tiny.slice(40) });
    assert.deepEqual(checkCoverage(page1).problems, []);
    assert.deepEqual(checkCoverage(page2).problems, []);
    for (const id of page2.usedFillerIds) assert.equal(usedIds.has(id), false, id);
    // 兩版都主要由多行素材組成（一行小訊只用來補縫）
    const tinyShare = page2.blocks.filter((b) => b.kind === 'tiny').length / page2.blocks.length;
    assert.ok(tinyShare < 0.5, `第二版一行小訊比例 ${tinyShare}`);
  });

  it('素材不含重複編號', () => {
    const pool = buildFillerPool({ seed: 2 });
    const ids = pool.fillers.map((b) => b.id);
    assert.equal(new Set(ids).size, ids.length);
  });
});
