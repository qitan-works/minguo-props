// 可選字型清單（建置、介面與測試共用）。
//
// 只收 SIL Open Font License 1.1 的字型，來源一律是 Fontsource 發布在 npm 的套件（依 Google Fonts
// 以 unicode-range 切好的 woff2 分片）。版本釘在 package.json 與 pnpm-lock.yaml；建置時另外驗證
// 實際複製的 woff2 檔（依檔名排序後串接）的 SHA-256 與下面的值相符，不符就中止建置。
// 網站自己提供字型；@font-face 依 unicode-range 分片，只有選用的字型、用到的字才會下載。
//
// 繁體中文字數：以 woff2 檔的 cmap 實際檢查（見 test/font-coverage.test.ts）。
// 每套都涵蓋 Big5 常用字 5,401 字，只缺下面 missingBig5 列出的字。這些字經比對教育部
// 〈常用國字標準字體表〉4,808 字（ButTaiwan/cjktables 的 edu_standard_1.txt）都不在常用字內，
// 唯一例外是「甽」：Google Fonts 的切片沒有收這個字，所以五套都缺，瀏覽器會改用系統字型顯示。

export type FontRole = 'title' | 'body' | 'hand';

export interface FontDef {
  readonly id: string;
  readonly label: string;
  /** CSS 字型家族名稱（與 Fontsource 的 @font-face 一致）。 */
  readonly family: string;
  /** 缺字時的備援：印刷字（serif）或手寫字（hand）。 */
  readonly fallback: 'serif' | 'hand';
  readonly pkg: string;
  readonly version: string;
  /** 套件裡要用的 CSS 檔（含 unicode-range 分片）。 */
  readonly css: string;
  /** 輸出目錄 dist/fonts/<dir>。 */
  readonly dir: string;
  /** licenses/ 底下的授權全文。 */
  readonly license: string;
  /** 授權檔第一行的著作權聲明。 */
  readonly copyright: string;
  readonly upstream: string;
  /** 依檔名排序後串接全部 woff2 的 SHA-256。 */
  readonly sha256: string;
  readonly woff2Count: number;
  /** 不在字型內的 Big5 常用字（見檔案開頭說明）。 */
  readonly missingBig5: string;
}

const GOOGLE_SLICE_GAPS = '杗阬姅甽涊偭梡詨跦穋歜毚縿燸霤鶸觼鑤';

export const FONTS: readonly FontDef[] = [
  {
    id: 'noto-serif',
    label: '思源宋體（Noto Serif TC）',
    family: 'Noto Serif TC Variable',
    fallback: 'serif',
    pkg: '@fontsource-variable/noto-serif-tc',
    version: '5.3.1',
    css: 'index.css',
    dir: 'noto-serif-tc',
    license: 'OFL-Noto-Serif-TC.txt',
    // 授權檔（google/fonts）的聲明；字型檔內另有「(c) 2017-2024 Adobe (http://www.adobe.com/).」
    copyright: 'Copyright 2012 Google Inc. All Rights Reserved.',
    upstream: 'https://github.com/notofonts/noto-cjk',
    sha256: 'f8ea551e7a9b72cb43424903192182992e5ff07ab6dcc0f539b277137faf9037',
    woff2Count: 108,
    missingBig5: GOOGLE_SLICE_GAPS,
  },
  {
    id: 'cactus',
    label: '仙人掌明體（Cactus Classical Serif）',
    family: 'Cactus Classical Serif',
    fallback: 'serif',
    pkg: '@fontsource/cactus-classical-serif',
    version: '5.3.1',
    css: '400.css',
    dir: 'cactus-classical-serif',
    license: 'OFL-Cactus-Classical-Serif.txt',
    copyright: 'Copyright 2024 The Caactus Classical Serif Project Authors (https://github.com/MoonlitOwen/CactusSerif)',
    upstream: 'https://github.com/MoonlitOwen/CactusSerif',
    sha256: 'e1484bb9d00995e8f418cc77fe27c909bf97479c87a5a362d9db4bf1044ab895',
    woff2Count: 109,
    missingBig5: GOOGLE_SLICE_GAPS,
  },
  {
    id: 'lxgw',
    label: '霞鶩文楷 TC（LXGW WenKai TC）',
    family: 'LXGW WenKai TC',
    fallback: 'hand',
    pkg: '@fontsource/lxgw-wenkai-tc',
    version: '5.3.1',
    css: '400.css',
    dir: 'lxgw-wenkai-tc',
    license: 'OFL-LXGW-WenKai-TC.txt',
    copyright: 'Copyright 2024 The LXGW WenKai Project Authors (https://github.com/lxgw/LxgwWenkaiTC)',
    upstream: 'https://github.com/lxgw/LxgwWenkaiTC',
    sha256: '5ffc1edb443218d1e503002760c73b5fb4b0c55c5b044c5c5fe0d54309191966',
    woff2Count: 115,
    missingBig5: GOOGLE_SLICE_GAPS,
  },
  {
    id: 'iansui',
    label: '芫荽（Iansui）',
    family: 'Iansui',
    fallback: 'hand',
    pkg: '@fontsource/iansui',
    version: '5.3.1',
    css: '400.css',
    dir: 'iansui',
    license: 'OFL-Iansui.txt',
    copyright: 'Copyright 2022 The Iansui Project Authors (https://github.com/ButTaiwan/iansui).',
    upstream: 'https://github.com/ButTaiwan/iansui',
    sha256: 'cd101066d523ac031bcc340193ac356dd61e2d4004254f288ad4112cf1ca7bc4',
    woff2Count: 108,
    missingBig5: '汍杗沘阬姅泜甽疢栘涊訑偯偭屝梡梂笮紱脤湩絰詖楛覜詻詨跦雊劂榣箄裯鄘酴儅潠誶輞輥穋擭歜毚濩縿褽燸霤韹譆羼鶸觼鑤',
  },
  {
    id: 'huninn',
    label: 'jf open 粉圓（Huninn）',
    family: 'Huninn',
    fallback: 'serif',
    pkg: '@fontsource/huninn',
    version: '5.3.1',
    css: '400.css',
    dir: 'huninn',
    license: 'OFL-Huninn.txt',
    copyright: 'Copyright 2025 The Huninn Project Authors (https://github.com/justfont/Huninn)',
    upstream: 'https://github.com/justfont/Huninn',
    sha256: '35c6263b4d97ddb3eb310c3e2a79d9ebaf1fce11467536b27c0e4eb7dbc635e1',
    woff2Count: 111,
    missingBig5: '汍杗沘阬姅泜甽疢栘涊訑偯偭屝梡梂紱脤愒湩絰詖楛覜詻詨跦鄗雊榦榣箄裯鄘儅潠誶踡輞輥穋擭歜毚濩縿褽燸霤韹譆鶸觼鑤',
  },
];

export const FONT_OPTIONS = FONTS.map((f) => ({ value: f.id, label: f.label }));

/** CSS font-family 字串（含備援）。 */
export function fontStack(id: string, role: FontRole): string {
  const font = FONTS.find((f) => f.id === id);
  const fallback = role === 'hand' || font?.fallback === 'hand' ? 'var(--font-hand)' : 'var(--font-serif)';
  return font ? `'${font.family}', ${fallback}` : fallback;
}
