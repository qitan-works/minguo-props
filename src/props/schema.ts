// 道具表單的欄位定義與資料清理。純邏輯，不碰 DOM，可在 Node 測試。

import { isValidSeed } from '../lib/random.ts';

export interface Option {
  readonly value: string;
  readonly label: string;
}

interface FieldBase<K extends string> {
  readonly key: K;
  readonly label: string;
  readonly hint?: string;
  /** 表單分組標題；同一組的欄位會放在同一個 <fieldset>。 */
  readonly group?: string;
  /** 只在另一個欄位等於指定值（之一）時顯示。 */
  readonly showIf?: { readonly key: string; readonly in: readonly (string | boolean | number)[] };
}

export interface TextField<K extends string = string> extends FieldBase<K> {
  readonly type: 'text' | 'textarea';
  readonly maxLength: number;
  readonly rows?: number;
  readonly placeholder?: string;
}

export interface SelectField<K extends string = string> extends FieldBase<K> {
  readonly type: 'select';
  readonly options: readonly Option[];
}

export interface CheckboxField<K extends string = string> extends FieldBase<K> {
  readonly type: 'checkbox';
}

export interface DateField<K extends string = string> extends FieldBase<K> {
  readonly type: 'date';
  /** 可選範圍（YYYY-MM-DD）。 */
  readonly min: string;
  readonly max: string;
}

export interface ImageField<K extends string = string> extends FieldBase<K> {
  readonly type: 'image';
}

/** 數值滑桿。 */
export interface RangeField<K extends string = string> extends FieldBase<K> {
  readonly type: 'range';
  readonly min: number;
  readonly max: number;
  readonly step: number;
  /** 顯示在數值後面的單位，例如「mm」「%」。 */
  readonly unit?: string;
}

/** 亂數種子：顯示成一個「換一個」按鈕（按鈕文字可自訂）。 */
export interface SeedField<K extends string = string> extends FieldBase<K> {
  readonly type: 'seed';
  readonly button: string;
}

export type Field<K extends string = string> =
  | TextField<K>
  | SelectField<K>
  | CheckboxField<K>
  | DateField<K>
  | ImageField<K>
  | RangeField<K>
  | SeedField<K>;

/** 由欄位清單推導資料型別：checkbox 為 boolean，range 與 seed 為 number，其餘為 string。 */
export type DataOf<F extends readonly Field[]> = {
  readonly [P in F[number] as P['key']]: P extends CheckboxField
    ? boolean
    : P extends RangeField | SeedField
      ? number
      : string;
};

export type FieldValue = string | boolean | number;

/** 圖片只接受常見點陣格式的 base64 data URL，避免載入任意網址。 */
const IMAGE_DATA_URL_RE = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;
/** 照片 data URL 的上限（約 6 MB 的字串）。 */
export const MAX_IMAGE_DATA_URL_LENGTH = 6 * 1024 * 1024;

export function isSafeImageDataUrl(value: string): boolean {
  return value.length <= MAX_IMAGE_DATA_URL_LENGTH && IMAGE_DATA_URL_RE.test(value);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 單一欄位的清理：型別不符或不合法時回傳 undefined（呼叫端改用預設值）。 */
export function sanitizeValue(field: Field, value: unknown): FieldValue | undefined {
  switch (field.type) {
    case 'checkbox':
      return typeof value === 'boolean' ? value : undefined;
    case 'text':
    case 'textarea':
      if (typeof value !== 'string') return undefined;
      // 移除控制字元（保留換行與 tab），並截到上限長度。
      return Array.from(value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ''))
        .slice(0, field.maxLength)
        .join('');
    case 'select':
      return typeof value === 'string' && field.options.some((o) => o.value === value) ? value : undefined;
    case 'date':
      return typeof value === 'string' && DATE_RE.test(value) && value >= field.min && value <= field.max
        ? value
        : undefined;
    case 'image':
      if (value === '') return '';
      return typeof value === 'string' && isSafeImageDataUrl(value) ? value : undefined;
    case 'range':
      return typeof value === 'number' && Number.isFinite(value) && value >= field.min && value <= field.max ? value : undefined;
    case 'seed':
      return isValidSeed(value) ? value : undefined;
  }
}

/**
 * 依欄位清單清理任意輸入：只保留已知欄位，型別錯誤或缺漏的欄位用預設值補上。
 * 回傳清理後的資料，以及被改用預設值的欄位名稱（給匯入時提示用）。
 */
export function sanitizeRecord<F extends readonly Field[]>(
  fields: F,
  defaults: DataOf<F>,
  input: unknown,
): { data: DataOf<F>; replaced: string[] } {
  const source = typeof input === 'object' && input !== null && !Array.isArray(input) ? input : {};
  const out: Record<string, FieldValue> = {};
  const replaced: string[] = [];
  const defaultRecord = defaults as Readonly<Record<string, FieldValue>>;
  for (const field of fields) {
    const has = Object.prototype.hasOwnProperty.call(source, field.key);
    const raw: unknown = has ? (source as Record<string, unknown>)[field.key] : undefined;
    const clean = has ? sanitizeValue(field, raw) : undefined;
    const fallback = defaultRecord[field.key];
    if (clean === undefined) {
      if (has) replaced.push(field.key);
      if (fallback !== undefined) out[field.key] = fallback;
    } else {
      out[field.key] = clean;
    }
  }
  return { data: out as DataOf<F>, replaced };
}
