import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { DEFAULT_PREVIEW_ZOOM, FIT_MAX, parsePreviewZoom, previewScale, serializePreviewZoom, wheelDirection, zoomBy, ZOOM_MAX, ZOOM_MIN } from '../src/lib/preview.ts';

describe('預覽大小', () => {
  const a4 = { w: 794, h: 1123 };
  const card = { w: 336, h: 204 };

  it('整張：寬高都放得下，整張道具一定看得到', () => {
    for (const avail of [{ w: 1400, h: 740 }, { w: 900, h: 560 }, { w: 358, h: 700 }, { w: 2000, h: 2000 }]) {
      for (const natural of [a4, card, { w: 1123, h: 794 }]) {
        const s = previewScale({ fit: 'page', zoom: 1 }, natural, avail);
        assert.ok(natural.w * s <= avail.w + 1e-9 && natural.h * s <= avail.h + 1e-9, `${JSON.stringify({ natural, avail, s })}`);
        assert.ok(s <= FIT_MAX);
      }
    }
    // 正式網站量到的情形：視窗 768 高時，A4 整張縮到放得下
    assert.ok(Math.abs(previewScale(DEFAULT_PREVIEW_ZOOM, a4, { w: 900, h: 600 }) - 600 / 1123) < 1e-9);
  });

  it('符合寬度、實際大小、自訂倍率', () => {
    assert.equal(previewScale({ fit: 'width', zoom: 1 }, a4, { w: 600, h: 300 }), 600 / 794);
    assert.equal(previewScale({ fit: 'actual', zoom: 3 }, a4, { w: 100, h: 100 }), 1);
    assert.equal(previewScale({ fit: 'custom', zoom: 1.5 }, a4, { w: 100, h: 100 }), 1.5);
    assert.equal(previewScale({ fit: 'custom', zoom: 99 }, a4, { w: 100, h: 100 }), ZOOM_MAX);
    assert.equal(previewScale({ fit: 'page', zoom: 1 }, { w: 0, h: 0 }, { w: 100, h: 100 }), 1);
  });

  it('放大、縮小一級，限制在範圍內', () => {
    assert.deepEqual(zoomBy(1, 1), { fit: 'custom', zoom: 1.25 });
    assert.deepEqual(zoomBy(1, -1), { fit: 'custom', zoom: 0.8 });
    assert.equal(zoomBy(ZOOM_MAX, 1).zoom, ZOOM_MAX);
    assert.equal(zoomBy(ZOOM_MIN, -1).zoom, ZOOM_MIN);
  });

  it('存在 localStorage 的選擇：讀回相同，格式不對時用整張', () => {
    for (const z of [{ fit: 'width', zoom: 1 }, { fit: 'custom', zoom: 2.4 }, DEFAULT_PREVIEW_ZOOM] as const) {
      assert.deepEqual(parsePreviewZoom(serializePreviewZoom(z)), z);
    }
    for (const bad of [null, '', '{', '[]', '{"fit":"huge"}', '{"fit":1}']) assert.deepEqual(parsePreviewZoom(bad), DEFAULT_PREVIEW_ZOOM);
    assert.deepEqual(parsePreviewZoom('{"fit":"custom","zoom":1e9}'), { fit: 'custom', zoom: ZOOM_MAX });
    assert.deepEqual(parsePreviewZoom('{"fit":"custom","zoom":"x"}'), { fit: 'custom', zoom: 1 });
  });

  it('滾輪方向：Shift 讓滾輪變成橫向時也算數', () => {
    assert.equal(wheelDirection(-100, 0), 1);
    assert.equal(wheelDirection(100, 0), -1);
    assert.equal(wheelDirection(0, 100), -1);
    assert.equal(wheelDirection(0, 0), 0);
  });
});

describe('預覽版面（寬螢幕左右各自捲動）', () => {
  const css = readFileSync(new URL('../src/styles/app.css', import.meta.url), 'utf8');
  const print = readFileSync(new URL('../src/styles/print.css', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');

  it('預覽不再用 sticky；兩欄各自捲動', () => {
    assert.equal(/position:\s*sticky[^}]*\}/.test(css.slice(css.indexOf('.preview {'), css.indexOf('.preview {') + 200)), false);
    const wide = css.slice(css.indexOf('@media (min-width: 900px)'));
    for (const rule of ['overflow: auto', 'min-height: 0', 'overscroll-behavior: contain', 'scrollbar-gutter: stable', '100dvh']) assert.ok(wide.includes(rule), rule);
  });

  it('兩欄可以用鍵盤聚焦後捲動', () => {
    for (const id of ['editor', 'preview']) {
      const tag = new RegExp(`<section[^>]*id="${id}"[^>]*>`).exec(html)?.[0] ?? '';
      assert.match(tag, /tabindex="0"/, id);
      assert.match(tag, /role="region"/, id);
      assert.match(tag, /aria-label="[^"]+"/, id);
    }
  });

  it('列印時把兩欄的高度與捲動還原', () => {
    for (const rule of ['overflow: visible', 'height: auto']) assert.ok(print.includes(rule), rule);
    assert.match(print, /\.preview-bar[^{]*\{[^}]*display:\s*none|\.preview-bar,/);
  });
});
