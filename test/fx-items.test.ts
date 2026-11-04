import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CLEARED_QUICK,
  FX_KINDS,
  FX_LIMITS,
  FX_STYLES,
  SHAPE_KINDS,
  changeStyle,
  compactFxItem,
  createFxItem,
  fxDefaults,
  itemsFromConditions,
  placeFx,
  quickGenerate,
  sanitizeFxItem,
  shapeFromPolygon,
  type FxItem,
  type PlaceContext,
} from '../src/lib/fx/catalog.ts';
import { charColor, planFxItem, planFxItems } from '../src/lib/fx/plan.ts';
import { polygonArea, polygonBounds, rectPolygonRelation, rectsOverlap, type Rect } from '../src/lib/geometry.ts';
import { defaultExtras, sanitizeExtras } from '../src/props/extras.ts';
import { groupCuts, mergeRects } from '../src/render/fx-items.ts';
import { PROP_LABELS, defaultState, parseSaveText, serializeState } from '../src/state.ts';

const ctx: PlaceContext = { bounds: { x: 0, y: 0, w: 210, h: 297 }, protect: [] };
const at = { x: 100, y: 140 };

function item(kind: FxItem['kind'], style: string, seed = 12345, patch: Partial<FxItem> = {}): FxItem {
  return { ...createFxItem(kind, style, at, seed, 0, `t-${kind}-${style}`), ...patch };
}

describe('特效項目：種類與樣式', () => {
  it('十三種效果，每種至少四個樣式；燒、水、撕有指定的樣式', () => {
    assert.equal(FX_KINDS.length, 13);
    for (const k of FX_KINDS) assert.ok(FX_STYLES[k.value].length >= 4, k.value);
    const has = (kind: FxItem['kind'], values: string[]): void => {
      for (const v of values) assert.ok(FX_STYLES[kind].some((s) => s.value === v), `${kind}:${v}`);
    };
    has('burn', ['hole', 'cigarette', 'flame', 'scorch', 'row']);
    has('water', ['round', 'splash', 'tear', 'rain', 'cup', 'soak']);
    has('tear', ['straight', 'zigzag', 'corner', 'bite']);
    assert.deepEqual([...SHAPE_KINDS].sort(), ['burn', 'tear', 'water']);
  });

  it('每個樣式都畫得出東西，同一個種子結果相同、換種子就不同', () => {
    for (const k of FX_KINDS) {
      for (const st of FX_STYLES[k.value]) {
        const a = planFxItem(item(k.value, st.value, 777), { protect: [] });
        const b = planFxItem(item(k.value, st.value, 777), { protect: [] });
        const c = planFxItem(item(k.value, st.value, 778), { protect: [] });
        assert.ok(a.prims.length + a.cuts.length > 0, `${k.value}:${st.value} 沒有東西`);
        assert.deepEqual(a, b, `${k.value}:${st.value} 不穩定`);
        assert.notDeepEqual(JSON.stringify(a.prims) + JSON.stringify(a.cuts), JSON.stringify(c.prims) + JSON.stringify(c.cuts), `${k.value}:${st.value} 換種子沒變`);
      }
    }
  });

  it('同一種效果的不同樣式畫出來不一樣；挖洞的樣式真的挖洞', () => {
    for (const k of FX_KINDS) {
      const shapes = FX_STYLES[k.value].map((st) => JSON.stringify(planFxItem(item(k.value, st.value), { protect: [] }).prims));
      assert.equal(new Set(shapes).size, shapes.length, k.value);
    }
    for (const [kind, style] of [['burn', 'hole'], ['burn', 'flame'], ['burn', 'row'], ['tear', 'straight'], ['tear', 'corner'], ['worm', 'scatter'], ['pin', 'tack']] as const) {
      assert.ok(planFxItem(item(kind, style), { protect: [] }).cuts.length > 0, `${kind}:${style}`);
    }
    assert.equal(planFxItem(item('burn', 'scorch'), { protect: [] }).cuts.length, 0, '只焦不穿');
  });

  it('大小、強度、色調、數量、旋轉都會改變結果', () => {
    const base = item('burn', 'row');
    const plan = (p: Partial<FxItem>): string => JSON.stringify(planFxItem({ ...base, ...p }, { protect: [] }));
    const ref = plan({});
    for (const p of [{ size: 4 }, { strength: 90 }, { tone: 90 }, { count: 8 }, { rotate: 30 }, { irregular: 0 }]) assert.notEqual(plan(p), ref, JSON.stringify(p));
    // 旋轉不改變挖掉的面積
    const area = (p: Partial<FxItem>): number => planFxItem({ ...item('burn', 'hole'), ...p }, { protect: [] }).cuts.reduce((s, c) => s + Math.abs(polygonArea(c)), 0);
    assert.ok(Math.abs(area({}) - area({ rotate: 73 })) < 0.01);
    // 邊緣柔和度換算成模糊
    assert.equal(planFxItem({ ...base, soft: 0 }, { protect: [] }).blur, 0);
    assert.ok(planFxItem({ ...base, soft: 80 }, { protect: [] }).blur > 0);
  });

  it('色調 0 的焦痕顏色與原本紙張狀況的燒洞相同，色調越高越偏褐', () => {
    assert.equal(charColor(9, 10, 0), 'rgb(12 7 4 / 0.97)');
    assert.equal(charColor(0, 10, 0), 'rgb(214 176 92 / 0.07)');
    assert.notEqual(charColor(9, 10, 100), charColor(9, 10, 0));
  });
});

describe('特效項目：保護區', () => {
  const clue: Rect = { x: 95, y: 130, w: 12, h: 20 };

  it('挖洞的效果碰到保護區會縮小或取消，不會挖到線索', () => {
    for (const [kind, style] of [['burn', 'hole'], ['burn', 'row'], ['worm', 'cluster'], ['water', 'soak'], ['tear', 'bite']] as const) {
      const plan = planFxItem(item(kind, style, 99, { size: kind === 'water' ? 30 : undefined as never }), { protect: [clue] });
      for (const c of plan.cuts) assert.equal(rectPolygonRelation(clue, c), 'outside', `${kind}:${style}`);
    }
    const hole = planFxItem(item('burn', 'hole', 5, { size: 10 }), { protect: [clue] });
    assert.equal(hole.shrunk, true);
  });

  it('浸水泡得最久的幾塊與起皺紋路避開保護區', () => {
    const plan = planFxItem(item('water', 'soak', 3, { size: 60, strength: 90 }), { protect: [clue] });
    const soaked = plan.bleeds.find((b) => b.wash > 0);
    for (const poly of soaked?.polygons ?? []) assert.equal(rectPolygonRelation(clue, poly), 'outside');
  });

  it('隨機擺放避開保護區；貼邊、貼角的樣式放在紙邊、紙角', () => {
    const p: PlaceContext = { bounds: { x: 0, y: 0, w: 148, h: 210 }, protect: [{ x: 20, y: 20, w: 100, h: 160 }] };
    for (let seed = 1; seed <= 30; seed++) {
      const a = placeFx('mold', 'colony', 6, seed, p);
      const box = { x: a.x - 6, y: a.y - 6, w: 12, h: 12 };
      assert.ok(!rectsOverlap(box, p.protect[0] as Rect), `seed ${seed}`);
      const e = placeFx('tear', 'straight', 90, seed, p);
      assert.ok(e.x === 0 || e.y === 0 || Math.abs(e.x - 148) < 1e-9 || Math.abs(e.y - 210) < 1e-9);
      const c = placeFx('tear', 'corner', 26, seed, p);
      assert.ok([0, 148].includes(c.x) && [0, 210].includes(c.y) && [0, 90, 180, 270].includes(c.rotate));
    }
  });
});

describe('特效項目：存檔', () => {
  it('只存改過的欄位，匯入時補回預設值', () => {
    const d = item('water', 'cup', 4242);
    assert.deepEqual(Object.keys(compactFxItem(d)).sort(), ['id', 'kind', 'seed', 'style', 'x', 'y']);
    const changed: FxItem = { ...d, size: 22, tone: 80, rotate: 15, z: 3 };
    const packed = compactFxItem(changed);
    assert.deepEqual(Object.keys(packed).sort(), ['id', 'kind', 'rotate', 'seed', 'size', 'style', 'tone', 'x', 'y', 'z']);
    assert.deepEqual(sanitizeFxItem(JSON.parse(JSON.stringify(packed))), changed);
  });

  it('逐項驗證：格式不符的整項丟棄', () => {
    const ok = compactFxItem(item('burn', 'hole'));
    assert.ok(sanitizeFxItem(ok));
    const bad: unknown[] = [
      { ...ok, kind: 'fire' },
      { ...ok, style: 'cup' },
      { ...ok, x: Number.NaN },
      { ...ok, seed: -1 },
      { ...ok, size: 9999 },
      { ...ok, strength: 101 },
      { ...ok, count: 2.5 },
      { ...ok, rotate: '30' },
      { ...ok, id: 'has space' },
      { ...ok, shape: [{ x: 0, y: 0 }] },
      { ...compactFxItem(item('mold', 'ring')), shape: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 0, y: 5 }] },
      null,
      'burn',
    ];
    for (const b of bad) assert.equal(sanitizeFxItem(b), null, JSON.stringify(b));
  });

  it('自訂形狀：中心取外框中心、大小取最遠點，存檔後照樣讀回', () => {
    const r = shapeFromPolygon([{ x: 10, y: 10 }, { x: 50, y: 12 }, { x: 40, y: 40 }, { x: 12, y: 36 }]);
    assert.ok(r);
    assert.equal(r.x, 30);
    assert.equal(r.y, 25);
    const d: FxItem = { ...item('tear', 'straight'), x: r.x, y: r.y, size: r.size, shape: r.shape };
    assert.deepEqual(sanitizeFxItem(JSON.parse(JSON.stringify(compactFxItem(d)))), d);
    // 挖掉的範圍就在畫的形狀附近
    const plan = planFxItem(d, { protect: [] });
    const b = polygonBounds(plan.cuts[0] ?? []);
    assert.ok(b.x > 5 && b.x + b.w < 55 && b.y > 5 && b.y + b.h < 45, JSON.stringify(b));
    assert.equal(shapeFromPolygon([{ x: 0, y: 0 }, { x: 1, y: 0 }]), null);
  });

  it('舊存檔沒有特效項目也能匯入；整份存檔來回一次不變', () => {
    const { extras, warnings } = sanitizeExtras({ letter: { crop: null, decorations: [] } }, PROP_LABELS);
    assert.deepEqual(extras.letter.effects, []);
    assert.deepEqual(warnings, []);
    const state = defaultState();
    const effects = [item('burn', 'flame', 1, { rotate: 90, x: 210, y: 100 }), item('water', 'soak', 2, { strength: 80 }), item('tape', 'cross', 3)];
    const next = { ...state, active: 'letter' as const, extras: { ...state.extras, letter: { ...state.extras.letter, effects } } };
    const text = serializeState(next);
    assert.ok(!text.includes('"irregular"'), '沒改過的欄位不存');
    const parsed = parseSaveText(text);
    assert.ok(parsed.ok);
    if (parsed.ok) {
      assert.deepEqual(parsed.state.extras.letter.effects, effects);
      assert.deepEqual(parsed.warnings, []);
    }
    const tooMany = sanitizeExtras({ card: { effects: [...Array(FX_LIMITS.items + 2)].map(() => compactFxItem(item('pin', 'tack'))) } }, PROP_LABELS);
    assert.equal(tooMany.extras.card.effects.length, FX_LIMITS.items);
    assert.equal(tooMany.warnings.length, 1);
    assert.deepEqual(defaultExtras().newspaper.effects, []);
  });
});

describe('特效項目：快速產生與拆成項目', () => {
  it('快速產生 N 個，每個都可以個別調整（各有自己的編號與種子）', () => {
    let n = 0;
    const made = quickGenerate('burn', 'random', 6, 99, ctx, [], () => `q${n++}`);
    assert.equal(made.length, 6);
    assert.equal(new Set(made.map((m) => m.id)).size, 6);
    assert.equal(new Set(made.map((m) => m.seed)).size, 6);
    assert.deepEqual(made.map((m) => m.z), [0, 1, 2, 3, 4, 5]);
    assert.deepEqual(quickGenerate('burn', 'random', 6, 99, ctx, [], (i) => `q${i}`).map((m) => [m.style, m.x, m.y]), made.map((m) => [m.style, m.x, m.y]), '同一個種子結果相同');
  });

  it('換樣式時，沒改過的欄位跟著新樣式的預設值，改過的保留', () => {
    const d = { ...item('water', 'round'), tone: 90 };
    const next = changeStyle(d, 'soak');
    assert.equal(next.size, fxDefaults('water', 'soak').size);
    assert.equal(next.tone, 90);
  });

  it('紙張狀況的滑桿拆成個別項目，對應的滑桿歸零', () => {
    const made = itemsFromConditions(
      { burnHoles: 3, wormHoles: 10, pinHoles: true, water: 'whole', waterStrength: 70, waterTint: 'blue', folds: true, foldStyle: 'thirds', crumple: 40, stains: true, spots: 50, mold: 30, rust: true, tape: true, smudge: true, wax: true, effectSeed: 7 },
      ctx,
      [],
      (i) => `c${i}`,
    );
    const count = (kind: string): number => made.filter((m) => m.kind === kind).length;
    assert.equal(count('burn'), 3);
    assert.equal(made.find((m) => m.kind === 'worm')?.count, 10);
    assert.equal(count('pin'), 2);
    const soak = made.find((m) => m.kind === 'water' && m.style === 'soak');
    assert.equal(soak?.strength, 70);
    assert.ok(soak?.shape, '整張泡過＝整張紙的形狀');
    assert.equal(made.filter((m) => m.kind === 'fold').length, 2);
    for (const k of ['crumple', 'spots', 'mold', 'rust', 'tape', 'smudge', 'wax']) assert.ok(count(k) > 0, k);
    assert.equal(new Set(made.map((m) => m.id)).size, made.length);
    for (const m of made) assert.ok(sanitizeFxItem(JSON.parse(JSON.stringify(compactFxItem(m)))), `${m.kind}:${m.style} 存得回來`);
    assert.equal(CLEARED_QUICK.burnHoles, 0);
    assert.equal(CLEARED_QUICK.water, 'none');
  });
});

describe('特效項目：畫的時候', () => {
  it('挖洞分組：同一組裡的洞互不重疊（evenodd 才不會抵銷）', () => {
    const plans = planFxItems([item('burn', 'row', 1, { count: 8, size: 3 }), item('worm', 'cluster', 2), item('tear', 'corner', 3)], { protect: [] });
    const cuts = plans.flatMap((p) => p.cuts);
    const groups = groupCuts(cuts);
    assert.equal(groups.flat().length, cuts.length);
    for (const g of groups) {
      for (let i = 0; i < g.length; i++) {
        for (let j = i + 1; j < g.length; j++) assert.ok(!rectsOverlap(polygonBounds(g[i] ?? []), polygonBounds(g[j] ?? [])));
      }
    }
  });

  it('保護區重疊時合併成外接矩形', () => {
    const merged = mergeRects([{ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 }, { x: 40, y: 0, w: 5, h: 5 }]);
    assert.deepEqual(merged, [{ x: 0, y: 0, w: 15, h: 15 }, { x: 40, y: 0, w: 5, h: 5 }]);
  });
});
