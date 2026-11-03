// 極簡 ZIP 讀取器：只用 node:zlib，不依賴任何套件。
//
// 只支援本專案需要的情況：讀取中央目錄（central directory），
// 取出「不壓縮（method 0）」或「deflate（method 8）」的單一檔案，
// 並以 CRC-32 與解壓後大小驗證內容。不支援 ZIP64、加密與分割壓縮檔。
//
// 格式依據：PKWARE APPNOTE.TXT（.ZIP File Format Specification）。

import { crc32, inflateRawSync } from 'node:zlib';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

export interface ZipEntry {
  readonly name: string;
  readonly method: number;
  readonly crc32: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
  readonly flags: number;
}

function findEndOfCentralDirectory(buf: Buffer): number {
  // EOCD 至少 22 位元組，之後可能接最長 65535 位元組的註解。
  const minStart = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= minStart; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) return i;
  }
  throw new Error('不是有效的 ZIP 檔：找不到中央目錄結尾（EOCD）');
}

export function listZipEntries(buf: Buffer): ZipEntry[] {
  const eocd = findEndOfCentralDirectory(buf);
  const entryCount = buf.readUInt16LE(eocd + 10);
  const centralSize = buf.readUInt32LE(eocd + 12);
  const centralOffset = buf.readUInt32LE(eocd + 16);
  if (entryCount === 0xffff || centralOffset === 0xffffffff) {
    throw new Error('不支援 ZIP64 格式');
  }
  if (centralOffset + centralSize > buf.length) {
    throw new Error('ZIP 中央目錄超出檔案範圍');
  }
  const entries: ZipEntry[] = [];
  let p = centralOffset;
  for (let i = 0; i < entryCount; i++) {
    if (buf.readUInt32LE(p) !== CENTRAL_SIGNATURE) {
      throw new Error(`ZIP 中央目錄第 ${i} 筆的簽章錯誤`);
    }
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const compressedSize = buf.readUInt32LE(p + 20);
    const uncompressedSize = buf.readUInt32LE(p + 24);
    const nameLength = buf.readUInt16LE(p + 28);
    const extraLength = buf.readUInt16LE(p + 30);
    const commentLength = buf.readUInt16LE(p + 32);
    const localHeaderOffset = buf.readUInt32LE(p + 42);
    // 第 11 位元（0x800）表示檔名是 UTF-8；否則是 CP437。本專案只處理 ASCII 檔名。
    const name = buf.toString('utf8', p + 46, p + 46 + nameLength);
    entries.push({ name, method, crc32: crc, compressedSize, uncompressedSize, localHeaderOffset, flags });
    p += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

export function readZipEntry(buf: Buffer, entry: ZipEntry): Buffer {
  if (entry.flags & 0x1) throw new Error(`不支援加密的 ZIP 項目：${entry.name}`);
  const p = entry.localHeaderOffset;
  if (buf.readUInt32LE(p) !== LOCAL_SIGNATURE) {
    throw new Error(`ZIP 本地檔頭簽章錯誤：${entry.name}`);
  }
  const nameLength = buf.readUInt16LE(p + 26);
  const extraLength = buf.readUInt16LE(p + 28);
  const dataStart = p + 30 + nameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > buf.length) throw new Error(`ZIP 項目超出檔案範圍：${entry.name}`);
  const raw = buf.subarray(dataStart, dataEnd);

  let out: Buffer;
  if (entry.method === 0) {
    out = Buffer.from(raw);
  } else if (entry.method === 8) {
    out = inflateRawSync(raw);
  } else {
    throw new Error(`不支援的壓縮方式 ${entry.method}：${entry.name}`);
  }
  if (out.length !== entry.uncompressedSize) {
    throw new Error(`解壓後大小不符：${entry.name}（預期 ${entry.uncompressedSize}，實際 ${out.length}）`);
  }
  const actualCrc = crc32(out) >>> 0;
  if (actualCrc !== entry.crc32 >>> 0) {
    throw new Error(`CRC-32 不符：${entry.name}`);
  }
  return out;
}

/** 依檔名（可含目錄）取出單一檔案；找不到時丟出錯誤。 */
export function extractZipFile(buf: Buffer, fileName: string): Buffer {
  const entries = listZipEntries(buf);
  const entry = entries.find((e) => e.name === fileName || e.name.endsWith(`/${fileName}`));
  if (!entry) {
    throw new Error(`ZIP 裡找不到 ${fileName}（共有：${entries.map((e) => e.name).join('、')}）`);
  }
  return readZipEntry(buf, entry);
}
