import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { decorationShape, type Primitive } from '../src/lib/decorations.ts';
import { charJitter, madText } from '../src/lib/madness.ts';
import { stripMarkup } from '../src/lib/markup.ts';
import { DECORATION_TYPES } from '../src/props/extras.ts';

/** 從 path 的座標數字粗估範圍（只取 M、L、Q、H、V 後面的絕對座標）。 */
function pathExtent(p: Primitive): number {
  if (p.kind === 'text') return Math.hypot(p.x, p.y) + p.size;
  const nums = (p.d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  return nums.reduce((m, n) => Math.max(m, Math.abs(n)), 0);
}

describe('裝飾形狀', () => {
  for (const { value: type } of DECORATION_TYPES) {
    it(`${type}：同種子相同、換種子不同、大小合理`, () => {
      const a = decorationShape(type, 11, '');
      const b = decorationShape(type, 11, '');
      assert.deepEqual(a, b);
      assert.ok(a.primitives.length > 0);
      for (const p of a.primitives) {
        assert.ok(pathExtent(p) < a.radius * 2.2 + 10, `${type} 超出範圍：${pathExtent(p)} > ${a.radius}`);
        if (p.kind === 'path') assert.match(p.d, /^M/);
      }
      if (type !== 'fingerprint' && type !== 'red-arrow' && type !== 'stamp' && type !== 'pencil-note' && type !== 'coffee-ring') {
        assert.notDeepEqual(decorationShape(type, 12, ''), a, `${type} 換種子後應不同`);
      }
    });
  }

  it('戳記與眉批使用自訂文字，沒填時用預設', () => {
    const custom = decorationShape('stamp', 1, '作廢').primitives.find((p) => p.kind === 'text');
    assert.equal(custom?.kind === 'text' && custom.text, '作廢');
    const def = decorationShape('stamp', 1, '').primitives.find((p) => p.kind === 'text');
    assert.equal(def?.kind === 'text' && def.text, '機密');
  });
});

describe('越寫越亂', () => {
  const o = { strength: 80, start: 10, seed: 5 };

  it('開始之前或強度為 0 時不變形', () => {
    assert.equal(charJitter(3, 100, o), null);
    assert.equal(charJitter(50, 100, { ...o, strength: 0 }), null);
  });

  it('同一種子結果相同，數值在合理範圍', () => {
    for (let i = 10; i < 100; i++) {
      const j = charJitter(i, 100, o);
      assert.deepEqual(j, charJitter(i, 100, o));
      assert.ok(j);
      assert.ok(Math.abs(j.dx) <= 0.45 && Math.abs(j.dy) <= 0.45);
      assert.ok(Math.abs(j.rotate) <= 45);
      assert.ok(j.scale >= 0.7 && j.scale <= 1.45);
      assert.ok(j.ink >= 0.4 && j.ink <= 1);
    }
  });

  it('越往後越亂（平均旋轉幅度變大）', () => {
    const avg = (from: number, to: number): number => {
      let sum = 0;
      for (let i = from; i < to; i++) sum += Math.abs(charJitter(i, 1000, { strength: 100, start: 0, seed: 9 })?.rotate ?? 0);
      return sum / (to - from);
    };
    assert.ok(avg(800, 1000) > avg(0, 200) * 1.5);
  });

  it('同一句重複：開始之後的第一句再寫兩遍', () => {
    const text = '前言照常。夜半有聲。燈將熄矣。';
    const out = madText(text, { start: 5, seed: 1, rewrite: false, repeat: true });
    assert.equal(out, '前言照常。夜半有聲。夜半有聲。夜半有聲。燈將熄矣。');
  });

  it('塗改後重寫：插入刪除線標記，去掉標記後原文的字順序不變', () => {
    const text = '地窖之下另有一層石階通往海底城中燈火通明人聲雜沓不知其為何物';
    const out = madText(text, { start: 3, seed: 2, rewrite: true, repeat: false });
    assert.match(out, /\[刪:/);
    const kept = out.replace(/\[刪:[^\]]*\]/g, '');
    assert.equal(kept, text);
    assert.ok(stripMarkup(out).length > text.length);
    assert.equal(out.slice(0, 3), text.slice(0, 3));
  });
});
