import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { layoutBook, planRubbing, planTalisman } from '../src/lib/relic.ts';
import { relicDefaults } from '../src/props/relic.ts';
import { PROP_KINDS, defaultState, parseSaveText, serializeState } from '../src/state.ts';

describe('古物：古籍殘頁', () => {
  it('標點拿掉、記在前一個字上（朱筆句讀）；依行數與每行字數排，排不下的算出來', () => {
    const b = layoutBook('天地玄黃，宇宙洪荒。日月盈昃', 2, 4, 1);
    assert.deepEqual(b.columns.map((c) => c.map((x) => x.ch).join('')), ['天地玄黃', '宇宙洪荒']);
    assert.equal(b.columns[0]?.[3]?.stop, true);
    assert.equal(b.columns[1]?.[3]?.stop, true);
    assert.equal(b.columns[0]?.[0]?.stop, false);
    assert.equal(b.overflow, 4);
  });

  it('朱筆圈由種子決定，比例 0 時沒有圈', () => {
    const text = relicDefaults.bookText;
    const a = layoutBook(text, 9, 18, 5, 0.5);
    assert.deepEqual(a, layoutBook(text, 9, 18, 5, 0.5));
    assert.notDeepEqual(a, layoutBook(text, 9, 18, 6, 0.5));
    assert.ok(a.columns.flat().some((c) => c.circled));
    assert.ok(!layoutBook(text, 9, 18, 5, 0).columns.flat().some((c) => c.circled));
  });
});

describe('古物：碑文拓片', () => {
  const area = { x: 30, y: 70, w: 150, h: 190 };
  it('剝落的字與剝落範圍由種子決定，殘缺越多剝落越多', () => {
    const a = planRubbing(9, area, 9, 14, 40);
    assert.deepEqual([...a.missing], [...planRubbing(9, area, 9, 14, 40).missing]);
    const few = planRubbing(9, area, 9, 14, 0).missing.size;
    const many = planRubbing(9, area, 9, 14, 100).missing.size;
    assert.ok(many > few, `${few} → ${many}`);
    for (const key of a.missing) {
      const [c, j] = key.split(',').map(Number);
      assert.ok((c ?? -1) >= 0 && (c ?? 99) < 9 && (j ?? -1) >= 0 && (j ?? 99) < 14);
    }
    assert.ok(a.edge.length > 40, '墨拓外緣不整齊');
  });
});

describe('古物：符籙', () => {
  it('同一個種子同樣的筆畫、換種子就不同；筆畫都在紙上，繁簡影響筆畫數', () => {
    const a = planTalisman(3, 90, 260, 60);
    assert.deepEqual(a, planTalisman(3, 90, 260, 60));
    assert.notDeepEqual(a.strokes, planTalisman(4, 90, 260, 60).strokes);
    for (const s of a.strokes) for (const p of s.outline) assert.ok(p.x > -5 && p.x < 95 && p.y > 0 && p.y < 260, JSON.stringify(p));
    const simple = Math.min(...[1, 2, 3, 4, 5].map((seed) => planTalisman(seed, 90, 260, 0).strokes.length));
    const rich = Math.max(...[1, 2, 3, 4, 5].map((seed) => planTalisman(seed, 90, 260, 100).strokes.length));
    assert.ok(rich > simple, `${simple} → ${rich}`);
    assert.ok(a.textBox.y1 > a.textBox.y0);
  });
});

describe('古物：存檔', () => {
  it('第五個道具「古物」可以存檔、匯入，舊存檔沒有它時用預設值', () => {
    assert.ok(PROP_KINDS.includes('relic'));
    const state = defaultState();
    const next = { ...state, active: 'relic' as const, props: { ...state.props, relic: { ...state.props.relic, relicType: 'talisman' as const, complexity: 90 } } };
    const parsed = parseSaveText(serializeState(next));
    assert.ok(parsed.ok);
    if (parsed.ok) {
      assert.equal(parsed.state.active, 'relic');
      assert.equal(parsed.state.props.relic.relicType, 'talisman');
      assert.deepEqual(parsed.state.extras.relic, { crop: null, decorations: [] });
    }
    const old = JSON.parse(serializeState(state));
    delete old.props.relic;
    delete old.extras.relic;
    const parsedOld = parseSaveText(JSON.stringify(old));
    assert.ok(parsedOld.ok);
    if (parsedOld.ok) assert.equal(parsedOld.state.props.relic.relicType, relicDefaults.relicType);
  });
});
