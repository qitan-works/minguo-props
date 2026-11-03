# 第三方授權聲明（THIRD_PARTY_NOTICES）

民國道具舖的程式碼以 MIT 授權釋出（見 `LICENSE`，著作權人：奇譚工坊（qitan-works））。
建置後的網站（`dist/`）另外包含下列第三方的字型與資料，各自依其授權條款散布。

## 字型

字型檔取自 [Fontsource](https://fontsource.org/) 發布在 npm 的套件（只在建置時讀取，
版本釘選在 `package.json` 與 `pnpm-lock.yaml`），建置時只複製 woff2 檔到 `dist/fonts/`，
網站自行提供字型，不連線到 Google Fonts 或任何字型服務。建置時會驗證實際複製的 woff2 檔的 SHA-256
（登記在 `src/fonts.ts`），不符就中止建置。

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
