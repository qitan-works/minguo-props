import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { bloodPalette, decorationShape, placeDecoration, type Primitive } from '../src/lib/decorations.ts';
import { rectsOverlap } from '../src/lib/geometry.ts';
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

describe('裝飾的質感（第三版）', () => {
  const rgb = (c: string): number[] => (/rgb\((\d+) (\d+) (\d+)/.exec(c) ?? []).slice(1).map(Number);

  it('血跡分新鮮與乾涸：新鮮偏鮮紅，乾涸偏褐，都是紅大於綠藍', () => {
    const fresh = bloodPalette(false);
    const dry = bloodPalette(true);
    for (const pal of [fresh, dry]) for (const c of Object.values(pal)) {
      const [r, g, b] = rgb(c);
      assert.ok(r! > g! && r! > b!, c);
    }
    // 乾涸的綠色成分較高（偏褐），新鮮的較純紅
    assert.ok(rgb(dry.mid)[1]! > rgb(fresh.mid)[1]!);
    assert.notDeepEqual(decorationShape('blood-splatter', 5, '', true), decorationShape('blood-splatter', 5, '', false));
  });

  it('噴濺：中心淡邊緣深的漸層、不規則邊緣、大小不一的衛星血點與拉長血滴', () => {
    const shape = decorationShape('blood-splatter', 21, '', true);
    const grad = shape.gradients?.[0];
    assert.ok(grad);
    const alpha = (c: string): number => Number(/\/ ([0-9.]+)\)/.exec(c)?.[1]);
    assert.ok(alpha(grad.stops[0]![1]) < alpha(grad.stops[grad.stops.length - 1]![1]), '中心要比邊緣淡');
    assert.ok(shape.primitives.some((p) => p.kind === 'path' && p.filter === 'rough'));
    const drops = shape.primitives.filter((p) => p.kind === 'path' && p.fill !== 'none' && !p.fill.startsWith('grad:'));
    assert.ok(drops.length >= 40, `只有 ${drops.length} 個血點`);
    assert.ok(shape.primitives.some((p) => p.kind === 'path' && p.filter === 'fine'), '要有拉長的血滴');
  });

  it('滴落有淚滴形與流痕；拖痕有斷續的刷痕', () => {
    const drip = decorationShape('blood-drip', 3, '', false);
    assert.ok(drip.primitives.filter((p) => p.kind === 'path' && p.filter === 'fine').length >= 4);
    const smear = decorationShape('blood-smear', 3, '', true);
    const streaks = smear.primitives.filter((p) => p.kind === 'path' && p.fill === 'none' && p.stroke);
    assert.ok(streaks.length >= 18);
    assert.ok(streaks.some((p) => p.kind === 'path' && p.dash), '刷痕要斷斷續續');
  });

  it('血手印：掌與五指，遮罩留出掌紋、指節與缺塊', () => {
    const shape = decorationShape('handprint', 8, '', true);
    const filled = shape.primitives.filter((p) => p.kind === 'path' && p.fill !== 'none');
    assert.ok(filled.length >= 1 + 5 * 2, '掌、五指與指尖');
    const mask = shape.mask ?? [];
    assert.equal(mask[0]?.kind === 'path' && mask[0].fill, 'white');
    assert.ok(mask.filter((p) => p.kind === 'path' && p.stroke === 'black').length >= 3 + 9, '掌紋三條＋指節');
    assert.ok(mask.filter((p) => p.kind === 'path' && p.fill === 'black').length >= 2, '按壓不均的缺塊');
  });

  it('抓痕：三到四道，頭尾尖細，中間露出淺色纖維', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const shape = decorationShape('claw', seed, '');
      const gouges = shape.primitives.filter((p) => p.kind === 'path' && p.fill.startsWith('rgb(48 20 10'));
      assert.ok(gouges.length >= 3 && gouges.length <= 4);
      for (const g of gouges) {
        if (g.kind !== 'path') continue;
        const nums = (g.d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
        const pts: { x: number; y: number }[] = [];
        for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i]!, y: nums[i + 1]! });
        const half = pts.length / 2;
        const width = (k: number): number => Math.abs(pts[pts.length - 1 - k]!.x - pts[k]!.x);
        assert.ok(width(0) < 0.15 && width(Math.floor(half / 2)) > 1, '頭要尖、中間要寬');
      }
      assert.ok(shape.primitives.some((p) => p.kind === 'path' && p.fill.startsWith('rgb(214 196 160')));
    }
  });

  it('黏液半透明、有光澤與垂流', () => {
    const shape = decorationShape('slime', 4, '');
    const stops = shape.gradients?.[0]?.stops ?? [];
    assert.ok(stops.every(([, c]) => Number(/\/ ([0-9.]+)\)/.exec(c)?.[1]) < 0.7));
    assert.ok(shape.primitives.some((p) => p.kind === 'path' && p.fill.startsWith('rgb(245 255 235')));
  });

  it('新增的裝飾不疊在正中央：依序錯開、避開保護區、留在紙內', () => {
    const protect = [{ x: 90, y: 130, w: 40, h: 30 }];
    const existing: { x: number; y: number }[] = [];
    for (let i = 0; i < 6; i++) {
      const p = placeDecoration({ width: 210, height: 297, radius: 20, existing, protect });
      assert.ok(p.x > 10 && p.y > 10 && p.x < 200 && p.y < 287);
      assert.ok(!rectsOverlap({ x: p.x - 16, y: p.y - 16, w: 32, h: 32 }, protect[0]!), `第 ${i + 1} 個碰到保護區`);
      for (const e of existing) assert.ok(Math.hypot(e.x - p.x, e.y - p.y) >= 20, '和前一個疊在一起');
      existing.push(p);
    }
  });
});
