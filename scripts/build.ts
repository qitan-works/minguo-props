// 建置：編譯 TypeScript，並把 HTML、CSS、電碼資料、字型與授權檔複製到 dist/。
// 產出的 dist/ 是純靜態網站，放到任何靜態伺服器即可使用。

import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createHash } from 'node:crypto';

import { FONTS } from '../src/fonts.ts';
import { rewriteFontCss } from './lib/fonts.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = path.join(root, 'dist');

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
    const pkgJson = JSON.parse(await readFile(path.join(pkgDir, 'package.json'), 'utf8')) as { version?: string };
    if (pkgJson.version !== font.version) throw new Error(`${font.pkg} 版本為 ${pkgJson.version}，預期 ${font.version}`);
    const css = await readFile(path.join(pkgDir, font.css), 'utf8');
    const { css: rewritten, files } = rewriteFontCss(css, font.dir);
    if (files.length !== font.woff2Count) throw new Error(`${font.pkg} 有 ${files.length} 個 woff2，預期 ${font.woff2Count}`);
    // 驗證實際要提供的字型檔與登記的 SHA-256 相符
    const hash = createHash('sha256');
    for (const file of [...files].sort()) hash.update(await readFile(path.join(pkgDir, 'files', file)));
    const digest = hash.digest('hex');
    if (digest !== font.sha256) throw new Error(`${font.pkg} 的字型檔 SHA-256 不符：${digest}`);
    for (const file of files) {
      await copyInto(path.join(pkgDir, 'files', file), path.join(dist, 'fonts', font.dir, file));
    }
    await copyInto(path.join(pkgDir, 'LICENSE'), path.join(dist, 'fonts', font.dir, 'LICENSE.txt'));
    parts.push(`/* ${font.pkg}@${font.version}（${files.length} 個 woff2 分片，SHA-256 ${font.sha256}） */`, rewritten.trim());
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
