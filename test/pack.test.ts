import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MAX_SHARE_CHARS, clueLabel, compactAgainst, decodeShare, encodeShare, summaryOf } from '../src/lib/pack.ts';
import { PACK_LIMITS, defaultState, parseSaveText, sanitizePack, serializeState, type PackEntry } from '../src/state.ts';

function entry(kind: PackEntry['kind'], id: string, scene = ''): PackEntry {
  const s = defaultState();
  return { id, kind, scene, props: s.props[kind], extras: s.extras[kind] };
}

describe('線索包', () => {
  it('依序編號為線索一、二……十、十一', () => {
    assert.deepEqual([0, 1, 9, 10, 19].map(clueLabel), ['線索一', '線索二', '線索十', '線索十一', '線索二十']);
  });

  it('摘要取第一個有內容的欄位，太長截斷', () => {
    assert.equal(summaryOf({ headline: '柳巷古宅夜半怪聲' }), '柳巷古宅夜半怪聲');
    assert.equal(summaryOf({ headline: '', body: '一二三四五六七八九十一二三四五六七八九十' }), '一二三四五六七八九十一二三四五六七八…');
  });

  it('存檔帶著線索包，匯入時逐件驗證；舊存檔沒有線索包', () => {
    const state = defaultState();
    const pack = [entry('letter', 'k1', '第二幕，在書房抽屜裡'), entry('telegram', 'k2')];
    const parsed = parseSaveText(serializeState({ ...state, pack }));
    assert.ok(parsed.ok);
    if (parsed.ok) {
      assert.deepEqual(parsed.state.pack.map((e) => [e.id, e.kind, e.scene]), [['k1', 'letter', '第二幕，在書房抽屜裡'], ['k2', 'telegram', '']]);
      assert.deepEqual(parsed.state.pack[0]?.props, state.props.letter);
    }
    assert.ok(!serializeState(state).includes('"pack"'), '空的線索包不存');
    const old = parseSaveText(serializeState(state));
    assert.ok(old.ok && old.state.pack.length === 0);
  });

  it('格式不符的那一件丟棄並提示；超過上限截斷', () => {
    const warnings: string[] = [];
    const out = sanitizePack([{ id: 'a', kind: 'letter', props: { body: '只改正文' } }, { id: 'b', kind: 'banknote' }, { id: 'has space', kind: 'card' }, 'x'], warnings);
    assert.equal(out.length, 1);
    assert.equal((out[0]?.props as { body: string }).body, '只改正文');
    assert.equal((out[0]?.props as { closing: string }).closing, defaultState().props.letter.closing, '缺的欄位用預設值');
    assert.equal(warnings.length, 1);
    assert.equal(sanitizePack([...Array(PACK_LIMITS.entries + 3)].map((_, i) => ({ id: `k${i}`, kind: 'card' }))).length, PACK_LIMITS.entries);
    assert.deepEqual(sanitizePack('nope', []), []);
  });

  it('分享網址：只放和預設值不同的欄位，壓縮後來回一次相同；一般的線索包在長度上限內', async () => {
    const s = defaultState();
    const letter = { ...s.props.letter, body: '霧港來信' };
    const compact = compactAgainst(letter as never, s.props.letter as never);
    assert.deepEqual(compact, { body: '霧港來信' });
    const pack = [entry('letter', 'k1', '第一幕'), entry('telegram', 'k2', '第二幕'), entry('card', 'k3')].map((e) => ({ ...e, props: compactAgainst(e.props as never, s.props[e.kind] as never) }));
    const text = await encodeShare(pack);
    assert.match(text, /^[A-Za-z0-9_-]+$/);
    assert.ok(text.length < MAX_SHARE_CHARS, `${text.length}`);
    assert.deepEqual(await decodeShare(text), pack);
    const back = sanitizePack(await decodeShare(text));
    assert.deepEqual(back.map((e) => e.scene), ['第一幕', '第二幕', '']);
    assert.deepEqual(back[0]?.props, s.props.letter, '缺的欄位補回預設值');
    await assert.rejects(decodeShare('不是網址安全的字'));
  });
});
