// 字型 CSS：改寫 Fontsource 的 @font-face，以及為自行產生的字型（fonts/manifest.json）寫 @font-face。

export interface FontFaceFile {
  readonly file: string;
  readonly unicodeRange: string | null;
}

/**
 * 自行產生的字型的 @font-face（每個檔一條規則，路徑一律是 ./<dir>/<檔名> 的相對網址）。
 * 每套字型只有一種字重，font-weight 宣告成 100～900 的範圍，粗體時直接用字型本身的筆畫，
 * 不讓瀏覽器另外合成假粗體（中文字合成粗體容易糊成一團）。
 */
export function generatedFontCss(family: string, dir: string, format: 'woff2' | 'woff', files: readonly FontFaceFile[]): string {
  if (!/^[\w ]+$/.test(family)) throw new Error(`字型家族名稱不符預期：${family}`);
  if (!/^[\w-]+$/.test(dir)) throw new Error(`字型目錄名稱不符預期：${dir}`);
  return files
    .map((f) => {
      if (!/^[\w.-]+\.woff2?$/.test(f.file)) throw new Error(`字型檔名不符預期：${f.file}`);
      if (f.unicodeRange !== null && !/^U\+[0-9a-f]+(?:-[0-9a-f]+)?(?:,U\+[0-9a-f]+(?:-[0-9a-f]+)?)*$/.test(f.unicodeRange)) {
        throw new Error(`unicode-range 格式不符預期：${f.file}`);
      }
      return [
        '@font-face {',
        `  font-family: '${family}';`,
        '  font-style: normal;',
        '  font-display: swap;',
        '  font-weight: 100 900;',
        `  src: url(./${dir}/${f.file}) format('${format}');`,
        ...(f.unicodeRange ? [`  unicode-range: ${f.unicodeRange};`] : []),
        '}',
      ].join('\n');
    })
    .join('\n');
}

// 改寫 Fontsource 的 @font-face CSS：只保留 woff2，並把路徑指到 dist/fonts/<dir>/。

export function rewriteFontCss(css: string, dir: string): { css: string; files: string[] } {
  const files = new Set<string>();
  const out = css
    // 移除舊式 woff 備援（所有現代瀏覽器都支援 woff2）
    .replace(/,\s*url\(\.\/files\/[^)]+\.woff\)\s*format\('woff'\)/g, '')
    .replace(/url\(\.\/files\/([^)]+\.woff2)\)/g, (_m, file: string) => {
      if (!/^[\w.-]+$/.test(file)) throw new Error(`字型檔名不符預期：${file}`);
      files.add(file);
      return `url(./${dir}/${file})`;
    });
  if (/url\((?!\.\/[\w-]+\/[\w.-]+\.woff2\))/.test(out)) throw new Error('字型 CSS 中有未處理的路徑');
  return { css: out, files: [...files] };
}
