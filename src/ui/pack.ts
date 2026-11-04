// 線索包面板（第五版）：把目前的道具加入線索包、每件寫上要在哪一幕給、調順序、載回表單、
// 預覽整包（含主持人對照表）一次列印、用網址分享。

import { clueLabel, summaryOf } from '../lib/pack.ts';
import { PACK_LIMITS, PROP_LABELS, type PackEntry, type PropKind } from '../state.ts';
import { h } from './dom.ts';

export interface PackEditorOptions {
  readonly entries: readonly PackEntry[];
  readonly current: PropKind;
  readonly previewing: boolean;
  /** 正在只預覽網址裡的線索包（件數；0 表示沒有）。 */
  readonly sharedPreview: number;
  /** 分享網址（按過「產生分享網址」才有）。 */
  readonly shareUrl: string | null;
  onAdd(): void;
  onChange(entries: PackEntry[]): void;
  onLoad(entry: PackEntry): void;
  onReplace(id: string): void;
  onPreview(on: boolean): void;
  onShare(): void;
}

function button(text: string, run: () => void, disabled = false): HTMLButtonElement {
  const b = h('button', { class: 'btn btn-small', attrs: { type: 'button', disabled }, text });
  b.addEventListener('click', run);
  return b;
}

export function buildPackEditor(o: PackEditorOptions): HTMLElement {
  const entries = [...o.entries];
  const emit = (next: PackEntry[]): void => o.onChange(next);
  const rows = entries.map((e, i) => {
    const scene = h('input', { attrs: { type: 'text', maxlength: PACK_LIMITS.scene, 'aria-label': `${clueLabel(i)}要在哪一幕給`, placeholder: '在哪一幕給，例如：第二幕，在死者口袋找到' } });
    scene.value = e.scene;
    scene.addEventListener('change', () => emit(entries.map((x) => (x.id === e.id ? { ...x, scene: scene.value } : x))));
    const move = (d: number): void => {
      const next = [...entries];
      const j = i + d;
      if (j < 0 || j >= next.length) return;
      [next[i], next[j]] = [next[j] as PackEntry, next[i] as PackEntry];
      emit(next);
    };
    const summary = summaryOf(e.props as unknown as Record<string, unknown>);
    return h(
      'li',
      { class: 'pack-row' },
      h('div', { class: 'pack-head' }, h('strong', { text: clueLabel(i) }), h('span', { text: `${PROP_LABELS[e.kind]}${summary ? `：${summary}` : ''}` })),
      scene,
      h(
        'div',
        { class: 'pack-buttons' },
        button('上移', () => move(-1), i === 0),
        button('下移', () => move(1), i === entries.length - 1),
        button('載回表單編輯', () => o.onLoad(e)),
        button('用目前的內容取代', () => o.onReplace(e.id), e.kind !== o.current),
        button('移出', () => emit(entries.filter((x) => x.id !== e.id))),
      ),
    );
  });
  const share = o.shareUrl ? h('input', { class: 'pack-url', attrs: { type: 'text', readonly: true, 'aria-label': '分享網址' } }) : null;
  if (share && o.shareUrl) {
    share.value = o.shareUrl;
    share.addEventListener('focus', () => share.select());
  }
  return h(
    'fieldset',
    { class: 'form-group pack-editor', attrs: { id: 'pack-editor' } },
    h('legend', { text: `線索包（${entries.length} 件）` }),
    h('p', {
      class: 'form-hint',
      text: '把做好的道具一件件加進來，自動編號為線索一、二……；預覽整包時會依序排好所有道具，最後附主持人對照表（縮圖、編號、在哪一幕給），按列印就一次印出。加入時存的是當下的內容，之後再改表單不會影響已加入的那一件（可以「用目前的內容取代」）。',
    }),
    o.sharedPreview ? h('p', { class: 'form-hint pack-shared', text: `正在預覽網址裡的線索包（${o.sharedPreview} 件，沒有存）。下面列的是你自己的線索包；按「回到目前的道具」結束預覽。` }) : null,
    h(
      'div',
      { class: 'pack-buttons' },
      button(`把目前的${PROP_LABELS[o.current]}加入線索包`, () => o.onAdd(), entries.length >= PACK_LIMITS.entries),
      button(o.previewing ? '回到目前的道具' : '預覽整包並列印', () => o.onPreview(!o.previewing), entries.length === 0 && !o.previewing),
      button('產生分享網址', () => o.onShare(), entries.length === 0),
    ),
    share,
    share ? h('p', { class: 'form-hint', text: '資料放在網址的 # 後面，不會傳到任何伺服器；對方打開這個網址就會載入同一包線索。' }) : null,
    entries.length ? h('ol', { class: 'pack-list' }, ...rows) : h('p', { class: 'form-hint', text: '線索包是空的。' }),
    entries.length ? h('div', { class: 'pack-buttons' }, button('清空線索包', () => emit([]))) : null,
  );
}
