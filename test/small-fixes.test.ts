import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { autopsyMarks, documentDefaults } from '../src/props/document.ts';
import { EAR_DEFAULTS, earParts, newspaperDefaults } from '../src/props/newspaper.ts';
import { bodySizeOptions } from '../src/ui/blocks.ts';
import { defaultState, parseSaveText, serializeState } from '../src/state.ts';

describe('小修正包', () => {
  it('大字模式下，區塊面板的「小」註明實際印成中號；平常不變', () => {
    const big = bodySizeOptions(true).find((o) => o.value === 's');
    const normal = bodySizeOptions(false).find((o) => o.value === 's');
    assert.match(big?.label ?? '', /大字模式下為中/);
    assert.equal(normal?.label, '小');
    assert.deepEqual(bodySizeOptions(true).map((o) => o.value), bodySizeOptions(false).map((o) => o.value));
  });

  it('線索包的編號：不透明的白底、小字、貼在紙張最角落（滿版的道具也只佔留白）', () => {
    const css = readFileSync(new URL('../src/styles/props.css', import.meta.url), 'utf8');
    const rule = /\.pack-label \{([^}]*)\}/.exec(css)?.[1] ?? '';
    assert.match(rule, /background: #fff;/);
    assert.ok(parseFloat(/font-size: ([\d.]+)mm/.exec(rule)?.[1] ?? '9') <= 2.6);
    assert.ok(parseFloat(/right: ([\d.]+)mm/.exec(rule)?.[1] ?? '9') <= 1 && parseFloat(/bottom: ([\d.]+)mm/.exec(rule)?.[1] ?? '9') <= 1);
  });

  it('報耳的文字可以編輯：第一行是標題、其餘是內文，留空就不印；預設是原本的原創文字，存檔照常驗證', () => {
    assert.deepEqual(earParts('本報啟事\n今日停刊一天'), { head: '本報啟事', body: '今日停刊一天' });
    assert.deepEqual(earParts('只有標題'), { head: '只有標題', body: '' });
    assert.equal(earParts('  \n '), null);
    assert.equal(newspaperDefaults.earRight, EAR_DEFAULTS.right);
    assert.equal(earParts(EAR_DEFAULTS.left)?.head, '廣告刊例');
    const state = defaultState();
    const raw = JSON.parse(serializeState({ ...state, props: { ...state.props, newspaper: { ...state.props.newspaper, earLeft: '霧港電影院\n今晚七時映演新片' } } }));
    const ok = parseSaveText(JSON.stringify(raw));
    assert.ok(ok.ok && ok.state.props.newspaper.earLeft === '霧港電影院\n今晚七時映演新片');
    raw.props.newspaper.earRight = 'x'.repeat(500);
    const bad = parseSaveText(JSON.stringify(raw));
    assert.ok(bad.ok && Array.from(bad.state.props.newspaper.earRight).length <= 60, '太長的截到欄位上限');
  });

  it('驗屍報告的印痕可選位置與數量（0～5），預設照原本的左胸三個', () => {
    assert.equal(documentDefaults.markSpot, 'chest');
    assert.equal(documentDefaults.markCount, '3');
    const chest = autopsyMarks('chest', 3).map((m) => [m.cx, m.cy]);
    assert.deepEqual(chest.map(([x, y]) => [Math.round((x ?? 0) * 10) / 10, Math.round((y ?? 0) * 10) / 10]), [[23.5, 27], [25.1, 28.6], [26.7, 31.8]], '和原本的位置相同');
    assert.equal(autopsyMarks('belly', 0).length, 0);
    for (const spot of ['head', 'chest', 'belly', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg']) {
      const ms = autopsyMarks(spot, 5);
      assert.equal(ms.length, 5, spot);
      for (const m of ms) assert.ok(m.cx > 3 && m.cx < 37 && m.cy > 1 && m.cy < 97, `${spot} ${m.cx},${m.cy}`);
    }
    assert.equal(autopsyMarks('chest', 9).length, 5, '最多 5 處');
    assert.deepEqual(autopsyMarks('nowhere', 2), autopsyMarks('chest', 2), '不認得的位置當成左胸');
  });
});
