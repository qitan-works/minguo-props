// 應用程式狀態與存檔格式（匯出／匯入 JSON、localStorage 都用同一個格式）。純邏輯。
//
// 存檔格式（version 1）：
// {
//   "format": "minguo-props",
//   "version": 1,
//   "savedAt": "2026-11-05T03:00:00.000Z",
//   "active": "newspaper",
//   "props": { "newspaper": {…}, "telegram": {…}, "letter": {…}, "card": {…} }
// }
// 匯入時只保留已知欄位；型別不符的欄位改用預設值並提示。

import { cardDefaults, cardFields, type CardData } from './props/card.ts';
import { letterDefaults, letterFields, type LetterData } from './props/letter.ts';
import { newspaperDefaults, newspaperFields, type NewspaperData } from './props/newspaper.ts';
import type { Field } from './props/schema.ts';
import { sanitizeRecord } from './props/schema.ts';
import { telegramDefaults, telegramFields, type TelegramData } from './props/telegram.ts';

export const SAVE_FORMAT = 'minguo-props';
export const SAVE_VERSION = 1;
/** 匯入檔大小上限（字元數），照片以 data URL 存放，所以留得寬一些。 */
export const MAX_SAVE_LENGTH = 32 * 1024 * 1024;

export const PROP_KINDS = ['newspaper', 'telegram', 'letter', 'card'] as const;
export type PropKind = (typeof PROP_KINDS)[number];

export const PROP_LABELS: Readonly<Record<PropKind, string>> = {
  newspaper: '報紙剪報',
  telegram: '電報',
  letter: '信箋',
  card: '名片／請帖',
};

export interface PropsState {
  readonly newspaper: NewspaperData;
  readonly telegram: TelegramData;
  readonly letter: LetterData;
  readonly card: CardData;
}

export interface AppState {
  readonly active: PropKind;
  readonly props: PropsState;
}

export const PROP_FIELDS: { readonly [K in PropKind]: readonly Field[] } = {
  newspaper: newspaperFields,
  telegram: telegramFields,
  letter: letterFields,
  card: cardFields,
};

export function defaultState(): AppState {
  return {
    active: 'newspaper',
    props: {
      newspaper: { ...newspaperDefaults },
      telegram: { ...telegramDefaults },
      letter: { ...letterDefaults },
      card: { ...cardDefaults },
    },
  };
}

export function isPropKind(value: unknown): value is PropKind {
  return typeof value === 'string' && (PROP_KINDS as readonly string[]).includes(value);
}

export interface SaveFile {
  readonly format: typeof SAVE_FORMAT;
  readonly version: typeof SAVE_VERSION;
  readonly savedAt: string;
  readonly active: PropKind;
  readonly props: PropsState;
}

export function toSaveFile(state: AppState, now: Date = new Date()): SaveFile {
  return {
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    savedAt: now.toISOString(),
    active: state.active,
    props: state.props,
  };
}

export function serializeState(state: AppState, now: Date = new Date()): string {
  return `${JSON.stringify(toSaveFile(state, now), null, 2)}\n`;
}

export type ParseResult =
  | { readonly ok: true; readonly state: AppState; readonly warnings: readonly string[] }
  | { readonly ok: false; readonly error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseSaveObject(input: unknown): ParseResult {
  if (!isRecord(input) || input['format'] !== SAVE_FORMAT) {
    return { ok: false, error: '這不是民國道具舖的存檔。' };
  }
  const version = input['version'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, error: '存檔缺少有效的版本號。' };
  }
  if (version > SAVE_VERSION) {
    return { ok: false, error: `存檔版本（${version}）比本工具新，請更新後再匯入。` };
  }

  const warnings: string[] = [];
  const rawProps = isRecord(input['props']) ? input['props'] : {};
  if (!isRecord(input['props'])) warnings.push('存檔沒有道具內容，已全部改用預設值。');

  function load<D>(kind: PropKind, fields: readonly Field[], defaults: D): D {
    const raw = rawProps[kind];
    if (raw === undefined) return { ...defaults };
    const { data, replaced } = sanitizeRecord(fields, defaults as never, raw);
    if (!isRecord(raw)) warnings.push(`${PROP_LABELS[kind]}的內容格式不符，已改用預設值。`);
    else if (replaced.length > 0) {
      warnings.push(`${PROP_LABELS[kind]}有 ${replaced.length} 個欄位格式不符，已改用預設值（${replaced.join('、')}）。`);
    }
    return data as D;
  }

  const props: PropsState = {
    newspaper: load('newspaper', newspaperFields, newspaperDefaults),
    telegram: load('telegram', telegramFields, telegramDefaults),
    letter: load('letter', letterFields, letterDefaults),
    card: load('card', cardFields, cardDefaults),
  };

  let active: PropKind = 'newspaper';
  if (isPropKind(input['active'])) active = input['active'];
  else if (input['active'] !== undefined) warnings.push('無法辨識存檔中目前的道具種類，已切換到報紙剪報。');

  return { ok: true, state: { active, props }, warnings };
}

export function parseSaveText(text: string): ParseResult {
  if (text.length > MAX_SAVE_LENGTH) return { ok: false, error: '檔案太大，無法匯入。' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: '檔案不是有效的 JSON。' };
  }
  return parseSaveObject(parsed);
}

/** 更新某個道具的一個欄位，回傳新的狀態（不修改原狀態）。 */
export function updateProp<K extends PropKind>(
  state: AppState,
  kind: K,
  patch: Partial<PropsState[K]>,
): AppState {
  return { ...state, props: { ...state.props, [kind]: { ...state.props[kind], ...patch } } };
}
