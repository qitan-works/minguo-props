// 線索包（第五版，純邏輯）：編號（線索一、二……）、每件的摘要、用網址分享。
//
// 分享：把線索包轉成 JSON，只留和預設值不同的欄位，用瀏覽器內建的 CompressionStream（deflate-raw）壓縮，
// 再轉成網址安全的 base64，放在網址的 # 後面。# 後面的資料不會送到伺服器；太長時提示改用匯出 JSON。

import { toChineseNumber } from './numerals.ts';

export const SHARE_PREFIX = '#pack=';
/** 超過這個長度，很多聊天軟體與瀏覽器的網址列會截斷，請改用匯出 JSON。 */
export const MAX_SHARE_CHARS = 8000;

export function clueLabel(index: number): string {
  return `線索${toChineseNumber(index + 1)}`;
}

/** 只留和預設值不同的欄位（網址短一點；匯入時缺的欄位用預設值）。 */
export function compactAgainst(value: Readonly<Record<string, unknown>>, defaults: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (JSON.stringify(v) !== JSON.stringify(defaults[k])) out[k] = v;
  }
  return out;
}

/** 一件道具的摘要（主持人對照表用）：依序取第一個有內容的欄位，最多 18 字。 */
export function summaryOf(props: Readonly<Record<string, unknown>>): string {
  for (const key of ['headline', 'docOrg', 'bookTitle', 'stoneTitle', 'name', 'salutation', 'body', 'masthead']) {
    const v = props[key];
    if (typeof v === 'string' && v.trim()) {
      const chars = Array.from(v.replace(/\s+/g, ' ').trim());
      return chars.length > 18 ? `${chars.slice(0, 18).join('')}…` : chars.join('');
    }
  }
  return '';
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = await new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream)).arrayBuffer();
  return new Uint8Array(out);
}

/** 任何可轉成 JSON 的資料 → 壓縮後的網址安全字串。 */
export async function encodeShare(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return toBase64Url(await pipe(bytes, new CompressionStream('deflate-raw')));
}

/** encodeShare 的反向；格式不符時丟出錯誤。 */
export async function decodeShare(text: string): Promise<unknown> {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) throw new Error('網址裡的線索包格式不符');
  const bytes = await pipe(fromBase64Url(text), new DecompressionStream('deflate-raw'));
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}
