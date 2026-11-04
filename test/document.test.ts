import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DOC_TEMPLATES, DOC_TYPES, applyDocType, documentDefaults, parseDocLines } from '../src/props/document.ts';
import { PROP_KINDS, defaultState, parseSaveText, serializeState } from '../src/state.ts';

describe('日常文件', () => {
  it('七種文件，每種都有範本', () => {
    assert.deepEqual(DOC_TYPES.map((d) => d.value), ['ship', 'train', 'pawn', 'medical', 'autopsy', 'deed', 'envelope']);
    for (const d of DOC_TYPES) assert.ok(DOC_TEMPLATES[d.value].docLines.length > 0, d.value);
  });

  it('欄位寫成「標籤：內容」，全形或半形冒號都可以，沒有冒號的行當成只有內容', () => {
    assert.deepEqual(parseDocLines('由：霧港\n至:上海\n\n認票不認人'), [
      { label: '由', value: '霧港' },
      { label: '至', value: '上海' },
      { label: '', value: '認票不認人' },
    ]);
  });

  it('換種類時套上那種文件的範本，其他設定（字型、紙張狀況）保留', () => {
    const next = applyDocType({ ...documentDefaults, aging: 'heavy' }, 'autopsy');
    assert.equal(next.docType, 'autopsy');
    assert.equal(next.docOrg, DOC_TEMPLATES.autopsy.docOrg);
    assert.equal(next.aging, 'heavy');
    assert.equal(applyDocType(documentDefaults, 'banknote'), documentDefaults, '不認得的種類不變');
  });

  it('不做貨幣、鈔票或現行證件：沒有這類種類，範本用的都是虛構機構', () => {
    const labels = DOC_TYPES.map((d) => d.label).join('');
    for (const word of ['鈔', '幣', '身分證', '護照']) assert.ok(!labels.includes(word), word);
    for (const t of Object.values(DOC_TEMPLATES)) assert.ok(!/中華郵政|交通部|中央銀行/.test(JSON.stringify(t)));
  });

  it('存檔與匯入；舊存檔沒有這個道具時用預設值', () => {
    assert.ok(PROP_KINDS.includes('document'));
    const state = defaultState();
    const next = { ...state, active: 'document' as const, props: { ...state.props, document: applyDocType(state.props.document, 'ship') } };
    const parsed = parseSaveText(serializeState(next));
    assert.ok(parsed.ok);
    if (parsed.ok) {
      assert.equal(parsed.state.props.document.docType, 'ship');
      assert.equal(parsed.state.props.document.docOrg, DOC_TEMPLATES.ship.docOrg);
    }
    const old = JSON.parse(serializeState(state));
    delete old.props.document;
    delete old.extras.document;
    const p2 = parseSaveText(JSON.stringify(old));
    assert.ok(p2.ok);
    if (p2.ok) assert.equal(p2.state.props.document.docType, documentDefaults.docType);
  });
});
