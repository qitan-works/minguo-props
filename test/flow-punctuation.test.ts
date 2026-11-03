import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { fillColumns, flowRegion, glyphsOf, layoutItem, truncationMark, type ColumnSlot, type FlowItem } from '../src/lib/newspaper/flow.ts';
import { applyPunctuation, headlinePunctuation, isPunctuation } from '../src/lib/newspaper/punctuation.ts';

const ITEM: FlowItem = { id: 'x', source: 'filler', level: 3, title: '鹽倉巷失火', subtitles: [], paragraphs: ['昨晚十時許，鹽倉巷某姓柴房不戒於火，火光燭天。幸救火會聞警即至，約半小時撲滅。'] };

function slots(caps: number[]): ColumnSlot[] {
  return caps.map((cap, col) => ({ col, top: 0, cap }));
}

describe('句讀模式', () => {
  const text = '昨晚十時許，「火光」燭天！幸無人傷亡。';
  it('現代標點照原文', () => {
    assert.equal(glyphsOf(text, 'modern').map((g) => g.ch).join(''), text);
  });
  it('無標點：全部拿掉', () => {
    const out = glyphsOf(text, 'none');
    assert.equal(out.map((g) => g.ch).join(''), '昨晚十時許火光燭天幸無人傷亡');
    assert.ok(out.every((g) => !g.pm && !isPunctuation(g.ch)));
  });
  it('舊式圈點：只用。、印在前一字旁，不佔字格', () => {
    const out = glyphsOf(text, 'circle');
    assert.equal(out.map((g) => g.ch).join(''), '昨晚十時許火光燭天幸無人傷亡');
    assert.deepEqual(out.filter((g) => g.pm).map((g) => `${g.ch}${g.pm}`), ['許、', '天。', '亡。']);
  });
  it('標題的標點在圈點、無標點模式拿掉', () => {
    assert.equal(headlinePunctuation('港口濃霧，輪船誤期', 'circle'), '港口濃霧　輪船誤期');
    assert.equal(headlinePunctuation('港口濃霧，輪船誤期', 'modern'), '港口濃霧，輪船誤期');
  });
  it('文字層標記保留在字上', () => {
    const out = applyPunctuation([{ ch: '林', mark: 'protect' }, { ch: '，' }, { ch: '宅' }], 'circle');
    assert.deepEqual(out, [{ ch: '林', mark: 'protect', pm: '、' }, { ch: '宅' }]);
  });
});

describe('欄內流排', () => {
  it('依各行容量填字，避頭點', () => {
    const glyphs = Array.from('一二三，四五六七。').map((ch) => ({ ch }));
    const { lines, used } = fillColumns(glyphs, [3, 5, 5]);
    assert.equal(used, glyphs.length);
    for (const l of lines) assert.notEqual(l[0]?.ch, '，');
    assert.equal(lines.flat().map((g) => g.ch).join(''), '一二三，四五六七。');
  });

  it('L 形區塊：各行長短不同也排得進去', () => {
    const laid = layoutItem(ITEM, slots([12, 12, 7, 7, 7, 7]), 0, 'modern', false);
    assert.ok(laid);
    for (const l of laid.lines) assert.ok(l.glyphs.length * l.size <= l.length);
  });

  it('放不下時截斷，最後一行以「（未完）」結尾；圈點模式用「未完」', () => {
    for (const mode of ['modern', 'circle'] as const) {
      const laid = layoutItem(ITEM, slots([10, 10, 10]), 0, mode, true);
      assert.ok(laid?.truncated);
      const last = laid.lines[laid.lines.length - 1]!;
      assert.ok(last.glyphs.map((g) => g.ch).join('').endsWith(truncationMark(mode)));
      assert.ok(last.glyphs.length <= last.length);
      assert.equal(layoutItem(ITEM, slots([10, 10, 10]), 0, mode, false), null);
    }
  });

  it('區塊排滿：排完素材再用一行小訊補，每一行都有字', () => {
    const queue: FlowItem[] = [ITEM, { ...ITEM, id: 'y', title: '米價續漲' }];
    const tiny: FlowItem[] = Array.from({ length: 10 }, (_, i) => ({ id: `t${i}`, source: 'filler', level: 3, title: '', subtitles: [], paragraphs: ['◎今日潮汐　早潮十時'] }));
    const s = slots([14, 14, 14, 14, 14, 14, 14, 14, 14, 14]);
    const result = flowRegion(s, queue, { mode: 'circle', tiny });
    s.forEach((_, i) => assert.ok(result.lines.some((l) => i >= l.slot && i < l.slot + l.span), `第 ${i} 行`));
    assert.ok(result.used.includes('x'));
  });
});
