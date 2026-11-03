// 部署版本（純邏輯）：讓每次部署的資源網址都不同，瀏覽器不會把新舊檔案混在一起用。
//
// GitHub Pages 對所有檔案都送 Cache-Control: max-age=600，網站又是幾十個各自快取的 ES 模組、CSS 與資料檔。
// 做法：除了 index.html，網站自己的 JS、CSS、fonts.css 與 data/*.json 都放在 dist/v/<版本>/ 底下，
// index.html 指向那個資料夾。模組之間的 import 本來就是相對路徑，所以一定指到同一版；
// 新的 index.html 整套載入新版，舊的（還在快取裡的）整套載入舊版，不會混用。
// 字型檔很大（幾十 MB）又很少變，不放進版本資料夾：每個字型檔的網址加上「它自己內容的雜湊」（?v=…），
// 內容沒變的部署之間繼續用快取，內容變了網址就跟著變；引用它們的 fonts.css 本身在版本資料夾裡。

import { createHash } from 'node:crypto';

/** 版本資料夾的名稱：commit 與網站內容一起算雜湊，取前 12 碼。不同 commit 一定不同，同一份內容重建得到相同的。 */
export function buildVersion(commit: string, contentHash: string): string {
  return createHash('sha256').update(`${commit.trim() || 'no-commit'}\n${contentHash}`).digest('hex').slice(0, 12);
}

export function isVersion(v: string): boolean {
  return /^[0-9a-f]{12}$/.test(v);
}

/** 一個檔案內容的短雜湊（字型網址的 ?v= 用）。 */
export function fileHash(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex').slice(0, 12);
}

/** 一組檔案（相對路徑 → 內容）的雜湊，與列出的順序無關。 */
export function contentHash(files: ReadonlyMap<string, Uint8Array | string>): string {
  const hash = createHash('sha256');
  for (const name of [...files.keys()].sort()) {
    hash.update(`${name}\0`);
    hash.update(files.get(name) as Uint8Array | string);
    hash.update('\0');
  }
  return hash.digest('hex');
}

/** index.html 裡指到網站自己的 JS、CSS 與 fonts.css 的相對網址（不含授權文件等一般連結）。 */
const VERSIONED_REF = /\b(href|src)=(["'])(?!v\/)((?:js|css|fonts)\/[^"']+\.(?:js|css))\2/g;

/** 把 index.html 的 JS、CSS 引用改成指到 v/<版本>/；fonts/fonts.css 在版本資料夾裡叫 fonts.css。 */
export function versionIndexHtml(html: string, version: string): string {
  if (!isVersion(version)) throw new Error(`版本名稱不符預期：${version}`);
  return html.replace(VERSIONED_REF, (_m, attr: string, q: string, path: string) => {
    const target = path === 'fonts/fonts.css' ? 'fonts.css' : path;
    return `${attr}=${q}v/${version}/${target}${q}`;
  });
}

/**
 * fonts.css 放在 v/<版本>/ 底下，字型檔在 dist/fonts/<目錄>/：把 url(./<目錄>/<檔名>) 改成
 * url(../../fonts/<目錄>/<檔名>?v=<這個檔的內容雜湊>)。
 */
export function versionFontUrls(css: string, hashOf: (dir: string, file: string) => string): string {
  const out = css.replace(/url\(\.\/([\w-]+)\/([\w.-]+\.woff2?)\)/g, (_m, dir: string, file: string) => {
    const h = hashOf(dir, file);
    if (!/^[0-9a-f]{8,}$/.test(h)) throw new Error(`字型檔的雜湊不符預期：${dir}/${file}`);
    return `url(../../fonts/${dir}/${file}?v=${h})`;
  });
  if (/url\((?!\.\.\/\.\.\/fonts\/[\w-]+\/[\w.-]+\.woff2?\?v=[0-9a-f]+\))/.test(out)) throw new Error('fonts.css 裡有沒有加版本的字型網址');
  return out;
}

export interface VersionProblem {
  readonly file: string;
  readonly match: string;
}

/**
 * 建置後檢查：網站自己的 JS、CSS、資料檔都只能從版本資料夾裡引用，字型網址都帶內容雜湊。
 * files 是 dist/ 底下的 HTML、CSS、JS（相對 dist/ 的路徑 → 內容）。
 */
export function checkVersionedRefs(files: ReadonlyMap<string, string>, version: string): VersionProblem[] {
  const problems: VersionProblem[] = [];
  const prefix = `v/${version}/`;
  const add = (file: string, match: string): void => {
    problems.push({ file, match: match.slice(0, 100) });
  };
  for (const [file, text] of files) {
    if (file.endsWith('.html')) {
      for (const m of text.matchAll(/\b(?:href|src)=["']([^"']+)["']/g)) {
        const ref = m[1] as string;
        if (/\.(?:m?js|css|json)(?:[?#].*)?$/.test(ref) && !ref.startsWith(prefix)) add(file, m[0]);
      }
      continue;
    }
    if (!file.startsWith(prefix)) {
      // 網站自己的 JS 與 CSS 只能在版本資料夾裡（授權文件等 .txt 不受影響）
      if (/\.(?:m?js|css)$/.test(file)) add(file, '不在版本資料夾裡的 JS 或 CSS');
      continue;
    }
    const depth = file.slice(prefix.length).split('/').length - 1;
    if (file.endsWith('.css')) {
      for (const m of text.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
        const ref = m[1] as string;
        if (ref.startsWith('data:')) continue;
        const font = /^(?:\.\.\/){2}fonts\/[\w-]+\/[\w.-]+\.woff2?\?v=[0-9a-f]{8,}$/.test(ref) && depth === 0;
        if (!font && escapes(ref, depth)) add(file, m[0]);
      }
      continue;
    }
    // JS：相對的 import 不可跳出版本資料夾；不可用相對於網頁的路徑讀網站自己的檔案（例如 fetch('data/…')）
    for (const m of text.matchAll(/\b(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)) {
      if (escapes(m[1] as string, depth)) add(file, m[0]);
    }
    for (const m of text.matchAll(/["'`](?:\.\/)?(?:js|css|data|fonts)\/[\w./-]+\.(?:m?js|css|json|woff2?)["'`]/g)) add(file, m[0]);
  }
  return problems;
}

/** 從深度 depth 的檔案出發，相對網址 ref 會不會跳出版本資料夾。 */
function escapes(ref: string, depth: number): boolean {
  if (/^[a-z]+:|^\/|^#/.test(ref)) return true;
  let level = depth;
  for (const part of ref.split(/[?#]/)[0]!.split('/')) {
    if (part === '..') level--;
    else if (part !== '.' && part !== '') level++;
    if (level < 0) return true;
  }
  return false;
}
