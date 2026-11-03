// 本機預覽用的極簡靜態伺服器：只綁定 127.0.0.1，只提供 dist/ 裡的檔案。
// 用法：pnpm build && pnpm serve（預設 http://127.0.0.1:4173/，可用 PORT 環境變數改埠號）
// 設 BASE=/minguo-props/ 可模擬 GitHub Pages 的子路徑：網站只在那個路徑下提供，其他路徑一律 404，
// 用來確認所有資源都是相對路徑。

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const port = Number(process.env['PORT'] ?? 4173);
const base = process.env['BASE'] ?? '/';
if (!/^\/(?:[A-Za-z0-9._-]+\/)*$/.test(base)) {
  throw new Error(`BASE 必須以「/」開頭與結尾，例如 /minguo-props/（目前是 ${base}）`);
}

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const server = createServer((req, res) => {
  void (async () => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (base !== '/' && url.pathname === base.slice(0, -1)) {
        // 和 GitHub Pages 一樣，少了結尾斜線就轉址，相對路徑才會從正確的資料夾算起
        res.writeHead(301, { location: base }).end();
        return;
      }
      if (!url.pathname.startsWith(base)) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('找不到檔案');
        return;
      }
      let rel = decodeURIComponent(url.pathname.slice(base.length - 1));
      if (rel.endsWith('/')) rel += 'index.html';
      const file = path.resolve(dist, `.${rel}`);
      if (!file.startsWith(dist)) {
        res.writeHead(403).end();
        return;
      }
      const info = await stat(file).catch(() => null);
      if (!info?.isFile()) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('找不到檔案');
        return;
      }
      res.writeHead(200, {
        'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
        'content-length': info.size,
        'cache-control': 'no-cache',
        'x-content-type-options': 'nosniff',
      });
      createReadStream(file).pipe(res);
    } catch {
      res.writeHead(400).end();
    }
  })();
});

server.listen(port, '127.0.0.1', () => {
  console.log(`民國道具舖：http://127.0.0.1:${port}${base}`);
});
