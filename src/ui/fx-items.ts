// 特效項目編輯器（第五版）：選種類與樣式加到紙上、快速產生 N 個、把紙張狀況的滑桿拆成個別項目；
// 選取一項（在列表或預覽上點一下）後，上方出現它自己的設定：樣式、大小、不規則程度、強度、色調、
// 邊緣柔和度、數量、旋轉、換一個（種子）、自訂形狀、疊放順序、複製、刪除。

import {
  FX_KINDS,
  FX_LIMITS,
  FX_STYLES,
  FX_TONE_LABELS,
  SHAPE_KINDS,
  changeStyle,
  createFxItem,
  fxKindLabel,
  fxStyle,
  itemsFromConditions,
  placeFx,
  quickGenerate,
  sizeRange,
  type FxItem,
  type FxKind,
  type PlaceContext,
  type QuickConditions,
} from '../lib/fx/catalog.ts';
import { freshSeed } from '../lib/random.ts';
import { newId } from '../props/extras.ts';
import type { CropTool } from './crop.ts';
import { h } from './dom.ts';

export interface FxEditorOptions {
  readonly items: readonly FxItem[];
  /** 目前最新的項目（拖曳、滾輪改過之後，設定面板要以這份為準）。 */
  readonly current: () => readonly FxItem[];
  readonly selectedId: string | null;
  /** 紙張外框與保護區（擺放新項目用）。 */
  readonly place: () => PlaceContext;
  /** 目前紙張狀況的滑桿（拆成個別項目用）。 */
  readonly conditions: QuickConditions;
  onChange(items: FxItem[], redraw: boolean): void;
  onSelect(id: string | null): void;
  /** 拆成個別項目：新項目加進來，並把紙張狀況裡對應的滑桿歸零。 */
  onConvert(items: FxItem[]): void;
  /** 在預覽上畫自訂形狀（多邊形或手繪套索）。 */
  onDrawShape(id: string, tool: CropTool): void;
  /** 選取中的項目碰到保護區而縮小或取消挖洞時的說明。 */
  readonly note?: string | null;
}

/** 紙張狀況裡有沒有可以拆成個別項目的效果。 */
export function hasQuickEffects(c: QuickConditions): boolean {
  return c.burnHoles > 0 || c.wormHoles > 0 || c.pinHoles || c.water !== 'none' || c.folds || c.crumple > 0 || c.stains || c.spots > 0 || c.mold > 0 || c.rust || c.tape || c.smudge || c.wax;
}

export function fxLabel(item: FxItem): string {
  return `${fxKindLabel(item.kind)}・${fxStyle(item.kind, item.style).label}${item.shape ? '（自訂形狀）' : ''}`;
}

function button(text: string, run: () => void, disabled = false): HTMLButtonElement {
  const b = h('button', { class: 'btn btn-small', attrs: { type: 'button', disabled } , text });
  b.addEventListener('click', run);
  return b;
}

function slider(label: string, min: number, max: number, step: number, value: number, format: (v: number) => string, onInput: (v: number) => void, ends?: readonly [string, string]): HTMLElement {
  const input = h('input', { attrs: { type: 'range', min, max, step, 'aria-label': label } });
  input.value = String(value);
  const out = h('output', { class: 'range-value', text: format(value) });
  input.addEventListener('input', () => {
    const v = Number(input.value);
    out.textContent = format(v);
    onInput(v);
  });
  const row = h('label', { class: 'deco-slider' }, h('span', { text: label }), input, out);
  if (!ends) return row;
  return h('div', { class: 'fx-tone' }, row, h('div', { class: 'fx-tone-ends' }, h('span', { text: ends[0] }), h('span', { text: ends[1] })));
}

export function buildFxEditor(o: FxEditorOptions): HTMLElement {
  let items = [...o.items];
  const emit = (redraw: boolean): void => o.onChange([...items], redraw);
  const update = (id: string, patch: (d: FxItem) => FxItem, redraw = false): void => {
    items = o.current().map((d) => (d.id === id ? patch(d) : d));
    emit(redraw);
  };
  const topZ = (): number => {
    const cur = o.current();
    return cur.length ? Math.max(...cur.map((x) => x.z)) + 1 : 0;
  };

  // 加一個、快速產生
  const kind = h('select', { attrs: { 'aria-label': '效果種類' } });
  for (const k of FX_KINDS) kind.appendChild(h('option', { attrs: { value: k.value }, text: k.label }));
  const styleSel = h('select', { attrs: { 'aria-label': '樣式' } });
  const fillStyles = (): void => {
    styleSel.replaceChildren(h('option', { attrs: { value: 'random' }, text: '隨機樣式' }), ...FX_STYLES[kind.value as FxKind].map((st) => h('option', { attrs: { value: st.value }, text: st.label })));
    styleSel.value = (FX_STYLES[kind.value as FxKind][0]?.value ?? 'random');
  };
  fillStyles();
  kind.addEventListener('change', fillStyles);
  const add = button('加一個', () => {
    items = [...o.current()];
    if (items.length >= FX_LIMITS.items) return;
    const k = kind.value as FxKind;
    const seed = freshSeed();
    const made = quickGenerate(k, styleSel.value, 1, seed, o.place(), items, () => newId('x'));
    if (!made.length) return;
    items = [...items, ...made];
    emit(false);
    o.onSelect((made[0] as FxItem).id);
  });
  const n = h('input', { attrs: { type: 'number', min: 1, max: 30, step: 1, value: 5, 'aria-label': '產生幾個' } });
  const quick = button('快速產生', () => {
    const k = kind.value as FxKind;
    const count = Math.max(1, Math.min(30, Math.round(Number(n.value) || 1)));
    items = [...o.current()];
    items = [...items, ...quickGenerate(k, styleSel.value, count, freshSeed(), o.place(), items, () => newId('x'))];
    emit(true);
  });

  const convertible = hasQuickEffects(o.conditions);
  const convert = button(
    '把上面紙張狀況的效果拆成個別項目',
    () => {
      const cur = o.current();
      const made = itemsFromConditions(o.conditions, o.place(), cur, () => newId('x'));
      o.onConvert([...cur, ...made]);
    },
    !convertible,
  );

  // 選取中的項目
  const selected = items.find((d) => d.id === o.selectedId) ?? null;
  const panel = selected ? itemPanel(selected) : h('p', { class: 'form-hint', text: '在預覽上點一下效果，或點下面列表裡的一項，就會在這裡出現它自己的設定。' });

  function itemPanel(d: FxItem): HTMLElement {
    const st = fxStyle(d.kind, d.style);
    const [min, max] = sizeRange(st, d.shape !== null);
    const styleSelect = h('select', { attrs: { 'aria-label': '樣式' } });
    for (const s2 of FX_STYLES[d.kind]) styleSelect.appendChild(h('option', { attrs: { value: s2.value }, text: s2.label }));
    styleSelect.value = d.style;
    styleSelect.addEventListener('change', () => update(d.id, (x) => changeStyle(x, styleSelect.value), true));
    const pct = (v: number): string => `${Math.round(v)}`;
    const rows: HTMLElement[] = [
      h('label', { class: 'deco-slider' }, h('span', { text: '樣式' }), styleSelect),
      slider(`大小（${st.sizeLabel}）`, min, max, max > 50 ? 1 : 0.1, Math.min(max, Math.max(min, d.size)), (v) => `${v} mm`, (v) => update(d.id, (x) => ({ ...x, size: v }))),
      slider('形狀不規則', 0, 100, 1, d.irregular, pct, (v) => update(d.id, (x) => ({ ...x, irregular: v }))),
      slider('強度', 0, 100, 1, d.strength, pct, (v) => update(d.id, (x) => ({ ...x, strength: v }))),
      slider('色調', 0, 100, 1, d.tone, pct, (v) => update(d.id, (x) => ({ ...x, tone: v })), FX_TONE_LABELS[d.kind]),
      slider('邊緣柔和', 0, 100, 1, d.soft, pct, (v) => update(d.id, (x) => ({ ...x, soft: v }))),
    ];
    if (st.count !== undefined) rows.push(slider('數量', 1, Math.min(FX_LIMITS.count, Math.max(40, st.count * 3)), 1, d.count, (v) => `${v} 個`, (v) => update(d.id, (x) => ({ ...x, count: v }))));
    rows.push(slider('旋轉', -180, 180, 1, Math.round(((d.rotate + 540) % 360) - 180), (v) => `${v}°`, (v) => update(d.id, (x) => ({ ...x, rotate: v }))));
    const shapeButtons = SHAPE_KINDS.has(d.kind)
      ? [
          button('畫自訂形狀：多邊形', () => o.onDrawShape(d.id, 'polygon')),
          button('手繪套索', () => o.onDrawShape(d.id, 'lasso')),
          ...(d.shape ? [button('清除自訂形狀', () => update(d.id, (x) => ({ ...x, shape: null, size: fxStyle(x.kind, x.style).size }), true))] : []),
        ]
      : [];
    return h(
      'div',
      { class: 'fx-panel', attrs: { id: 'fx-panel' }, dataset: { fxId: d.id } },
      h('h3', { class: 'fx-panel-title', text: `選取中：${fxLabel(d)}` }),
      o.note ? h('p', { class: 'form-hint fx-note', text: o.note }) : null,
      ...rows,
      h(
        'div',
        { class: 'fx-buttons' },
        button('換一個', () => update(d.id, (x) => ({ ...x, seed: freshSeed(x.seed) }))),
        ...shapeButtons,
        button('移到最上層', () => update(d.id, (x) => ({ ...x, z: topZ() }))),
        button('移到最下層', () => update(d.id, (x) => ({ ...x, z: Math.min(...o.current().map((y) => y.z)) - 1 }))),
        button('複製', () => {
          items = [...o.current()];
    if (items.length >= FX_LIMITS.items) return;
          const copy: FxItem = { ...d, id: newId('x'), x: d.x + 6, y: d.y + 6, z: topZ(), seed: freshSeed(d.seed) };
          items = [...items, copy];
          emit(false);
          o.onSelect(copy.id);
        }),
        button('刪除', () => {
          items = o.current().filter((x) => x.id !== d.id);
          emit(false);
          o.onSelect(null);
        }),
        button('取消選取', () => o.onSelect(null)),
      ),
      d.shape ? h('p', { class: 'form-hint', text: '自訂形狀：大小滑桿會等比例縮放這個形狀；拖曳可以移動，旋轉照樣有效。' }) : null,
      st.anchor !== 'free'
        ? h('p', { class: 'form-hint', text: st.anchor === 'corner' ? '這個樣式貼著紙角：旋轉 0° 是左上角、90° 右上角、180° 右下角、270°（−90°）左下角。' : st.anchor === 'edge' ? '這個樣式貼著紙邊：旋轉 0° 是上邊、90° 右邊、180° 下邊、270°（−90°）左邊。' : '直線橫越整張紙：旋轉 0° 是橫的、90° 是直的。' })
        : null,
    );
  }

  const list = h(
    'ol',
    { class: 'fx-list' },
    ...[...items]
      .sort((a, b) => b.z - a.z)
      .map((d) =>
        h(
          'li',
          { class: ['fx-row', d.id === o.selectedId && 'fx-row-selected'], dataset: { fxId: d.id } },
          button(fxLabel(d), () => o.onSelect(d.id)),
          button('刪除', () => {
            items = o.current().filter((x) => x.id !== d.id);
            emit(false);
            if (d.id === o.selectedId) o.onSelect(null);
            else o.onChange([...items], true);
          }),
        ),
      ),
  );

  return h(
    'fieldset',
    { class: 'form-group fx-editor', attrs: { id: 'fx-editor' } },
    h('legend', { text: '特效項目（逐一放置、逐一調整）' }),
    h('p', {
      class: 'form-hint',
      text: '燒洞、水漬、撕口、摺痕、霉斑、膠帶……每一項都可以在預覽上拖曳移動；按住 Alt 再捲動滑鼠滾輪縮放，Alt＋Shift＋滾輪旋轉。標了 [保:…] 的線索會被避開：挖洞的效果碰到會自動縮小，其他效果在線索上不畫。',
    }),
    h('div', { class: 'deco-add' }, kind, styleSel, add),
    h('div', { class: 'deco-add' }, h('span', { text: '快速產生' }), n, h('span', { text: '個' }), quick),
    h('div', { class: 'deco-add' }, convert),
    panel,
    items.length ? list : h('p', { class: 'form-hint', text: '還沒有特效項目。' }),
    items.length ? h('div', { class: 'fx-buttons' }, button('全部清除', () => { items = []; emit(false); o.onSelect(null); })) : null,
  );
}

/** 依目前的位置與種子新增一項（測試與範例用）。 */
export function newFxItem(kind: FxKind, style: string, ctx: PlaceContext, existing: readonly FxItem[], seed: number): FxItem {
  const size = fxStyle(kind, style).size;
  const at = placeFx(kind, style, size, seed, ctx, existing);
  return createFxItem(kind, style, at, seed, existing.length ? Math.max(...existing.map((e) => e.z)) + 1 : 0, newId('x'));
}
