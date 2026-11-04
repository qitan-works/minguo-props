import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MAX_SHARE_BYTES, MAX_SHARE_CHARS, MAX_SHARE_INPUT, ShareTooLargeError, clueLabel, compactAgainst, decodeShare, encodeShare, summaryOf } from '../src/lib/pack.ts';
import { PACK_LIMITS, combinePack, defaultState, parseSaveText, sanitizePack, serializeState, type PackEntry } from '../src/state.ts';

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

  it('讀網址：太長的字串直接拒絕；解壓縮炸彈（很短的網址解壓成巨大的資料）讀到上限就中止', async () => {
    await assert.rejects(decodeShare('A'.repeat(MAX_SHARE_INPUT + 1)), ShareTooLargeError);
    // 6 MB 的同一個字，壓縮後只有幾 KB，網址長度在讀取上限內，但解壓縮會超過 4 MB
    const bomb = await encodeShare('a'.repeat(6 * 1024 * 1024));
    assert.ok(bomb.length <= MAX_SHARE_INPUT, `炸彈的網址 ${bomb.length} 字元`);
    await assert.rejects(decodeShare(bomb), (err: unknown) => err instanceof ShareTooLargeError && /4 MB/.test(err.message));
    // 上限可以調低：同一份正常的資料超過上限也會中止
    const small = await encodeShare({ a: 'x'.repeat(5000) });
    await assert.rejects(decodeShare(small, { bytes: 1000 }), ShareTooLargeError);
    assert.deepEqual(await decodeShare(small), { a: 'x'.repeat(5000) });
    assert.ok(MAX_SHARE_BYTES === 4 * 1024 * 1024);
  });

  it('打開帶線索包的網址、本機已有線索包時：只預覽不改、取代、附加（編號重複的換新編號）', () => {
    const local = [entry('letter', 'k1'), entry('card', 'k2')];
    const incoming = [entry('telegram', 'k1', '別人的第一幕'), entry('newspaper', 'z9')];
    assert.equal(combinePack(local, incoming, 'preview'), null, '只預覽：本機的線索包不變');
    assert.deepEqual(combinePack(local, incoming, 'replace'), incoming);
    const appended = combinePack(local, incoming, 'append') ?? [];
    assert.deepEqual(appended.map((e) => e.kind), ['letter', 'card', 'telegram', 'newspaper']);
    assert.equal(new Set(appended.map((e) => e.id)).size, 4, '編號不重複');
    assert.equal(appended[2]?.scene, '別人的第一幕');
    const full = [...Array(PACK_LIMITS.entries)].map((_, i) => entry('card', `f${i}`));
    assert.equal(combinePack(full, incoming, 'append')?.length, PACK_LIMITS.entries, '附加後不超過上限');
  });
});
