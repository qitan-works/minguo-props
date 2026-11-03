import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { cutFrame } from '../src/lib/newspaper/blocks.ts';
import { LIMITS, defaultExtras, sanitizeDecoration, sanitizeExtras } from '../src/props/extras.ts';
import { PROP_LABELS, SAVE_FORMAT, defaultState, parseSaveObject, parseSaveText, serializeState, updateExtras } from '../src/state.ts';

describe('存檔格式第二版', () => {
  it('結構化資料（新聞、鎖定、刪除、裁切、裝飾）可以完整來回轉換', () => {
    let state = defaultState();
    state = updateExtras(state, 'newspaper', {
      items: [{ id: 'u1', kind: 'notice', title: '尋人', body: '林某離家未歸。' }],
      locked: [{ id: 's03', kind: 'short', title: '燈塔看守人失蹤', body: '……' }],
      removed: ['a01', 'n02'],
      crop: [
        { x: 10, y: 10 },
        { x: 100, y: 12 },
        { x: 90, y: 150 },
      ],
    });
    state = updateExtras(state, 'letter', {
      decorations: [{ id: 'd1', type: 'stamp', x: 50, y: 60, rotate: -12, scale: 1.2, opacity: 0.8, z: 2, seed: 99, text: '機密' }],
    });
    const result = parseSaveText(serializeState(state));
    assert.ok(result.ok);
    assert.deepEqual(result.state, state);
    assert.deepEqual(result.warnings, []);
  });

  it('第一版存檔可以匯入：「污漬位置」轉成數字種子', () => {
    const v1 = {
      format: SAVE_FORMAT,
      version: 1,
      active: 'letter',
      props: { letter: { stainSeed: '5', body: '舊信' }, card: { stainSeed: '2' } },
    };
    const result = parseSaveObject(v1);
    assert.ok(result.ok);
    assert.equal(result.state.props.letter.effectSeed, 5);
    assert.equal(result.state.props.card.effectSeed, 2);
    assert.equal(result.state.props.letter.body, '舊信');
    assert.deepEqual(result.state.extras, defaultExtras());
    assert.equal('stainSeed' in result.state.props.letter, false);
  });

  it('不合法的結構化資料逐項丟棄並提示', () => {
    const { extras, warnings } = sanitizeExtras(
      {
        newspaper: {
          items: [
            { id: 'ok1', kind: 'short', title: '好', body: '好' },
            { id: 'bad id!', kind: 'short', title: 'x', body: 'x' },
            { id: 'k2', kind: 'poster', title: 'x', body: 'x' },
            'nope',
          ],
          removed: ['a01', 42],
          crop: [{ x: 1, y: 1 }],
        },
        letter: { decorations: [{ id: 'd', type: 'unknown' }] },
      },
      PROP_LABELS,
    );
    assert.deepEqual(
      extras.newspaper.items.map((i) => i.id),
      ['ok1'],
    );
    assert.deepEqual(extras.newspaper.removed, ['a01']);
    assert.equal(extras.newspaper.crop, null);
    assert.deepEqual(extras.letter.decorations, []);
    assert.ok(warnings.length >= 4);
  });

  it('數量超過上限時截斷', () => {
    const many = Array.from({ length: LIMITS.items + 5 }, (_, i) => ({ id: `u${i}`, kind: 'short', title: 't', body: 'b' }));
    const { extras, warnings } = sanitizeExtras({ newspaper: { items: many } }, PROP_LABELS);
    assert.equal(extras.newspaper.items.length, LIMITS.items);
    assert.ok(warnings.some((w) => w.includes('5 項')));
  });

  it('裝飾的數值範圍', () => {
    const base = { id: 'd1', type: 'claw', x: 1, y: 1, rotate: 0, scale: 1, opacity: 1, z: 0, seed: 3, text: '' };
    assert.ok(sanitizeDecoration(base));
    assert.equal(sanitizeDecoration({ ...base, scale: 99 }), null);
    assert.equal(sanitizeDecoration({ ...base, opacity: 2 }), null);
    assert.equal(sanitizeDecoration({ ...base, seed: 0 }), null);
    assert.equal(sanitizeDecoration({ ...base, z: 1.5 }), null);
  });

  it('隨機種子欄位只接受合法整數', () => {
    const result = parseSaveObject({ format: SAVE_FORMAT, version: 2, props: { newspaper: { fillSeed: -3, cutSeed: 12 } } });
    assert.ok(result.ok);
    assert.equal(result.state.props.newspaper.fillSeed, defaultState().props.newspaper.fillSeed);
    assert.equal(result.state.props.newspaper.cutSeed, 12);
  });
});

describe('從整版剪下：剪裁範圍', () => {
  const bounds = { x: 0, y: 0, w: 210, h: 297 };
  it('錨點向外多留邊', () => {
    assert.deepEqual(cutFrame({ x: 100, y: 50, w: 40, h: 80 }, { top: 5, right: 6, bottom: 7, left: 8 }, bounds), {
      x: 92,
      y: 45,
      w: 54,
      h: 92,
    });
  });
  it('超出紙面時限制在紙內', () => {
    const f = cutFrame({ x: 190, y: 5, w: 15, h: 20 }, { top: 20, right: 20, bottom: 0, left: 0 }, bounds);
    assert.deepEqual(f, { x: 190, y: 0, w: 20, h: 25 });
  });
  it('負數多留邊會剪進新聞，但不會剪到消失', () => {
    const f = cutFrame({ x: 100, y: 50, w: 40, h: 80 }, { top: -50, right: -50, bottom: -50, left: -50 }, bounds);
    assert.ok(f.w >= 5 && f.h >= 5);
  });
});
