// 建置前檢查 CSS 的結構：去掉註解與字串後，大括號必須成對；這個專案不用 CSS 巢狀，
// 所以一般的選擇器規則只能在最外層，或直接在 @media、@supports、@layer、@container 裡；
// @keyframes 裡只能有 from、to 與百分比。
//
// 為什麼要有：少一個結尾的 } 時，瀏覽器不會報錯，而是把後面所有規則當成巢狀規則，
// 結果整段樣式悄悄失效（第五版整合時就發生過：日常文件、古物、線索包的樣式全部沒套上）。

export interface CssProblem {
  readonly line: number;
  readonly message: string;
}

const GROUPING = new Set(['@media', '@supports', '@layer', '@container']);

/** 把註解與字串的內容換成空白（保留換行，行號才對得上）。 */
function blankOut(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i] as string;
    if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end < 0 ? text.length : end + 2;
      out += text.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== c && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1;
      out += c + text.slice(i + 1, j).replace(/[^\n]/g, ' ') + (text[j] === c ? c : '');
      i = text[j] === c ? j + 1 : j;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

interface Block {
  readonly kind: 'rule' | 'at';
  readonly name: string;
  readonly line: number;
}

export function checkCss(text: string): CssProblem[] {
  const src = blankOut(text);
  const problems: CssProblem[] = [];
  const stack: Block[] = [];
  let line = 1;
  let prelude = '';
  let preludeLine = 1;
  for (const c of src) {
    if (c === '\n') line++;
    if (c === '{') {
      const head = prelude.trim();
      const parent = stack[stack.length - 1];
      if (head.startsWith('@')) {
        const name = (/^@[\w-]+/.exec(head)?.[0] ?? '@').toLowerCase();
        if (parent && parent.kind === 'rule') problems.push({ line: preludeLine, message: `${name} 寫在選擇器規則「${parent.name}」裡面（這個專案不用 CSS 巢狀）` });
        stack.push({ kind: 'at', name, line: preludeLine });
      } else {
        if (parent && parent.kind === 'rule') {
          problems.push({ line: preludeLine, message: `規則「${head.slice(0, 60)}」寫在「${parent.name.slice(0, 60)}」（第 ${parent.line} 行）裡面：前面可能少了一個 }` });
        } else if (parent && parent.name === '@keyframes') {
          if (!/^(from|to|[\d.]+%)(\s*,\s*(from|to|[\d.]+%))*$/i.test(head)) problems.push({ line: preludeLine, message: `@keyframes 裡出現「${head.slice(0, 60)}」` });
        } else if (parent && !GROUPING.has(parent.name) && parent.name !== '@keyframes') {
          problems.push({ line: preludeLine, message: `規則「${head.slice(0, 60)}」寫在 ${parent.name} 裡面` });
        }
        stack.push({ kind: 'rule', name: head || '（空的選擇器）', line: preludeLine });
      }
      prelude = '';
    } else if (c === '}') {
      if (stack.length === 0) problems.push({ line, message: '多了一個 }' });
      else stack.pop();
      prelude = '';
    } else if (c === ';') {
      prelude = '';
    } else {
      if (!prelude.trim() && c.trim()) preludeLine = line;
      prelude += c;
    }
  }
  for (const b of stack) problems.push({ line: b.line, message: `「${b.name.slice(0, 60)}」沒有結尾的 }` });
  return problems;
}
