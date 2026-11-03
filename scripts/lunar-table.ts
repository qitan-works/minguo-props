// 產生 src/data/lunar.ts：1911～1949 年各農曆年的正月初一、各月天數與閏月，供報紙日期附「舊曆」使用。
//
// 用法：
//   pnpm data:lunar           # 下載、驗證、產生並寫入
//   pnpm data:lunar --check   # 重新產生並與已提交的檔案比對（不寫入）
//
// 資料來源：香港天文台《公曆與農曆日期對照表》（1901～2100，每年一個文字檔 T<年>c.txt）。
// 天文台網站在本專案的建置環境連不到，所以從 GitHub 上原樣收錄這些檔案的 xwjdsh/lunar 倉庫
// 取得（釘選 commit），並驗證 40 個檔案串接後的 SHA-256。維護者可以到天文台網站
// （https://www.hko.gov.hk/tc/gts/time/conversion.htm）逐年對照。
//
// 為什麼不用瀏覽器或 ICU 內建的農曆：ICU 依現代天文計算，1917 年與 1922 年的閏月位置
// 和當年實際頒行的曆書（天文台表列的閏二月、閏五月）不同，相差的日子共 118 天。

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { buildLunarYears, parseHkoYear, serializeLunarYears } from './lib/lunar-hko.ts';

const COMMIT = '9bbf91a8c27a29d6d81cfe1529af94a691ebffeb';
const BASE = `https://raw.githubusercontent.com/xwjdsh/lunar/${COMMIT}/files`;
const FIRST = 1911;
const LAST = 1950;
/** T1911c.txt～T1950c.txt 依序串接後的 SHA-256。 */
const SHA256 = 'ef425d85ef6b68a303d2dbca7600d20b2ff9747e211ac08dbddabf73e066aac8';
const SOURCE = `香港天文台《公曆與農曆日期對照表》T1911c.txt～T1950c.txt（取自 github.com/xwjdsh/lunar@${COMMIT.slice(0, 7)}）`;

const OUTPUT = fileURLToPath(new URL('../src/data/lunar.ts', import.meta.url));

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { check: { type: 'boolean', default: false } } });
  const texts: string[] = [];
  for (let y = FIRST; y <= LAST; y++) {
    const url = `${BASE}/T${y}c.txt`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`下載失敗：${url}（HTTP ${res.status}）`);
    texts.push(await res.text());
  }
  const hash = createHash('sha256');
  for (const t of texts) hash.update(t);
  const actual = hash.digest('hex');
  if (actual !== SHA256) {
    throw new Error(`對照表的 SHA-256 不符，拒絕使用。\n  預期：${SHA256}\n  實際：${actual}`);
  }
  const years = buildLunarYears(texts.flatMap(parseHkoYear)).filter((y) => y.year >= FIRST && y.year <= LAST - 1);
  if (years.length !== LAST - FIRST) throw new Error(`年度數不對：${years.length}`);
  const output = serializeLunarYears(years, SOURCE);
  if (values.check) {
    const committed = await readFile(OUTPUT, 'utf8');
    if (committed !== output) throw new Error('src/data/lunar.ts 與重新產生的結果不同，請執行 pnpm data:lunar');
    console.log(`src/data/lunar.ts 與來源一致（${years.length} 個農曆年）`);
    return;
  }
  await writeFile(OUTPUT, output);
  console.log(`已寫入 src/data/lunar.ts（${years.length} 個農曆年）`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
