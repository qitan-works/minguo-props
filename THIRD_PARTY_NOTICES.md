# 第三方授權聲明（THIRD_PARTY_NOTICES）

民國道具舖的程式碼以 MIT 授權釋出（見 `LICENSE`，著作權人：奇譚工坊（qitan-works））。
建置後的網站（`dist/`）另外包含下列第三方的字型與資料，各自依其授權條款散布。

## 字型

網站自行提供字型，不連線到 Google Fonts 或任何字型服務。字型有兩種來源，建置時都會驗證實際複製到
`dist/fonts/` 的字型檔（依檔名排序後串接）的 SHA-256 與 `src/fonts.ts` 登記的值相符，不符就中止建置：

1. [Fontsource](https://fontsource.org/) 發布在 npm 的套件（SIL OFL 1.1）；
2. 本專案自行處理、提交在 `fonts/` 的字型：王漢宗自由字型（GPL-2.0-or-later）、清松手寫體（OFL）、
   辰宇落雁體（OFL 1.1），由 `pnpm fonts:generate` 從釘選的原始檔產生（見下方「自行處理的字型」）。

字型檔與網站程式碼是各自獨立的檔案：網站只透過 CSS 的 `@font-face` 載入字型。字型依各自的授權提供，
網站程式碼仍以 MIT 授權釋出，不因字型的授權而改變。

### Fontsource 套件

字型套件只在建置時讀取，版本釘選在 `package.json` 與 `pnpm-lock.yaml`，建置時只複製 woff2 檔到 `dist/fonts/`。

| 字型 | 來源套件（版本） | 上游專案與著作權聲明 | 授權 |
| --- | --- | --- | --- |
| 思源宋體 Noto Serif TC（可變字重） | `@fontsource-variable/noto-serif-tc` 5.3.1 | [notofonts/noto-cjk](https://github.com/notofonts/noto-cjk)；字型內聲明：(c) 2017-2024 Adobe (http://www.adobe.com/). | SIL OFL 1.1，全文 [`licenses/OFL-Noto-Serif-TC.txt`](licenses/OFL-Noto-Serif-TC.txt) |
| 仙人掌明體 Cactus Classical Serif | `@fontsource/cactus-classical-serif` 5.3.1 | [MoonlitOwen/CactusSerif](https://github.com/MoonlitOwen/CactusSerif)；Copyright 2024 The Caactus Classical Serif Project Authors（原文如此） | SIL OFL 1.1，全文 [`licenses/OFL-Cactus-Classical-Serif.txt`](licenses/OFL-Cactus-Classical-Serif.txt) |
| 霞鶩文楷 TC（LXGW WenKai TC）Regular | `@fontsource/lxgw-wenkai-tc` 5.3.1 | [lxgw/LxgwWenkaiTC](https://github.com/lxgw/LxgwWenkaiTC)；Copyright 2024 The LXGW WenKai Project Authors | SIL OFL 1.1，全文 [`licenses/OFL-LXGW-WenKai-TC.txt`](licenses/OFL-LXGW-WenKai-TC.txt) |
| 芫荽 Iansui | `@fontsource/iansui` 5.3.1 | [ButTaiwan/iansui](https://github.com/ButTaiwan/iansui)；Copyright 2022 The Iansui Project Authors | SIL OFL 1.1，全文 [`licenses/OFL-Iansui.txt`](licenses/OFL-Iansui.txt) |
| jf open 粉圓 Huninn | `@fontsource/huninn` 5.3.1 | [justfont/Huninn](https://github.com/justfont/Huninn)；Copyright 2025 The Huninn Project Authors | SIL OFL 1.1，全文 [`licenses/OFL-Huninn.txt`](licenses/OFL-Huninn.txt) |

各 OFL 全文取自 [google/fonts](https://github.com/google/fonts) 的 `ofl/<字型>/OFL.txt`（芫荽的檔案開頭的位元組順序記號已移除，其餘原文照錄）；建置時也會把 Fontsource 套件附帶的 `LICENSE` 一併複製到
`dist/fonts/<字型>/LICENSE.txt`。依 OFL 規定，字型不得單獨販售；本專案未修改字型內容，
只使用 Fontsource 依 Google Fonts 切分好的 woff2 分片。

### 自行處理的字型（`fonts/`）

`pnpm fonts:generate`（[`scripts/fonts-generate.ts`](scripts/fonts-generate.ts)）的流程：

1. 下載 [`scripts/lib/font-sources.ts`](scripts/lib/font-sources.ts) 釘選的原始檔（網址、大小、SHA-256 都寫死），
   驗證不符就中止；王漢宗字型的 tar.gz 以本專案自己寫的 tar 讀取器（[`scripts/lib/tar.ts`](scripts/lib/tar.ts)，只用 `node:zlib`）解開。
2. 字集：Big5 常用字 5,401 字＋預設內容與填版素材用到的所有字（掃描原始碼的字串）＋全形標點、直排標點與報紙常用符號。
3. 切子集：以 HarfBuzz 的子集化工具（開發依賴 `harfbuzzjs` 1.6.4 附的 `hb-subset.wasm`，MIT 授權）切出子集，
   保留 name 表的全部紀錄；第 0 片是預設與填版文字用到的字，其餘的字依 Unicode 碼位平均切成每片約 200 KB；
   再以開發依賴 `woff2-encoder` 2.0.0（MIT 授權，WASM 版的 Google woff2 編碼器）轉成 WOFF2。
4. 原封不動的字型（辰宇落雁體）只以本專案自己寫的 WOFF 1.0 編碼器（[`scripts/lib/woff.ts`](scripts/lib/woff.ts)，只用 `node:zlib`）包裝。
5. 寫出 `fonts/manifest.json`：每個檔的大小、SHA-256、`unicode-range`，以及原字型缺的字。

輸出是決定性的。`pnpm fonts:check` 會重新下載、重新產生到暫存目錄，逐位元組比對提交的 `fonts/`；
CI 的「字型驗證」工作流程（[`.github/workflows/fonts.yml`](.github/workflows/fonts.yml)）在字型相關檔案變動時執行它。
兩個開發依賴只在產生字型時使用，不會出現在網站裡。建置時每套字型的目錄還會附上授權全文（`LICENSE.txt`）
與來源、修改說明（`SOURCE.txt`）：`dist/fonts/<字型>/`。

#### 王漢宗自由字型（GPL-2.0-or-later）

- 來源：王漢宗自由字型 1.3.0 的原始 tarball（Google Code 封存）
  <https://storage.googleapis.com/google-code-archive-downloads/v2/code.google.com/wangfonts/wangfonts-1.3.0.tar.gz>，
  134,133,251 位元組，SHA-256 `76449c671ba9f7e56518b3db5810c5033a3ae9fef386a6c8b6eb5e15591a53e7`
- 上游專案：<https://code.google.com/archive/p/wangfonts/>
- 著作權：`(C)Copyright Dr. Hann-Tzong Wang, 2002-2004.`（字型 name 表的著作權欄位，原文照錄）
- 授權：字型 name 表的授權說明（nameID 13）原文為「This program is free software; you can redistribute it and/or modify it
  under the terms of the GNU General Public License as published by the Free Software Foundation; either version 2 of the License,
  or any later version.」，即 GPL-2.0-or-later。tarball 裡沒有附授權檔，GPL 第 2 版全文見
  [`licenses/GPL-2.0.txt`](licenses/GPL-2.0.txt)（取自 [spdx/license-list-data](https://github.com/spdx/license-list-data)
  commit `d46e94e2c78ceede1cfc63cfa0396472d2798d4c`（v3.27.0）的 `text/GPL-2.0-only.txt`，與同版的 `GPL-2.0-or-later.txt` 內容相同；
  SHA-256 `aaf135472f81c5b4a0dca9367e5bb5e9750032b5bebe5442b36e4c0a47430df3`）。
- 字型 name 表另有「HanWangMingMedium is a registered trademark of HtWang Graphics Laboratory」等商標聲明，原樣保留；
  本專案只用字型名稱指稱字型本身。

| 字型 | tarball 裡的原始檔（SHA-256） | 輸出 |
| --- | --- | --- |
| 王漢宗中明體 | `wangfonts/wt002.ttf`（`897efc92ab47e64ece39773710a3802bc78d88b5171da1641dd1de50100efbcf`） | 7 個 WOFF2，1.41 MB |
| 王漢宗特明體 | `wangfonts/wt004.ttf`（`33ade736c8df39fe207a5b7dddbf2c3c6ee1f6283eaed10297b2d02e2a247a6e`） | 8 個 WOFF2，1.73 MB |
| 王漢宗超明體 | `wangfonts/wt005.ttf`（`b45348a41f2fed13757a0b0983685f04dabc06fedbabce334cfb8e6694274ccb`） | 7 個 WOFF2，1.57 MB |
| 王漢宗特黑體 | `wangfonts/wt014.ttf`（`716ae1f44b1853d1c7cfccf97311c7c3712850f83de0e733e766433a4f7d709f`） | 6 個 WOFF2，1.13 MB |
| 王漢宗中隸書 | `wangfonts/wt021.ttf`（`c33a5244e6c1dae686f9828052708516b589f12480cc1b04b46497e4892d3fe6`） | 8 個 WOFF2，1.81 MB |
| 王漢宗中仿宋 | `wangfonts/wt024.ttf`（`f2e2400c553b3cf17f1798c4239f1dce5fbbd753cb019db01dbdfedd3eaecbb2`） | 9 個 WOFF2，1.96 MB |
| 王漢宗顏楷體 | `wangfonts/wt064.ttf`（`5567cc7ae20d11fd972a83daa0d364baba6867014a25a91b4aedcb0dbbdf1e55`） | 8 個 WOFF2，1.82 MB |
| 王漢宗中行書 | `wangfonts/wt071.ttf`（`50a8c5f2c8cfe6d218ec2041deb1902add56882348a86c518eaeab685678c0fe`） | 9 個 WOFF2，2.02 MB |
| 王漢宗鋼筆行楷 | `wangfonts/wthc06.ttf`（`9bdc5780b43ca8121a68af7fcb98ece77acc31988ee40bb48f045d3def1035f2`） | 6 個 WOFF2，1.33 MB |

GPL 的處理方式：

- 這些字型是獨立的檔案，依 GPL-2.0-or-later 提供；網站程式碼仍以 MIT 授權釋出。
- 切過子集的字型是修改版，同樣以 GPL-2.0-or-later 提供：
  - 保留原有的著作權與授權聲明（name 表的全部紀錄原樣保留）；
  - 註明修改：切出子集、依 Unicode 範圍分片並轉成 WOFF2。修改聲明與日期寫在每個字型檔 name 表的說明欄（nameID 10，
    附在原說明之後），也寫在 `dist/fonts/<字型>/SOURCE.txt`；
  - 原始字型就是上面的 tarball（網址與 SHA-256 見上）。字型檔本身就是可直接修改的原始形式，沒有另外的「原始碼」。
- [`licenses/`](licenses/) 附有 GPL 第 2 版全文（[`licenses/GPL-2.0.txt`](licenses/GPL-2.0.txt)），建置時也複製到每套字型的
  `dist/fonts/<字型>/LICENSE.txt`。
- 列印成 PDF 時，瀏覽器會把用到的字（字型子集）嵌入 PDF；這是供個人列印使用的道具。

#### 清松手寫體（作者聲明為 SIL Open Font License，本專案視為 OFL 1.1）

- 來源：[jasonhandwriting/JasonHandwriting](https://github.com/jasonhandwriting/JasonHandwriting)
  commit `e488583c07077850aa4a2a6280baa20374cccde2`，經 `raw.githubusercontent.com` 下載
- 作者：游清松（Jason, Yu Ching Sung）。作者沒有載明 OFL 的版本，儲存庫也沒有授權檔。作者的原文照錄如下：
  - README：「JasonHandwriting 1/2/3/4/5/6/7/8/9 are created by Jason(Yu Ching Sung) under SIL Open Font License.」；
    同一份 README 也寫著「個人/企業使用100%完全免費！」「任何型式的商用，也100%完全免費！」
  - 字型 name 表的著作權欄位：
    「© Copyright 2021, JasonHandwriting5 is created by Jason(Yu Ching Sung) under SIL Open Font License.」、
    「© Copyright 2023, JasonHandwriting7 is created by Jason(Yu Ching Sung) under SIL Open Font License.」、
    「© Copyright 2024, JasonHandwriting8 is created by Jason(Yu Ching Sung) under SIL Open Font License.」
- 本專案把它當作 SIL OFL 1.1（目前唯一通行的版本）遵守，全文與作者原文見
  [`licenses/OFL-JasonHandwriting.txt`](licenses/OFL-JasonHandwriting.txt)。作者沒有宣告保留字型名稱。
- 切過子集，屬 OFL 的修改版（Modified Version），同樣以 OFL 提供；name 表全部保留，說明欄（nameID 10）加註修改聲明。
- 這三套字型沒有直排用的 `vert` 功能，也沒有 Unicode 的直排標點字形，所以「，」「。」「「」」「（」等
  瀏覽器能換成直排形式的標點刻意不收進子集，交給備援字型（霞鶩文楷）顯示，直排時括號才會轉向、句讀才會擺對位置。

| 字型 | 原始檔（大小、SHA-256） | 輸出 |
| --- | --- | --- |
| 清松手寫體5（行楷） | `JasonHandwriting5.ttf`（5,923,696 位元組，`2f0a54b56a79961e44f38d95ea293d113362e6eff438a2c351e60390d60f7960`） | 12 個 WOFF2，2.66 MB |
| 清松手寫體7（飄逸） | `JasonHandwriting7.ttf`（9,254,640 位元組，`415a3b569ae977de87377a892f250e53c8d12139e0f47ef7cadd8a8a359c288e`） | 12 個 WOFF2，2.63 MB |
| 清松手寫體8（隨性） | `JasonHandwriting8.ttf`（8,030,664 位元組，`1437de4a5fee29a5c6b43450df56e734af9cddb5b3a68d236cf5f42be178c93f`） | 11 個 WOFF2，2.48 MB |

#### 辰宇落雁體 Thin（SIL OFL 1.1，保留字型名稱「辰宇落雁」「Chenyuluoyan」）

- 來源：[Chenyu-otf/chenyuluoyan_thin](https://github.com/Chenyu-otf/chenyuluoyan_thin)
  commit `6e36815b0bec9f4f948298698d00b27a5f0b65c1` 的 `ChenYuluoyan-2.0-Thin.ttf`（版本 2.100），
  9,522,140 位元組，SHA-256 `1289e42a6d1ec995d0cb23aee89efc69fc95749fbd54a610057a3e992dc453db`
- 著作權：`Copyright (c) 2022, Wang, Li-Yu & Liu, Wei-Chen.`（字型 name 表）；書寫：劉韋辰，後製：王立宇
- 授權：上游的 `license.txt` 原樣照錄為 [`licenses/OFL-Chenyuluoyan.txt`](licenses/OFL-Chenyuluoyan.txt)
  （SHA-256 `393732512d2658fa5841dfaad325e002ccb6755b9037a818500434c0a5c4a6d1`），保留字型名稱為「辰宇落雁」與「Chenyuluoyan」。
- **原封不動提供**：不切子集、不改名，只包成 WOFF 1.0，沒有 WOFF 中繼資料，輸出 1 個檔 5.35 MB
  （`fonts/chenyu-luoyan/ChenYuluoyan-2.0-Thin.woff`）。依 OFL-FAQ 1.1-update7（2023 年 11 月）第 2.2.1 題：
  「You are allowed to create, use and distribute a WOFF version of an OFL font without changing the font name, but only if the original
  font data remains unchanged except for WOFF compression, and WOFF-specific metadata is either omitted altogether or present and
  includes, unaltered, the contents of all equivalent metadata in the original font.」這樣就不算修改版，可以沿用原名。
  同一份 FAQ 第 2.6 題說明切子集屬於修改；修改版不得使用保留字型名稱，所以本專案不切子集。
- 怎麼確認沒有修改：WOFF 編碼器只把每個表以 zlib 壓縮（壓縮沒有變小的表原樣存放），表的順序與檢查碼照抄原檔；
  測試會解碼提交的 WOFF，逐表比對長度、檢查碼與 SHA-256（記錄在 `fonts/manifest.json`），
  並確認解回來的整個字型檔與原檔的 SHA-256 相同。
- 代價：沒有 `unicode-range` 分片，選用這套字型時要整個下載 5.35 MB；Big5 常用字缺 46 字（以備援字型顯示）。

## 查過但不收的字型

- 王漢宗自由字型的其他款式：只收上面九款。勘亭流是戲曲海報字，綜藝、疊圓、海報、動物是現代美術字，
  不合報紙內文、公文與書信的用途；WCL 系列等其餘款式也不收。
- 清松手寫體 2（秀氣）：缺 452 個 Big5 常用字，也缺預設與填版文字用到的「篠」「籀」「糶」「銑」等字；
  其他款（1 圓潤、3 呆萌、4 POP、6 Q萌、9 文青）是現代可愛風格，不像民國時期的手跡。
- 內海字體（[max32002/naikaifont](https://github.com/max32002/naikaifont)，OFL，查閱 commit `7baa43a6adad4a82eab6fd27c9612b316f69d7c9`）
  與小賴字體（[lxgw/kose-font](https://github.com/lxgw/kose-font)，OFL，查閱 commit `172d9dbe94ade82b5316e0989e3aa286b7041baf`）：
  兩者都衍生自日本的瀨戶字體，是現代、圓潤可愛的麥克筆手寫風格，不像 1910～40 年代的印刷或手跡；
  原檔也很大（內海字體 Regular 26 MB、小賴字體 25 MB）。內海字體的 README 自述從多套字型拼補（「有一些字補的超級醜的」），
  風格不一；小賴字體以簡體中文補字為主。
- 源樣明體：只有 16 MB 的 OTF 與第三方個人維護的切片套件，這一版沒有收。
- 柳建毛草、志莽行書：只有簡體中文，缺「霧」「電」「報」「總」「聲」等繁體字。
- Chiron Sung HK：Fontsource 套件裡是未壓縮的 TTF、全套 16.8 MB，且為香港字形。

## 中文電碼資料（Unicode Unihan 資料庫）

- 檔案：`src/data/telegraph.json`（中文電碼）與 `src/data/big5-level1.json`（Big5 常用字，用來檢查字型字數），
  皆由 `scripts/unihan-telegraph.ts` 產生
- 來源：Unicode 17.0.0 的 `Unihan.zip`（<https://www.unicode.org/Public/17.0.0/ucd/Unihan.zip>，
  SHA-256 `f7a48b2b545acfaa77b2d607ae28747404ce02baefee16396c5d2d7a8ef34b5e`）中
  `Unihan_OtherMappings.txt` 的 `kTaiwanTelegraph` 與 `kBigFive` 欄位，以及 `Unihan_Variants.txt` 的異體字欄位
- 著作權：© 2025 Unicode®, Inc.
- 授權：Unicode License v3（SPDX：`Unicode-3.0`），全文見 [`licenses/Unicode-License-v3.txt`](licenses/Unicode-License-v3.txt)
- 使用條款：<https://www.unicode.org/terms_of_use.html>

Unicode and the Unicode Logo are registered trademarks of Unicode, Inc. in the U.S. and other countries.
本專案與 Unicode, Inc. 沒有任何關係，也未獲其背書。

## 其他

- 紙張狀況（泛黃、紙紋、紙邊、破洞、浸水、摺痕、揉皺、斑點、霉斑等）與裝飾（血跡、戳記、怪符號等）全部以 CSS、
  SVG 與程式即時產生，沒有使用任何圖片素材；怪符號是程式隨機組合的原創圖形，不取材自任何現有作品。
- 報紙填版素材（`src/data/fillers.ts` 與 `src/lib/newspaper/fillers.ts`）全部為本專案原創、虛構，
  不含真實報紙文字、商號、藥名、品牌或人名，隨程式碼以 MIT 授權釋出。
- 執行期沒有任何第三方 JavaScript 函式庫。
