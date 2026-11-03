// 極簡 tar 讀取器：只用 node:zlib（gunzip），不依賴任何套件。
//
// 只支援本專案需要的情況：POSIX ustar 與 GNU tar 的一般檔案（type '0' 或 '\0'）、目錄，
// 以及 GNU 長檔名（'L'）與 pax 延伸標頭（'x'、'g'）裡的 path。不支援稀疏檔、多卷壓縮檔。
// 每個標頭都會驗證檢查碼（checksum），檔案大小超出範圍就丟出錯誤。
//
// 格式依據：POSIX.1-2008 pax 格式（ustar 標頭）與 GNU tar 手冊的〈Basic Tar Format〉。

import { gunzipSync } from 'node:zlib';

const BLOCK = 512;

export interface TarEntry {
  /** 完整路徑（含目錄）。 */
  readonly name: string;
  /** '0' 一般檔案、'5' 目錄，其餘照標頭原樣。 */
  readonly type: string;
  readonly size: number;
  /** 修改時間（Unix 秒）。 */
  readonly mtime: number;
  readonly data: Buffer;
}

function readString(buf: Buffer, start: number, length: number): string {
  const field = buf.subarray(start, start + length);
  const end = field.indexOf(0);
  return field.toString('utf8', 0, end === -1 ? length : end);
}

/** 八進位數字欄位（前後可有空白或 NUL）；GNU 的 base-256 大數字格式也支援。 */
function readNumber(buf: Buffer, start: number, length: number): number {
  const first = buf[start] as number;
  if (first & 0x80) {
    // base-256：第一個位元組的最高位元是旗標，其餘是大端序的正整數
    let value = first & 0x7f;
    for (let i = 1; i < length; i++) value = value * 256 + (buf[start + i] as number);
    return value;
  }
  const text = readString(buf, start, length).trim();
  if (text === '') return 0;
  if (!/^[0-7]+$/.test(text)) throw new Error(`tar 標頭的數字欄位格式錯誤：「${text}」`);
  return Number.parseInt(text, 8);
}

function verifyChecksum(header: Buffer): void {
  const stored = readNumber(header, 148, 8);
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : (header[i] as number);
  if (sum !== stored) throw new Error(`tar 標頭檢查碼不符（預期 ${stored}，實際 ${sum}）`);
}

/** 解析 pax 延伸標頭（「長度 key=value\n」的序列）。 */
function parsePax(data: Buffer): Map<string, string> {
  const out = new Map<string, string>();
  let p = 0;
  while (p < data.length) {
    const space = data.indexOf(0x20, p);
    if (space === -1) break;
    const length = Number.parseInt(data.toString('utf8', p, space), 10);
    if (!Number.isInteger(length) || length <= 0 || p + length > data.length) throw new Error('pax 延伸標頭格式錯誤');
    const record = data.toString('utf8', space + 1, p + length - 1);
    const eq = record.indexOf('=');
    if (eq > 0) out.set(record.slice(0, eq), record.slice(eq + 1));
    p += length;
  }
  return out;
}

/** 讀取未壓縮的 tar 資料，回傳所有項目（不含 pax／GNU 長檔名這類輔助標頭）。 */
export function readTar(tar: Buffer): TarEntry[] {
  const entries: TarEntry[] = [];
  let p = 0;
  let longName: string | null = null;
  let paxPath: string | null = null;
  let globalPath: string | null = null;
  while (p + BLOCK <= tar.length) {
    const header = tar.subarray(p, p + BLOCK);
    if (header.every((b) => b === 0)) break; // 結尾的兩個全零區塊
    verifyChecksum(header);
    const size = readNumber(header, 124, 12);
    const typeByte = header[156] as number;
    const type = typeByte === 0 ? '0' : String.fromCharCode(typeByte);
    const dataStart = p + BLOCK;
    const dataEnd = dataStart + size;
    if (dataEnd > tar.length) throw new Error('tar 項目超出檔案範圍');
    const data = tar.subarray(dataStart, dataEnd);
    p = dataStart + Math.ceil(size / BLOCK) * BLOCK;

    if (type === 'L') {
      longName = readString(data, 0, data.length);
      continue;
    }
    if (type === 'x' || type === 'g') {
      const path = parsePax(data).get('path') ?? null;
      if (type === 'x') paxPath = path;
      else globalPath = path;
      continue;
    }
    const magic = header.toString('latin1', 257, 263);
    const prefix = magic.startsWith('ustar') ? readString(header, 345, 155) : '';
    const baseName = readString(header, 0, 100);
    const name = paxPath ?? longName ?? globalPath ?? (prefix ? `${prefix}/${baseName}` : baseName);
    longName = null;
    paxPath = null;
    entries.push({ name, type, size, mtime: readNumber(header, 136, 12), data: Buffer.from(data) });
  }
  return entries;
}

/** 讀取 .tar.gz，回傳所有項目。 */
export function readTarGz(tgz: Buffer): TarEntry[] {
  return readTar(gunzipSync(tgz));
}

/** 依路徑取出單一一般檔案；找不到時丟出錯誤。 */
export function extractTarFile(entries: readonly TarEntry[], name: string): Buffer {
  const entry = entries.find((e) => e.name === name && (e.type === '0' || e.type === '7'));
  if (!entry) throw new Error(`tar 裡找不到 ${name}`);
  return entry.data;
}
