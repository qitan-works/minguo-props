// 讀取 SFNT（TrueType／OpenType）字型檔的表目錄與 name 表，並計算表的檢查碼。
// 只用 Node 內建功能，不依賴任何套件。
//
// 格式依據：OpenType 規格〈The OpenType Font File〉與〈name — Naming Table〉。

export interface SfntTable {
  readonly tag: string;
  readonly checksum: number;
  readonly offset: number;
  readonly length: number;
  readonly data: Buffer;
}

export interface Sfnt {
  /** 0x00010000（TrueType）或 'OTTO'（CFF）。 */
  readonly flavor: number;
  /** 依表目錄的順序（規格要求依標籤排序）。 */
  readonly tables: readonly SfntTable[];
}

/** 解析 SFNT 的表目錄；不支援字型集合（TTC）。 */
export function readSfnt(font: Buffer): Sfnt {
  const flavor = font.readUInt32BE(0);
  if (flavor === 0x74746366) throw new Error('不支援字型集合（TTC）');
  if (flavor !== 0x00010000 && flavor !== 0x4f54544f && flavor !== 0x74727565) {
    throw new Error(`不是 SFNT 字型檔（開頭 0x${flavor.toString(16)}）`);
  }
  const numTables = font.readUInt16BE(4);
  const tables: SfntTable[] = [];
  for (let i = 0; i < numTables; i++) {
    const r = 12 + i * 16;
    const tag = font.toString('latin1', r, r + 4);
    const checksum = font.readUInt32BE(r + 4);
    const offset = font.readUInt32BE(r + 8);
    const length = font.readUInt32BE(r + 12);
    if (offset + length > font.length) throw new Error(`${tag} 表超出檔案範圍`);
    tables.push({ tag, checksum, offset, length, data: font.subarray(offset, offset + length) });
  }
  return { flavor, tables };
}

export function sfntTable(font: Sfnt, tag: string): Buffer | null {
  return font.tables.find((t) => t.tag === tag)?.data ?? null;
}

/** SFNT 檔頭的二分搜尋欄位（OpenType 規格的定義，只由表的數目決定）。 */
export function sfntSearchFields(numTables: number): { searchRange: number; entrySelector: number; rangeShift: number } {
  let entrySelector = 0;
  while (2 ** (entrySelector + 1) <= numTables) entrySelector++;
  const searchRange = 2 ** entrySelector * 16;
  return { searchRange, entrySelector, rangeShift: numTables * 16 - searchRange };
}

/** 寫入 12 位元組的 SFNT 檔頭（flavor、表的數目與二分搜尋欄位）。 */
export function writeSfntHeader(out: Buffer, flavor: number, numTables: number): void {
  const f = sfntSearchFields(numTables);
  out.writeUInt32BE(flavor, 0);
  out.writeUInt16BE(numTables, 4);
  out.writeUInt16BE(f.searchRange, 6);
  out.writeUInt16BE(f.entrySelector, 8);
  out.writeUInt16BE(f.rangeShift, 10);
}

/** OpenType 表檢查碼：以 4 位元組大端序整數加總（不足 4 位元組補零），取 32 位元。 */
export function tableChecksum(data: Buffer): number {
  let sum = 0;
  const whole = data.length & ~3;
  for (let i = 0; i < whole; i += 4) sum = (sum + data.readUInt32BE(i)) >>> 0;
  if (whole < data.length) {
    const tail = Buffer.alloc(4);
    data.copy(tail, 0, whole);
    sum = (sum + tail.readUInt32BE(0)) >>> 0;
  }
  return sum;
}

export interface NameRecord {
  readonly platformID: number;
  readonly encodingID: number;
  readonly languageID: number;
  readonly nameID: number;
  /** 解碼後的字串；無法解碼的編碼為 null。 */
  readonly value: string | null;
  /** 原始位元組。 */
  readonly raw: Buffer;
}

function decodeName(platformID: number, encodingID: number, raw: Buffer): string | null {
  if (platformID === 0 || (platformID === 3 && (encodingID === 0 || encodingID === 1 || encodingID === 10))) {
    return new TextDecoder('utf-16be').decode(raw);
  }
  if (platformID === 1 && encodingID === 0) return raw.toString('latin1');
  return null;
}

/** 解析 name 表的所有紀錄（format 0 與 1；format 1 的語言標籤不解析）。 */
export function parseName(name: Buffer): NameRecord[] {
  const count = name.readUInt16BE(2);
  const storage = name.readUInt16BE(4);
  const out: NameRecord[] = [];
  for (let i = 0; i < count; i++) {
    const r = 6 + i * 12;
    const platformID = name.readUInt16BE(r);
    const encodingID = name.readUInt16BE(r + 2);
    const languageID = name.readUInt16BE(r + 4);
    const nameID = name.readUInt16BE(r + 6);
    const length = name.readUInt16BE(r + 8);
    const offset = name.readUInt16BE(r + 10);
    const raw = name.subarray(storage + offset, storage + offset + length);
    out.push({ platformID, encodingID, languageID, nameID, value: decodeName(platformID, encodingID, raw), raw: Buffer.from(raw) });
  }
  return out;
}

/** 取某個 nameID 的字串：優先 Windows 英文（0x409），其次任何可解碼的紀錄。 */
export function nameString(records: readonly NameRecord[], nameID: number, languageID = 0x409): string | null {
  const pick =
    records.find((r) => r.nameID === nameID && r.platformID === 3 && r.languageID === languageID && r.value !== null) ??
    records.find((r) => r.nameID === nameID && r.platformID === 3 && r.value !== null) ??
    records.find((r) => r.nameID === nameID && r.value !== null);
  return pick?.value ?? null;
}

/** 一筆 Windows Unicode 平台（platformID 3、encodingID 1，UTF-16BE）的 name 紀錄。 */
export function windowsNameRecord(languageID: number, nameID: number, value: string): NameRecord {
  const raw = Buffer.from(value, 'utf16le');
  raw.swap16();
  return { platformID: 3, encodingID: 1, languageID, nameID, value, raw };
}

/** 依紀錄組出 name 表（format 0；紀錄依平台、編碼、語言、nameID 排序，字串位元組原樣寫入）。 */
export function buildName(input: readonly NameRecord[]): Buffer {
  const records = [...input].sort(
    (x, y) => x.platformID - y.platformID || x.encodingID - y.encodingID || x.languageID - y.languageID || x.nameID - y.nameID,
  );
  const storageOffset = 6 + records.length * 12;
  const header = Buffer.alloc(storageOffset);
  header.writeUInt16BE(records.length, 2);
  header.writeUInt16BE(storageOffset, 4);
  let offset = 0;
  records.forEach((r, i) => {
    const p = 6 + i * 12;
    header.writeUInt16BE(r.platformID, p);
    header.writeUInt16BE(r.encodingID, p + 2);
    header.writeUInt16BE(r.languageID, p + 4);
    header.writeUInt16BE(r.nameID, p + 6);
    header.writeUInt16BE(r.raw.length, p + 8);
    header.writeUInt16BE(offset, p + 10);
    offset += r.raw.length;
  });
  if (offset > 0xffff) throw new Error('name 表的字串超過 64 KB');
  return Buffer.concat([header, ...records.map((r) => r.raw)]);
}

/**
 * 組出 SFNT 字型檔：表目錄依標籤排序、表資料依同樣順序存放並補齊 4 位元組，
 * 重新計算每個表的檢查碼與 head 表的 checkSumAdjustment。
 */
export function buildSfnt(flavor: number, tables: readonly { tag: string; data: Buffer }[]): Buffer {
  const sorted = [...tables].sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  const n = sorted.length;
  const header = Buffer.alloc(12 + 16 * n);
  writeSfntHeader(header, flavor, n);
  const chunks: Buffer[] = [header];
  let offset = header.length;
  let headOffset = -1;
  sorted.forEach((t, i) => {
    const data = Buffer.from(t.data);
    if (t.tag === 'head') {
      data.writeUInt32BE(0, 8);
      headOffset = offset;
    }
    const r = 12 + i * 16;
    header.write(t.tag, r, 4, 'latin1');
    header.writeUInt32BE(tableChecksum(data), r + 4);
    header.writeUInt32BE(offset, r + 8);
    header.writeUInt32BE(data.length, r + 12);
    const padded = (data.length + 3) & ~3;
    chunks.push(data, Buffer.alloc(padded - data.length));
    offset += padded;
  });
  const font = Buffer.concat(chunks);
  if (headOffset >= 0) font.writeUInt32BE((0xb1b0afba - tableChecksum(font)) >>> 0, headOffset + 8);
  return font;
}

/** 每個字形在 glyf 表裡的位元組數（依 loca 表；只適用 TrueType 外框）。 */
export function glyphByteLengths(font: Sfnt): number[] {
  const head = sfntTable(font, 'head');
  const loca = sfntTable(font, 'loca');
  const maxp = sfntTable(font, 'maxp');
  if (!head || !loca || !maxp) throw new Error('字型沒有 head／loca／maxp 表（不是 TrueType 外框？）');
  const numGlyphs = maxp.readUInt16BE(4);
  const long = head.readInt16BE(50) === 1;
  const at = (i: number): number => (long ? loca.readUInt32BE(i * 4) : loca.readUInt16BE(i * 2) * 2);
  const out: number[] = [];
  for (let g = 0; g < numGlyphs; g++) out.push(at(g + 1) - at(g));
  return out;
}
