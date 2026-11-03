import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CUT_STYLES, classifyRects, cutPolygon } from '../src/lib/cutline.ts';
import {
  inflateRect,
  intersectRects,
  pointInPolygon,
  polygonArea,
  polygonBounds,
  rectPolygonRelation,
  rectToPolygon,
  rectsOverlap,
  segmentsIntersect,
  unionRects,
} from '../src/lib/geometry.ts';
import { MAX_SEED, deriveSeed, freshSeed, isValidSeed, mulberry32, rngFor, shuffle } from '../src/lib/random.ts';

describe('固定種子亂數', () => {
  it('同一種子得到同樣的序列，不同種子不同', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const c = mulberry32(43);
    const xs = Array.from({ length: 5 }, () => a());
    assert.deepEqual(
      xs,
      Array.from({ length: 5 }, () => b()),
    );
    assert.notDeepEqual(
      xs,
      Array.from({ length: 5 }, () => c()),
    );
    for (const x of xs) assert.ok(x >= 0 && x < 1);
  });

  it('衍生種子：同標籤相同、不同標籤不同，且都在合法範圍', () => {
    assert.equal(deriveSeed(7, 'stain'), deriveSeed(7, 'stain'));
    assert.notEqual(deriveSeed(7, 'stain'), deriveSeed(7, 'burn'));
    for (let s = 1; s < 50; s++) assert.ok(isValidSeed(deriveSeed(s, 'x')));
    assert.equal(rngFor(9, 'a')(), rngFor(9, 'a')());
  });

  it('換一個種子一定不同', () => {
    let i = 0;
    const fixed = (): number => [0.5, 0.5, 0.25][i++ % 3] as number;
    const first = freshSeed(undefined, fixed);
    assert.notEqual(freshSeed(first, fixed), first);
    assert.ok(isValidSeed(first));
    assert.equal(isValidSeed(0), false);
    assert.equal(isValidSeed(MAX_SEED + 1), false);
    assert.equal(isValidSeed(1.5), false);
  });

  it('洗牌不改變元素、可重現', () => {
    const items = Array.from({ length: 20 }, (_, k) => k);
    const s1 = shuffle(mulberry32(3), items);
    assert.deepEqual([...s1].sort((x, y) => x - y), items);
    assert.deepEqual(shuffle(mulberry32(3), items), s1);
  });
});

describe('幾何', () => {
  const square = rectToPolygon({ x: 0, y: 0, w: 10, h: 10 });

  it('點在多邊形內', () => {
    assert.equal(pointInPolygon({ x: 5, y: 5 }, square), true);
    assert.equal(pointInPolygon({ x: 0, y: 5 }, square), true);
    assert.equal(pointInPolygon({ x: 11, y: 5 }, square), false);
  });

  it('矩形重疊、交集、聯集、外擴', () => {
    assert.equal(rectsOverlap({ x: 0, y: 0, w: 5, h: 5 }, { x: 5, y: 0, w: 5, h: 5 }), false);
    assert.equal(rectsOverlap({ x: 0, y: 0, w: 5, h: 5 }, { x: 4, y: 4, w: 5, h: 5 }), true);
    assert.deepEqual(intersectRects({ x: 0, y: 0, w: 5, h: 5 }, { x: 4, y: 4, w: 5, h: 5 }), { x: 4, y: 4, w: 1, h: 1 });
    assert.deepEqual(unionRects([{ x: 0, y: 0, w: 1, h: 1 }, { x: 3, y: 2, w: 1, h: 1 }]), { x: 0, y: 0, w: 4, h: 3 });
    assert.deepEqual(inflateRect({ x: 1, y: 1, w: 2, h: 2 }, 1), { x: 0, y: 0, w: 4, h: 4 });
    assert.equal(polygonArea(square), 100);
    assert.deepEqual(polygonBounds(square), { x: 0, y: 0, w: 10, h: 10 });
  });

  it('線段相交', () => {
    assert.equal(segmentsIntersect({ x: 0, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }, { x: 2, y: 0 }), true);
    assert.equal(segmentsIntersect({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }), false);
  });

  it('矩形與剪線的關係：框內、框外、被切', () => {
    assert.equal(rectPolygonRelation({ x: 2, y: 2, w: 3, h: 3 }, square), 'inside');
    assert.equal(rectPolygonRelation({ x: 20, y: 2, w: 3, h: 3 }, square), 'outside');
    assert.equal(rectPolygonRelation({ x: 8, y: 2, w: 4, h: 3 }, square), 'cut');
    // 矩形整個蓋住剪線範圍也算被切
    assert.equal(rectPolygonRelation({ x: -1, y: -1, w: 12, h: 12 }, square), 'cut');
  });
});

describe('剪線', () => {
  const frame = { x: 20, y: 30, w: 80, h: 120 };

  for (const style of CUT_STYLES.map((s) => s.value)) {
    it(`${style}：可重現、貼近框線、包住框的中心`, () => {
      const a = cutPolygon(frame, style, 11);
      const b = cutPolygon(frame, style, 11);
      assert.deepEqual(a, b);
      assert.ok(a.length >= 4);
      assert.equal(pointInPolygon({ x: 60, y: 90 }, a), true);
      const bounds = polygonBounds(a);
      const tolerance = style === 'skew' ? 8 : 2.5;
      assert.ok(Math.abs(bounds.x - frame.x) < tolerance, `${style} 左緣 ${bounds.x}`);
      assert.ok(Math.abs(bounds.y - frame.y) < tolerance, `${style} 上緣 ${bounds.y}`);
      assert.ok(Math.abs(bounds.x + bounds.w - (frame.x + frame.w)) < tolerance);
      assert.ok(Math.abs(bounds.y + bounds.h - (frame.y + frame.h)) < tolerance);
      // 面積與框相差不大
      const ratio = polygonArea(a) / (frame.w * frame.h);
      assert.ok(ratio > 0.9 && ratio < 1.05, `${style} 面積比 ${ratio}`);
    });
  }

  it('不同種子剪出不同形狀', () => {
    assert.notDeepEqual(cutPolygon(frame, 'torn', 1), cutPolygon(frame, 'torn', 2));
  });

  it('分類：直排的行被左右剪線切過、段落頭尾被上下剪線切到', () => {
    const poly = cutPolygon(frame, 'straight', 1);
    const items = [
      { id: 'inside', rect: { x: 40, y: 60, w: 3.7, h: 40 } },
      { id: 'left-cut', rect: { x: 18, y: 60, w: 3.7, h: 40 } },
      { id: 'top-cut', rect: { x: 50, y: 20, w: 3.7, h: 40 } },
      { id: 'outside', rect: { x: 120, y: 60, w: 3.7, h: 40 } },
    ];
    const result = Object.fromEntries(classifyRects(items, poly).map((c) => [c.item.id, c.relation]));
    assert.deepEqual(result, { inside: 'inside', 'left-cut': 'cut', 'top-cut': 'cut', outside: 'outside' });
  });
});
