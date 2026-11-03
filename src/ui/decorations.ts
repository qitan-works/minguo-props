// 裝飾編輯器：選種類加到紙上，逐項調整旋轉、縮放、透明度、疊放順序與文字。

import { DEFAULT_TEXT } from '../lib/decorations.ts';
import { freshSeed } from '../lib/random.ts';
import { DECORATION_TYPES, LIMITS, newId, type Decoration, type DecorationType } from '../props/extras.ts';
import { h } from './dom.ts';

const TEXT_TYPES = new Set<DecorationType>(['stamp', 'pencil-note', 'wax-seal', 'pressed-text']);

export interface DecorationEditorOptions {
  readonly decorations: readonly Decoration[];
  /** 新裝飾放在紙的哪裡（公釐）。 */
  readonly center: () => { readonly x: number; readonly y: number };
  readonly selectedId: string | null;
  onChange(decorations: Decoration[], redraw: boolean): void;
  onSelect(id: string | null): void;
}

function labelOf(type: DecorationType): string {
  return DECORATION_TYPES.find((t) => t.value === type)?.label ?? type;
}

function slider(label: string, min: number, max: number, step: number, value: number, unit: string, onInput: (v: number) => void): HTMLElement {
  const input = h('input', { attrs: { type: 'range', min, max, step, 'aria-label': label } });
  input.value = String(value);
  const out = h('output', { class: 'range-value', text: `${value}${unit}` });
  input.addEventListener('input', () => {
    const v = Number(input.value);
    out.textContent = `${v}${unit}`;
    onInput(v);
  });
  return h('label', { class: 'deco-slider' }, h('span', { text: label }), input, out);
}

export function buildDecorationEditor(o: DecorationEditorOptions): HTMLElement {
  let items = [...o.decorations];
  const list = h('div', { class: 'deco-list' });
  const type = h('select', { attrs: { 'aria-label': '裝飾種類' } });
  for (const t of DECORATION_TYPES) type.appendChild(h('option', { attrs: { value: t.value }, text: t.label }));
  const add = h('button', { class: 'btn btn-small', attrs: { type: 'button' }, text: '加到紙上' });

  const emit = (redraw: boolean): void => o.onChange([...items], redraw);
  const update = (id: string, patch: Partial<Decoration>, redraw = false): void => {
    items = items.map((d) => (d.id === id ? { ...d, ...patch } : d));
    emit(redraw);
  };

  function row(d: Decoration): HTMLElement {
    const head = h(
      'div',
      { class: 'deco-head' },
      h('strong', { text: labelOf(d.type) }),
      button('換一個', () => update(d.id, { seed: freshSeed(d.seed) }, true)),
      button('上移', () => update(d.id, { z: Math.max(...items.map((x) => x.z)) + 1 }, true)),
      button('下移', () => update(d.id, { z: Math.min(...items.map((x) => x.z)) - 1 }, true)),
      button('刪除', () => {
        items = items.filter((x) => x.id !== d.id);
        emit(true);
      }),
    );
    const el = h(
      'div',
      { class: ['deco-row', d.id === o.selectedId && 'deco-row-selected'], dataset: { decoId: d.id } },
      head,
      slider('旋轉', -180, 180, 1, Math.round(d.rotate), '°', (v) => update(d.id, { rotate: v })),
      slider('縮放', 0.2, 4, 0.05, d.scale, '×', (v) => update(d.id, { scale: v })),
      slider('透明度', 0.05, 1, 0.05, d.opacity, '', (v) => update(d.id, { opacity: v })),
    );
    if (TEXT_TYPES.has(d.type)) {
      const text = h('input', { attrs: { type: 'text', maxlength: LIMITS.decorationText, 'aria-label': '文字', placeholder: DEFAULT_TEXT[d.type] ?? '' } });
      text.value = d.text;
      text.addEventListener('input', () => update(d.id, { text: text.value }));
      el.appendChild(h('label', { class: 'deco-slider' }, h('span', { text: '文字' }), text));
    }
    el.addEventListener('focusin', () => o.onSelect(d.id));
    return el;
  }

  function button(text: string, run: () => void): HTMLButtonElement {
    const b = h('button', { class: 'btn btn-small', attrs: { type: 'button' }, text });
    b.addEventListener('click', run);
    return b;
  }

  add.addEventListener('click', () => {
    if (items.length >= LIMITS.decorations) return;
    const t = type.value as DecorationType;
    const d: Decoration = {
      id: newId('d'),
      type: t,
      x: o.center().x,
      y: o.center().y,
      rotate: t === 'stamp' ? -12 : 0,
      scale: 1,
      opacity: t.startsWith('blood') || t === 'handprint' ? 0.85 : 1,
      z: items.length ? Math.max(...items.map((x) => x.z)) + 1 : 0,
      seed: freshSeed(),
      text: DEFAULT_TEXT[t] ?? '',
    };
    items = [...items, d];
    emit(true);
  });

  list.replaceChildren(...items.map(row));
  return h(
    'fieldset',
    { class: 'form-group' },
    h('legend', { text: '裝飾' }),
    h('p', { class: 'form-hint', text: '加到紙上後，可在預覽上拖曳移動；滑鼠滾輪縮放，Shift＋滾輪旋轉。' }),
    h('div', { class: 'deco-add' }, type, add),
    list,
  );
}
