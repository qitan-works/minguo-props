// 民國道具舖：主程式。左邊表單、右邊即時預覽；內容自動存在 localStorage。
// 不連線到任何外部服務：唯一的網路請求是讀取同站的電碼表 data/telegraph.json。

import { createSafeStore, type SaveOutcome } from './lib/storage.ts';
import { createCodebook, encodeTelegram, missingChars, substitutedChars, type Codebook } from './lib/telegraph.ts';
import { renderCard } from './render/card.ts';
import { renderLetter } from './render/letter.ts';
import { renderRelic } from './render/relic.ts';
import { fitNewspaperToContent, renderNewspaper } from './render/newspaper.ts';
import { renderNewspaperFull, type FullPageRender } from './render/newspaper-full.ts';
import { applyPaperEffects } from './render/effects.ts';
import { drawDecorations } from './render/decorations.ts';
import { buildDecorationEditor } from './ui/decorations.ts';
import { placeDecoration } from './lib/decorations.ts';
import { measureMarks } from './render/effects.ts';
import { PX_PER_MM } from './lib/geometry.ts';
import { parsePreviewZoom, previewScale, serializePreviewZoom, wheelDirection, zoomBy, type PreviewFit, type PreviewZoom, type Size } from './lib/preview.ts';
import { applyPreset, pickConditions } from './props/conditions.ts';
import { eraFontPatch, eraPatch, isEra } from './props/eras.ts';
import { startCropDrawing, type CropSession, type CropTool } from './ui/crop.ts';
import { newId, type Decoration } from './props/extras.ts';
import { findOverflow } from './render/sheet.ts';
import { renderTelegram, type TelegramRender } from './render/telegram.ts';
import {
  PROP_FIELDS,
  PROP_KINDS,
  PROP_LABELS,
  defaultState,
  parseSaveText,
  serializeState,
  updateExtras,
  updateProp,
  type AppState,
  type PropKind,
} from './state.ts';
import { h } from './ui/dom.ts';
import { buildForm, type FieldValue } from './ui/form.ts';
import { buildItemsEditor } from './ui/items.ts';
import { closePopover } from './ui/popover.ts';
import { buildBlockPanel, type BlockAction } from './ui/blocks.ts';
import { EMPTY_BLOCK_EXTRAS, mergeStyle, type BlockEdit, type BlockExtras, type BlockStyle } from './lib/newspaper/blockstyle.ts';
import { contentSeed, snapshotContent } from './lib/newspaper/content.ts';
import { FONT_OPTIONS } from './fonts.ts';

const STORAGE_KEY = 'minguo-props:v1';
const store = createSafeStore(() => window.localStorage, STORAGE_KEY);

function $(selector: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`找不到元素：${selector}`);
  return el;
}

const els = {
  tabs: $('#prop-tabs'),
  form: $('#prop-form'),
  telegramInfo: $('#telegram-info'),
  overflow: $('#overflow-warning'),
  status: $('#status'),
  stage: $('#preview-stage'),
  preview: $('#preview'),
  editor: $('#editor'),
  previewBar: $('#preview-bar'),
  zoomValue: $('#zoom-value'),
  jumpButton: $('#btn-jump'),
  printButton: $('#btn-print'),
  exportButton: $('#btn-export'),
  importButton: $('#btn-import'),
  importInput: $('#import-file') as HTMLInputElement,
  resetButton: $('#btn-reset'),
  clearButton: $('#btn-clear'),
};

let codebook: Codebook | null = null;
let lastFull: FullPageRender | null = null;
/** 整版上點選的區塊（只在畫面上標示，不存檔）。 */
let selectedBlock: string | null = null;
let selectedDeco: string | null = null;
let codebookFailed = false;
let saveTimer: number | undefined;
let renderQueued = false;
let lastSaveOutcome: SaveOutcome | null = null;

function setStatus(message: string, tone: 'info' | 'warn' | 'error' = 'info'): void {
  els.status.textContent = message;
  els.status.dataset['tone'] = tone;
}

function loadInitialState(): AppState {
  const saved = store.load();
  if (saved === null) return defaultState();
  const result = parseSaveText(saved);
  if (!result.ok) {
    setStatus(`本機存檔無法讀取（${result.error}），已改用預設內容。`, 'warn');
    return defaultState();
  }
  if (result.warnings.length > 0) setStatus(result.warnings.join(' '), 'warn');
  return result.state;
}

let state: AppState = loadInitialState();

function saveNow(): void {
  const outcome = store.save(serializeState(state));
  if (outcome === lastSaveOutcome) return;
  lastSaveOutcome = outcome;
  switch (outcome) {
    case 'saved':
      setStatus('內容已自動保存在這台電腦的瀏覽器裡。');
      break;
    case 'quota':
      setStatus('瀏覽器的儲存空間不足（多半是照片太大），無法自動保存；請用「匯出 JSON」備份。', 'warn');
      break;
    case 'unavailable':
      setStatus('這個瀏覽器不允許本機儲存（例如無痕模式），關閉頁面後內容不會保留；請用「匯出 JSON」備份。', 'warn');
      break;
    case 'error':
      setStatus('自動保存失敗；請用「匯出 JSON」備份。', 'warn');
      break;
  }
}

function scheduleSave(): void {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(saveNow, 400);
}

// ---- 分頁 ----

function renderTabs(): void {
  els.tabs.replaceChildren(
    ...PROP_KINDS.map((kind) => {
      const selected = kind === state.active;
      const button = h('button', {
        class: 'tab',
        text: PROP_LABELS[kind],
        attrs: { type: 'button', role: 'tab', 'aria-selected': selected ? 'true' : 'false', id: `tab-${kind}`, 'aria-controls': 'prop-form' },
      });
      button.addEventListener('click', () => switchTo(kind));
      return button;
    }),
  );
}

function switchTo(kind: PropKind): void {
  if (kind === state.active) return;
  state = { ...state, active: kind };
  renderTabs();
  rebuildForm();
  queueRender();
  scheduleSave();
}

// ---- 表單 ----

let refreshForm: ((values: Readonly<Record<string, FieldValue>>) => void) | null = null;

function currentValues(): Readonly<Record<string, FieldValue>> {
  return state.props[state.active] as unknown as Readonly<Record<string, FieldValue>>;
}

function rebuildForm(): void {
  const kind = state.active;
  const form = buildForm(PROP_FIELDS[kind], currentValues(), {
    onChange(key, value) {
      if (key === 'preset') {
        // 情境預設：一次套用一組紙張狀況，再重建表單讓欄位顯示新值
        state = updateProp(state, kind, applyPreset(pickConditions(currentValues()), String(value)) as never);
        queueRender();
        scheduleSave();
        rebuildForm();
        return;
      }
      if (key === 'era' && kind === 'newspaper' && isEra(String(value))) {
        // 年代預設：一次改句讀、報頭位置、字型與印刷質感，再重建表單
        const patch = eraPatch(String(value) as Parameters<typeof eraPatch>[0]);
        state = updateProp(state, kind, { era: value, ...(patch ?? {}) } as never);
        queueRender();
        scheduleSave();
        rebuildForm();
        return;
      }
      if (key === 'fontEra' && isEra(String(value))) {
        // 字型年代組合：一次改五個字型，再重建表單
        const patch = eraFontPatch(String(value) as Parameters<typeof eraFontPatch>[0]);
        state = updateProp(state, kind, { fontEra: value, ...(patch ?? {}) } as never);
        queueRender();
        scheduleSave();
        rebuildForm();
        return;
      }
      if (kind !== 'newspaper' && ['fontMasthead', 'fontTitle', 'fontBody', 'fontAd', 'fontHand'].includes(key)) {
        state = updateProp(state, kind, { [key]: value, fontEra: 'custom' } as never);
        const select = document.querySelector<HTMLSelectElement>('#prop-form select[id^="f-fontEra-"]');
        if (select) select.value = 'custom';
        refreshForm?.(currentValues());
        queueRender();
        scheduleSave();
        return;
      }
      if (kind === 'newspaper' && ['punctuation', 'mastheadLayout', 'press', 'fontMasthead', 'fontTitle', 'fontBody', 'fontAd'].includes(key)) {
        // 個別調整了年代預設管的欄位：年代改成「自訂」
        state = updateProp(state, kind, { [key]: value, era: 'custom' } as never);
        const eraSelect = document.querySelector<HTMLSelectElement>('#prop-form select[id^="f-era-"]');
        if (eraSelect) eraSelect.value = 'custom';
        refreshForm?.(currentValues());
        queueRender();
        scheduleSave();
        return;
      }
      state = updateProp(state, kind, { [key]: value } as never);
      refreshForm?.(currentValues());
      queueRender();
      scheduleSave();
    },
    onError(message) {
      setStatus(message, 'error');
    },
  });
  refreshForm = form.refresh;
  els.form.replaceChildren(form.root);
  const panel = kind === 'newspaper' ? blockPanel() : null;
  if (panel) els.form.prepend(panel);
  els.form.appendChild(cropEditor(kind));
  els.form.appendChild(
    buildDecorationEditor({
      decorations: state.extras[kind].decorations,
      selectedId: selectedDeco,
      place: (radius, existing) => {
        const paper = els.stage.querySelector<HTMLElement>('.paper');
        if (!paper) return { x: 50, y: 50 };
        return placeDecoration({
          width: paper.offsetWidth / PX_PER_MM,
          height: paper.offsetHeight / PX_PER_MM,
          radius,
          existing,
          protect: measureMarks(paper, 'protect'),
        });
      },
      onChange(decorations, redraw) {
        state = updateExtras(state, kind, { decorations } as never);
        queueRender();
        scheduleSave();
        if (redraw) rebuildForm();
      },
      onSelect(id) {
        if (id === selectedDeco) return;
        selectedDeco = id;
        queueRender();
      },
    }),
  );
  if (kind === 'newspaper') {
    els.form.appendChild(
      buildItemsEditor(state.extras.newspaper.items, (items) => {
        state = updateExtras(state, 'newspaper', { items });
        queueRender();
        scheduleSave();
      }),
    );
  }
  els.form.setAttribute('aria-labelledby', `tab-${kind}`);
}

// ---- 自由裁切 ----

let cropSession: CropSession | null = null;

function cropEditor(kind: PropKind): HTMLElement {
  const has = state.extras[kind].crop !== null;
  const status = h('p', { class: 'form-hint', text: has ? '已設定自由裁切範圍。' : '尚未設定（整張紙）。' });
  const start = (tool: CropTool): void => {
    cropSession?.cancel();
    queueRender();
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        cropSession = startCropDrawing(
          els.stage,
          tool,
          (points) => {
            state = updateExtras(state, kind, { crop: points } as never);
            scheduleSave();
          },
          () => {
            cropSession = null;
            rebuildForm();
            queueRender();
          },
        );
      }),
    );
  };
  const polygon = h('button', { class: 'btn btn-small', attrs: { type: 'button' }, text: '在預覽上畫多邊形' });
  const lasso = h('button', { class: 'btn btn-small', attrs: { type: 'button' }, text: '手繪套索' });
  const clear = h('button', { class: 'btn btn-small', attrs: { type: 'button', disabled: !has }, text: '清除自由裁切' });
  polygon.addEventListener('click', () => start('polygon'));
  lasso.addEventListener('click', () => start('lasso'));
  clear.addEventListener('click', () => {
    state = updateExtras(state, kind, { crop: null } as never);
    scheduleSave();
    rebuildForm();
    queueRender();
  });
  return h(
    'fieldset',
    { class: 'form-group' },
    h('legend', { text: '自由裁切' }),
    h('p', { class: 'form-hint', text: '框出要保留的部分；搭配「紙邊」選擇手撕、火燒等樣式，會沿著你畫的形狀加工。' }),
    h('div', { class: 'crop-buttons' }, polygon, lasso, clear),
    status,
  );
}

// ---- 預覽 ----

function queueRender(): void {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    renderPreview();
  });
}

function renderTelegramInfo(result: TelegramRender | null): void {
  if (!result) {
    els.telegramInfo.hidden = true;
    return;
  }
  els.telegramInfo.hidden = false;
  const children: (HTMLElement | string)[] = [h('h2', { text: '電碼檢查' })];
  if (!result.coded) {
    children.push(
      h('p', { class: 'warn', text: codebookFailed ? '電碼表載入失敗，暫時無法標示電碼。請確認網站檔案完整後重新整理。' : '電碼表載入中……' }),
    );
  } else {
    const missing = missingChars(result.cells);
    if (missing.length === 0) {
      children.push(h('p', { class: 'ok', text: '電文中每個漢字都查得到電碼。' }));
    } else {
      children.push(
        h('p', { class: 'warn', text: `以下 ${missing.length} 個字查無電碼，已在電報上以紅框標示：` }),
        h('p', { class: 'missing-list' }, ...missing.map((c) => h('span', { class: 'missing-char', text: c }))),
        h('p', { class: 'form-hint', text: '可以改用同義字或常見寫法（例如異體字改為正體）。' }),
      );
    }
    const substituted = substitutedChars(result.cells);
    if (substituted.length > 0) {
      children.push(
        h('p', {
          text: `電碼本收的是舊字形，以下的字改用異體字的電碼：${substituted.map(([from, to]) => `${from}→${to}`).join('、')}。`,
        }),
      );
    }
    const code = encodeTelegram(result.cells);
    const output = h('textarea', { class: 'code-string', attrs: { readonly: '', rows: 3, 'aria-label': '電碼串' } });
    output.value = code;
    children.push(h('p', { text: `共 ${result.cells.length} 字（方格可容 ${result.capacity} 字）。電碼串：` }), output);
  }
  els.telegramInfo.replaceChildren(...children);
}

function renderPreview(): void {
  closePopover();
  lastFull = null;
  let sheet: HTMLElement;
  let telegram: TelegramRender | null = null;
  switch (state.active) {
    case 'newspaper': {
      const np = state.props.newspaper;
      if (np.fit === 'full' || np.fit === 'cut') {
        lastFull = renderNewspaperFull(np, state.extras.newspaper, selectedBlock);
        sheet = lastFull.sheet;
        if (selectedBlock && !lastFull.layout.blocks.some((b) => b.id === selectedBlock)) {
          selectedBlock = null;
          queueMicrotask(() => rebuildForm());
        } else if (selectedBlock && els.form.querySelector('#block-panel')?.getAttribute('data-block-id') !== selectedBlock) {
          // 新增或複製的區塊要排出來之後才有設定面板
          queueMicrotask(() => rebuildForm());
        }
      } else {
        sheet = renderNewspaper(np, state.extras.newspaper.crop);
      }
      break;
    }
    case 'telegram':
      telegram = renderTelegram(state.props.telegram, codebook, state.extras.telegram.crop);
      sheet = telegram.sheet;
      break;
    case 'letter':
      sheet = renderLetter(state.props.letter, state.extras.letter.crop);
      break;
    case 'card':
      sheet = renderCard(state.props.card, state.extras.card.crop);
      break;
    case 'relic':
      sheet = renderRelic(state.props.relic, state.extras.relic.crop);
      break;
  }
  // 列印用的頁面名稱（見 print.css）
  document.documentElement.dataset['page'] = sheet.dataset['page'] ?? '';
  const scaler = h('div', { class: 'sheet-scaler' }, sheet);
  els.stage.replaceChildren(scaler);
  fitNewspaperToContent(sheet);
  applyPaperEffects(sheet);
  drawDecorations(sheet, state.extras[state.active].decorations, selectedDeco);
  fitPreview();
  renderTelegramInfo(telegram);
  requestAnimationFrame(() => {
    els.overflow.hidden = !findOverflow(sheet);
    fitPreview();
  });
}

// ---- 預覽大小：整張（預設）、符合寬度、實際大小、放大縮小；選擇存在 localStorage ----

const PREVIEW_ZOOM_KEY = 'minguo-props:preview-zoom';
const zoomStore = createSafeStore(() => window.localStorage, PREVIEW_ZOOM_KEY);
let previewZoom: PreviewZoom = parsePreviewZoom(zoomStore.load());
let currentScale = 1;
const wideLayout = window.matchMedia('(min-width: 900px)');

/** 道具可用的空間：寬螢幕是預覽欄扣掉工具列、提示與留白；窄螢幕以視窗高度為準。 */
function previewSpace(): Size {
  const w = els.stage.clientWidth - 32;
  if (wideLayout.matches) {
    const top = els.stage.getBoundingClientRect().top - els.preview.getBoundingClientRect().top + els.preview.scrollTop;
    return { w, h: els.preview.clientHeight - top - 32 };
  }
  return { w, h: window.innerHeight - els.previewBar.offsetHeight - 48 };
}

function fitPreview(): void {
  const scaler = els.stage.querySelector<HTMLElement>('.sheet-scaler');
  const sheet = scaler?.querySelector<HTMLElement>('.sheet');
  if (!scaler || !sheet) return;
  const natural = { w: sheet.offsetWidth, h: sheet.offsetHeight };
  if (natural.w === 0) return;
  currentScale = previewScale(previewZoom, natural, previewSpace());
  scaler.style.setProperty('--scale', String(currentScale));
  scaler.style.setProperty('width', `${natural.w * currentScale}px`);
  scaler.style.setProperty('height', `${natural.h * currentScale}px`);
  els.zoomValue.textContent = `${Math.round(currentScale * 100)}%`;
  for (const b of els.previewBar.querySelectorAll<HTMLButtonElement>('[data-fit]')) {
    b.setAttribute('aria-pressed', String(b.dataset['fit'] === previewZoom.fit));
  }
}

function setPreviewZoom(z: PreviewZoom): void {
  previewZoom = z;
  zoomStore.save(serializePreviewZoom(z));
  fitPreview();
}

els.previewBar.addEventListener('click', (event) => {
  const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button') : null;
  if (!button) return;
  const fit = button.dataset['fit'];
  if (fit) setPreviewZoom({ fit: fit as PreviewFit, zoom: currentScale });
  else if (button.dataset['zoom']) setPreviewZoom(zoomBy(currentScale, button.dataset['zoom'] === '1' ? 1 : -1));
});

const previewResize = new ResizeObserver(() => fitPreview());
previewResize.observe(els.stage);
previewResize.observe(els.preview);
window.addEventListener('resize', () => fitPreview());

// 窄螢幕：浮動按鈕在表單與預覽之間跳轉
function updateJumpButton(): void {
  const atPreview = els.preview.getBoundingClientRect().top < window.innerHeight * 0.5;
  els.jumpButton.textContent = atPreview ? '回表單' : '看預覽';
  els.jumpButton.setAttribute('aria-controls', atPreview ? 'editor' : 'preview');
}
els.jumpButton.addEventListener('click', () => {
  const target = els.preview.getBoundingClientRect().top < window.innerHeight * 0.5 ? els.editor : els.preview;
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  target.focus({ preventScroll: true });
});
window.addEventListener('scroll', updateJumpButton, { passive: true });
updateJumpButton();

// ---- 工具列 ----

function timestamp(): string {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

els.printButton.addEventListener('click', () => {
  void document.fonts.ready.then(() => window.print());
});

els.exportButton.addEventListener('click', () => {
  const blob = new Blob([serializeState(state)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { attrs: { href: url, download: `minguo-props-${timestamp()}.json` } });
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  setStatus('已匯出 JSON 存檔（照片也包含在檔案裡）。');
});

els.importButton.addEventListener('click', () => els.importInput.click());
els.importInput.addEventListener('change', () => {
  const file = els.importInput.files?.[0];
  els.importInput.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.addEventListener('load', () => {
    const result = parseSaveText(typeof reader.result === 'string' ? reader.result : '');
    if (!result.ok) {
      setStatus(`匯入失敗：${result.error}`, 'error');
      return;
    }
    state = result.state;
    renderTabs();
    rebuildForm();
    queueRender();
    saveNow();
    lastSaveOutcome = null;
    setStatus(result.warnings.length > 0 ? `已匯入，但有些內容改用預設值：${result.warnings.join(' ')}` : '已匯入存檔。', result.warnings.length > 0 ? 'warn' : 'info');
  });
  reader.addEventListener('error', () => setStatus('無法讀取這個檔案。', 'error'));
  reader.readAsText(file, 'utf-8');
});

els.resetButton.addEventListener('click', () => {
  const kind = state.active;
  if (!window.confirm(`要把「${PROP_LABELS[kind]}」的內容還原成預設值嗎？`)) return;
  const defaults = defaultState();
  state = {
    ...state,
    props: { ...state.props, [kind]: defaults.props[kind] },
    extras: { ...state.extras, [kind]: defaults.extras[kind] },
  };
  rebuildForm();
  queueRender();
  scheduleSave();
});

els.clearButton.addEventListener('click', () => {
  if (!window.confirm('要清除這台電腦上保存的全部內容，並還原成預設值嗎？（已匯出的 JSON 檔不受影響）')) return;
  window.clearTimeout(saveTimer);
  store.remove();
  zoomStore.remove();
  previewZoom = parsePreviewZoom(null);
  state = defaultState();
  lastSaveOutcome = null;
  renderTabs();
  rebuildForm();
  queueRender();
  setStatus('已清除本機保存的內容。');
});

// ---- 整版：點一個區塊，左邊出現它自己的設定 ----

function blockExtras(): BlockExtras {
  return state.extras.newspaper.blocks ?? EMPTY_BLOCK_EXTRAS;
}

function commitBlocks(next: BlockExtras, select: string | null = selectedBlock): void {
  state = updateExtras(state, 'newspaper', { blocks: next });
  selectedBlock = select;
  scheduleSave();
  queueRender();
  rebuildForm();
}

/** 改一個區塊的樣式：只把改過的欄位併進它的修改。 */
function editBlock(id: string, patch: Partial<BlockStyle> & Partial<Pick<BlockEdit, 'locked' | 'content' | 'contentSeed'>>): void {
  const b = blockExtras();
  const old = b.edits.find((e) => e.id === id);
  const next: BlockEdit = { ...(old ?? { id }), ...patch, id };
  commitBlocks({ ...b, edits: [...b.edits.filter((e) => e.id !== id), next] });
}

function blockAction(id: string, action: BlockAction): void {
  const b = blockExtras();
  const placed = lastFull?.layout.blocks.find((x) => x.id === id);
  const order = (lastFull?.blocks ?? []).map((x) => x.id);
  switch (action) {
    case 'close':
      selectedBlock = null;
      queueRender();
      rebuildForm();
      return;
    case 'add': {
      const nid = newId('u');
      const at = order.indexOf(id);
      commitBlocks({ ...b, added: [...b.added, { id: nid, kind: 'news', after: id }], order: b.order.length ? [...order.slice(0, at + 1), nid, ...order.slice(at + 1)] : b.order }, nid);
      return;
    }
    case 'copy': {
      if (!placed) return;
      const nid = newId('u');
      const at = order.indexOf(id);
      const { kind, ...rest } = placed.style;
      commitBlocks(
        {
          ...b,
          added: [...b.added, { id: nid, kind, after: id }],
          edits: [...b.edits, { id: nid, kind, ...rest }],
          order: b.order.length ? [...order.slice(0, at + 1), nid, ...order.slice(at + 1)] : b.order,
        },
        nid,
      );
      return;
    }
    case 'delete':
      commitBlocks(
        {
          edits: b.edits.filter((e) => e.id !== id),
          added: b.added.filter((a) => a.id !== id),
          removed: b.added.some((a) => a.id === id) ? b.removed : [...b.removed.filter((r) => r !== id), id],
          order: b.order.filter((o) => o !== id),
        },
        null,
      );
      return;
    case 'lock': {
      if (!placed || !lastFull) return;
      const np = state.props.newspaper;
      editBlock(id, { ...placed.style, locked: true, content: snapshotContent(placed.usedIds, lastFull.pool), contentSeed: contentSeed(np.fillSeed, id) });
      return;
    }
    case 'unlock': {
      const old = b.edits.find((e) => e.id === id);
      if (!old) return;
      const { locked: _l, content: _c, contentSeed: _s, ...rest } = old;
      commitBlocks({ ...b, edits: [...b.edits.filter((e) => e.id !== id), rest] });
      return;
    }
    case 'up':
    case 'down': {
      const at = order.indexOf(id);
      const to = action === 'up' ? at - 1 : at + 1;
      if (at < 0 || to < 0 || to >= order.length) return;
      const next = [...order];
      [next[at], next[to]] = [next[to] as string, next[at] as string];
      commitBlocks({ ...b, order: next });
      return;
    }
    case 'reset':
      commitBlocks({ ...b, edits: b.edits.filter((e) => e.id !== id) });
      return;
  }
}

function blockPanel(): HTMLElement | null {
  const np = state.props.newspaper;
  if (!selectedBlock || !lastFull || (np.fit !== 'full' && np.fit !== 'cut')) return null;
  const placed = lastFull.layout.blocks.find((x) => x.id === selectedBlock);
  if (!placed) return null;
  const id = placed.id;
  const edit = blockExtras().edits.find((e) => e.id === id);
  const head = placed.lines.find((l) => l.itemId === placed.headItemId && (l.role === 'h1' || l.role === 'h2' || l.role === 'h3'));
  return buildBlockPanel({
    id,
    // 畫面還沒重畫之前，先把最新的修改套上去
    style: mergeStyle(placed.style, edit),
    filler: placed.filler,
    locked: edit?.locked === true,
    edited: !!edit,
    titlePreview: placed.band?.lines.map((l) => l.text).join('') ?? head?.glyphs.map((g) => g.ch).join('') ?? placed.ad?.big ?? placed.table?.title ?? placed.toc?.title ?? placed.picture?.caption ?? '',
    fontOptions: FONT_OPTIONS,
    onStyle: (patch) => editBlock(id, patch),
    onAction: (action) => blockAction(id, action),
  });
}

/** 預覽上的一點落在哪個區塊（依版面格子換算）。 */
function blockAtPoint(clientX: number, clientY: number): string | null {
  const paper = els.stage.querySelector<HTMLElement>('.paper');
  if (!paper || !lastFull) return null;
  const box = paper.getBoundingClientRect();
  const perMm = box.width / (paper.offsetWidth / PX_PER_MM);
  const x = (clientX - box.left) / perMm;
  const y = (clientY - box.top) / perMm;
  const { geometry: g, layout } = lastFull;
  const col = Math.floor((g.area.x + g.area.w - x) / g.pitch);
  const row = Math.floor((y - g.area.y) / g.cell);
  if (col < 0 || row < 0 || col >= layout.cols || row >= layout.rows) return null;
  const index = layout.owner[row * layout.cols + col] ?? -1;
  return index >= 0 ? (layout.blocks[index]?.id ?? null) : null;
}

els.stage.addEventListener('click', (event) => {
  closePopover();
  if (event.target instanceof Element && event.target.closest('.deco, .crop-overlay')) return;
  if (state.active !== 'newspaper' || !lastFull) return;
  const target = event.target instanceof Element ? event.target.closest<HTMLElement>('.nr[data-region-id]') : null;
  // 點在空心字、框線、留白上時，依座標找出是哪個區塊
  const id = target?.dataset['regionId'] ?? blockAtPoint(event.clientX, event.clientY);
  if (!id || id === selectedBlock) return;
  selectedBlock = id;
  queueRender();
  rebuildForm();
  // 寬螢幕：表單欄捲回最上面，看得到區塊設定
  if (wideLayout.matches) els.editor.scrollTo({ top: 0, behavior: 'smooth' });
  setStatus('已選取一個區塊，設定在左邊表單最上方。');
});

// ---- 裝飾：拖曳移動、Alt＋滾輪縮放、Alt＋Shift＋滾輪旋轉（沒按 Alt 時滾輪一律捲動） ----

function decoTarget(event: Event): { g: SVGGElement; id: string; paper: HTMLElement } | null {
  const g = event.target instanceof Element ? event.target.closest<SVGGElement>('g.deco[data-deco-id]') : null;
  const paper = g?.closest<HTMLElement>('.paper');
  const id = g?.dataset['decoId'];
  return g && paper && id ? { g, id, paper } : null;
}

function patchDecoration(id: string, patch: (d: Decoration) => Partial<Decoration>): void {
  const kind = state.active;
  const decorations = state.extras[kind].decorations.map((d) => (d.id === id ? { ...d, ...patch(d) } : d));
  state = updateExtras(state, kind, { decorations } as never);
  queueRender();
  scheduleSave();
}

els.stage.addEventListener('pointerdown', (event) => {
  const hit = decoTarget(event);
  if (!hit) return;
  event.preventDefault();
  const deco = state.extras[state.active].decorations.find((d) => d.id === hit.id);
  if (!deco) return;
  if (selectedDeco !== hit.id) {
    selectedDeco = hit.id;
    rebuildForm();
  }
  const perMm = hit.paper.getBoundingClientRect().width / (hit.paper.offsetWidth / PX_PER_MM);
  const startX = event.clientX;
  const startY = event.clientY;
  const base = hit.g.getAttribute('transform') ?? '';
  let dx = 0;
  let dy = 0;
  const move = (e: PointerEvent): void => {
    dx = (e.clientX - startX) / perMm;
    dy = (e.clientY - startY) / perMm;
    hit.g.setAttribute('transform', `translate(${dx.toFixed(2)} ${dy.toFixed(2)}) ${base}`);
  };
  const up = (): void => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    if (Math.abs(dx) + Math.abs(dy) > 0.05) patchDecoration(hit.id, (d) => ({ x: d.x + dx, y: d.y + dy }));
    else queueRender();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
});

els.stage.addEventListener(
  'wheel',
  (event) => {
    if (!event.altKey) return;
    const hit = decoTarget(event);
    if (!hit) return;
    event.preventDefault();
    const dir = wheelDirection(event.deltaY, event.deltaX);
    if (dir === 0) return;
    if (event.shiftKey) patchDecoration(hit.id, (d) => ({ rotate: Math.max(-180, Math.min(180, d.rotate + dir * 5)) }));
    else patchDecoration(hit.id, (d) => ({ scale: Math.max(0.2, Math.min(4, d.scale * (dir > 0 ? 1.06 : 1 / 1.06))) }));
  },
  { passive: false },
);

// ---- 啟動 ----

async function loadCodebook(): Promise<void> {
  try {
    const res = await fetch(new URL('../data/telegraph.json', import.meta.url));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { codes?: unknown; variants?: unknown };
    if (typeof json.codes !== 'object' || json.codes === null) throw new Error('格式不符');
    const variants = typeof json.variants === 'object' && json.variants !== null ? json.variants : {};
    codebook = createCodebook(json.codes as Record<string, string>, variants as Record<string, string>);
  } catch {
    codebookFailed = true;
  }
  if (state.active === 'telegram') queueRender();
}

renderTabs();
rebuildForm();
renderPreview();
void loadCodebook();
void document.fonts.ready.then(() => queueRender());
