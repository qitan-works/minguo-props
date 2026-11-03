import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EDGE_STYLES, obscuringShapes, planEffects, type ConditionSettings } from '../src/lib/effects.ts';
import { rectPolygonRelation, rectsOverlap, type Rect } from '../src/lib/geometry.ts';
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
