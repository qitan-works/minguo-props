// 依欄位定義產生表單。

import { formatMinguoDate, parseIsoDate } from '../lib/minguo.ts';
import { freshSeed } from '../lib/random.ts';
import type { Field, FieldValue } from '../props/schema.ts';
import { h } from './dom.ts';
import { readImageAsDataUrl } from './image.ts';

export type { FieldValue };
export type Values = Readonly<Record<string, FieldValue>>;

export interface FormCallbacks {
  onChange(key: string, value: FieldValue): void;
  onError(message: string): void;
}

let uid = 0;

function isVisible(field: Field, values: Values): boolean {
  if (!field.showIf) return true;
  return field.showIf.in.includes(values[field.showIf.key] ?? '');
}

function datePreview(value: string): string {
  const d = parseIsoDate(value);
  return d ? formatMinguoDate(d, { weekday: true }) : '請選擇日期';
}

/** 建立整份表單，回傳根元素與「依目前值更新顯示條件」的函式。 */
export function buildForm(
  fields: readonly Field[],
  values: Values,
  callbacks: FormCallbacks,
): { root: HTMLElement; refresh(values: Values): void } {
  const root = h('div', { class: 'form' });
  const rows = new Map<string, HTMLElement>();
  const groups = new Map<string, HTMLFieldSetElement>();
  const datePreviews = new Map<string, HTMLElement>();

  function groupFor(name: string): HTMLElement {
    let fs = groups.get(name);
    if (!fs) {
      fs = h('fieldset', { class: 'form-group' }, h('legend', { text: name }));
      groups.set(name, fs);
      root.appendChild(fs);
    }
    return fs;
  }

  for (const field of fields) {
    const id = `f-${field.key}-${++uid}`;
    const value = values[field.key];
    const row = h('div', { class: ['form-row', `form-row--${field.type}`] });
    const hint = field.hint ? h('p', { class: 'form-hint', text: field.hint, attrs: { id: `${id}-hint` } }) : null;
    const describedBy = hint ? `${id}-hint` : null;

    switch (field.type) {
      case 'text': {
        const input = h('input', {
          attrs: { id, type: 'text', maxlength: field.maxLength, placeholder: field.placeholder, 'aria-describedby': describedBy },
        });
        input.value = typeof value === 'string' ? value : '';
        input.addEventListener('input', () => callbacks.onChange(field.key, input.value));
        row.append(h('label', { attrs: { for: id }, text: field.label }), input);
        break;
      }
      case 'textarea': {
        const input = h('textarea', {
          attrs: { id, maxlength: field.maxLength, rows: field.rows ?? 4, 'aria-describedby': describedBy },
        });
        input.value = typeof value === 'string' ? value : '';
        input.addEventListener('input', () => callbacks.onChange(field.key, input.value));
        row.append(h('label', { attrs: { for: id }, text: field.label }), input);
        break;
      }
      case 'select': {
        const select = h('select', { attrs: { id, 'aria-describedby': describedBy } });
        for (const option of field.options) {
          select.appendChild(h('option', { attrs: { value: option.value }, text: option.label }));
        }
        select.value = typeof value === 'string' ? value : '';
        select.addEventListener('change', () => callbacks.onChange(field.key, select.value));
        row.append(h('label', { attrs: { for: id }, text: field.label }), select);
        break;
      }
      case 'checkbox': {
        const input = h('input', { attrs: { id, type: 'checkbox', 'aria-describedby': describedBy } });
        input.checked = value === true;
        input.addEventListener('change', () => callbacks.onChange(field.key, input.checked));
        row.append(h('label', { class: 'check', attrs: { for: id } }, input, h('span', { text: field.label })));
        break;
      }
      case 'date': {
        const input = h('input', { attrs: { id, type: 'date', min: field.min, max: field.max, 'aria-describedby': describedBy } });
        input.value = typeof value === 'string' ? value : '';
        const preview = h('output', { class: 'date-preview', attrs: { for: id }, text: datePreview(input.value) });
        datePreviews.set(field.key, preview);
        input.addEventListener('change', () => {
          if (!parseIsoDate(input.value)) return;
          preview.textContent = datePreview(input.value);
          callbacks.onChange(field.key, input.value);
        });
        row.append(h('label', { attrs: { for: id }, text: field.label }), input, preview);
        break;
      }
      case 'range': {
        const input = h('input', {
          attrs: { id, type: 'range', min: field.min, max: field.max, step: field.step, 'aria-describedby': describedBy },
        });
        const num = typeof value === 'number' ? value : field.min;
        input.value = String(num);
        const out = h('output', { class: 'range-value', attrs: { for: id }, text: `${num}${field.unit ?? ''}` });
        input.addEventListener('input', () => {
          const v = Number(input.value);
          out.textContent = `${v}${field.unit ?? ''}`;
          callbacks.onChange(field.key, v);
        });
        row.append(h('label', { attrs: { for: id }, text: field.label }), h('div', { class: 'range-box' }, input, out));
        break;
      }
      case 'seed': {
        const button = h('button', { class: 'btn btn-small', attrs: { id, type: 'button', 'aria-describedby': describedBy }, text: field.button });
        const labelId = `${id}-label`;
        button.setAttribute('aria-labelledby', `${labelId} ${id}`);
        let current = typeof value === 'number' ? value : 1;
        const shown = h('span', { class: 'seed-value', text: `種子 ${current}` });
        button.addEventListener('click', () => {
          current = freshSeed(current);
          shown.textContent = `種子 ${current}`;
          callbacks.onChange(field.key, current);
        });
        row.append(h('span', { class: 'field-label', attrs: { id: labelId }, text: field.label }), h('div', { class: 'seed-box' }, button, shown));
        break;
      }
      case 'image': {
        const input = h('input', { attrs: { id, type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', 'aria-describedby': describedBy } });
        const thumb = h('img', { class: 'image-thumb', attrs: { alt: '已選擇的照片' } });
        const remove = h('button', { class: 'btn btn-small', attrs: { type: 'button' }, text: '移除照片' });
        const setThumb = (src: string): void => {
          thumb.hidden = src === '';
          remove.hidden = src === '';
          if (src) thumb.src = src;
          else thumb.removeAttribute('src');
        };
        setThumb(typeof value === 'string' ? value : '');
        input.addEventListener('change', () => {
          const file = input.files?.[0];
          if (!file) return;
          readImageAsDataUrl(file)
            .then((url) => {
              setThumb(url);
              callbacks.onChange(field.key, url);
            })
            .catch((err: unknown) => callbacks.onError(err instanceof Error ? err.message : '無法讀取照片。'))
            .finally(() => {
              input.value = '';
            });
        });
        remove.addEventListener('click', () => {
          setThumb('');
          callbacks.onChange(field.key, '');
        });
        row.append(h('label', { attrs: { for: id }, text: field.label }), input, h('div', { class: 'image-box' }, thumb, remove));
        break;
      }
    }
    if (hint) row.appendChild(hint);
    rows.set(field.key, row);
    groupFor(field.group ?? '其他').appendChild(row);
  }

  function refresh(current: Values): void {
    for (const field of fields) {
      const row = rows.get(field.key);
      if (row) row.hidden = !isVisible(field, current);
    }
    for (const fs of groups.values()) {
      const anyVisible = [...fs.querySelectorAll<HTMLElement>('.form-row')].some((r) => !r.hidden);
      fs.hidden = !anyVisible;
    }
  }
  refresh(values);
  return { root, refresh };
}
