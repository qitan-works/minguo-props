// 應用程式狀態與存檔格式（匯出／匯入 JSON、localStorage 都用同一個格式）。純邏輯。
//
// 存檔格式（version 2）：
// {
//   "format": "minguo-props",
//   "version": 2,
//   "savedAt": "2026-11-05T03:00:00.000Z",
//   "active": "newspaper",
//   "props": { "newspaper": {…表單欄位…}, "telegram": {…}, "letter": {…}, "card": {…} },
//   "extras": { "newspaper": { "items": […], "locked": […], "removed": […], "crop": null, "decorations": […] }, … }
// }
// 匯入時只保留已知欄位；型別不符的欄位改用預設值並提示。第一版（version 1）的存檔可以直接匯入。

import { cardDefaults, cardFields, type CardData } from './props/card.ts';
import { relicDefaults, relicFields, type RelicData } from './props/relic.ts';
import { documentDefaults, documentFields, type DocumentData } from './props/document.ts';
import { compactExtras, defaultExtras, sanitizeExtras, type ExtrasState } from './props/extras.ts';
import { letterDefaults, letterFields, type LetterData } from './props/letter.ts';
import { newspaperDefaults, newspaperFields, type NewspaperData } from './props/newspaper.ts';
import type { Field } from './props/schema.ts';
import { sanitizeRecord } from './props/schema.ts';
import { telegramDefaults, telegramFields, type TelegramData } from './props/telegram.ts';

export const SAVE_FORMAT = 'minguo-props';
export const SAVE_VERSION = 2;
/** 匯入檔大小上限（字元數），照片以 data URL 存放，所以留得寬一些。 */
export const MAX_SAVE_LENGTH = 32 * 1024 * 1024;

export const PROP_KINDS = ['newspaper', 'telegram', 'letter', 'card', 'relic', 'document'] as const;
export type PropKind = (typeof PROP_KINDS)[number];

export const PROP_LABELS: Readonly<Record<PropKind, string>> = {
  newspaper: '報紙剪報',
  telegram: '電報',
  letter: '信箋',
  card: '名片／請帖',
  relic: '古物',
  document: '日常文件',
};

export interface PropsState {
  readonly newspaper: NewspaperData;
  readonly telegram: TelegramData;
  readonly letter: LetterData;
  readonly card: CardData;
  readonly relic: RelicData;
  readonly document: DocumentData;
}

export interface AppState {
  readonly active: PropKind;
  readonly props: PropsState;
  readonly extras: ExtrasState;
  /** 第五版：線索包（多張道具的快照，依序編號為線索一、二……）。 */
  readonly pack: readonly PackEntry[];
}

/** 線索包裡的一件：某個道具在加入當時的內容（表單欄位與結構化資料），以及要在哪一幕給。 */
export interface PackEntry {
  readonly id: string;
  readonly kind: PropKind;
  readonly scene: string;
  readonly props: PropsState[PropKind];
  readonly extras: ExtrasState[PropKind];
}

export const PACK_LIMITS = { entries: 30, scene: 60 } as const;

export const PROP_FIELDS: { readonly [K in PropKind]: readonly Field[] } = {
  newspaper: newspaperFields,
  telegram: telegramFields,
  letter: letterFields,
  card: cardFields,
  relic: relicFields,
  document: documentFields,
};

export function defaultState(): AppState {
  return {
    active: 'newspaper',
    props: {
      newspaper: { ...newspaperDefaults },
      telegram: { ...telegramDefaults },
      letter: { ...letterDefaults },
      card: { ...cardDefaults },
      relic: { ...relicDefaults },
      document: { ...documentDefaults },
    },
    extras: defaultExtras(),
    pack: [],
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
  readonly extras: Record<keyof ExtrasState, unknown>;
  readonly pack?: readonly PackEntry[];
}

export function toSaveFile(state: AppState, now: Date = new Date()): SaveFile {
  return {
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    savedAt: now.toISOString(),
    active: state.active,
    props: state.props,
    extras: compactExtras(state.extras),
    ...(state.pack.length ? { pack: state.pack } : {}),
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

/** 第一版存檔的欄位轉換：「污漬位置」選單（'1'～'8'）改成數字種子。 */
function migrateV1Prop(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  const out: Record<string, unknown> = { ...raw };
  if (typeof raw['stainSeed'] === 'string' && /^[1-9]$/.test(raw['stainSeed'])) {
    out['effectSeed'] = Number(raw['stainSeed']);
  }
  delete out['stainSeed'];
  return out;
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
    const raw = version === 1 ? migrateV1Prop(rawProps[kind]) : rawProps[kind];
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
    relic: load('relic', relicFields, relicDefaults),
    document: load('document', documentFields, documentDefaults),
  };

  const extrasResult = sanitizeExtras(input['extras'], PROP_LABELS);
  warnings.push(...extrasResult.warnings);

  let active: PropKind = 'newspaper';
  if (isPropKind(input['active'])) active = input['active'];
  else if (input['active'] !== undefined) warnings.push('無法辨識存檔中目前的道具種類，已切換到報紙剪報。');

  const pack = sanitizePack(input['pack'], warnings);
  return { ok: true, state: { active, props, extras: extrasResult.extras, pack }, warnings };
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

/** 更新某個道具的欄位，回傳新的狀態（不修改原狀態）。 */
export function updateProp<K extends PropKind>(state: AppState, kind: K, patch: Partial<PropsState[K]>): AppState {
  return { ...state, props: { ...state.props, [kind]: { ...state.props[kind], ...patch } } };
}

/** 更新某個道具的結構化資料。 */
export function updateExtras<K extends PropKind>(state: AppState, kind: K, patch: Partial<ExtrasState[K]>): AppState {
  return { ...state, extras: { ...state.extras, [kind]: { ...state.extras[kind], ...patch } } };
}

const PACK_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

/**
 * 匯入線索包：逐件驗證。道具種類不認得、格式不符的那一件丟棄；
 * 每一件的表單欄位與結構化資料用和道具本身一樣的規則驗證（缺的欄位用預設值）。
 */
export function sanitizePack(raw: unknown, warnings: string[] = []): PackEntry[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    warnings.push('線索包格式不符，已略過。');
    return [];
  }
  const defaults = defaultState().props;
  const out: PackEntry[] = [];
  let dropped = Math.max(0, raw.length - PACK_LIMITS.entries);
  for (const item of raw.slice(0, PACK_LIMITS.entries)) {
    if (!isRecord(item) || !isPropKind(item['kind']) || typeof item['id'] !== 'string' || !PACK_ID_RE.test(item['id'])) {
      dropped++;
      continue;
    }
    const kind = item['kind'];
    const scene = typeof item['scene'] === 'string' ? Array.from(item['scene'].replace(/[\u0000-\u001F\u007F]/g, '')).slice(0, PACK_LIMITS.scene).join('') : '';
    const { data } = sanitizeRecord(PROP_FIELDS[kind], defaults[kind] as never, item['props']);
    const extras = sanitizeExtras({ [kind]: item['extras'] }, PROP_LABELS).extras[kind];
    out.push({ id: item['id'], kind, scene, props: data as unknown as PropsState[PropKind], extras });
  }
  if (dropped > 0) warnings.push(`線索包有 ${dropped} 件格式不符或超過上限，已略過。`);
  return out;
}

/** 打開帶線索包的網址、本機已有線索包時的選擇。預設（關掉對話框）是只預覽、不存。 */
export type SharedPackChoice = 'replace' | 'append' | 'preview';

/**
 * 依選擇算出要存的線索包（只預覽時回傳 null，表示本機的線索包不變）。
 * 附加時，編號和本機重複的那幾件換一個新編號；總數不超過上限。
 */
export function combinePack(local: readonly PackEntry[], incoming: readonly PackEntry[], choice: SharedPackChoice): PackEntry[] | null {
  if (choice === 'preview') return null;
  if (choice === 'replace') return incoming.slice(0, PACK_LIMITS.entries);
  const used = new Set(local.map((e) => e.id));
  const added = incoming.map((e, i) => {
    if (!used.has(e.id)) {
      used.add(e.id);
      return e;
    }
    let n = i;
    let id = `${e.id}-${n}`;
    while (used.has(id) || id.length > 40) id = `s${(n += 1)}`;
    used.add(id);
    return { ...e, id };
  });
  return [...local, ...added].slice(0, PACK_LIMITS.entries);
}
