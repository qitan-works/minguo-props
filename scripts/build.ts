// 建置：編譯 TypeScript，並把 HTML、CSS、電碼資料、字型與授權檔複製到 dist/。
// 字型有兩種來源：Fontsource 套件（node_modules）與 pnpm fonts:generate 產生、提交在 fonts/ 的字型。
// 兩種都會驗證實際複製的字型檔的數量與 SHA-256（登記在 src/fonts.ts），不符就中止建置。
// 產出的 dist/ 是純靜態網站，放到任何靜態伺服器即可使用。
//
// 部署版本（見 scripts/lib/version.ts）：網站自己的 JS、CSS、fonts.css 與 data/ 放在 dist/v/<版本>/，
// index.html 是唯一不帶版本的入口；字型檔留在 dist/fonts/，網址加上各自內容的雜湊。
//   dist/index.html
//   dist/v/<版本>/js/…、css/…、data/telegraph.json、fonts.css
//   dist/fonts/<字型>/*.woff2（網址帶 ?v=<內容雜湊>）、LICENSE.txt、SOURCE.txt
//   dist/licenses/…

import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createHash } from 'node:crypto';

import { FONTS, type FontsourceFont, type GeneratedFont } from '../src/fonts.ts';
import { readManifest, type FontManifest, type ManifestFont } from './lib/font-manifest.ts';
import { MODIFIED_DATE, PROJECT_URL } from './lib/font-sources.ts';
import { generatedFontCss, rewriteFontCss } from './lib/fonts.ts';
import { findRootUrls, kindOf } from './lib/relative-urls.ts';
import { buildVersion, checkVersionedRefs, contentHash, fileHash, versionFontUrls, versionIndexHtml } from './lib/version.ts';

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

/** 依檔名排序後串接的 SHA-256（與 src/fonts.ts 登記的算法相同）。 */
async function concatSha256(dir: string, files: readonly string[]): Promise<string> {
  const hash = createHash('sha256');
  for (const file of [...files].sort()) hash.update(await readFile(path.join(dir, file)));
  return hash.digest('hex');
}

async function buildFontsourceFont(font: FontsourceFont): Promise<string[]> {
  const pkgDir = path.join(root, 'node_modules', font.pkg);
  const pkgJson = JSON.parse(await readFile(path.join(pkgDir, 'package.json'), 'utf8')) as { version?: string };
  if (pkgJson.version !== font.version) throw new Error(`${font.pkg} 版本為 ${pkgJson.version}，預期 ${font.version}`);
  const css = await readFile(path.join(pkgDir, font.css), 'utf8');
  const { css: rewritten, files } = rewriteFontCss(css, font.dir);
  if (files.length !== font.fileCount) throw new Error(`${font.pkg} 有 ${files.length} 個 woff2，預期 ${font.fileCount}`);
  // 驗證實際要提供的字型檔與登記的 SHA-256 相符
  const digest = await concatSha256(path.join(pkgDir, 'files'), files);
  if (digest !== font.sha256) throw new Error(`${font.pkg} 的字型檔 SHA-256 不符：${digest}`);
  for (const file of files) {
    await copyInto(path.join(pkgDir, 'files', file), path.join(dist, 'fonts', font.dir, file));
  }
  await copyInto(path.join(pkgDir, 'LICENSE'), path.join(dist, 'fonts', font.dir, 'LICENSE.txt'));
  return [`/* ${font.pkg}@${font.version}（${files.length} 個 woff2 分片，SHA-256 ${font.sha256}；SIL OFL 1.1） */`, rewritten.trim()];
}

/** 放在字型目錄裡的來源與修改說明（GPL-2.0 第 2 條 (a) 款要求修改過的檔案註明修改內容與日期）。 */
function sourceNotice(font: GeneratedFont, entry: ManifestFont): string {
  const origin = entry.source.member ? `${path.basename(entry.source.member)}（在 ${entry.source.url} 裡）` : entry.source.url;
  const lines = [
    `${font.label}（CSS 字型家族名稱：${font.family}）`,
    '',
    `原始字型：${origin}`,
    `原始檔 SHA-256：${entry.source.sha256}（${entry.source.bytes} 位元組）`,
    ...(entry.source.member ? [`原始字型檔 SHA-256：${entry.source.fontSha256}（${entry.source.fontBytes} 位元組）`] : []),
    `上游專案：${font.upstream}${font.commit ? `（commit ${font.commit}）` : ''}`,
    `版本：${font.version}`,
    `著作權：${font.copyright}`,
    `授權：${font.license}（全文見同目錄的 LICENSE.txt；彙整見 ../../licenses/THIRD_PARTY_NOTICES.txt）`,
    '',
  ];
  if (font.modified) {
    lines.push(
      `修改：民國道具舖（${PROJECT_URL}）於 ${MODIFIED_DATE} 修改了這套字型：切出子集（Big5 常用字、標點符號與網站用到的字），`,
      `依 Unicode 範圍分成 ${entry.files.length} 個 WOFF2 檔，並在字型 name 表的說明欄（nameID 10）加註修改聲明。`,
      '原有的著作權與授權聲明全部保留。字型檔本身就是可修改的原始形式；未修改的原始字型可從上面的網址取得。',
      '',
      `Modified by minguo-props (${PROJECT_URL}) on ${MODIFIED_DATE}: subset to Big5 level-1 characters, punctuation,`,
      `symbols and the characters used by the site, split into ${entry.files.length} WOFF2 files by Unicode range, and a modification`,
      'notice was appended to the description (name ID 10). All copyright and license notices are retained.',
    );
  } else {
    lines.push(
      '未修改：原字型的資料原封不動（每個表都與原檔逐位元組相同），只以 WOFF 1.0 壓縮，沒有 WOFF 中繼資料。',
      'Unmodified: the original font data is unchanged; it is only WOFF 1.0 compressed, without WOFF metadata.',
    );
  }
  return `${lines.join('\n')}\n`;
}

async function buildGeneratedFont(font: GeneratedFont, manifest: FontManifest): Promise<string[]> {
  const entry = manifest.fonts.find((f) => f.id === font.id);
  if (!entry) throw new Error(`fonts/manifest.json 沒有 ${font.id}，請執行 pnpm fonts:generate`);
  if (entry.format !== font.format) throw new Error(`${font.id} 的格式為 ${entry.format}，預期 ${font.format}`);
  const files = entry.files.map((f) => f.file);
  if (files.length !== font.fileCount) throw new Error(`${font.id} 有 ${files.length} 個字型檔，預期 ${font.fileCount}`);
  const srcDir = path.join(root, 'fonts', entry.id);
  const digest = await concatSha256(srcDir, files);
  if (digest !== font.sha256) throw new Error(`${font.id} 的字型檔 SHA-256 不符：${digest}`);
  for (const file of files) await copyInto(path.join(srcDir, file), path.join(dist, 'fonts', font.dir, file));
  const [license, ...more] = font.licenseFiles;
  if (!license || more.length > 0) throw new Error(`${font.id} 應該只有一個授權檔`);
  await copyInto(path.join(root, 'licenses', license), path.join(dist, 'fonts', font.dir, 'LICENSE.txt'));
  await writeFile(path.join(dist, 'fonts', font.dir, 'SOURCE.txt'), sourceNotice(font, entry), 'utf8');
  const what = font.modified ? `子集，${files.length} 個 ${font.format} 分片` : `原封不動的 ${font.format}`;
  return [
    `/* ${font.label}（${what}，SHA-256 ${font.sha256}；${font.license}，來源與修改說明見 ./${font.dir}/SOURCE.txt） */`,
    generatedFontCss(font.family, font.dir, font.format, entry.files),
  ];
}

/** 複製字型檔到 dist/fonts/，回傳 fonts.css 的內容（字型網址帶各自內容的雜湊，fonts.css 放在版本資料夾）。 */
async function buildFonts(): Promise<string> {
  const manifest = await readManifest(path.join(root, 'fonts'));
  const parts: string[] = [
    '/* 由 scripts/build.ts 產生。字型各依其授權條款散布（SIL OFL 1.1 或 GPL-2.0-or-later），見 ../../licenses/ 與各字型目錄的 LICENSE.txt。 */',
  ];
  for (const font of FONTS) {
    parts.push(...(font.source === 'fontsource' ? await buildFontsourceFont(font) : await buildGeneratedFont(font, manifest)));
  }
  const hashes = new Map<string, string>();
  for (const entry of await readdir(path.join(dist, 'fonts'), { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !/\.woff2?$/.test(entry.name)) continue;
    hashes.set(`${path.basename(entry.parentPath)}/${entry.name}`, fileHash(await readFile(path.join(entry.parentPath, entry.name))));
  }
  return versionFontUrls(`${parts.join('\n\n')}\n`, (dir, file) => {
    const h = hashes.get(`${dir}/${file}`);
    if (!h) throw new Error(`fonts.css 引用的字型檔不存在：${dir}/${file}`);
    return h;
  });
}

/** 目前的 commit（GitHub Actions 的 GITHUB_SHA，或本機的 git）；都沒有時是空字串。 */
function commitId(): string {
  const env = process.env['GITHUB_SHA'];
  if (env) return env;
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : '';
}

async function readTree(dir: string, base = dir): Promise<Map<string, Buffer>> {
  const out = new Map<string, Buffer>();
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath, entry.name);
    out.set(path.relative(base, file).split(path.sep).join('/'), await readFile(file));
  }
  return out;
}

/** 建置後檢查：網站自己的 JS、CSS、資料檔都只從版本資料夾引用，字型網址都帶內容雜湊。 */
async function assertVersioned(version: string): Promise<void> {
  const files = new Map<string, string>();
  for (const [name, data] of await readTree(dist)) if (/\.(?:html|css|m?js)$/.test(name)) files.set(name, data.toString('utf8'));
  const problems = checkVersionedRefs(files, version);
  if (problems.length > 0) {
    throw new Error(`dist/ 裡有沒有加版本的引用，部署後瀏覽器可能把新舊檔案混在一起用：\n${problems.map((p) => `  ${p.file}  ${p.match}`).join('\n')}`);
  }
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

/** 網站部署在子路徑下（GitHub Pages），產物裡只要有一個根路徑網址就中止建置。 */
async function assertRelativeUrls(): Promise<void> {
  const problems: string[] = [];
  for (const entry of await readdir(dist, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const kind = kindOf(entry.name);
    if (!kind) continue;
    const file = path.join(entry.parentPath, entry.name);
    for (const ref of findRootUrls(await readFile(file, 'utf8'), kind)) {
      problems.push(`  ${path.relative(dist, file)}:${ref.line}  ${ref.match}`);
    }
  }
  if (problems.length > 0) {
    throw new Error(`dist/ 裡有以「/」開頭的網址，部署在子路徑下會找不到檔案，請改用相對路徑：\n${problems.join('\n')}`);
  }
}

async function main(): Promise<void> {
  await rm(dist, { recursive: true, force: true });

  run(process.execPath, [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.build.json']);

  // 網站自己的檔案先放在暫存資料夾，算出版本後整個改名成 v/<版本>/
  const stage = path.join(dist, '.stage');
  await mkdir(stage, { recursive: true });
  await rename(path.join(dist, 'js'), path.join(stage, 'js'));
  await copyDir(path.join(root, 'src', 'styles'), path.join(stage, 'css'), (n) => n.endsWith('.css'));
  await copyInto(path.join(root, 'src', 'data', 'telegraph.json'), path.join(stage, 'data', 'telegraph.json'));
  await writeFile(path.join(stage, 'fonts.css'), await buildFonts(), 'utf8');
  const version = buildVersion(commitId(), contentHash(await readTree(stage)));
  await mkdir(path.join(dist, 'v'), { recursive: true });
  await rename(stage, path.join(dist, 'v', version));
  await writeFile(path.join(dist, 'index.html'), versionIndexHtml(await readFile(path.join(root, 'src', 'index.html'), 'utf8'), version), 'utf8');

  await copyInto(path.join(root, 'LICENSE'), path.join(dist, 'licenses', 'LICENSE.txt'));
  await copyInto(path.join(root, 'THIRD_PARTY_NOTICES.md'), path.join(dist, 'licenses', 'THIRD_PARTY_NOTICES.txt'));
  await copyDir(path.join(root, 'licenses'), path.join(dist, 'licenses'), (n) => n.endsWith('.txt'));

  await assertRelativeUrls();
  await assertVersioned(version);

  const { files, bytes } = await dirSize(dist);
  console.log(`建置完成：dist/（${files} 個檔案，${(bytes / 1024 / 1024).toFixed(1)} MB），版本 v/${version}/`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
