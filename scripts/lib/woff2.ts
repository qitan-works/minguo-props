// 讀取 WOFF2 字型檔的 cmap（字元對應表），用來檢查字型實際涵蓋哪些字。
// 只用 node:zlib 的 brotli 解壓，不依賴任何套件，也不用 Python 工具。
//
// 格式依據：W3C WOFF File Format 2.0 與 OpenType 規格的 cmap 表（format 4、12）。

import { brotliDecompressSync } from 'node:zlib';

const KNOWN_TAGS = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT',
  'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH',
  'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar',
  'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill',
];

function readBase128(buf: Buffer, offset: number): { value: number; next: number } {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    const byte = buf[offset + i];
    if (byte === undefined) throw new Error('WOFF2 資料截斷');
    if (i === 0 && byte === 0x80) throw new Error('WOFF2 UIntBase128 格式錯誤');
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) return { value, next: offset + i + 1 };
  }
  throw new Error('WOFF2 UIntBase128 過長');
}

/** 取出 WOFF2 裡指定的表（未經轉換的表）。 */
export function woff2Table(file: Buffer, wanted: string): Buffer | null {
  if (file.readUInt32BE(0) !== 0x774f4632) throw new Error('不是 WOFF2 檔');
  const flavor = file.readUInt32BE(4);
  if (flavor === 0x74746366) throw new Error('不支援 WOFF2 字型集合');
  const numTables = file.readUInt16BE(12);
  const compressedSize = file.readUInt32BE(20);
  let p = 48;
  const tables: { tag: string; length: number }[] = [];
  for (let i = 0; i < numTables; i++) {
    const flags = file[p] as number;
    p++;
    let tag: string;
    if ((flags & 0x3f) === 63) {
      tag = file.toString('latin1', p, p + 4);
      p += 4;
    } else {
      tag = KNOWN_TAGS[flags & 0x3f] ?? '????';
    }
    const version = (flags >> 6) & 3;
    const orig = readBase128(file, p);
    p = orig.next;
    let length = orig.value;
    const transformed = tag === 'glyf' || tag === 'loca' ? version === 0 : version !== 0;
    if (transformed) {
      const t = readBase128(file, p);
      p = t.next;
      length = t.value;
    }
    tables.push({ tag, length });
  }
  const data = brotliDecompressSync(file.subarray(p, p + compressedSize));
  let offset = 0;
  for (const t of tables) {
    if (t.tag === wanted) return data.subarray(offset, offset + t.length);
    offset += t.length;
  }
  return null;
}

/** 解析 cmap 表，回傳有字形的碼位集合（優先使用 format 12，其次 format 4）。 */
export function parseCmap(cmap: Buffer): Set<number> {
  return new Set(parseCmapGlyphs(cmap).keys());
}

/** 解析 cmap 表，回傳「碼位 → 字形編號」（只含有字形的碼位；優先使用 format 12，其次 format 4）。 */
export function parseCmapGlyphs(cmap: Buffer): Map<number, number> {
  const numTables = cmap.readUInt16BE(2);
  const subtables: { platform: number; encoding: number; offset: number; format: number }[] = [];
  for (let i = 0; i < numTables; i++) {
    const r = 4 + i * 8;
    const offset = cmap.readUInt32BE(r + 4);
    subtables.push({ platform: cmap.readUInt16BE(r), encoding: cmap.readUInt16BE(r + 2), offset, format: cmap.readUInt16BE(offset) });
  }
  const pickTable =
    subtables.find((t) => t.format === 12) ??
    subtables.find((t) => t.format === 4 && t.platform === 3) ??
    subtables.find((t) => t.format === 4);
  const out = new Map<number, number>();
  if (!pickTable) return out;
  const o = pickTable.offset;
  if (pickTable.format === 12) {
    const groups = cmap.readUInt32BE(o + 12);
    for (let g = 0; g < groups; g++) {
      const q = o + 16 + g * 12;
      const start = cmap.readUInt32BE(q);
      const end = cmap.readUInt32BE(q + 4);
      const glyph = cmap.readUInt32BE(q + 8);
      for (let c = start; c <= end; c++) if (glyph + (c - start) !== 0) out.set(c, glyph + (c - start));
    }
    return out;
  }
  const segX2 = cmap.readUInt16BE(o + 6);
  const ends = o + 14;
  const starts = ends + segX2 + 2;
  const deltas = starts + segX2;
  const rangeOffsets = deltas + segX2;
  for (let s = 0; s < segX2 / 2; s++) {
    const end = cmap.readUInt16BE(ends + s * 2);
    const start = cmap.readUInt16BE(starts + s * 2);
    const delta = cmap.readInt16BE(deltas + s * 2);
    const ro = cmap.readUInt16BE(rangeOffsets + s * 2);
    for (let c = start; c <= end && c !== 0xffff; c++) {
      let glyph: number;
      if (ro === 0) glyph = (c + delta) & 0xffff;
      else {
        const idx = rangeOffsets + s * 2 + ro + (c - start) * 2;
        const raw = idx + 1 < cmap.length ? cmap.readUInt16BE(idx) : 0;
        glyph = raw === 0 ? 0 : (raw + delta) & 0xffff;
      }
      if (glyph !== 0) out.set(c, glyph);
    }
  }
  return out;
}

/** 一個 WOFF2 檔實際涵蓋的碼位。 */
export function woff2Coverage(file: Buffer): Set<number> {
  const cmap = woff2Table(file, 'cmap');
  return cmap ? parseCmap(cmap) : new Set();
}
