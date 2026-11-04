// 整版報紙的區塊設定面板：在預覽上點一個區塊，左邊出現它自己的設定。
// 種類、標題（文字、字型、大小、方向、樣式、括號）、內文（字型、大小、割注）、框線與花邊、插圖、
// 高度與寬度；另有新增、複製、刪除、鎖定、上移、下移與還原。只存改過的欄位。

import { BLOCK_KINDS, BODY_SIZES, FRAMES, PATTERNS, PICTURES, TITLE_DIRS, TITLE_MARKS, TITLE_SIZES, TITLE_STYLES, type BlockStyle } from '../lib/newspaper/blockstyle.ts';
import { h } from './dom.ts';

export type BlockAction = 'add' | 'copy' | 'delete' | 'lock' | 'unlock' | 'up' | 'down' | 'reset' | 'close';

export interface BlockPanelOptions {
  readonly id: string;
  readonly style: BlockStyle;
  /** 自動補上的短訊（不在版面類型的區塊清單裡）。 */
  readonly filler: boolean;
  readonly locked: boolean;
  /** 這個區塊現在的標題（自訂標題的提示）。 */
  readonly titlePreview: string;
  readonly fontOptions: readonly { readonly value: string; readonly label: string }[];
  /** 有沒有改過（可以還原）。 */
  readonly edited: boolean;
  /** 報紙開了大字模式（小號內文實際印成中號）。 */
  readonly bigText?: boolean;
  onStyle(patch: Partial<BlockStyle>): void;
  onAction(action: BlockAction): void;
}

/** 內文大小的選項；大字模式下「小」實際印成中號，在選項上註明。 */
export function bodySizeOptions(bigText: boolean): readonly { readonly value: (typeof BODY_SIZES)[number]['value']; readonly label: string }[] {
  return BODY_SIZES.map((x) => (bigText && x.value === 's' ? { value: x.value, label: `${x.label}（大字模式下為中）` } : x));
}

function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  return h('label', { class: 'block-field' }, h('span', { class: 'field-label', text: label }), control, hint ? h('small', { class: 'form-hint', text: hint }) : null);
}

function select<T extends string>(label: string, options: readonly { readonly value: T; readonly label: string }[], value: string, onChange: (v: T) => void): HTMLSelectElement {
  const el = h('select', { attrs: { 'aria-label': label, 'data-block-field': label } });
  for (const o of options) el.appendChild(h('option', { attrs: { value: o.value }, text: o.label }));
  el.value = value;
  el.addEventListener('change', () => onChange(el.value as T));
  return el;
}

function number(label: string, min: number, max: number, value: number, onChange: (v: number) => void): HTMLInputElement {
  const el = h('input', { attrs: { type: 'number', min, max, step: 1, 'aria-label': label, 'data-block-field': label } });
  el.value = String(value);
  el.addEventListener('change', () => {
    const v = Math.round(Number(el.value));
    if (Number.isFinite(v) && v >= min && v <= max) onChange(v);
    else el.value = String(value);
  });
  return el;
}

function button(text: string, action: BlockAction, o: BlockPanelOptions, extra: string | false = false): HTMLButtonElement {
  const b = h('button', { class: ['btn', 'btn-small', extra], attrs: { type: 'button', 'data-block-action': action }, text });
  b.addEventListener('click', () => o.onAction(action));
  return b;
}

export function buildBlockPanel(o: BlockPanelOptions): HTMLElement {
  const s = o.style;
  const kindLabel = BLOCK_KINDS.find((k) => k.value === s.kind)?.label ?? s.kind;
  const root = h('fieldset', { class: 'form-group block-panel', attrs: { id: 'block-panel', 'data-block-id': o.id } });
  root.appendChild(h('legend', { text: `選取的區塊：${kindLabel}${o.locked ? '（已鎖定）' : ''}` }));
  root.appendChild(
    h('div', { class: 'block-actions' },
      button('取消選取', 'close', o),
      ...(o.filler
        ? []
        : [
            button('新增區塊', 'add', o),
            button('複製', 'copy', o),
            button('上移', 'up', o),
            button('下移', 'down', o),
            button(o.locked ? '解除鎖定' : '鎖定', o.locked ? 'unlock' : 'lock', o),
            ...(o.edited ? [button('還原設定', 'reset', o)] : []),
            button('刪除', 'delete', o, 'btn-danger'),
          ]),
    ),
  );
  if (o.filler) {
    root.appendChild(h('p', { class: 'form-hint', text: '這是排完各區塊後自動補上的短訊，用來把版面排滿。要調整時，請點旁邊的區塊改寬度或高度，或用「新增區塊」加一個可以設定的區塊。' }));
    return root;
  }
  root.appendChild(h('p', { class: 'form-hint', text: '「鎖定」後換一批、換一個版面配置時，這個區塊的內容與樣式都保留。上移、下移改變排入的先後（位置跟著改）。' }));
  const set = (patch: Partial<BlockStyle>): void => o.onStyle(patch);
  const fonts = [{ value: '', label: '跟著整版的字型設定' }, ...o.fontOptions];
  root.appendChild(field('種類', select('種類', BLOCK_KINDS, s.kind, (v) => set({ kind: v }))));
  const title = h('input', { attrs: { type: 'text', maxlength: 24, placeholder: o.titlePreview || '（用素材本身的標題）', 'aria-label': '標題文字', 'data-block-field': '標題文字' } });
  title.value = s.title;
  title.addEventListener('change', () => set({ title: title.value.trim() }));
  root.appendChild(field('標題文字', title, '留空時用素材本身的標題。'));
  root.appendChild(
    h('div', { class: 'block-grid' },
      field('標題字型', select('標題字型', fonts, s.titleFont, (v) => set({ titleFont: v }))),
      field('標題大小', select('標題大小', TITLE_SIZES, String(s.titleSize), (v) => set({ titleSize: Number(v) as BlockStyle['titleSize'] }))),
      field('標題方向', select('標題方向', TITLE_DIRS, s.titleDir, (v) => set({ titleDir: v }))),
      field('標題樣式', select('標題樣式', TITLE_STYLES, s.titleStyle, (v) => set({ titleStyle: v }))),
      field('括號或符號', select('括號或符號', TITLE_MARKS, s.titleMark, (v) => set({ titleMark: v }))),
      field('內文字型', select('內文字型', fonts, s.bodyFont, (v) => set({ bodyFont: v }))),
      field('內文大小', select('內文大小', bodySizeOptions(o.bigText === true), s.bodySize, (v) => set({ bodySize: v })), o.bigText && s.bodySize === 's' ? '大字模式下，小號內文印成中號。' : undefined),
      field('框線', select('框線', FRAMES, s.frame, (v) => set({ frame: v }))),
      ...(s.frame === 'pattern' ? [field('花邊圖樣', select('花邊圖樣', PATTERNS, s.pattern, (v) => set({ pattern: v })))] : []),
      ...(s.kind === 'picture' || s.kind === 'ad'
        ? [field('插圖', select('插圖', [{ value: 'none' as const, label: '無' }, ...PICTURES], s.picture, (v) => set({ picture: v })))]
        : []),
      field('高度（段）', number('高度（段）', 1, 6, s.span, (v) => set({ span: v }))),
      field('寬度（行）', number('寬度（行）', 0, 60, s.width, (v) => set({ width: v })), '0 表示佔滿這一段剩下的寬度（通欄）。'),
    ),
  );
  return root;
}
