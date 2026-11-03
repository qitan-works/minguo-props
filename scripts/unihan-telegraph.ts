// 產生 src/data/telegraph.json：中文電碼（Unicode Unihan 資料庫的 kTaiwanTelegraph 欄位）。
//
// 用法：
//   pnpm data:telegraph                  # 從 unicode.org 下載、驗證、產生並寫入
//   pnpm data:check                      # 重新產生並與已提交的檔案比對（不寫入）
//   pnpm data:telegraph --zip 路徑/Unihan.zip   # 改用本機的 Unihan.zip（同樣驗證 SHA-256）
//
// 流程：下載固定版本的 Unihan.zip → 驗證 SHA-256 與大小 → 以 node:zlib 解壓
// Unihan_OtherMappings.txt → 取出 kTaiwanTelegraph → 輸出精簡 JSON。
//
// 雜湊來源：Unicode 17.0.0 的 Unihan.zip。這個雜湊是由 Ubuntu 套件庫的
// unicode-data_17.0.0.orig.tar.xz（原封收錄 unicode.org 的檔案；該 tarball 的
// SHA-256 e78e5fde…a30c 與 Debian 簽章的 unicode-data_17.0.0-2.dsc 相符）
// 中的 ucd/Unihan.zip 計算而得；CI 的「Unihan 資料驗證」工作流程會直接從
// unicode.org 下載並比對同一個雜湊。
//
// 資料授權：Unicode License v3（見 licenses/Unicode-License-v3.txt）。

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { buildTelegraphData, parseTaiwanTelegraph, serializeTelegraphData } from './lib/unihan.ts';
import { extractZipFile } from './lib/zip.ts';

const UNICODE_VERSION = '17.0.0';
const UNIHAN_URL = `https://www.unicode.org/Public/${UNICODE_VERSION}/ucd/Unihan.zip`;
const UNIHAN_SHA256 = 'f7a48b2b545acfaa77b2d607ae28747404ce02baefee16396c5d2d7a8ef34b5e';
const UNIHAN_SIZE = 8_518_517;
const MEMBER = 'Unihan_OtherMappings.txt';

const OUTPUT = fileURLToPath(new URL('../src/data/telegraph.json', import.meta.url));

async function download(url: string): Promise<Buffer> {
  console.error(`下載 ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`下載失敗：HTTP ${res.status} ${res.statusText}`);
  return Buffer.from(await res.arrayBuffer());
}

function verify(zip: Buffer): void {
  const actual = createHash('sha256').update(zip).digest('hex');
  if (zip.length !== UNIHAN_SIZE || actual !== UNIHAN_SHA256) {
    throw new Error(
      [
        'Unihan.zip 驗證失敗，拒絕使用。',
        `  預期：${UNIHAN_SHA256}（${UNIHAN_SIZE} 位元組）`,
        `  實際：${actual}（${zip.length} 位元組）`,
      ].join('\n'),
    );
  }
  console.error(`SHA-256 相符：${actual}`);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      zip: { type: 'string' },
      check: { type: 'boolean', default: false },
    },
  });

  const zip = values.zip ? await readFile(values.zip) : await download(UNIHAN_URL);
  verify(zip);

  const text = extractZipFile(zip, MEMBER).toString('utf8');
  const entries = parseTaiwanTelegraph(text);
  const data = buildTelegraphData(entries, {
    unicodeVersion: UNICODE_VERSION,
    source: UNIHAN_URL,
    sha256: UNIHAN_SHA256,
  });
  const json = serializeTelegraphData(data);

  if (values.check) {
    const committed = await readFile(OUTPUT, 'utf8').catch(() => '');
    if (committed !== json) {
      console.error(`${OUTPUT} 與重新產生的結果不一致，請執行 pnpm data:telegraph 並提交。`);
      process.exitCode = 1;
      return;
    }
    console.error(`${OUTPUT} 與官方資料一致（${data.count} 字）。`);
    return;
  }

  await writeFile(OUTPUT, json, 'utf8');
  console.error(`已寫入 ${OUTPUT}（${data.count} 字）。`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
