import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { FONTS, FONT_OPTIONS } from '../src/fonts.ts';
import { ERAS, ERA_SETTINGS, eraFontPatch, eraPatch, headlineMix, resolveFont } from '../src/props/eras.ts';
import { letterFields } from '../src/props/letter.ts';
import { newspaperFields } from '../src/props/newspaper.ts';

const fontIds = new Set(FONT_OPTIONS.map((o) => o.value));

function optionsOf(fields: readonly { key: string; options?: readonly { value: string }[] }[], key: string): Set<string> {
  return new Set((fields.find((f) => f.key === key)?.options ?? []).map((o) => o.value));
}

describe('年代預設', () => {
  it('每個年代的設定都是合法的選項，字型都是已收錄的字型', () => {
    for (const era of ERAS) {
      const patch = eraPatch(era.value);
      if (era.value === 'custom') {
        assert.equal(patch, null);
        continue;
      }
      assert.ok(patch);
      assert.ok(optionsOf(newspaperFields, 'punctuation').has(patch.punctuation));
      assert.ok(optionsOf(newspaperFields, 'mastheadLayout').has(patch.mastheadLayout));
      for (const id of [patch.fontMasthead, patch.fontTitle, patch.fontBody, patch.fontAd]) assert.ok(fontIds.has(id), `${era.value} ${id}`);
      const fonts = eraFontPatch(era.value);
      assert.ok(fonts && fontIds.has(fonts.fontHand));
      assert.ok(optionsOf(letterFields, 'fontEra').has(era.value));
    }
  });

  it('1910 年代用舊式圈點與右側直排報頭，1930 年代用現代標點', () => {
    assert.equal(ERA_SETTINGS['1910s'].punctuation, 'circle');
    assert.equal(ERA_SETTINGS['1910s'].masthead, 'right');
    assert.equal(ERA_SETTINGS['1930s'].punctuation, 'modern');
    assert.ok(ERA_SETTINGS['1910s'].press > ERA_SETTINGS['1930s'].press, '早期印刷較粗糙');
  });

  it('字型偏好清單取第一個已收錄的，都沒有時取最後一個', () => {
    const known = FONTS[0]!.id;
    assert.equal(resolveFont(['沒有這個字型', known]), known);
    assert.equal(resolveFont(['甲', '乙']), '乙');
  });

  it('標題混用：年代預設時第二三級標題與副題各有字型，自訂時跟著標題字型', () => {
    const custom = headlineMix('custom', 'noto-serif', 'lxgw');
    assert.deepEqual(custom, { h2: 'noto-serif', h3: 'noto-serif', sub: 'lxgw' });
    const mix = headlineMix('1920s', 'noto-serif', 'noto-serif');
    for (const id of Object.values(mix)) assert.ok(fontIds.has(id));
  });
});
