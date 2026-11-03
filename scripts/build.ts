// 建置：編譯 TypeScript，並把 HTML、CSS、電碼資料、字型與授權檔複製到 dist/。
// 產出的 dist/ 是純靜態網站，放到任何靜態伺服器即可使用。

import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { rewriteFontCss } from './lib/fonts.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = path.join(root, 'dist');

interface FontSource {
  /** node_modules 裡的套件名稱（開發依賴，只在建置時讀取）。 */
  readonly pkg: string;
  /** 套件內的 CSS 檔。 */
  readonly css: string;
  /** 輸出目錄名稱（dist/fonts/<dir>）。 */
  readonly dir: string;
  readonly license: string;
}

const FONTS: readonly FontSource[] = [
  { pkg: '@fontsource-variable/noto-serif-tc', css: 'index.css', dir: 'noto-serif-tc', license: 'OFL-Noto-Serif-TC.txt' },
  { pkg: '@fontsource/lxgw-wenkai-tc', css: '400.css', dir: 'lxgw-wenkai-tc', license: 'OFL-LXGW-WenKai-TC.txt' },
];

function run(cmd: string, args: readonly string[]): void {
  const result = spawnSync(cmd, args, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`${path.basename(args[0] ?? cmd)} 執行失敗（代碼 ${result.status ?? 'null'}）`);
  }
}

async function copyInto(from: string, to: string): Promise<void> {
  await mkdir(path.dirname(to), { recursive: true });
  await copyFile(from, to);
}

async function buildFonts(): Promise<void> {
  const parts: string[] = [
    '/* 由 scripts/build.ts 從 Fontsource 套件產生。字型以 SIL Open Font License 1.1 授權，見 ../licenses/。 */',
  ];
  for (const font of FONTS) {
    const pkgDir = path.join(root, 'node_modules', font.pkg);
    const css = await readFile(path.join(pkgDir, font.css), 'utf8');
    const { css: rewritten, files } = rewriteFontCss(css, font.dir);
    if (files.length === 0) throw new Error(`${font.pkg} 沒有任何 woff2 檔`);
    for (const file of files) {
      await copyInto(path.join(pkgDir, 'files', file), path.join(dist, 'fonts', font.dir, file));
    }
    await copyInto(path.join(pkgDir, 'LICENSE'), path.join(dist, 'fonts', font.dir, 'LICENSE.txt'));
    parts.push(`/* ${font.pkg}（${files.length} 個 woff2 分片） */`, rewritten.trim());
  }
  await writeFile(path.join(dist, 'fonts', 'fonts.css'), `${parts.join('\n\n')}\n`, 'utf8');
}

async function copyDir(from: string, to: string, filter: (name: string) => boolean): Promise<void> {
  for (const entry of await readdir(from, { withFileTypes: true })) {
    if (entry.isFile() && filter(entry.name)) await copyInto(path.join(from, entry.name), path.join(to, entry.name));
  }
}

async function dirSize(dir: string): Promise<{ files: number; bytes: number }> {
  let files = 0;
  let bytes = 0;
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    files++;
    bytes += (await stat(path.join(entry.parentPath, entry.name))).size;
  }
  return { files, bytes };
}

async function main(): Promise<void> {
  await rm(dist, { recursive: true, force: true });

  run(process.execPath, [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.build.json']);

  await copyInto(path.join(root, 'src', 'index.html'), path.join(dist, 'index.html'));
  await copyDir(path.join(root, 'src', 'styles'), path.join(dist, 'css'), (n) => n.endsWith('.css'));
  await copyInto(path.join(root, 'src', 'data', 'telegraph.json'), path.join(dist, 'data', 'telegraph.json'));
  await buildFonts();

  await copyInto(path.join(root, 'LICENSE'), path.join(dist, 'licenses', 'LICENSE.txt'));
  await copyInto(path.join(root, 'THIRD_PARTY_NOTICES.md'), path.join(dist, 'licenses', 'THIRD_PARTY_NOTICES.txt'));
  await copyDir(path.join(root, 'licenses'), path.join(dist, 'licenses'), (n) => n.endsWith('.txt'));

  const { files, bytes } = await dirSize(dist);
  console.log(`建置完成：dist/（${files} 個檔案，${(bytes / 1024 / 1024).toFixed(1)} MB）`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
