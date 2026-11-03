// 以 HarfBuzz 的子集化工具（harfbuzzjs 套件附的 harfbuzz-subset.wasm，MIT 授權）切出字型子集。
// WASM 模組不需要任何匯入，直接用 Node 內建的 WebAssembly 執行；只在產生字型時使用（開發依賴）。
//
// 設定：
// - 保留 name 表的全部紀錄（所有 nameID、所有語言，含麥金塔平台的舊式紀錄），著作權與授權聲明原樣留下；
// - 保留直排相關的版面功能（vert、vrt2、vkna、vhal、vpal、valt、vkrn）與 HarfBuzz 預設保留的功能；
//   GSUB／GPOS 會依保留的字做閉包（closure），被替換出來的直排字形也一併保留；
// - vhea、vmtx、VORG 依 HarfBuzz 預設保留；mort、morx 等 AAT 表、DSIG 依預設捨棄；
// - 其餘使用 HarfBuzz 的預設值（輸出是決定性的：相同輸入一定得到相同位元組）。
//
// 參考：HarfBuzz 的 hb-subset.h（hb_subset_input_t、hb_subset_sets_t、hb_subset_flags_t）。

import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

interface HbExports {
  readonly memory: WebAssembly.Memory;
  malloc(size: number): number;
  free(ptr: number): void;
  hb_blob_create(data: number, length: number, mode: number, userData: number, destroy: number): number;
  hb_blob_destroy(blob: number): void;
  hb_blob_get_length(blob: number): number;
  hb_blob_get_data(blob: number, lengthPtr: number): number;
  hb_face_create(blob: number, index: number): number;
  hb_face_destroy(face: number): void;
  hb_face_reference_blob(face: number): number;
  hb_set_add(set: number, value: number): void;
  hb_set_clear(set: number): void;
  hb_set_invert(set: number): void;
  hb_subset_input_create_or_fail(): number;
  hb_subset_input_destroy(input: number): void;
  hb_subset_input_unicode_set(input: number): number;
  hb_subset_input_set(input: number, which: number): number;
  hb_subset_input_get_flags(input: number): number;
  hb_subset_input_set_flags(input: number, flags: number): void;
  hb_subset_or_fail(face: number, input: number): number;
  _initialize?: () => void;
}

const HB_MEMORY_MODE_READONLY = 1;
const HB_SUBSET_SETS_NAME_ID = 4;
const HB_SUBSET_SETS_NAME_LANG_ID = 5;
const HB_SUBSET_SETS_LAYOUT_FEATURE_TAG = 6;
const HB_SUBSET_FLAGS_NAME_LEGACY = 0x8;

const VERTICAL_FEATURES = ['vert', 'vrt2', 'vkna', 'vhal', 'vpal', 'valt', 'vkrn'];

function tag(s: string): number {
  return ((s.charCodeAt(0) << 24) | (s.charCodeAt(1) << 16) | (s.charCodeAt(2) << 8) | s.charCodeAt(3)) >>> 0;
}

let cached: Promise<HbExports> | null = null;

/** harfbuzz-subset.wasm 的路徑（由 node_modules/harfbuzzjs 解析）。 */
export function hbSubsetWasmPath(): string {
  return createRequire(import.meta.url).resolve('harfbuzzjs/dist/harfbuzz-subset.wasm');
}

async function load(): Promise<HbExports> {
  const bytes = await readFile(hbSubsetWasmPath());
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const exports = instance.exports as unknown as HbExports;
  exports._initialize?.();
  return exports;
}

/**
 * 依碼位集合切出字型子集，回傳新的 SFNT（TrueType）位元組。
 * 每次呼叫都重新建立 face，記憶體在結束前全部釋放。
 */
export async function subsetFont(font: Buffer, codepoints: Iterable<number>): Promise<Buffer> {
  cached ??= load();
  const hb = await cached;
  const fontPtr = hb.malloc(font.length);
  if (fontPtr === 0) throw new Error('HarfBuzz 記憶體配置失敗');
  new Uint8Array(hb.memory.buffer, fontPtr, font.length).set(font);
  const blob = hb.hb_blob_create(fontPtr, font.length, HB_MEMORY_MODE_READONLY, 0, 0);
  const face = hb.hb_face_create(blob, 0);
  hb.hb_blob_destroy(blob);
  const input = hb.hb_subset_input_create_or_fail();
  if (input === 0) throw new Error('HarfBuzz 無法建立子集設定');
  try {
    const unicodes = hb.hb_subset_input_unicode_set(input);
    for (const cp of codepoints) hb.hb_set_add(unicodes, cp);
    // 全部 nameID、全部語言：清空後反轉＝全集
    for (const which of [HB_SUBSET_SETS_NAME_ID, HB_SUBSET_SETS_NAME_LANG_ID]) {
      const set = hb.hb_subset_input_set(input, which);
      hb.hb_set_clear(set);
      hb.hb_set_invert(set);
    }
    const features = hb.hb_subset_input_set(input, HB_SUBSET_SETS_LAYOUT_FEATURE_TAG);
    for (const f of VERTICAL_FEATURES) hb.hb_set_add(features, tag(f));
    hb.hb_subset_input_set_flags(input, hb.hb_subset_input_get_flags(input) | HB_SUBSET_FLAGS_NAME_LEGACY);

    const subset = hb.hb_subset_or_fail(face, input);
    if (subset === 0) throw new Error('HarfBuzz 子集化失敗');
    const out = hb.hb_face_reference_blob(subset);
    const ptr = hb.hb_blob_get_data(out, 0);
    const length = hb.hb_blob_get_length(out);
    const result = Buffer.from(new Uint8Array(hb.memory.buffer, ptr, length));
    hb.hb_blob_destroy(out);
    hb.hb_face_destroy(subset);
    if (length === 0) throw new Error('HarfBuzz 子集化結果是空的');
    return result;
  } finally {
    hb.hb_subset_input_destroy(input);
    hb.hb_face_destroy(face);
    hb.free(fontPtr);
  }
}
