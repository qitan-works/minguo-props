// fonts/manifest.json 的格式：由 pnpm fonts:generate 產生並提交，建置與測試都讀這個檔。

import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const MANIFEST_FILE = 'manifest.json';

export interface ManifestFile {
  /** fonts/<id>/ 底下的檔名。 */
  readonly file: string;
  readonly bytes: number;
  readonly sha256: string;
  /** 這個檔的 cmap 收了幾個碼位。 */
  readonly codepoints: number;
  /** @font-face 的 unicode-range；null 表示不分片（整個字型一個檔）。 */
  readonly unicodeRange: string | null;
}

export interface ManifestTable {
  readonly tag: string;
  readonly length: number;
  /** 原字型表目錄裡的檢查碼（8 位十六進位）。 */
  readonly checksum: string;
  readonly sha256: string;
}

export interface ManifestFont {
  readonly id: string;
  readonly format: 'woff2' | 'woff';
  readonly source: {
    readonly url: string;
    readonly bytes: number;
    readonly sha256: string;
    /** 壓縮檔裡的路徑（來源是 tar.gz 時）。 */
    readonly member?: string;
    /** 原字型檔（解壓後）的大小與 SHA-256。 */
    readonly fontBytes: number;
    readonly fontSha256: string;
  };
  /** 依檔名排序後串接全部輸出檔的 SHA-256（與 src/fonts.ts 的 sha256 相同）。 */
  readonly sha256: string;
  readonly bytes: number;
  /** 輸出檔沒有的 Big5 常用字。 */
  readonly missingBig5: string;
  /** 輸出檔沒有、但預設或填版文字用到的字（原字型沒有，或為了直排刻意不收的標點）。 */
  readonly missingText: string;
  readonly files: readonly ManifestFile[];
  /** 只有 woff（原封不動）格式才有：原字型每個表的長度、檢查碼與 SHA-256（依表目錄順序）。 */
  readonly tables?: readonly ManifestTable[];
}

export interface FontManifest {
  readonly $comment: string;
  readonly version: 1;
  /** 產生時掃描到的預設與填版文字用字（依碼位排序）。 */
  readonly textChars: string;
  readonly fonts: readonly ManifestFont[];
}

export function serializeManifest(manifest: FontManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export async function readManifest(dir: string): Promise<FontManifest> {
  const manifest = JSON.parse(await readFile(path.join(dir, MANIFEST_FILE), 'utf8')) as FontManifest;
  if (manifest.version !== 1) throw new Error(`${MANIFEST_FILE} 的版本不符（${String(manifest.version)}）`);
  return manifest;
}
