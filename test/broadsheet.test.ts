import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { COLUMN_TAGS } from '../src/data/fillers.ts';
import { classifyRects, cutPolygon } from '../src/lib/cutline.ts';
import { rectContainsRect, type Rect } from '../src/lib/geometry.ts';
import { layoutAd } from '../src/lib/newspaper/ads.ts';
import { fullWidthBoundaries, headlineBand, layoutBroadsheet, type Broadsheet, type BroadsheetInput, type Region } from '../src/lib/newspaper/broadsheet.ts';
import { buildBroadsheetPool } from '../src/lib/newspaper/fillers.ts';
import type { FlowItem } from '../src/lib/newspaper/flow.ts';
import type { PunctuationMode } from '../src/lib/newspaper/punctuation.ts';
import { broadsheetGeometry, colLeft, rowTop, type BroadsheetGeometry, type MastheadLayout } from '../src/lib/newspaper/sheetgeom.ts';
import { newspaperDefaults as d } from '../src/props/newspaper.ts';

const MAIN: FlowItem = {
  id: 'main',
  source: 'user',
  level: 1,
  title: d.headline,
  subtitles: d.subheadline.split('　'),
  kicker: d.dateline,
  paragraphs: d.body.split('\n'),
};

function page(options: { seed?: number; fill?: number; layout?: MastheadLayout; mode?: PunctuationMode; extra?: FlowItem[]; width?: number; height?: number } = {}): { b: Broadsheet; g: BroadsheetGeometry; input: BroadsheetInput } {
  const g = broadsheetGeometry({ width: options.width ?? 210, height: options.height ?? 297, layout: options.layout ?? 'right', header: true });
  const pool = buildBroadsheetPool({ seed: options.fill ?? d.fillSeed });
  const input: BroadsheetInput = {
    cols: g.cols,
    rows: g.rows,
    seed: options.seed ?? 1105,
    tiers: 5,
    mode: options.mode ?? 'circle',
    ...(g.obstacle ? { obstacle: g.obstacle } : {}),
    main: MAIN,
    mainHorizontal: true,
    queue: [...(options.extra ?? []), ...pool.items],
    ads: pool.ads,
    tiny: [...pool.tiny],
    tags: COLUMN_TAGS,
    aspect: g.pitch / g.cell,
  };
  return { b: layoutBroadsheet(input), g, input };
}

function regionHeight(r: Region): number {
  return Math.max(...r.columns.map((c) => c.bottom)) - Math.min(...r.columns.map((c) => c.top));
}

const LAYOUTS: MastheadLayout[] = ['right', 'corner-right', 'corner-left', 'top', 'none'];

describe('整版不規則版面', () => {
  for (const layout of LAYOUTS) {
    for (const seed of [1, 7, 42]) {
      it(`${layout}／種子 ${seed}：每一格剛好屬於一個區塊，文字區塊每一行都有字`, () => {
        const { b } = page({ layout, seed });
        assert.equal(b.owner.filter((o) => o === -1).length, 0, '有空格');
        // 區塊的行不重疊：每一格只記一個歸屬，再由區塊回推檢查
        const seen = new Int32Array(b.cols * b.rows).fill(0);
        for (const r of b.regions) for (const c of r.columns) for (let row = c.top; row < c.bottom; row++) seen[row * b.cols + c.col]! += 1;
        b.owner.forEach((o, i) => assert.equal(seen[i], o === -2 ? 0 : 1, `第 ${i} 格`));
        for (const r of b.regions) {
          if (r.kind === 'ad' || r.kind === 'photo') continue;
          r.slots.forEach((s, i) => {
            if (s.cap <= 0) return;
            assert.ok(r.lines.some((l) => i >= l.slot && i < l.slot + l.span && l.glyphs.length > 0), `${r.id} 第 ${i} 行是空的`);
          });
          for (const l of r.lines) {
            const slot = r.slots[l.slot]!;
            assert.ok(l.glyphs.length * l.size <= slot.cap + 0.01 || l.align === 'center', `${r.id} 的字超出行長`);
          }
        }
      });

      it(`${layout}／種子 ${seed}：不規則（多種區塊高度、沒有橫貫全版的分界）`, () => {
        const { b, input } = page({ layout, seed });
        const heights = new Set(b.regions.map(regionHeight));
        assert.ok(heights.size >= 6, `只有 ${heights.size} 種高度`);
        const straight = fullWidthBoundaries(b.owner, b.cols, b.rows).filter((row) => !input.obstacle || row !== input.obstacle.rows);
        assert.deepEqual(straight, []);
        // 有些區塊不是矩形（L 形或階梯）
        assert.ok(b.regions.some((r) => new Set(r.columns.map((c) => c.bottom)).size > 1), '沒有 L 形區塊');
        // 有廣告、有文字
        assert.ok(b.regions.some((r) => r.kind === 'ad'));
        assert.ok(b.regions.filter((r) => r.kind === 'text').length >= 5);
      });
    }
  }

  it('部分新聞（不只主新聞）的標題橫排，跨整個區塊寬', () => {
    let count = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) count += page({ seed }).b.regions.filter((r) => r.kind === 'text' && r.band).length;
    assert.ok(count >= 3, `六個種子只有 ${count} 則橫排標題`);
  });

  it('同一種子排出同樣的版面；換版面種子會不同', () => {
    const a = page({ seed: 9 }).b;
    const b = page({ seed: 9 }).b;
    assert.deepEqual(a.regions, b.regions);
    assert.deepEqual([...a.owner], [...b.owner]);
    const c = page({ seed: 10 }).b;
    assert.notDeepEqual([...a.owner], [...c.owner]);
  });

  it('主新聞在右上方可用處，使用者加的新聞都排進去', () => {
    const extra: FlowItem[] = Array.from({ length: 4 }, (_, i) => ({ id: `u${i}`, source: 'user', level: 3, title: `自訂新聞${i}`, subtitles: [], paragraphs: ['這是自己寫的新聞，內容不長。'] }));
    const { b, input } = page({ extra });
    const main = b.regions.find((r) => r.kind === 'main')!;
    assert.equal(main.columns[0]!.col, input.obstacle!.cols);
    assert.equal(main.columns[0]!.top, 0);
    assert.ok(main.band && main.band.lines.length > 0);
    for (const item of extra) assert.ok(b.usedIds.includes(item.id), item.id);
    assert.equal(b.overflow, false);
  });

  it('使用者內容太多時標示溢出', () => {
    const long: FlowItem = { ...MAIN, paragraphs: Array.from({ length: 40 }, () => d.body.split('\n')[0]!) };
    const g = broadsheetGeometry({ width: 210, height: 297, layout: 'right', header: true });
    const pool = buildBroadsheetPool({ seed: 3 });
    const b = layoutBroadsheet({ ...page().input, main: long, queue: pool.items, ads: pool.ads, tiny: [...pool.tiny], cols: g.cols, rows: g.rows });
    assert.equal(b.overflow, true);
    const main = b.regions.find((r) => r.kind === 'main')!;
    const last = main.lines[main.lines.length - 1]!;
    assert.ok(last.glyphs.map((x) => x.ch).join('').endsWith('未完'));
  });

  it('連排兩版，第二版不重複第一版用過的素材', () => {
    const first = page({ fill: 31 });
    const used = new Set(first.b.usedIds);
    const pool = buildBroadsheetPool({ seed: 31 });
    const second = layoutBroadsheet({ ...first.input, queue: pool.items.filter((i) => !used.has(i.id)), ads: pool.ads.filter((a) => !used.has(a.id)), tiny: pool.tiny.slice(120), main: { ...pool.items.find((i) => !used.has(i.id))!, level: 1 } });
    assert.equal(second.owner.filter((o) => o === -1).length, 0);
    for (const id of second.usedIds) if (!id.startsWith('t')) assert.equal(used.has(id), false, id);
  });

  it('A5 與 A4 橫式也排得滿', () => {
    for (const [width, height] of [[148, 210], [297, 210]] as const) {
      const { b } = page({ width, height, layout: 'corner-right' });
      assert.equal(b.owner.filter((o) => o === -1).length, 0);
    }
  });
});

describe('從整版剪下', () => {
  it('剪線把主新聞框內的字留下、外面的拿掉，壓在剪線上的字被切到', () => {
    const { b, g } = page({ seed: 3 });
    const items: { rect: Rect; main: boolean }[] = [];
    for (const r of b.regions) {
      for (const l of r.lines) {
        const slot = r.slots[l.slot + l.span - 1]!;
        items.push({ rect: { x: colLeft(g, slot.col), y: rowTop(g, l.top), w: l.span * g.pitch, h: Math.max(1, l.glyphs.length) * l.size * g.cell }, main: r.kind === 'main' });
      }
    }
    const main = b.regions.find((r) => r.kind === 'main')!;
    const left = colLeft(g, main.columns[main.columns.length - 1]!.col);
    const frame: Rect = { x: left - 6, y: g.area.y - 2, w: colLeft(g, main.columns[0]!.col) + g.pitch - left + 10, h: (main.columns[0]!.bottom - main.columns[0]!.top) * g.cell + 8 };
    const result = classifyRects(items, cutPolygon(frame, 'scissors', 7));
    const kinds = new Set(result.map((r) => r.relation));
    assert.ok(kinds.has('inside') && kinds.has('outside') && kinds.has('cut'));
    for (const r of result) if (r.item.main) assert.notEqual(r.relation, 'outside');
  });
});

describe('廣告版型', () => {
  it('特大字、說明、價目都在框內，版型可重現', () => {
    const pool = buildBroadsheetPool({ seed: 4 });
    for (const ad of pool.ads.slice(0, 20)) {
      for (const box of [{ x: 10, y: 10, w: 40, h: 60 }, { x: 10, y: 10, w: 70, h: 30 }, { x: 0, y: 0, w: 20, h: 35 }]) {
        const a = layoutAd(ad, box, 11, 3.3);
        assert.deepEqual(a, layoutAd(ad, box, 11, 3.3));
        const big = a.texts.filter((t) => t.role === 'big');
        assert.ok(big.length > 0, ad.id);
        const bigChars = big.reduce((n, t) => n + Array.from(t.text).length, 0);
        assert.ok(bigChars >= 1 && bigChars <= 7);
        for (const t of a.texts) assert.ok(rectContainsRect({ x: box.x - 0.01, y: box.y - 0.01, w: box.w + 0.02, h: box.h + 0.02 }, t), `${ad.id} ${t.role} 超出框`);
      }
    }
  });
});

describe('主新聞橫排標題', () => {
  it('字太多時分兩行，字盡量大但不超過寬度', () => {
    const one = headlineBand('柳巷古宅', 20, 1.14, 'circle')!;
    assert.equal(one.lines.length, 1);
    const two = headlineBand('柳巷古宅夜半怪聲鄰里驚疑', 10, 1.14, 'circle')!;
    assert.equal(two.lines.length, 2);
    for (const l of two.lines) assert.ok(Array.from(l.text).length * l.size <= 10 * 1.14 + 0.01);
    assert.equal(headlineBand('柳巷，古宅！', 20, 1.14, 'none')!.lines[0]!.text.includes('，'), false);
  });
});
