// 產生自行處理的字型：fonts/<id>/ 底下的字型檔與 fonts/manifest.json（都提交進版本庫）。
//
// 用法：
//   pnpm fonts:generate     下載來源（有快取就用 .cache/fonts/ 的檔案）、驗證 SHA-256、產生並寫入 fonts/
//   pnpm fonts:check        重新產生到暫存目錄，與已提交的 fonts/ 逐位元組比對（不寫入）
//
// 流程（全部只用 Node 內建模組與兩個開發依賴：harfbuzzjs 的 hb-subset.wasm、woff2-encoder，都是 MIT 授權）：
// 1. 下載 scripts/lib/font-sources.ts 釘選的來源檔，驗證大小與 SHA-256，不符就中止；
//    王漢宗字型的 tar.gz 以自己寫的 tar 讀取器（scripts/lib/tar.ts）解開。
// 2. 字集：Big5 常用字 5,401 字（src/data/big5-level1.json）＋預設與填版文字用到的所有字
//    （掃描原始碼，見 scripts/lib/text-chars.ts）＋標點與報紙常用符號（EXTRA_RANGES）。
// 3. 切子集的字型：用 HarfBuzz 依分片切出子集（分片方式見 scripts/lib/font-slices.ts），在 name 表的
//    說明（nameID 10）加上修改聲明，再轉成 WOFF2。產生後讀回每個檔的 cmap，確認收的字與分片完全一致。
// 4. 原封不動的字型（辰宇落雁體）：只包成 WOFF 1.0（scripts/lib/woff.ts），並確認解回來與原檔逐位元組相同。
// 5. 寫出 fonts/manifest.json：每個檔的大小、SHA-256、unicode-range，以及原字型缺的字。
//
// 輸出是決定性的：相同的來源、字集與程式，一定產生相同的位元組（fonts:check 就是靠這點）。
// fonts:check 用 fonts/manifest.json 記錄的 textChars（產生當時的文字用字），所以只檢查字型處理本身；
// 文字有沒有新的字沒收進字型，由 pnpm test 的字數檢查負責（會提示執行 pnpm fonts:generate）。

import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { compress } from 'woff2-encoder';

import { FONTS } from '../src/fonts.ts';
import { MANIFEST_FILE, readManifest, serializeManifest, type FontManifest, type ManifestFile, type ManifestFont } from './lib/font-manifest.ts';
import { firstSlice, restSlices, unicodeRanges, VERTICAL_FORMS } from './lib/font-slices.ts';
import { EXTRA_RANGES, MODIFIED_DATE, PROJECT_URL, RECIPES, SLICE_TARGET_BYTES, type FontRecipe, type SourceFile } from './lib/font-sources.ts';
import { subsetFont } from './lib/hb-subset.ts';
import { buildName, buildSfnt, glyphByteLengths, parseName, readSfnt, sfntTable, windowsNameRecord, type NameRecord } from './lib/sfnt.ts';
import { extractTarFile, readTarGz, type TarEntry } from './lib/tar.ts';
import { scanTextChars } from './lib/text-chars.ts';
import { decodeWoff, encodeWoff } from './lib/woff.ts';
import { parseCmapGlyphs, woff2Coverage } from './lib/woff2.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const OUTPUT = path.join(root, 'fonts');
const CACHE = path.join(root, '.cache', 'fonts');

const sha256 = (buf: Buffer): string => createHash('sha256').update(buf).digest('hex');
const cps = (text: string): number[] => [...text].map((c) => c.codePointAt(0) as number);
const chars = (list: Iterable<number>): string => [...list].map((cp) => String.fromCodePoint(cp)).join('');

function verifySource(buf: Buffer, src: SourceFile): string | null {
  const actual = sha256(buf);
  if (buf.length === src.bytes && actual === src.sha256) return null;
  return [`  預期：${src.sha256}（${src.bytes} 位元組）`, `  實際：${actual}（${buf.length} 位元組）`].join('\n');
}

async function fetchSource(src: SourceFile): Promise<Buffer> {
  const file = path.join(CACHE, src.cache);
  const cached = await readFile(file).catch(() => null);
  if (cached && verifySource(cached, src) === null) return cached;
  if (cached) console.error(`快取的 ${src.cache} 驗證失敗，重新下載`);
  console.error(`下載 ${src.url}`);
  const res = await fetch(src.url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`下載失敗：HTTP ${res.status} ${res.statusText}（${src.url}）`);
  const buf = Buffer.from(await res.arrayBuffer());
  const problem = verifySource(buf, src);
  if (problem) throw new Error(`${src.url} 驗證失敗，拒絕使用。\n${problem}`);
  await mkdir(CACHE, { recursive: true });
  await writeFile(file, buf);
  return buf;
}

const tarCache = new Map<string, Promise<TarEntry[]>>();

async function loadFont(recipe: FontRecipe): Promise<Buffer> {
  if (!recipe.member) return fetchSource(recipe.source);
  let entries = tarCache.get(recipe.source.cache);
  if (!entries) {
    entries = fetchSource(recipe.source).then((tgz) => readTarGz(tgz));
    tarCache.set(recipe.source.cache, entries);
  }
  return extractTarFile(await entries, recipe.member);
}

/** 在 name 表的說明（nameID 10）加上修改聲明（GPL-2.0 第 2 條 (a) 款），原有內容原樣保留。 */
function addModificationNotice(font: Buffer, origin: string): Buffer {
  const sfnt = readSfnt(font);
  const name = sfntTable(sfnt, 'name');
  if (!name) throw new Error('字型沒有 name 表');
  const en =
    `Modified by minguo-props (${PROJECT_URL}) on ${MODIFIED_DATE}: subset to Big5 level-1 characters, ` +
    `punctuation, symbols and the characters used by the site, split into unicode-range slices and converted to WOFF2. ` +
    `Original font: ${origin}.`;
  const zh =
    `民國道具舖（${PROJECT_URL}）於 ${MODIFIED_DATE} 修改：切出子集（Big5 常用字、標點符號與網站用到的字），` +
    `依 Unicode 範圍分片並轉成 WOFF2。原始字型：${origin}。`;
  const isChinese = (lang: number): boolean => (lang & 0x3ff) === 0x04;
  const isWinDescription = (r: NameRecord): boolean => r.platformID === 3 && r.encodingID === 1 && r.nameID === 10;
  const records = parseName(name).map((r) =>
    isWinDescription(r) ? windowsNameRecord(r.languageID, 10, `${r.value ?? ''}\n\n${isChinese(r.languageID) ? zh : en}`) : r,
  );
  for (const [lang, text] of [
    [0x409, en],
    [0x404, zh],
  ] as const) {
    if (!records.some((r) => isWinDescription(r) && r.languageID === lang)) records.push(windowsNameRecord(lang, 10, text));
  }
  return buildSfnt(
    sfnt.flavor,
    sfnt.tables.map((t) => ({ tag: t.tag, data: t.tag === 'name' ? buildName(records) : t.data })),
  );
}

interface CharSets {
  readonly big5: readonly number[];
  readonly text: readonly number[];
  /** 每套子集字型要收的全部碼位。 */
  readonly requested: ReadonlySet<number>;
  /** 第 0 片：預設與填版文字＋ASCII。 */
  readonly first: ReadonlySet<number>;
}

async function charSets(textChars: string): Promise<CharSets> {
  const big5 = cps((JSON.parse(await readFile(path.join(root, 'src', 'data', 'big5-level1.json'), 'utf8')) as { chars: string[] }).chars.join(''));
  const text = cps(textChars);
  const requested = new Set<number>([...big5, ...text]);
  for (const [a, b] of EXTRA_RANGES) for (let cp = a; cp <= b; cp++) requested.add(cp);
  const first = new Set<number>(text);
  for (let cp = 0x20; cp <= 0x7e; cp++) first.add(cp);
  return { big5, text, requested, first };
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

async function generateFont(recipe: FontRecipe, sets: CharSets, outDir: string): Promise<ManifestFont> {
  const font = await loadFont(recipe);
  const sfnt = readSfnt(font);
  const cmapTable = sfntTable(sfnt, 'cmap');
  if (!cmapTable) throw new Error(`${recipe.id}：字型沒有 cmap 表`);
  const cmap = parseCmapGlyphs(cmapTable);
  // 字型裡有、而且要收進輸出檔的碼位（原封不動的字型就是整個 cmap）
  const covered = new Set(recipe.mode === 'woff' ? cmap.keys() : [...sets.requested].filter((cp) => cmap.has(cp)));
  if (recipe.verticalPunctuation === 'fallback') {
    if (sfntTable(sfnt, 'GSUB')) throw new Error(`${recipe.id}：字型有 GSUB 表，不該設 verticalPunctuation: 'fallback'`);
    for (const [h, v] of VERTICAL_FORMS) if (!cmap.has(v)) covered.delete(h);
  }
  const missingBig5 = chars(sets.big5.filter((cp) => !covered.has(cp)));
  const missingText = chars(sets.text.filter((cp) => !covered.has(cp)));
  const dir = path.join(outDir, recipe.id);
  await mkdir(dir, { recursive: true });
  const files: ManifestFile[] = [];
  const outputs: Buffer[] = [];
  let tables: ManifestFont['tables'];

  if (recipe.mode === 'woff') {
    const woff = encodeWoff(font);
    if (Buffer.compare(decodeWoff(woff).sfnt, font) !== 0) throw new Error(`${recipe.id}：WOFF 解回來與原字型不同`);
    const file = `${path.basename(recipe.source.url, '.ttf')}.woff`;
    await writeFile(path.join(dir, file), woff);
    outputs.push(woff);
    files.push({ file, bytes: woff.length, sha256: sha256(woff), codepoints: cmap.size, unicodeRange: null });
    tables = sfnt.tables.map((t) => ({ tag: t.tag, length: t.length, checksum: t.checksum.toString(16).padStart(8, '0'), sha256: sha256(t.data) }));
  } else {
    const sizes = glyphByteLengths(sfnt);
    const weight = (cp: number): number => sizes[cmap.get(cp) as number] ?? 0;
    const makeSlice = async (slice: readonly number[], i: number): Promise<Buffer> => {
      const subset = addModificationNotice(await subsetFont(font, slice), recipe.origin);
      const woff2 = Buffer.from(await compress(subset));
      const got = [...woff2Coverage(woff2)].sort((a, b) => a - b);
      if (got.join() !== slice.join()) throw new Error(`${recipe.id} 第 ${i} 片收的字與預期不同（${got.length}／${slice.length}）`);
      return woff2;
    };
    // 先做第 0 片，用它的壓縮率（WOFF2 大小÷原字形大小）換算其餘各片的目標大小
    const slice0 = firstSlice(covered, sets.first);
    const woff0 = await makeSlice(slice0, 0);
    const ratio = woff0.length / slice0.reduce((s, cp) => s + weight(cp), 0);
    const slices = [slice0, ...restSlices({ covered, taken: new Set(slice0), weight, budget: SLICE_TARGET_BYTES / ratio })];
    const ranges = unicodeRanges(slices, sets.requested);
    for (const [i, slice] of slices.entries()) {
      const woff2 = i === 0 ? woff0 : await makeSlice(slice, i);
      const file = `${recipe.id}-${pad2(i)}.woff2`;
      await writeFile(path.join(dir, file), woff2);
      outputs.push(woff2);
      files.push({ file, bytes: woff2.length, sha256: sha256(woff2), codepoints: slice.length, unicodeRange: ranges[i] as string });
    }
  }

  // 與建置相同的算法：依檔名排序後串接
  const hash = createHash('sha256');
  const order = files.map((f, i) => ({ f, buf: outputs[i] as Buffer })).sort((a, b) => (a.f.file < b.f.file ? -1 : 1));
  for (const { buf } of order) hash.update(buf);
  return {
    id: recipe.id,
    format: recipe.mode === 'woff' ? 'woff' : 'woff2',
    source: {
      url: recipe.source.url,
      bytes: recipe.source.bytes,
      sha256: recipe.source.sha256,
      ...(recipe.member ? { member: recipe.member } : {}),
      fontBytes: font.length,
      fontSha256: sha256(font),
    },
    sha256: hash.digest('hex'),
    bytes: files.reduce((s, f) => s + f.bytes, 0),
    missingBig5,
    missingText,
    files,
    ...(tables ? { tables } : {}),
  };
}

async function generate(outDir: string, textChars: string): Promise<FontManifest> {
  const sets = await charSets(textChars);
  const fonts: ManifestFont[] = [];
  for (const recipe of RECIPES) {
    const started = Date.now();
    const entry = await generateFont(recipe, sets, outDir);
    fonts.push(entry);
    console.error(
      `${recipe.id}：${entry.files.length} 個檔，${(entry.bytes / 1024).toFixed(0)} KB（${((Date.now() - started) / 1000).toFixed(1)} 秒）`,
    );
  }
  const manifest: FontManifest = {
    $comment:
      '由 scripts/fonts-generate.ts（pnpm fonts:generate）自動產生，請勿手動修改。字型的授權與來源見 THIRD_PARTY_NOTICES.md。',
    version: 1,
    textChars,
    fonts,
  };
  await writeFile(path.join(outDir, MANIFEST_FILE), serializeManifest(manifest), 'utf8');
  return manifest;
}

async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) out.push(path.relative(dir, path.join(entry.parentPath, entry.name)));
  }
  return out.sort();
}

/** WOFF 1.0 的壓縮位元組可能因 zlib 實作不同而異；這時改比對解壓後的內容與檔頭欄位。 */
function sameWoffContent(a: Buffer, b: Buffer): boolean {
  try {
    const x = decodeWoff(a);
    const y = decodeWoff(b);
    return Buffer.compare(x.sfnt, y.sfnt) === 0 && x.majorVersion === y.majorVersion && x.minorVersion === y.minorVersion && x.metaLength === 0 && y.metaLength === 0 && x.privLength === 0 && y.privLength === 0;
  } catch {
    return false;
  }
}

async function compareDirs(committed: string, generated: string): Promise<string[]> {
  const problems: string[] = [];
  const a = await listFiles(committed).catch(() => [] as string[]);
  const b = await listFiles(generated);
  for (const f of a) if (!b.includes(f)) problems.push(`  多出來的檔案：fonts/${f}`);
  for (const f of b) {
    if (!a.includes(f)) {
      problems.push(`  缺少的檔案：fonts/${f}`);
      continue;
    }
    const x = await readFile(path.join(committed, f));
    const y = await readFile(path.join(generated, f));
    if (Buffer.compare(x, y) === 0) continue;
    if (f.endsWith('.woff') && sameWoffContent(x, y)) {
      console.error(`注意：fonts/${f} 的 zlib 壓縮位元組不同（zlib 實作差異），但解壓後的字型與檔頭完全相同。`);
      continue;
    }
    problems.push(`  內容不同：fonts/${f}`);
  }
  return problems;
}

/** 列出 src/fonts.ts 需要更新的欄位（產生新字型之後提醒）。 */
function registryHints(manifest: FontManifest): string[] {
  const hints: string[] = [];
  for (const entry of manifest.fonts) {
    const font = FONTS.find((f) => f.id === entry.id);
    const want = { sha256: entry.sha256, fileCount: entry.files.length, missingBig5: entry.missingBig5, missingText: entry.missingText };
    if (font?.source !== 'generated') {
      hints.push(`  ${entry.id}：${JSON.stringify(want)}`);
      continue;
    }
    for (const [key, value] of Object.entries(want)) {
      if ((font as unknown as Record<string, unknown>)[key] !== value) hints.push(`  ${entry.id}.${key} = ${JSON.stringify(value)}`);
    }
  }
  return hints;
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { check: { type: 'boolean', default: false } } });
  const scanned = (await scanTextChars(root)).join('');

  if (values.check) {
    const committed = await readManifest(OUTPUT);
    if (committed.textChars !== scanned) {
      console.error('注意：原始碼裡的預設與填版文字用字與 fonts/manifest.json 記錄的不同（比對仍以記錄的為準）；需要時請執行 pnpm fonts:generate。');
    }
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'minguo-fonts-check-'));
    try {
      await generate(tmp, committed.textChars);
      const problems = await compareDirs(OUTPUT, tmp);
      if (problems.length > 0) {
        console.error(`fonts/ 與重新產生的結果不一致，請執行 pnpm fonts:generate 並提交：\n${problems.join('\n')}`);
        process.exitCode = 1;
        return;
      }
      console.error('fonts/ 與重新產生的結果完全一致。');
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
    return;
  }

  await mkdir(path.join(root, '.cache'), { recursive: true });
  const staging = await mkdtemp(path.join(root, '.cache', 'fonts-out-'));
  try {
    const manifest = await generate(staging, scanned);
    await rm(OUTPUT, { recursive: true, force: true });
    await rename(staging, OUTPUT);
    const total = manifest.fonts.reduce((s, f) => s + f.bytes, 0);
    console.error(`已寫入 fonts/（${manifest.fonts.length} 套字型，共 ${(total / 1024 / 1024).toFixed(1)} MB）。`);
    const hints = registryHints(manifest);
    if (hints.length > 0) console.error(`請更新 src/fonts.ts：\n${hints.join('\n')}`);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exitCode = 1;
});
