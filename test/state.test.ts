import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createSafeStore, type StorageLike } from '../src/lib/storage.ts';
import { FICTIONAL_MASTHEADS, REAL_NEWSPAPER_NAMES, newspaperDefaults } from '../src/props/newspaper.ts';
import { isSafeImageDataUrl, sanitizeRecord, type Field } from '../src/props/schema.ts';
import {
  PROP_FIELDS,
  PROP_KINDS,
  SAVE_FORMAT,
  SAVE_VERSION,
  defaultState,
  parseSaveObject,
  parseSaveText,
  serializeState,
  updateProp,
} from '../src/state.ts';

const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('存檔格式：匯出與匯入', () => {
  it('預設狀態可以完整來回轉換', () => {
    const state = defaultState();
    const text = serializeState(state, new Date('2026-11-05T03:00:00Z'));
    const parsed = JSON.parse(text) as Record<string, unknown>;
    assert.equal(parsed['format'], SAVE_FORMAT);
    assert.equal(parsed['version'], SAVE_VERSION);
    assert.equal(parsed['savedAt'], '2026-11-05T03:00:00.000Z');
    const result = parseSaveText(text);
    assert.ok(result.ok);
    assert.deepEqual(result.state, state);
    assert.deepEqual(result.warnings, []);
  });

  it('修改過的內容與照片也能來回轉換', () => {
    let state = defaultState();
    state = updateProp(state, 'newspaper', { headline: '測試標題', photo: PNG_1PX, folds: false });
    state = updateProp(state, 'telegram', { body: '速歸' });
    state = { ...state, active: 'telegram' };
    const result = parseSaveText(serializeState(state));
    assert.ok(result.ok);
    assert.deepEqual(result.state, state);
  });

  it('預設值涵蓋每個欄位，且都通過清理', () => {
    const state = defaultState();
    for (const kind of PROP_KINDS) {
      const fields = PROP_FIELDS[kind];
      const defaults = state.props[kind] as Readonly<Record<string, unknown>>;
      assert.deepEqual(Object.keys(defaults).sort(), fields.map((f) => f.key).sort(), kind);
      const { replaced } = sanitizeRecord(fields, defaults as never, defaults);
      assert.deepEqual(replaced, [], kind);
    }
  });

  it('拒絕非 JSON、其他格式與較新版本', () => {
    assert.equal(parseSaveText('not json').ok, false);
    assert.equal(parseSaveText('[]').ok, false);
    assert.equal(parseSaveObject({ format: 'other', version: 1 }).ok, false);
    assert.equal(parseSaveObject({ format: SAVE_FORMAT }).ok, false);
    assert.equal(parseSaveObject({ format: SAVE_FORMAT, version: 0 }).ok, false);
    const newer = parseSaveObject({ format: SAVE_FORMAT, version: SAVE_VERSION + 1 });
    assert.equal(newer.ok, false);
    if (!newer.ok) assert.match(newer.error, /比本工具新/);
  });

  it('型別錯誤的欄位改用預設值並提示，未知欄位捨棄', () => {
    const result = parseSaveObject({
      format: SAVE_FORMAT,
      version: 1,
      active: 'letter',
      props: {
        newspaper: { headline: 42, folds: 'yes', paper: 'b5', body: '正文', unknown: 'x' },
      },
    });
    assert.ok(result.ok);
    const n = result.state.props.newspaper;
    assert.equal(n.headline, newspaperDefaults.headline);
    assert.equal(n.folds, newspaperDefaults.folds);
    assert.equal(n.paper, newspaperDefaults.paper);
    assert.equal(n.body, '正文');
    assert.equal('unknown' in n, false);
    assert.equal(result.state.active, 'letter');
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0] ?? '', /3 個欄位/);
  });

  it('缺少的道具用預設值，未知的道具種類切回報紙', () => {
    const result = parseSaveObject({ format: SAVE_FORMAT, version: 1, active: 'poster', props: {} });
    assert.ok(result.ok);
    assert.deepEqual(result.state.props, defaultState().props);
    assert.equal(result.state.active, 'newspaper');
    assert.equal(result.warnings.length, 1);
  });

  it('照片只接受圖片 data URL', () => {
    assert.equal(isSafeImageDataUrl(PNG_1PX), true);
    assert.equal(isSafeImageDataUrl('https://example.com/a.png'), false);
    assert.equal(isSafeImageDataUrl('javascript:alert(1)'), false);
    assert.equal(isSafeImageDataUrl('data:text/html;base64,PGI+'), false);
    assert.equal(isSafeImageDataUrl('data:image/svg+xml;base64,PHN2Zz4='), false);
    const result = parseSaveObject({
      format: SAVE_FORMAT,
      version: 1,
      props: { newspaper: { photo: 'https://example.com/tracker.png' } },
    });
    assert.ok(result.ok);
    assert.equal(result.state.props.newspaper.photo, '');
  });

  it('文字欄位截到上限並移除控制字元', () => {
    const fields = [{ key: 'title', type: 'text', label: '標題', maxLength: 3 }] as const satisfies readonly Field[];
    const { data } = sanitizeRecord(fields, { title: '' }, { title: '一\u0000二三四' });
    assert.equal(data.title, '一二三');
    const kept = sanitizeRecord(fields, { title: '' }, { title: '𠮷\n𠮷' });
    assert.equal(kept.data.title, '𠮷\n𠮷');
  });

  it('日期必須在範圍內', () => {
    const result = parseSaveObject({
      format: SAVE_FORMAT,
      version: 1,
      props: { telegram: { date: '1888-01-01' }, letter: { date: '1930-02-31x' } },
    });
    assert.ok(result.ok);
    assert.equal(result.state.props.telegram.date, defaultState().props.telegram.date);
    assert.equal(result.state.props.letter.date, defaultState().props.letter.date);
  });
});

describe('預設報頭為虛構', () => {
  it('預設與建議報頭都不是已知的真實報紙名稱', () => {
    const real = new Set<string>(REAL_NEWSPAPER_NAMES);
    assert.equal(real.has(newspaperDefaults.masthead), false);
    for (const name of FICTIONAL_MASTHEADS) assert.equal(real.has(name), false, name);
    assert.ok((FICTIONAL_MASTHEADS as readonly string[]).includes(newspaperDefaults.masthead));
  });
});

describe('localStorage 安全包裝', () => {
  function memoryStorage(): StorageLike & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return {
      data,
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => void data.set(k, v),
      removeItem: (k) => void data.delete(k),
    };
  }

  it('正常讀寫', () => {
    const mem = memoryStorage();
    const store = createSafeStore(() => mem, 'k');
    assert.equal(store.load(), null);
    assert.equal(store.save('v'), 'saved');
    assert.equal(store.load(), 'v');
    assert.equal(store.remove(), true);
    assert.equal(store.load(), null);
  });

  it('取得 storage 時丟出例外（例如停用網站資料）', () => {
    const store = createSafeStore(() => {
      throw new Error('SecurityError');
    }, 'k');
    assert.equal(store.load(), null);
    assert.equal(store.save('v'), 'unavailable');
    assert.equal(store.remove(), false);
  });

  it('沒有 storage', () => {
    const store = createSafeStore(() => undefined, 'k');
    assert.equal(store.load(), null);
    assert.equal(store.save('v'), 'unavailable');
  });

  it('讀寫時丟出例外，容量已滿另外標示', () => {
    const throwing: StorageLike = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        const err = new Error('full');
        err.name = 'QuotaExceededError';
        throw err;
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    const store = createSafeStore(() => throwing, 'k');
    assert.equal(store.load(), null);
    assert.equal(store.save('v'), 'quota');
    assert.equal(store.remove(), false);
    const other = createSafeStore(
      () => ({
        ...throwing,
        setItem: () => {
          throw new Error('other');
        },
      }),
      'k',
    );
    assert.equal(other.save('v'), 'error');
  });
});
