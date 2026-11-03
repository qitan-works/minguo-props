import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EDGE_STYLES, obscuringShapes, planEffects, waterBleed, type ConditionSettings } from '../src/lib/effects.ts';
import { pointInPolygon, polygonBounds, rectPolygonRelation, rectsOverlap, type Rect } from '../src/lib/geometry.ts';
import { hasMarkup, markedChars, parseMarkup, stripMarkup } from '../src/lib/markup.ts';
import { CONDITION_BASE, PRESETS, PRESET_PATCHES, applyPreset, conditionFields } from '../src/props/conditions.ts';
import { sanitizeValue } from '../src/props/schema.ts';

describe('文字層標記', () => {
  it('解析各種標記', () => {
    assert.deepEqual(parseMarkup('甲[保:地窖]乙[毀:鑰匙]丙'), [
      { text: '甲' },
      { text: '地窖', mark: 'protect' },
      { text: '乙' },
      { text: '鑰匙', mark: 'destroy' },
      { text: '丙' },
    ]);
    assert.deepEqual(parseMarkup('[改:三更|四更]'), [{ text: '三更', mark: 'rewrite', replacement: '四更' }]);
    assert.deepEqual(parseMarkup('[黑：機密]'), [{ text: '機密', mark: 'redact' }]);
  });

  it('不成對或未知的方括號照原樣保留', () => {
    assert.deepEqual(parseMarkup('[注意] [保:'), [{ text: '[注意] [保:' }]);
    assert.equal(hasMarkup('[注意]'), false);
  });

  it('去掉標記與逐字標記', () => {
    assert.equal(stripMarkup('甲[刪:乙]丙[改:丁|戊]'), '甲乙丙丁戊');
    const chars = markedChars('甲[斷:乙丙]');
    assert.deepEqual(
      chars.map((c) => c.mark ?? ''),
      ['', 'cutoff', 'cutoff'],
    );
    const rewrite = markedChars('[改:丁丁|戊]');
    assert.equal(rewrite[0]?.replacement, undefined);
    assert.equal(rewrite[1]?.replacement, '戊');
  });
});

describe('情境預設', () => {
  const fields = conditionFields('a', 'b');
  it('每個預設的值都是合法欄位值', () => {
    for (const [name, patch] of Object.entries(PRESET_PATCHES)) {
      for (const [key, value] of Object.entries(patch)) {
        const field = fields.find((f) => f.key === key);
        assert.ok(field, `${name}：未知欄位 ${key}`);
        assert.notEqual(sanitizeValue(field, value), undefined, `${name}.${key} = ${String(value)}`);
      }
    }
    assert.equal(PRESETS.length - 1, Object.keys(PRESET_PATCHES).length);
  });

  it('套用預設會先清掉原本的狀況，保留種子', () => {
    const current = { ...CONDITION_BASE, mold: 80, effectSeed: 777 };
    const next = applyPreset(current, 'fire-letter');
    assert.equal(next.mold, 0);
    assert.equal(next.edge, 'burnt');
    assert.equal(next.effectSeed, 777);
    assert.equal(next.preset, 'fire-letter');
    assert.equal(applyPreset(next, 'custom').edge, 'burnt');
  });
});

function settings(patch: Partial<ConditionSettings>): ConditionSettings {
  return { ...CONDITION_BASE, ...patch };
}

const EVERYTHING: Partial<ConditionSettings> = {
  edgeDepth: 12,
  burnHoles: 5,
  wormHoles: 30,
  pinHoles: true,
  water: 'corner',
  waterStrength: 80,
  stains: true,
  spots: 100,
  mold: 100,
  rust: true,
  tape: true,
  smudge: true,
  wax: true,
  pencilGhost: '別信他',
  crumple: 60,
};

describe('效果規劃：保護區與必毀區', () => {
  const protect: Rect[] = [
    { x: 150, y: 40, w: 8, h: 60 },
    { x: 20, y: 200, w: 30, h: 8 },
  ];
  const destroy: Rect[] = [{ x: 100, y: 150, w: 7, h: 25 }];

  for (const { value: edge } of EDGE_STYLES) {
    it(`紙邊「${edge}」：不同種子下，保護區都在紙內且不被任何效果碰到`, () => {
      for (let seed = 1; seed <= 25; seed++) {
        const plan = planEffects({
          width: 210,
          height: 297,
          settings: settings({ ...EVERYTHING, edge, effectSeed: seed * 7919 }),
          protect,
          destroy,
          crop: null,
        });
        for (const p of protect) {
          assert.equal(rectPolygonRelation(p, plan.outline), 'inside', `種子 ${seed}：保護區被紙邊切到`);
          for (const shape of obscuringShapes(plan)) {
            assert.equal(rectsOverlap(p, shape), false, `種子 ${seed}：保護區被效果遮到`);
          }
          // 浸水範圍若涵蓋保護區，保護區必須被挖成洞
          if (plan.water && rectPolygonRelation(p, plan.water.polygons[0]!) !== 'outside') {
            assert.ok(
              plan.water.polygons.slice(1).some((hole) => rectPolygonRelation(p, hole) === 'inside'),
              `種子 ${seed}：浸水範圍沒有避開保護區`,
            );
          }
        }
      }
    });
  }

  it('必毀區一定被燒洞或墨跡蓋到', () => {
    for (const edge of ['burnt', 'none'] as const) {
      for (let seed = 1; seed <= 10; seed++) {
        const plan = planEffects({
          width: 210,
          height: 297,
          settings: settings({ edge, burnHoles: edge === 'burnt' ? 1 : 0, effectSeed: seed }),
          protect: [],
          destroy,
          crop: null,
        });
        const target = destroy[0]!;
        const covering = [...plan.holes.map((h) => h.polygon), ...plan.blots];
        assert.ok(
          covering.some((poly) => rectPolygonRelation({ x: target.x + 1, y: target.y + 2, w: target.w - 2, h: target.h - 4 }, poly) === 'inside'),
          `${edge} 種子 ${seed}：必毀區沒有被蓋住`,
        );
      }
    }
  });

  it('必毀區是細長的直行、旁邊緊鄰保護區時，毀掉的效果不會碰到保護區', () => {
    const tallDestroy = { x: 121.4, y: 35.8, w: 11.4, h: 64.7 };
    const nearProtect = [
      { x: 136.1, y: 35.8, w: 11.4, h: 55.4 },
      { x: 106.7, y: 35.8, w: 11.4, h: 55.4 },
    ];
    for (const edge of ['none', 'burnt'] as const) {
      for (let seed = 1; seed <= 15; seed++) {
        const plan = planEffects({ width: 210, height: 297, settings: settings({ edge, effectSeed: seed }), protect: nearProtect, destroy: [tallDestroy], crop: null });
        const covering = [...plan.holes.map((h) => h.polygon), ...plan.blots];
        assert.ok(covering.some((poly) => rectPolygonRelation({ x: 123, y: 38, w: 8, h: 60 }, poly) === 'inside'), `${edge} ${seed}：必毀區沒被蓋住`);
        for (const p of nearProtect) for (const poly of covering) assert.equal(rectPolygonRelation(p, poly), 'outside', `${edge} ${seed}：碰到保護區`);
      }
    }
  });

  it('同一種子結果相同，換種子結果不同', () => {
    const run = (seed: number) =>
      planEffects({ width: 210, height: 297, settings: settings({ ...EVERYTHING, edge: 'torn', effectSeed: seed }), protect, destroy, crop: null });
    assert.deepEqual(run(5), run(5));
    assert.notDeepEqual(run(5).outline, run(6).outline);
  });

  it('自由裁切的多邊形作為紙張外形', () => {
    const crop = [
      { x: 20, y: 20 },
      { x: 180, y: 30 },
      { x: 160, y: 260 },
      { x: 30, y: 240 },
    ];
    const plan = planEffects({ width: 210, height: 297, settings: settings({ edge: 'none' }), protect: [], destroy: [], crop });
    assert.deepEqual(plan.outline, crop);
  });

  it('被撕掉一半：保留下來的面積約一半', () => {
    const plan = planEffects({ width: 210, height: 297, settings: settings({ edge: 'half', effectSeed: 3 }), protect: [], destroy: [], crop: null });
    // 粗估：在紙上均勻取樣，落在外形內的比例
    let inside = 0;
    let total = 0;
    for (let x = 2; x < 210; x += 6) {
      for (let y = 2; y < 297; y += 6) {
        total++;
        if (rectPolygonRelation({ x, y, w: 0.01, h: 0.01 }, plan.outline) === 'inside') inside++;
      }
    }
    const ratio = inside / total;
    assert.ok(ratio > 0.3 && ratio < 0.7, `保留比例 ${ratio}`);
  });
});

describe('浸水與火燒（第三版）', () => {
  const protect: Rect[] = [{ x: 60, y: 120, w: 30, h: 8 }];
  const base = { width: 210, height: 297, protect, destroy: [], crop: null, variant: 0 } as const;

  it('浸水：有三圈潮線、起皺的紋路避開保護區、墨色偏藍或偏褐', () => {
    for (const tint of ['blue', 'brown'] as const) {
      const plan = planEffects({ ...base, settings: settings({ water: 'half', waterStrength: 70, waterTint: tint }) });
      assert.ok(plan.water);
      assert.equal(plan.water.tint, tint);
      assert.equal(plan.water.tides.length, 3);
      assert.ok(plan.water.wrinkles.length >= 8);
      for (const w of plan.water.wrinkles) for (const p of w) assert.ok(!protect.some((r) => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h));
    }
    // 舊存檔沒有墨色欄位：偏褐
    const old = planEffects({ ...base, settings: settings({ water: 'corner', waterStrength: 40 }) });
    assert.equal(old.water?.tint, 'brown');
  });

  it('火燒邊由外往內：十圈焦痕由深到淺，都在紙內、不碰保護區，另有灰燼碎片與焦裂', () => {
    const plan = planEffects({ ...base, protect: [{ x: 12, y: 40, w: 30, h: 10 }], settings: settings({ edge: 'burnt', edgeDepth: 9 }) });
    const marks = plan.char.edge;
    assert.ok(marks);
    assert.equal(marks.bands.length, 10);
    for (let i = 1; i < marks.bands.length; i++) assert.ok(marks.bands[i]!.depth < marks.bands[i - 1]!.depth);
    const inside = marks.bands.flatMap((b) => b.line).filter((p) => p.x > 0 && p.x < 210 && p.y > 0 && p.y < 297).length;
    assert.ok(inside / marks.bands.flatMap((b) => b.line).length > 0.98);
    for (const b of marks.bands.slice(-6)) for (const p of b.line) assert.ok(!(p.x > 12 && p.x < 42 && p.y > 40 && p.y < 50), '焦痕蓋到保護區');
    assert.ok(marks.flakes.length > 20 && marks.flakes.some((f) => f.ash) && marks.flakes.some((f) => !f.ash));
    assert.ok(marks.cracks.length > 5);
  });

  it('燒洞也有焦痕，往洞外（紙面）擴散', () => {
    const plan = planEffects({ ...base, settings: settings({ burnHoles: 3 }) });
    const burns = plan.holes.filter((h) => h.kind === 'burn');
    assert.equal(plan.char.holes.length, burns.length);
    for (let i = 0; i < burns.length; i++) {
      const hole = burns[i]!.polygon;
      const cx = hole.reduce((s, p) => s + p.x, 0) / hole.length;
      const cy = hole.reduce((s, p) => s + p.y, 0) / hole.length;
      const r0 = Math.max(...hole.map((p) => Math.hypot(p.x - cx, p.y - cy)));
      const outer = plan.char.holes[i]!.bands[0]!.line;
      const avg = outer.reduce((s, p) => s + Math.hypot(p.x - cx, p.y - cy), 0) / outer.length;
      assert.ok(avg > r0 * 0.9, '最外圈的焦痕要在洞外');
    }
  });

  it('不用 backdrop-filter（列印成 PDF 時不會畫出來，預覽和 PDF 會不一樣）', async () => {
    const { readdir, readFile } = await import('node:fs/promises');
    const root = new URL('../src/', import.meta.url);
    for (const entry of await readdir(root, { recursive: true })) {
      if (!/\.(ts|css|html)$/.test(entry)) continue;
      const text = await readFile(new URL(entry, root), 'utf8');
      assert.equal(/backdrop-filter\s*:|'backdrop-filter'/.test(text), false, entry);
    }
  });

  it('浸水程度 50：字邊明顯擴散、變色；80 以上字身糊開超過一筆的寬度、原字被洗掉大半', () => {
    const [halo50, body50] = waterBleed(50, 'brown').layers;
    assert.ok(halo50 && body50);
    assert.ok(halo50.blur >= 1, `外圍的暈只有 ${halo50.blur} 公釐`);
    assert.ok(body50.blur >= 0.45, `字身只糊開 ${body50.blur} 公釐`);
    assert.ok(halo50.opacity >= 0.6 && body50.opacity >= 0.7, '暈開的字要夠濃才看得出來');
    assert.ok(waterBleed(50, 'brown').wash >= 0.45, '原本清楚的字要洗淡一半左右');
    // 變色：偏褐（紅明顯大於藍）或偏藍（藍明顯大於紅），而且不是原本的黑色
    for (const l of waterBleed(50, 'brown').layers) assert.ok(l.color[0] - l.color[2] >= 40 && l.color[0] + l.color[1] + l.color[2] > 150, `${l.color}`);
    for (const l of waterBleed(50, 'blue').layers) assert.ok(l.color[2] - l.color[0] >= 40 && l.color[0] + l.color[1] + l.color[2] > 150, `${l.color}`);

    const strong = waterBleed(85, 'brown');
    assert.ok(strong.layers[1]!.blur >= 0.8, '字身糊開超過一筆的寬度');
    assert.ok(strong.wash >= 0.75, '原本清楚的字被洗掉大半');
    assert.ok(strong.soaked && strong.soaked.blur >= 2.5, '泡得最久的地方字幾乎無法辨識');
    assert.equal(waterBleed(20, 'brown').soaked, null, '輕微浸水沒有泡爛的地方');

    // 越高越嚴重
    for (let s = 10; s <= 100; s += 10) {
      const a = waterBleed(s - 10, 'blue');
      const b = waterBleed(s, 'blue');
      assert.ok(b.wash > a.wash && b.stain > a.stain);
      b.layers.forEach((l, i) => assert.ok(l.blur > a.layers[i]!.blur && l.opacity > a.layers[i]!.opacity));
    }
  });

  it('泡得最久的幾塊：在水漬範圍與紙內、不碰保護區、互不重疊、壓在紙面中間', () => {
    for (const water of ['half', 'whole', 'corner'] as const) {
      for (const effectSeed of [1, 2, 3, 4]) {
        const plan = planEffects({ ...base, settings: settings({ water, waterStrength: 90, effectSeed }) });
        const soaked = plan.water?.soaked ?? [];
        if (water !== 'corner') assert.ok(soaked.length >= 1, `${water} 種子 ${effectSeed} 沒有泡爛的地方`);
        const region = plan.water!.polygons[0]!;
        soaked.forEach((blob, i) => {
          for (const p of blob) assert.ok(pointInPolygon(p, region) && pointInPolygon(p, plan.outline));
          const b = polygonBounds(blob);
          for (const r of protect) assert.equal(rectPolygonRelation(r, blob), 'outside');
          const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
          assert.ok(c.x > 210 * 0.1 && c.x < 210 * 0.9 && c.y > 297 * 0.1 && c.y < 297 * 0.9, '要壓在寫字的地方');
          soaked.slice(i + 1).forEach((o) => assert.equal(rectsOverlap(b, polygonBounds(o)), false));
        });
        assert.deepEqual(planEffects({ ...base, settings: settings({ water, waterStrength: 90, effectSeed }) }).water?.soaked, soaked);
      }
    }
    assert.deepEqual(planEffects({ ...base, settings: settings({ water: 'half', waterStrength: 20 }) }).water?.soaked, []);
  });
});
