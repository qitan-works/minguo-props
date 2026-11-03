// 民國道具舖：主程式。左邊表單、右邊即時預覽；內容自動存在 localStorage。
// 不連線到任何外部服務：唯一的網路請求是讀取同站的電碼表 data/telegraph.json。

import { createSafeStore, type SaveOutcome } from './lib/storage.ts';
import { createCodebook, encodeTelegram, missingChars, substitutedChars, type Codebook } from './lib/telegraph.ts';
import { renderCard } from './render/card.ts';
import { renderLetter } from './render/letter.ts';
import { fitNewspaperToContent, renderNewspaper } from './render/newspaper.ts';
import { findOverflow } from './render/sheet.ts';
import { renderTelegram, type TelegramRender } from './render/telegram.ts';
import {
  PROP_FIELDS,
  PROP_KINDS,
  PROP_LABELS,
  defaultState,
  parseSaveText,
  serializeState,
  updateProp,
  type AppState,
  type PropKind,
} from './state.ts';
import { h } from './ui/dom.ts';
import { buildForm, type FieldValue } from './ui/form.ts';

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
  printButton: $('#btn-print'),
  exportButton: $('#btn-export'),
  importButton: $('#btn-import'),
  importInput: $('#import-file') as HTMLInputElement,
  resetButton: $('#btn-reset'),
  clearButton: $('#btn-clear'),
};

let codebook: Codebook | null = null;
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
  return state.props[state.active] as Readonly<Record<string, FieldValue>>;
}

function rebuildForm(): void {
  const kind = state.active;
  const form = buildForm(PROP_FIELDS[kind], currentValues(), {
    onChange(key, value) {
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
  els.form.setAttribute('aria-labelledby', `tab-${kind}`);
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
  let sheet: HTMLElement;
  let telegram: TelegramRender | null = null;
  switch (state.active) {
    case 'newspaper':
      sheet = renderNewspaper(state.props.newspaper);
      break;
    case 'telegram':
      telegram = renderTelegram(state.props.telegram, codebook);
      sheet = telegram.sheet;
      break;
    case 'letter':
      sheet = renderLetter(state.props.letter);
      break;
    case 'card':
      sheet = renderCard(state.props.card);
      break;
  }
  // 列印用的頁面名稱（見 print.css）
  document.documentElement.dataset['page'] = sheet.dataset['page'] ?? '';
  const scaler = h('div', { class: 'sheet-scaler' }, sheet);
  els.stage.replaceChildren(scaler);
  fitNewspaperToContent(sheet);
  fitPreview();
  renderTelegramInfo(telegram);
  requestAnimationFrame(() => {
    els.overflow.hidden = !findOverflow(sheet);
  });
}

function fitPreview(): void {
  const scaler = els.stage.querySelector<HTMLElement>('.sheet-scaler');
  const sheet = scaler?.querySelector<HTMLElement>('.sheet');
  if (!scaler || !sheet) return;
  const available = els.stage.clientWidth - 32;
  const naturalW = sheet.offsetWidth;
  const naturalH = sheet.offsetHeight;
  if (naturalW === 0) return;
  const maxScale = naturalW < 400 ? 2.5 : 1;
  const scale = Math.max(0.2, Math.min(maxScale, available / naturalW));
  scaler.style.setProperty('--scale', String(scale));
  scaler.style.setProperty('width', `${naturalW * scale}px`);
  scaler.style.setProperty('height', `${naturalH * scale}px`);
}

new ResizeObserver(() => fitPreview()).observe(els.stage);

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
  state = { ...state, props: { ...state.props, [kind]: defaults.props[kind] } };
  rebuildForm();
  queueRender();
  scheduleSave();
});

els.clearButton.addEventListener('click', () => {
  if (!window.confirm('要清除這台電腦上保存的全部內容，並還原成預設值嗎？（已匯出的 JSON 檔不受影響）')) return;
  window.clearTimeout(saveTimer);
  store.remove();
  state = defaultState();
  lastSaveOutcome = null;
  renderTabs();
  rebuildForm();
  queueRender();
  setStatus('已清除本機保存的內容。');
});

// ---- 啟動 ----

async function loadCodebook(): Promise<void> {
  try {
    const res = await fetch('data/telegraph.json');
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
