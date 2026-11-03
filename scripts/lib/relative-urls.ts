// 檢查網站檔案裡沒有以「/」開頭的網址。網站部署在 GitHub Pages 的子路徑
// （https://qitan-works.github.io/minguo-props/）下，「/css/app.css」這種根路徑會指到
// qitan-works.github.io/ 本身而找不到檔案；「//主機/…」則會連到別的網站。所以一律要用相對路徑。

export interface RootUrlRef {
  /** 第幾行（1 起算）。 */
  readonly line: number;
  /** 符合的那一段文字。 */
  readonly match: string;
}

export type CheckedKind = 'html' | 'css' | 'js';

// 只在「會被當成網址」的位置比對，所以註解、正規表示式與一般字串裡的斜線不會誤判。
const PATTERNS: Readonly<Record<CheckedKind, readonly RegExp[]>> = {
  html: [/\b(?:href|src|srcset|action|formaction|poster|data|content)\s*=\s*["']?\s*\//gi, /url\(\s*["']?\//gi],
  css: [/url\(\s*["']?\//gi, /@import\s+["']\//gi],
  js: [
    /\b(?:fetch|import|Worker|SharedWorker|EventSource|WebSocket)\s*\(\s*["'`]\//g,
    /\bnew\s+URL\s*\(\s*["'`]\//g,
    /\b(?:from|import)\s*["']\//g,
    /\.(?:href|src|action)\s*=\s*["'`]\//g,
    /\bsetAttribute\(\s*["'](?:href|src|action)["']\s*,\s*["'`]\//g,
    /\b(?:href|src)\s*:\s*["'`]\//g,
    /url\(\s*["']?\//gi,
  ],
};

/** 依副檔名決定要用哪一組規則；其他檔案不檢查。 */
export function kindOf(file: string): CheckedKind | null {
  if (/\.html?$/i.test(file)) return 'html';
  if (/\.css$/i.test(file)) return 'css';
  if (/\.(?:[cm]?js|ts)$/i.test(file)) return 'js';
  return null;
}

/** 找出文字裡所有以「/」開頭的網址（含「//主機」）。 */
export function findRootUrls(text: string, kind: CheckedKind): RootUrlRef[] {
  const found: RootUrlRef[] = [];
  for (const pattern of PATTERNS[kind]) {
    for (const m of text.matchAll(pattern)) {
      const at = m.index ?? 0;
      const line = text.slice(0, at).split('\n').length;
      const end = text.indexOf('\n', at);
      found.push({ line, match: text.slice(at, end === -1 ? undefined : Math.min(end, at + 80)).trim() });
    }
  }
  return found.sort((a, b) => a.line - b.line);
}
