// 找出網站預設內容與填版素材用到的所有字，讓自行切子集的字型一定收得到這些字。
//
// 做法刻意寫得通用：掃描會放道具文字的原始碼目錄（見 TEXT_SOURCES），取出 TypeScript 的字串與
// 樣板字串內容，以及 HTML 的文字與屬性（不含註解），收集所有非 ASCII 字元。新增填版素材的檔案
// 或目錄裡的字，重新執行 pnpm fonts:generate 就會自動收進字型。程式註解裡的字不算（註解不會顯示）。
//
// TypeScript 的掃描用一個小型詞法分析器：認得單行／多行註解、單雙引號字串、樣板字串（含 ${} 內嵌
// 運算式，可巢狀）與正規表示式字面值（依前一個記號判斷「/」是除號還是正規表示式的開頭）。

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

/** 要掃描的原始碼（相對於專案根目錄）；目錄會遞迴掃描其中的 .ts 檔。 */
export const TEXT_SOURCES: readonly string[] = [
  'src/index.html',
  'src/data',
  'src/props',
  'src/lib',
  'src/render',
];

/** 前一個記號是這些字元時，接著的「/」是正規表示式的開頭。 */
const REGEX_AFTER = new Set('(,=:[!&|?{};+-*%<>~^'.split(''));
const REGEX_AFTER_WORDS = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'yield', 'await']);

/** 把 \uXXXX 與 \u{…} 跳脫序列換成實際的字（其他跳脫序列原樣保留）。 */
function unescapeUnicode(text: string): string {
  return text.replace(/\\u\{([0-9a-fA-F]+)\}|\\u([0-9a-fA-F]{4})/g, (_m, braced: string | undefined, four: string | undefined) =>
    String.fromCodePoint(Number.parseInt(braced ?? four ?? '0', 16)),
  );
}

/** 取出 TypeScript 原始碼裡所有字串與樣板字串的內容（\u 跳脫序列會換成實際的字）。 */
export function tsStringContents(source: string): string[] {
  const out: string[] = [];
  /** 樣板字串的巢狀層級：每層記錄 ${ 之後未配對的 { 數量。 */
  const templates: number[] = [];
  let i = 0;
  let prev = ''; // 前一個有意義的記號（字元或單字）
  const n = source.length;

  const readTemplate = (): void => {
    // 進入時 i 指向樣板字串內容的第一個字元（或從 } 回到樣板）
    const start = i;
    while (i < n) {
      const c = source[i];
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === '`') {
        out.push(source.slice(start, i));
        i++;
        prev = 'x';
        return;
      }
      if (c === '$' && source[i + 1] === '{') {
        out.push(source.slice(start, i));
        i += 2;
        templates.push(0);
        prev = '{';
        return;
      }
      i++;
    }
    out.push(source.slice(start, i));
  };

  while (i < n) {
    const c = source[i] as string;
    const next = source[i + 1];
    if (c === '/' && next === '/') {
      const end = source.indexOf('\n', i);
      i = end === -1 ? n : end;
      continue;
    }
    if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n && source[j] !== c && source[j] !== '\n') j += source[j] === '\\' ? 2 : 1;
      out.push(source.slice(i + 1, j));
      i = j + 1;
      prev = 'x';
      continue;
    }
    if (c === '`') {
      i++;
      readTemplate();
      continue;
    }
    if (c === '{' && templates.length > 0) {
      templates[templates.length - 1] = (templates.at(-1) as number) + 1;
      prev = '{';
      i++;
      continue;
    }
    if (c === '}' && templates.length > 0) {
      const depth = templates.at(-1) as number;
      if (depth === 0) {
        templates.pop();
        i++;
        readTemplate();
        continue;
      }
      templates[templates.length - 1] = depth - 1;
      prev = '}';
      i++;
      continue;
    }
    if (c === '/') {
      if (prev === '' || REGEX_AFTER.has(prev) || REGEX_AFTER_WORDS.has(prev)) {
        // 正規表示式字面值：跳到未跳脫、不在字元類別 [...] 裡的 /
        let j = i + 1;
        let inClass = false;
        while (j < n && source[j] !== '\n') {
          const d = source[j];
          if (d === '\\') {
            j += 2;
            continue;
          }
          if (d === '[') inClass = true;
          else if (d === ']') inClass = false;
          else if (d === '/' && !inClass) break;
          j++;
        }
        i = j + 1;
        while (i < n && /[a-z]/i.test(source[i] as string)) i++;
        prev = 'x';
        continue;
      }
      prev = '/';
      i++;
      continue;
    }
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[\w$]/.test(c)) {
      let j = i + 1;
      while (j < n && /[\w$]/.test(source[j] as string)) j++;
      const word = source.slice(i, j);
      prev = REGEX_AFTER_WORDS.has(word) ? word : 'x';
      i = j;
      continue;
    }
    prev = c === ')' || c === ']' ? 'x' : c;
    i++;
  }
  return out;
}

/** HTML 的文字與屬性值（去掉 <!-- --> 註解）。 */
export function htmlText(source: string): string {
  return source.replace(/<!--[\s\S]*?-->/g, '');
}

/** 字串裡的非 ASCII 字元（不含換行、BOM 與變體選擇符以外的控制字元）。 */
export function nonAsciiChars(text: string): Set<string> {
  const out = new Set<string>();
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    if (cp < 0x80 || cp === 0xfeff) continue;
    out.add(ch);
  }
  return out;
}

async function listTsFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name.endsWith('.ts')) out.push(path.join(entry.parentPath, entry.name));
  }
  return out.sort();
}

/** 掃描 TEXT_SOURCES，回傳用到的非 ASCII 字元（依碼位排序）。 */
export async function scanTextChars(root: string, sources: readonly string[] = TEXT_SOURCES): Promise<string[]> {
  const chars = new Set<string>();
  for (const source of sources) {
    const full = path.join(root, source);
    const files = source.endsWith('.ts') || source.endsWith('.html') ? [full] : await listTsFiles(full);
    for (const file of files) {
      const text = await readFile(file, 'utf8');
      const parts = file.endsWith('.html') ? [htmlText(text)] : tsStringContents(text);
      for (const part of parts) for (const ch of nonAsciiChars(unescapeUnicode(part))) chars.add(ch);
    }
  }
  return [...chars].sort((a, b) => (a.codePointAt(0) as number) - (b.codePointAt(0) as number));
}
