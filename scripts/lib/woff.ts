// WOFF 1.0 編碼與解碼：只用 node:zlib，不依賴任何套件。
//
// 用途：辰宇落雁體要「原封不動」地提供（見 THIRD_PARTY_NOTICES.md），所以不切子集、不改名，
// 只把原字型包成 WOFF 1.0。依 OFL-FAQ 1.1-update7 第 2.2.1 題，只要原字型資料除了 WOFF 壓縮之外
// 完全不變，而且不加 WOFF 專屬的中繼資料，就不算修改版（Modified Version）。因此：
// - 每個表的位元組原樣保留，只用 zlib 壓縮（壓縮後沒有變小就不壓縮，照規格存原始位元組）；
// - 不寫中繼資料區塊（metadata）與私有資料區塊（private data）；
// - 表的資料依原字型檔裡的順序存放，表目錄依標籤排序，origChecksum 照抄原字型表目錄的值；
// - majorVersion／minorVersion 照抄 head 表的 fontRevision（16.16 定點數的高低 16 位元）。
// 編碼前會檢查原字型是「格式良好」的（檢查碼正確、表之間沒有多餘資料、補齊 4 位元組），
// 這樣解碼回來的 SFNT 與原字型檔逐位元組相同，測試可以直接比對原字型的 SHA-256。
//
// 格式依據：W3C WOFF File Format 1.0（2012-12-13 建議書；w3c/woff 儲存庫 woff1/spec/Overview.html）。

import { deflateSync, inflateSync } from 'node:zlib';

import { readSfnt, sfntSearchFields, tableChecksum, writeSfntHeader } from './sfnt.ts';

const WOFF_SIGNATURE = 0x774f4646; // 'wOFF'
const HEADER_SIZE = 44;
const DIR_ENTRY_SIZE = 20;

const pad4 = (n: number): number => (n + 3) & ~3;

/** 整個字型檔的檢查碼調整值（head.checkSumAdjustment 應有的值）。 */
function checkSumAdjustment(font: Buffer, headOffset: number): number {
  const copy = Buffer.from(font);
  copy.writeUInt32BE(0, headOffset + 8);
  return (0xb1b0afba - tableChecksum(copy)) >>> 0;
}

/**
 * 檢查 SFNT 是否格式良好，可以無損地包成 WOFF 再還原；不符就丟出錯誤（說明哪裡不符）。
 * 依 WOFF 1.0 第 5 節：檢查碼正確、沒有表以外的資料、每個表補齊 4 位元組、檔頭欄位正確、表不重疊。
 */
export function assertWellFormedSfnt(font: Buffer): void {
  const sfnt = readSfnt(font);
  const n = sfnt.tables.length;
  const expected = sfntSearchFields(n);
  if (font.readUInt16BE(6) !== expected.searchRange || font.readUInt16BE(8) !== expected.entrySelector || font.readUInt16BE(10) !== expected.rangeShift) {
    throw new Error('SFNT 檔頭的 searchRange／entrySelector／rangeShift 不正確');
  }
  for (let i = 1; i < n; i++) {
    if ((sfnt.tables[i - 1] as { tag: string }).tag >= (sfnt.tables[i] as { tag: string }).tag) throw new Error('SFNT 表目錄沒有依標籤排序');
  }
  let p = 12 + 16 * n;
  for (const t of [...sfnt.tables].sort((a, b) => a.offset - b.offset)) {
    if (t.offset !== p) throw new Error(`${t.tag} 表的位置不連續（預期 ${p}，實際 ${t.offset}）`);
    const end = t.offset + t.length;
    const padded = pad4(end);
    if (padded > font.length) throw new Error(`${t.tag} 表沒有補齊 4 位元組`);
    for (let i = end; i < padded; i++) if (font[i] !== 0) throw new Error(`${t.tag} 表後面的補齊位元組不是 0`);
    p = padded;
    let sum: number;
    if (t.tag === 'head') {
      const zeroed = Buffer.from(t.data);
      zeroed.writeUInt32BE(0, 8);
      sum = tableChecksum(zeroed);
      if (t.data.readUInt32BE(8) !== checkSumAdjustment(font, t.offset)) throw new Error('head 表的 checkSumAdjustment 不正確');
    } else {
      sum = tableChecksum(t.data);
    }
    if (sum !== t.checksum) throw new Error(`${t.tag} 表的檢查碼不正確`);
  }
  if (p !== font.length) throw new Error('SFNT 最後一個表之後還有多餘的資料');
}

/** 把格式良好的 SFNT 包成 WOFF 1.0（不含中繼資料與私有資料）。 */
export function encodeWoff(font: Buffer): Buffer {
  assertWellFormedSfnt(font);
  const sfnt = readSfnt(font);
  const n = sfnt.tables.length;
  const head = sfnt.tables.find((t) => t.tag === 'head');
  if (!head) throw new Error('字型沒有 head 表');
  const dataOrder = [...sfnt.tables].sort((a, b) => a.offset - b.offset);
  const stored = new Map<string, { offset: number; data: Buffer }>();
  let p = HEADER_SIZE + DIR_ENTRY_SIZE * n;
  const chunks: Buffer[] = [];
  for (const t of dataOrder) {
    const compressed = deflateSync(t.data, { level: 9 });
    const data = compressed.length < t.length ? compressed : t.data;
    stored.set(t.tag, { offset: p, data });
    chunks.push(data, Buffer.alloc(pad4(data.length) - data.length));
    p += pad4(data.length);
  }
  // 每個表（含最後一個）都補齊到 4 位元組，與 W3C 測試集的 valid-005.woff 相同
  const length = p;

  const header = Buffer.alloc(HEADER_SIZE + DIR_ENTRY_SIZE * n);
  header.writeUInt32BE(WOFF_SIGNATURE, 0);
  header.writeUInt32BE(sfnt.flavor, 4);
  header.writeUInt32BE(length, 8);
  header.writeUInt16BE(n, 12);
  header.writeUInt16BE(0, 14);
  header.writeUInt32BE(12 + 16 * n + sfnt.tables.reduce((s, t) => s + pad4(t.length), 0), 16);
  header.writeUInt16BE(head.data.readUInt16BE(4), 20); // fontRevision 的整數部分
  header.writeUInt16BE(head.data.readUInt16BE(6), 22); // fontRevision 的小數部分
  // metaOffset、metaLength、metaOrigLength、privOffset、privLength 都是 0（24～43）
  sfnt.tables.forEach((t, i) => {
    const r = HEADER_SIZE + i * DIR_ENTRY_SIZE;
    const s = stored.get(t.tag) as { offset: number; data: Buffer };
    header.write(t.tag, r, 4, 'latin1');
    header.writeUInt32BE(s.offset, r + 4);
    header.writeUInt32BE(s.data.length, r + 8);
    header.writeUInt32BE(t.length, r + 12);
    header.writeUInt32BE(t.checksum, r + 16);
  });
  const out = Buffer.concat([header, ...chunks]);
  if (out.length !== length) throw new Error('WOFF 長度計算錯誤');
  return out;
}

export interface WoffTable {
  readonly tag: string;
  readonly origChecksum: number;
  /** 解壓後的表資料。 */
  readonly data: Buffer;
  /** 是否有壓縮（compLength < origLength）。 */
  readonly compressed: boolean;
}

export interface DecodedWoff {
  readonly flavor: number;
  readonly majorVersion: number;
  readonly minorVersion: number;
  readonly metaLength: number;
  readonly privLength: number;
  /** 依表目錄的順序（標籤排序）。 */
  readonly tables: readonly WoffTable[];
  /** 依原字型的表順序還原的 SFNT。 */
  readonly sfnt: Buffer;
}

/** 解碼 WOFF 1.0，並依規格檢查結構（不合規格就丟出錯誤）。 */
export function decodeWoff(woff: Buffer): DecodedWoff {
  if (woff.readUInt32BE(0) !== WOFF_SIGNATURE) throw new Error('不是 WOFF 1.0 檔');
  if (woff.readUInt32BE(8) !== woff.length) throw new Error('WOFF 檔頭的 length 與檔案大小不符');
  const n = woff.readUInt16BE(12);
  if (woff.readUInt16BE(14) !== 0) throw new Error('WOFF 檔頭的保留欄位不是 0');
  const totalSfntSize = woff.readUInt32BE(16);
  const metaOffset = woff.readUInt32BE(24);
  const metaLength = woff.readUInt32BE(28);
  const privOffset = woff.readUInt32BE(36);
  const privLength = woff.readUInt32BE(40);
  if ((metaLength === 0) !== (metaOffset === 0) || (privLength === 0) !== (privOffset === 0)) throw new Error('WOFF 中繼資料／私有資料欄位不一致');

  const entries: { tag: string; offset: number; compLength: number; origLength: number; origChecksum: number }[] = [];
  for (let i = 0; i < n; i++) {
    const r = HEADER_SIZE + i * DIR_ENTRY_SIZE;
    entries.push({
      tag: woff.toString('latin1', r, r + 4),
      offset: woff.readUInt32BE(r + 4),
      compLength: woff.readUInt32BE(r + 8),
      origLength: woff.readUInt32BE(r + 12),
      origChecksum: woff.readUInt32BE(r + 16),
    });
  }
  for (let i = 1; i < n; i++) {
    if ((entries[i - 1] as { tag: string }).tag >= (entries[i] as { tag: string }).tag) throw new Error('WOFF 表目錄沒有依標籤排序');
  }
  // 表資料必須緊接在表目錄之後、依序排列、彼此不重疊，只有 0～3 個補齊位元組
  let p = HEADER_SIZE + DIR_ENTRY_SIZE * n;
  const byOffset = [...entries].sort((a, b) => a.offset - b.offset);
  for (const e of byOffset) {
    if (e.offset !== p) throw new Error(`WOFF 的 ${e.tag} 表位置不正確（預期 ${p}，實際 ${e.offset}）`);
    if (e.compLength > e.origLength) throw new Error(`WOFF 的 ${e.tag} 表壓縮後比原本大`);
    p = e.offset + e.compLength;
    const padded = pad4(p);
    if (padded <= woff.length) {
      for (let i = p; i < padded; i++) if (woff[i] !== 0) throw new Error(`WOFF 的 ${e.tag} 表補齊位元組不是 0`);
      p = padded;
    }
  }
  const expectedEnd = metaLength > 0 ? metaOffset : privLength > 0 ? privOffset : woff.length;
  if (pad4(p) < expectedEnd || p > expectedEnd) throw new Error('WOFF 表資料之後有多餘資料');
  const computedTotal = 12 + 16 * n + entries.reduce((s, e) => s + pad4(e.origLength), 0);
  if (totalSfntSize !== computedTotal || totalSfntSize % 4 !== 0) throw new Error('WOFF 檔頭的 totalSfntSize 不正確');

  const tables = new Map<string, WoffTable>();
  for (const e of entries) {
    const raw = woff.subarray(e.offset, e.offset + e.compLength);
    const compressed = e.compLength < e.origLength;
    const data = compressed ? inflateSync(raw) : Buffer.from(raw);
    if (data.length !== e.origLength) throw new Error(`WOFF 的 ${e.tag} 表解壓後長度不符`);
    tables.set(e.tag, { tag: e.tag, origChecksum: e.origChecksum, data, compressed });
  }

  // 依 WOFF 裡的表順序（＝原字型的順序）還原 SFNT
  const flavor = woff.readUInt32BE(4);
  const sfnt = Buffer.alloc(totalSfntSize);
  writeSfntHeader(sfnt, flavor, n);
  const offsets = new Map<string, number>();
  let q = 12 + 16 * n;
  for (const e of byOffset) {
    const t = tables.get(e.tag) as WoffTable;
    t.data.copy(sfnt, q);
    offsets.set(e.tag, q);
    q += pad4(t.data.length);
  }
  entries.forEach((e, i) => {
    const r = 12 + i * 16;
    sfnt.write(e.tag, r, 4, 'latin1');
    sfnt.writeUInt32BE(e.origChecksum, r + 4);
    sfnt.writeUInt32BE(offsets.get(e.tag) as number, r + 8);
    sfnt.writeUInt32BE(e.origLength, r + 12);
  });

  return {
    flavor,
    majorVersion: woff.readUInt16BE(20),
    minorVersion: woff.readUInt16BE(22),
    metaLength,
    privLength,
    tables: entries.map((e) => tables.get(e.tag) as WoffTable),
    sfnt,
  };
}
