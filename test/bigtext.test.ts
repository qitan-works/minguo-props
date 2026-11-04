import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { newspaperDefaults } from '../src/props/newspaper.ts';
import { v4Cell } from '../src/render/newspaper-full.ts';

describe('報紙大字模式', () => {
  it('A4 內文 3.3 mm（平常 2.7）、A5 2.8 mm（平常 2.3），都不小於約 3.2 mm 與原本的大小', () => {
    assert.equal(v4Cell(210, 297), 2.7);
    assert.equal(v4Cell(210, 297, true), 3.3);
    assert.equal(v4Cell(148, 210), 2.3);
    assert.equal(v4Cell(148, 210, true), 2.8);
    assert.ok(v4Cell(210, 297, true) >= 3.2);
  });

  it('預設不開，舊存檔沒有這個欄位時照舊', () => {
    assert.equal(newspaperDefaults.bigText, false);
  });
});
