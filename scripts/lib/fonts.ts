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
