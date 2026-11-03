import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { bloodPalette, decorationShape, placeDecoration, type Primitive, type StainTexture } from '../src/lib/decorations.ts';
import { rectsOverlap } from '../src/lib/geometry.ts';
import { charJitter, madGlyph, madText } from '../src/lib/madness.ts';
import { stripMarkup } from '../src/lib/markup.ts';
import { DECORATION_TYPES } from '../src/props/extras.ts';

/** 從 path 的座標數字粗估範圍（只取 M、L、Q、H、V 後面的絕對座標）。 */
function pathExtent(p: Primitive): number {
  if (p.kind === 'text') return Math.hypot(p.x, p.y) + p.size;
  if (p.kind === 'group') return p.children.reduce((m, c) => Math.max(m, pathExtent(c)), 0);
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
  const run = (strength: number, from: number, to: number, total = 1000) =>
    Array.from({ length: to - from }, (_, i) => madGlyph(from + i, total, { strength, start: 0, seed: 9 })!);
  const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

  it('開始之前或強度為 0 時不變形', () => {
    assert.equal(madGlyph(3, 100, o), null);
    assert.equal(madGlyph(50, 100, { ...o, strength: 0 }), null);
  });

  it('同一種子結果相同，數值在合理範圍', () => {
    for (let i = 10; i < 100; i++) {
      const j = madGlyph(i, 100, o);
      assert.deepEqual(j, madGlyph(i, 100, o));
      assert.ok(j);
      assert.ok(Math.abs(j.dx) <= 1 && Math.abs(j.dy) <= 0.4);
      assert.ok(j.size >= 0.8 && j.size <= 1.7);
      assert.ok(j.ink >= 0.3 && j.ink <= 1);
      assert.ok(j.gap >= -0.45 && j.gap <= 0.6);
      assert.ok(j.overdraw.length <= 2);
    }
    assert.deepEqual(charJitter(50, 100, o)?.dx, madGlyph(50, 100, o)?.dx);
  });

  it('越往後越亂、字越寫越大', () => {
    const early = run(100, 0, 150);
    const late = run(100, 850, 1000);
    assert.ok(mean(late.map((g) => Math.abs(g.rotate % 180))) > mean(early.map((g) => Math.abs(g.rotate % 180))) * 1.5);
    assert.ok(mean(late.map((g) => g.size)) > mean(early.map((g) => g.size)) + 0.3);
  });

  it('強度 60 明顯：後段平均旋轉超過 8 度、字放大兩成以上、有重描', () => {
    const late = run(60, 800, 1000);
    assert.ok(mean(late.map((g) => Math.abs(g.rotate))) > 12);
    assert.ok(mean(late.map((g) => g.size)) > 1.2);
    assert.ok(late.filter((g) => g.overdraw.length > 0).length > 20);
  });

  it('強度 100 接近失控：有橫躺與倒寫的字、墨團、大量重描、字距重疊、墨色忽深忽淺', () => {
    const late = run(100, 500, 1000);
    assert.ok(late.some((g) => g.flip === 90) && late.some((g) => g.flip === 180));
    assert.ok(late.filter((g) => g.flip !== 0).length < late.length * 0.05, '只有少數字橫躺或倒寫');
    assert.ok(late.some((g) => g.blob));
    assert.ok(late.filter((g) => g.overdraw.length > 0).length > late.length * 0.25);
    assert.ok(late.some((g) => g.gap < -0.2));
    assert.ok(late.some((g) => g.ink < 0.5) && late.some((g) => g.ink === 1));
  });

  it('行歪斜：位移沿字序平滑變化，相鄰兩字差得比隨機小', () => {
    const late = run(100, 600, 900);
    const steps = late.slice(1).map((g, i) => Math.abs(g.dx - late[i]!.dx));
    const spread = Math.max(...late.map((g) => g.dx)) - Math.min(...late.map((g) => g.dx));
    assert.ok(spread > 1, '整行要偏離格線');
    assert.ok(mean(steps) < spread / 4, '相鄰的字要接近，看起來是整行歪');
  });

  it('亂到一半換字型', () => {
    const opts = { strength: 70, start: 0, seed: 3, switchAt: 0.5 };
    assert.equal(madGlyph(100, 1000, opts)?.alt, false);
    assert.equal(madGlyph(700, 1000, opts)?.alt, true);
    assert.equal(madGlyph(700, 1000, { strength: 70, start: 0, seed: 3 })?.alt, false);
  });

  it('同一句重複：開始之後的第一句再寫兩遍', () => {
    const text = '前言照常。夜半有聲。燈將熄矣。';
    const out = madText(text, { start: 5, seed: 1, rewrite: false, repeat: true });
    assert.equal(out, '前言照常。夜半有聲。夜半有聲。夜半有聲。燈將熄矣。');
  });

  it('同一句寫滿整頁：一直重複到字數夠，後面的原文不再出現', () => {
    const text = '前言照常。夜半有聲。燈將熄矣。';
    const out = madText(text, { start: 5, seed: 1, rewrite: false, repeat: false, fill: 200 });
    assert.ok(Array.from(out).length >= 200);
    assert.ok(out.startsWith('前言照常。夜半有聲。夜半有聲。'));
    assert.equal(out.includes('燈將熄矣'), false);
    assert.equal(out.replaceAll('夜半有聲。', '').replace('前言照常。', ''), '');
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
  const alpha = (c: string): number => Number(/\/ ([0-9.]+)\)/.exec(c)?.[1] ?? 1);
  const luma = (c: string): number => {
    const [r, g, b] = rgb(c);
    return 0.3 * r! + 0.59 * g! + 0.11 * b!;
  };
  const paths = (prims: readonly Primitive[]): Extract<Primitive, { kind: 'path' }>[] =>
    prims.flatMap((p) => (p.kind === 'path' ? [p] : p.kind === 'group' ? paths(p.children) : []));
  /** 濾鏡算出的透明度：斜率 × 雜訊 + 截距，限制在 0～1。 */
  const mottleAlpha = (t: StainTexture, noise: number): number => Math.max(0, Math.min(1, t.mottle[0] * noise + t.mottle[1]));
  const BLOOD = ['blood-splatter', 'blood-drip', 'blood-smear', 'handprint'] as const;

  it('血跡分新鮮與乾涸：新鮮偏鮮紅，乾涸偏褐，都是紅大於綠藍；顏色不透明，重疊處不會疊出深色接縫', () => {
    const fresh = bloodPalette(false);
    const dry = bloodPalette(true);
    for (const pal of [fresh, dry]) for (const c of Object.values(pal)) {
      const [r, g, b] = rgb(c);
      assert.ok(r! > g! && r! > b!, c);
      assert.equal(alpha(c), 1, c);
    }
    // 乾涸的綠色成分較高（偏褐），新鮮的較純紅
    assert.ok(rgb(dry.mid)[1]! > rgb(fresh.mid)[1]!);
    for (const type of BLOOD) assert.notDeepEqual(decorationShape(type, 5, '', true), decorationShape(type, 5, '', false), type);
  });

  it('血跡沒有外框：噴濺、滴落、拖痕的本體都不描邊，也沒有和本體同形狀的框線', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      for (const type of ['blood-splatter', 'blood-drip', 'blood-smear'] as const) {
        const prims = paths(decorationShape(type, seed, '', true).primitives);
        const filled = new Set(prims.filter((p) => p.fill !== 'none').map((p) => p.d));
        for (const p of prims) {
          assert.ok(!(p.fill === 'none' && filled.has(p.d)), `${type} 有一圈外框`);
          // 只有拖痕的刷痕是描邊，而且是開放的細線，不是封閉的框
          if (p.stroke) {
            assert.equal(type, 'blood-smear');
            assert.ok(!p.d.endsWith('Z') && (p.width ?? 0) < 0.6);
          }
        }
      }
    }
  });

  it('邊緣不規則、略柔和，內部由雜訊控制透明度而斑駁；乾涸的比新鮮的斑駁', () => {
    for (const type of BLOOD) {
      for (const dry of [true, false]) {
        const t = decorationShape(type, 9, '', dry).texture;
        assert.ok(t, `${type} 要有污漬質感`);
        assert.ok(t.warp > 0 && t.warpFrequency > 0, '邊緣要擾動成不規則');
        assert.ok(t.soften > 0 && t.soften < 0.3, '邊緣略柔和但不糊掉');
        assert.ok(mottleAlpha(t, 0.65) - mottleAlpha(t, 0.35) > 0.3, `${type} 斑駁不夠：透明度起伏太小`);
        assert.ok(mottleAlpha(t, 0.5) > 0.75, `${type} 大部分要夠濃`);
        assert.ok(Number.isInteger(t.seed));
      }
      const dry = decorationShape(type, 9, '', true).texture!;
      const fresh = decorationShape(type, 9, '', false).texture!;
      assert.ok(mottleAlpha(dry, 0.35) < mottleAlpha(fresh, 0.35), `${type}：乾涸的較斑駁`);
    }
    // 雜訊種子跟著裝飾的種子走（「換一個」會換質感）
    assert.notEqual(decorationShape('blood-splatter', 1, '').texture?.seed, decorationShape('blood-splatter', 2, '').texture?.seed);
  });

  it('噴濺：中心淺邊緣略深的漸層、往外的尖刺、大小不一的衛星血點與拉長血滴', () => {
    const shape = decorationShape('blood-splatter', 21, '', true);
    const grad = shape.gradients?.[0];
    assert.ok(grad?.kind === 'radial');
    const stops = grad.stops.map(([, c]) => c);
    assert.ok(luma(stops[0]!) > luma(stops[stops.length - 1]!), '中心要比邊緣淺');
    assert.ok(luma(stops[0]!) - luma(stops[stops.length - 1]!) < 40, '邊緣只略深，不是一圈深框');
    const drops = paths(shape.primitives).filter((p) => !p.fill.startsWith('grad:'));
    assert.ok(drops.length >= 40, `只有 ${drops.length} 個血點`);
    // 淚滴形（尖刺與拉長血滴）是多邊形，圓點用弧線
    assert.ok(drops.filter((p) => p.d.includes('L')).length >= 6, '要有尖刺與拉長的血滴');
  });

  it('滴落有流痕與淚滴形血珠；拖痕整塊漸淡、有斷續的刷痕', () => {
    const drip = paths(decorationShape('blood-drip', 3, '', false).primitives);
    assert.ok(drip.filter((p) => !p.fill.startsWith('grad:')).length >= 4);
    const smear = decorationShape('blood-smear', 3, '', true);
    const fade = smear.gradients?.find((g) => g.kind === 'linear');
    assert.ok(fade, '抹痕本體用沿拖曳方向的漸層');
    assert.ok(alpha(fade.stops[0]![1]) > alpha(fade.stops[fade.stops.length - 1]![1]) * 5, '越往後越淡');
    const streaks = paths(smear.primitives).filter((p) => p.fill === 'none' && p.stroke);
    assert.ok(streaks.length >= 18);
    assert.ok(streaks.some((p) => p.dash), '刷痕要斷斷續續');
  });

  it('血手印：像按壓的印子，沒有外框、沒有白色橫條與白點；輕重不均、指尖有紋路、有缺塊、往一個方向拖抹', () => {
    for (const seed of [8, 9, 10]) {
      for (const dry of [true, false]) {
        const shape = decorationShape('handprint', seed, '', dry);
        // 本體只有一塊血色，形狀全在遮罩裡
        assert.equal(shape.primitives.length, 1);
        assert.ok(paths(shape.primitives).every((p) => !p.stroke));
        const mask = shape.mask ?? [];
        const all = paths(mask);
        assert.ok(!all.some((p) => p.fill === 'white'), '不能有白點');
        const [print, ridges] = mask;
        assert.ok(print?.kind === 'group' && (print.blur ?? 0) > 0, '壓痕整組略模糊');
        assert.ok(ridges?.kind === 'group');
        // 壓痕：灰階代表輕重，指尖重、掌心凹處輕
        const level = (c: string): number => rgb(c)[0]! / 255;
        const pads = paths(print.children).filter((p) => p.fill.startsWith('rgb('));
        const levels = pads.map((p) => level(p.fill));
        assert.ok(new Set(levels.map((l) => l.toFixed(2))).size >= 10, '輕重要不均');
        assert.ok(levels.some((l) => l >= 0.88), '指尖按得重');
        assert.ok(levels.some((l) => l > 0.15 && l <= 0.45), '掌心凹處輕');
        // 拖抹：殘影（很淡的同形狀）至少五層，另有拖痕細線
        assert.ok(levels.filter((l) => l < 0.3).length >= 5 * 15, '要有往一個方向的殘影');
        assert.ok(paths(print.children).filter((p) => p.fill === 'none' && p.stroke?.startsWith('rgb(')).length >= 10, '要有拖痕');
        // 指尖的紋路：五個指尖、每個至少兩圈，黑色半透明細線
        const lines = paths(ridges.children);
        assert.ok(lines.length >= 5 * 2);
        assert.ok(lines.every((p) => p.stroke === 'black' && (p.opacity ?? 1) < 0.6 && (p.width ?? 1) < 0.2));
        // 隨機缺塊
        assert.ok(paths(print.children).some((p) => p.fill === 'black'), '要有缺塊');
        assert.equal(shape.texture?.soften !== undefined && shape.texture.soften < 0.1, true, '指紋才不會被模糊掉');
      }
    }
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
