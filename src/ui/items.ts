// 「我的新聞與啟事」編輯器：使用者可以新增多則，方便把線索藏在填版素材之間。

import { LIMITS, NEWS_ITEM_KINDS, newId, type NewsItem, type NewsItemKind } from '../props/extras.ts';
import { h } from './dom.ts';

export function buildItemsEditor(initial: readonly NewsItem[], onChange: (items: NewsItem[]) => void): HTMLElement {
  let items = [...initial];
  const list = h('div', { class: 'items-list' });
  const root = h(
    'fieldset',
    { class: 'form-group items-editor' },
    h('legend', { text: '我的新聞與啟事' }),
    h('p', {
      class: 'form-hint',
      text: '在整版與剪下模式中，這些會和填版素材一起排進版面（放不下時最後一則會截斷）。可用來把線索藏在一堆短訊與廣告之間。',
    }),
    list,
  );

  const emit = (): void => onChange([...items]);

  function row(item: NewsItem, index: number): HTMLElement {
    const kind = h('select', { attrs: { 'aria-label': `第 ${index + 1} 則的種類` } });
    for (const k of NEWS_ITEM_KINDS) kind.appendChild(h('option', { attrs: { value: k.value }, text: k.label }));
    kind.value = item.kind;
    const title = h('input', { attrs: { type: 'text', maxlength: LIMITS.title, placeholder: '標題', 'aria-label': `第 ${index + 1} 則的標題` } });
    title.value = item.title;
    const body = h('textarea', { attrs: { rows: 3, maxlength: LIMITS.body, placeholder: '內文', 'aria-label': `第 ${index + 1} 則的內文` } });
    body.value = item.body;
    const remove = h('button', { class: 'btn btn-small', attrs: { type: 'button' }, text: '刪除這則' });

    const update = (patch: Partial<NewsItem>): void => {
      items = items.map((it) => (it.id === item.id ? { ...it, ...patch } : it));
      emit();
    };
    kind.addEventListener('change', () => update({ kind: kind.value as NewsItemKind }));
    title.addEventListener('input', () => update({ title: title.value }));
    body.addEventListener('input', () => update({ body: body.value }));
    remove.addEventListener('click', () => {
      items = items.filter((it) => it.id !== item.id);
      emit();
      redraw();
    });
    return h('div', { class: 'item-row', dataset: { itemId: item.id } }, h('div', { class: 'item-head' }, kind, remove), title, body);
  }

  const add = h('button', { class: 'btn btn-small', attrs: { type: 'button' }, text: '＋ 新增一則' });
  add.addEventListener('click', () => {
    if (items.length >= LIMITS.items) return;
    items = [...items, { id: newId('u'), kind: 'short', title: '', body: '' }];
    emit();
    redraw();
    list.querySelector<HTMLInputElement>('.item-row:last-child input')?.focus();
  });

  function redraw(): void {
    list.replaceChildren(...items.map(row));
    add.disabled = items.length >= LIMITS.items;
  }
  redraw();
  root.appendChild(add);
  return root;
}
