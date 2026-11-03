// 可選字型清單（建置、介面與測試共用）。
//
// 字型有兩種來源：
// 1. Fontsource 發布在 npm 的套件（source: 'fontsource'）：依 Google Fonts 以 unicode-range 切好的 woff2 分片，
//    版本釘在 package.json 與 pnpm-lock.yaml。全部是 SIL Open Font License 1.1。
// 2. 本專案自行處理、提交在 fonts/ 的字型（source: 'generated'）：由 pnpm fonts:generate 從釘選的原始檔
//    產生（見 scripts/fonts-generate.ts 與 scripts/lib/font-sources.ts）。王漢宗自由字型（GPL-2.0-or-later）
//    與清松手寫體（OFL）切成子集並依 unicode-range 分片；辰宇落雁體（OFL，有保留字型名稱）原封不動包成 WOFF 1.0。
// 建置時驗證實際複製的字型檔（依檔名排序後串接）的 SHA-256 與下面的值相符，不符就中止建置。
// 網站自己提供字型；只有選用的字型、用到的字所在的分片才會下載。
//
// 繁體中文字數：以字型檔的 cmap 實際檢查（見 test/font-coverage.test.ts）。
// Fontsource 的五套都涵蓋 Big5 常用字 5,401 字，只缺 missingBig5 列出的字。這些字經比對教育部
// 〈常用國字標準字體表〉4,808 字（ButTaiwan/cjktables 的 edu_standard_1.txt）都不在常用字內，
// 唯一例外是「甽」：Google Fonts 的切片沒有收這個字，所以五套都缺，瀏覽器會改用系統字型顯示。
// 自行處理的字型另外登記 missingText：子集裡沒有、但預設或填版文字用到的字（以備援字型顯示）。
// 多半是原字型本來就沒有的字；清松手寫體另外刻意不收直排標點（「，」「。」「「」」「（」等），
// 因為它沒有直排形式，交給備援字型（霞鶩文楷）直排時才會轉向、擺對位置（見 scripts/lib/font-sources.ts）。
//
// VERTICAL_NOTE（直排的建議調整 vertical）：在 Chromium（deviceScaleFactor 1，14～40px）以直排排出
// 「下緣最低」與「上緣最高」的字的各種組合，數相鄰兩字墨跡重疊的像素，取讓重疊歸零的最小字距。
// 清松手寫體 7、8 沒有 vmtx，瀏覽器以 hhea 的 ascent＋descent（0.952em）當直排字高，
// 約一成的字下緣超出，所以需要 0.04、0.05em。欄與欄之間（行高 1 起）都不會相撞，行高倍數都是 1。

export type FontRole = 'title' | 'body' | 'hand';

/** 字體類別（給介面依用途挑字型用）。 */
export type FontKind = 'ming' | 'hei' | 'li' | 'fangsong' | 'kai' | 'xing' | 'hand';

/** 直排時建議的調整（字距與行距），避免字形較大或較斜的手寫字互相重疊。 */
export interface VerticalAdjust {
  /** 字與字之間額外的間距（em，加在 letter-spacing 上）。 */
  readonly letterSpacing: number;
  /** 行高（直排時是欄與欄的間距）乘上的倍數。 */
  readonly lineHeight: number;
}

interface FontCommon {
  readonly id: string;
  readonly label: string;
  /** CSS 字型家族名稱（與 @font-face 一致）。 */
  readonly family: string;
  /** 缺字時的備援：印刷字（serif）或手寫字（hand）。 */
  readonly fallback: 'serif' | 'hand';
  readonly kind: FontKind;
  /** SPDX 授權代號。 */
  readonly license: 'OFL-1.1' | 'GPL-2.0-or-later';
  /** licenses/ 底下的授權全文。 */
  readonly licenseFiles: readonly string[];
  /** 著作權聲明（Fontsource：授權檔第一行；自行處理：字型 name 表的 nameID 0）。 */
  readonly copyright: string;
  readonly upstream: string;
  /** 版本：npm 套件版本，或上游發布的字型版本。 */
  readonly version: string;
  /** 輸出目錄 dist/fonts/<dir>。 */
  readonly dir: string;
  /** 依檔名排序後串接全部字型檔的 SHA-256。 */
  readonly sha256: string;
  readonly fileCount: number;
  /** 不在字型內的 Big5 常用字（見檔案開頭說明）。 */
  readonly missingBig5: string;
  /** 直排的建議調整；沒有就是不需要調整。 */
  readonly vertical?: VerticalAdjust;
}

export interface FontsourceFont extends FontCommon {
  readonly source: 'fontsource';
  readonly pkg: string;
  /** 套件裡要用的 CSS 檔（含 unicode-range 分片）。 */
  readonly css: string;
}

export interface GeneratedFont extends FontCommon {
  readonly source: 'generated';
  /** woff2：切子集、分片；woff：原封不動的 WOFF 1.0（一個檔）。 */
  readonly format: 'woff2' | 'woff';
  /** 上游 git 儲存庫的 commit（來源是 git 儲存庫時）。 */
  readonly commit?: string;
  /** 是否修改過原字型（切子集＝修改版）。 */
  readonly modified: boolean;
  /** 子集裡沒有、但預設或填版文字用到的字（以備援字型顯示；見檔案開頭說明）。 */
  readonly missingText: string;
}

export type FontDef = FontsourceFont | GeneratedFont;

const GOOGLE_SLICE_GAPS = '杗阬姅甽涊偭梡詨跦穋歜毚縿燸霤鶸觼鑤';

const fontsource = (f: Omit<FontsourceFont, 'source' | 'license'>): FontsourceFont => ({ ...f, source: 'fontsource', license: 'OFL-1.1' });

const WANG_COMMON = {
  source: 'generated',
  format: 'woff2',
  modified: true,
  license: 'GPL-2.0-or-later',
  licenseFiles: ['GPL-2.0.txt'],
  copyright: '(C)Copyright Dr. Hann-Tzong Wang, 2002-2004.',
  upstream: 'https://code.google.com/archive/p/wangfonts/',
  version: '1.3.0',
  // 王漢宗字型的 Big5 常用字一字不缺；「〇」「峯」不在原字型裡
  missingBig5: '',
  missingText: '〇峯',
} as const;

const JASON_COMMON = {
  source: 'generated',
  format: 'woff2',
  modified: true,
  fallback: 'hand',
  kind: 'hand',
  license: 'OFL-1.1',
  licenseFiles: ['OFL-JasonHandwriting.txt'],
  upstream: 'https://github.com/jasonhandwriting/JasonHandwriting',
  commit: 'e488583c07077850aa4a2a6280baa20374cccde2',
} as const;

export const FONTS: readonly FontDef[] = [
  fontsource({
    id: 'noto-serif',
    label: '思源宋體（Noto Serif TC）',
    family: 'Noto Serif TC Variable',
    fallback: 'serif',
    kind: 'ming',
    pkg: '@fontsource-variable/noto-serif-tc',
    version: '5.3.1',
    css: 'index.css',
    dir: 'noto-serif-tc',
    licenseFiles: ['OFL-Noto-Serif-TC.txt'],
    // 授權檔（google/fonts）的聲明；字型檔內另有「(c) 2017-2024 Adobe (http://www.adobe.com/).」
    copyright: 'Copyright 2012 Google Inc. All Rights Reserved.',
    upstream: 'https://github.com/notofonts/noto-cjk',
    sha256: 'f8ea551e7a9b72cb43424903192182992e5ff07ab6dcc0f539b277137faf9037',
    fileCount: 108,
    missingBig5: GOOGLE_SLICE_GAPS,
  }),
  fontsource({
    id: 'cactus',
    label: '仙人掌明體（Cactus Classical Serif）',
    family: 'Cactus Classical Serif',
    fallback: 'serif',
    kind: 'ming',
    pkg: '@fontsource/cactus-classical-serif',
    version: '5.3.1',
    css: '400.css',
    dir: 'cactus-classical-serif',
    licenseFiles: ['OFL-Cactus-Classical-Serif.txt'],
    copyright: 'Copyright 2024 The Caactus Classical Serif Project Authors (https://github.com/MoonlitOwen/CactusSerif)',
    upstream: 'https://github.com/MoonlitOwen/CactusSerif',
    sha256: 'e1484bb9d00995e8f418cc77fe27c909bf97479c87a5a362d9db4bf1044ab895',
    fileCount: 109,
    missingBig5: GOOGLE_SLICE_GAPS,
  }),
  fontsource({
    id: 'lxgw',
    label: '霞鶩文楷 TC（LXGW WenKai TC）',
    family: 'LXGW WenKai TC',
    fallback: 'hand',
    kind: 'kai',
    pkg: '@fontsource/lxgw-wenkai-tc',
    version: '5.3.1',
    css: '400.css',
    dir: 'lxgw-wenkai-tc',
    licenseFiles: ['OFL-LXGW-WenKai-TC.txt'],
    copyright: 'Copyright 2024 The LXGW WenKai Project Authors (https://github.com/lxgw/LxgwWenkaiTC)',
    upstream: 'https://github.com/lxgw/LxgwWenkaiTC',
    sha256: '5ffc1edb443218d1e503002760c73b5fb4b0c55c5b044c5c5fe0d54309191966',
    fileCount: 115,
    missingBig5: GOOGLE_SLICE_GAPS,
  }),
  fontsource({
    id: 'iansui',
    label: '芫荽（Iansui）',
    family: 'Iansui',
    fallback: 'hand',
    kind: 'hand',
    pkg: '@fontsource/iansui',
    version: '5.3.1',
    css: '400.css',
    dir: 'iansui',
    licenseFiles: ['OFL-Iansui.txt'],
    copyright: 'Copyright 2022 The Iansui Project Authors (https://github.com/ButTaiwan/iansui).',
    upstream: 'https://github.com/ButTaiwan/iansui',
    sha256: 'cd101066d523ac031bcc340193ac356dd61e2d4004254f288ad4112cf1ca7bc4',
    fileCount: 108,
    missingBig5: '汍杗沘阬姅泜甽疢栘涊訑偯偭屝梡梂笮紱脤湩絰詖楛覜詻詨跦雊劂榣箄裯鄘酴儅潠誶輞輥穋擭歜毚濩縿褽燸霤韹譆羼鶸觼鑤',
  }),
  fontsource({
    id: 'huninn',
    label: 'jf open 粉圓（Huninn）',
    family: 'Huninn',
    fallback: 'serif',
    kind: 'hei',
    pkg: '@fontsource/huninn',
    version: '5.3.1',
    css: '400.css',
    dir: 'huninn',
    licenseFiles: ['OFL-Huninn.txt'],
    copyright: 'Copyright 2025 The Huninn Project Authors (https://github.com/justfont/Huninn)',
    upstream: 'https://github.com/justfont/Huninn',
    sha256: '35c6263b4d97ddb3eb310c3e2a79d9ebaf1fce11467536b27c0e4eb7dbc635e1',
    fileCount: 111,
    missingBig5: '汍杗沘阬姅泜甽疢栘涊訑偯偭屝梡梂紱脤愒湩絰詖楛覜詻詨跦鄗雊榦榣箄裯鄘儅潠誶踡輞輥穋擭歜毚濩縿褽燸霤韹譆鶸觼鑤',
  }),
  {
    ...WANG_COMMON,
    id: 'wang-zhong-ming',
    label: '王漢宗中明體',
    family: 'MP Wang Zhong Ming',
    fallback: 'serif',
    kind: 'ming',
    dir: 'wang-zhong-ming',
    sha256: '3da57b70b1b1f2e4152b446b4364b25393eb7accbf30de375fd4c7bcb3558c03',
    fileCount: 7,
  },
  {
    ...WANG_COMMON,
    id: 'wang-te-ming',
    label: '王漢宗特明體',
    family: 'MP Wang Te Ming',
    fallback: 'serif',
    kind: 'ming',
    dir: 'wang-te-ming',
    sha256: 'a1a3a8bbf06e2cbb56496816e5332a10e3d868c650307f878f4a3e3122e0c36a',
    fileCount: 8,
  },
  {
    ...WANG_COMMON,
    id: 'wang-chao-ming',
    label: '王漢宗超明體',
    family: 'MP Wang Chao Ming',
    fallback: 'serif',
    kind: 'ming',
    dir: 'wang-chao-ming',
    sha256: '8b0e04a7be9b2b5f15a752d0eeffe8c6244baa18151e61c158d3b16b60fe3677',
    fileCount: 7,
  },
  {
    ...WANG_COMMON,
    id: 'wang-te-hei',
    label: '王漢宗特黑體',
    family: 'MP Wang Te Hei',
    fallback: 'serif',
    kind: 'hei',
    dir: 'wang-te-hei',
    sha256: 'd892579cd9ebe02f22859db00df6e34978c35c27fc1f62ca6ae60305bfa00eff',
    fileCount: 6,
  },
  {
    ...WANG_COMMON,
    id: 'wang-zhong-li',
    label: '王漢宗中隸書',
    family: 'MP Wang Zhong Li',
    fallback: 'serif',
    kind: 'li',
    dir: 'wang-zhong-li',
    sha256: 'cbcb6705484a5e5cfc8b04fa763e79cdfcbe0cdae2e1a941182e77294e05efb5',
    fileCount: 8,
  },
  {
    ...WANG_COMMON,
    id: 'wang-zhong-fangsong',
    label: '王漢宗中仿宋',
    family: 'MP Wang Zhong Fangsong',
    fallback: 'serif',
    kind: 'fangsong',
    dir: 'wang-zhong-fangsong',
    sha256: '64c9d592474c200eda53679656e25a01a3ece730451614d9fc2c541f8bc52d6b',
    fileCount: 9,
  },
  {
    ...WANG_COMMON,
    id: 'wang-yan-kai',
    label: '王漢宗顏楷體',
    family: 'MP Wang Yan Kai',
    fallback: 'hand',
    kind: 'kai',
    dir: 'wang-yan-kai',
    sha256: '965cb371f1d192f00ea0cb1429b0c81a7b26237bccf5a63b85f9e94af6f2d27e',
    fileCount: 8,
  },
  {
    ...WANG_COMMON,
    id: 'wang-zhong-xing',
    label: '王漢宗中行書',
    family: 'MP Wang Zhong Xing',
    fallback: 'hand',
    kind: 'xing',
    dir: 'wang-zhong-xing',
    sha256: '5d077b48a7cc55ad90f5bbb8392a4ca4a301b53015e4d30a965008117ae3989d',
    fileCount: 9,
  },
  {
    ...WANG_COMMON,
    id: 'wang-gangbi-xingkai',
    label: '王漢宗鋼筆行楷',
    family: 'MP Wang Gangbi Xingkai',
    fallback: 'hand',
    kind: 'hand',
    dir: 'wang-gangbi-xingkai',
    sha256: 'a5b459f16d48046aaf61c62d8b6c147231892450d09403528e35de60c6086894',
    fileCount: 6,
  },
  {
    ...JASON_COMMON,
    id: 'jason-xingkai',
    label: '清松手寫體5（行楷）',
    family: 'MP Jason Xingkai',
    copyright: '© Copyright 2021, JasonHandwriting5 is created by Jason(Yu Ching Sung) under SIL Open Font License.',
    version: '1.12',
    dir: 'jason-xingkai',
    sha256: 'd484362daadb383bceb9ee74a3cb70e445aa16650a3de9ff519a939e14ae2912',
    fileCount: 12,
    missingBig5: '佚涪淬紱硿摭箄撳蔆璘躓',
    missingText: '—…　、。「」『』【】〔〕哿舁！（），：；＝？',
  },
  {
    ...JASON_COMMON,
    id: 'jason-piaoyi',
    label: '清松手寫體7（飄逸）',
    family: 'MP Jason Piaoyi',
    copyright: '© Copyright 2023, JasonHandwriting7 is created by Jason(Yu Ching Sung) under SIL Open Font License.',
    version: '1.01',
    dir: 'jason-piaoyi',
    sha256: '7c7849f701d13270f26858f43d30643841525a8ce6069ed2a11da1afc100f16a',
    fileCount: 12,
    missingBig5: '紱硿摭箄',
    missingText: '—…→　、。〈〉《》「」『』【】〔〕！％（）＋，／：；＝？～',
    // 直排時上字的長筆畫會碰到下字（Chromium 實測，見 VERTICAL_NOTE）
    vertical: { letterSpacing: 0.04, lineHeight: 1 },
  },
  {
    ...JASON_COMMON,
    id: 'jason-suixing',
    label: '清松手寫體8（隨性）',
    family: 'MP Jason Suixing',
    copyright: '© Copyright 2024, JasonHandwriting8 is created by Jason(Yu Ching Sung) under SIL Open Font License.',
    version: '1.00',
    dir: 'jason-suixing',
    sha256: '36dec6c08e32814b48fadb140dd15fca892d529f3d24cd37f86b6ed218b10040',
    fileCount: 11,
    missingBig5: '紱硿摭箄',
    missingText: '×—…→▲○◎　、。〇〈〉《》「」『』【】〔〕！（），：；＝？',
    vertical: { letterSpacing: 0.05, lineHeight: 1 },
  },
  {
    source: 'generated',
    // 原封不動：不切子集、不改名，只包成 WOFF 1.0（見 THIRD_PARTY_NOTICES.md）
    format: 'woff',
    modified: false,
    id: 'chenyu-luoyan',
    label: '辰宇落雁體 Thin',
    family: 'MP Chenyu Luoyan',
    fallback: 'hand',
    kind: 'hand',
    license: 'OFL-1.1',
    licenseFiles: ['OFL-Chenyuluoyan.txt'],
    copyright: 'Copyright (c) 2022, Wang, Li-Yu & Liu, Wei-Chen.',
    upstream: 'https://github.com/Chenyu-otf/chenyuluoyan_thin',
    commit: '6e36815b0bec9f4f948298698d00b27a5f0b65c1',
    version: '2.100',
    dir: 'chenyu-luoyan',
    sha256: '85421459432567e9e2e750c50447e2812ff251045ea2b4646fb23ce7e86acdfc',
    fileCount: 1,
    missingBig5: '汍杗沘阬姅泜疢栘涊砟訑偯屝梂笮紱愒湩絰詻跦鄗雊榣箄裯鄘酴儅潠誶踡輞輥穋擭歜毚濩縿燸韹譆羼觼鑤',
    missingText: '舁',
    // 不設 vertical：一般文字實測不會相撞。少數字的直排外框超出很多（「憂」上緣超出 0.27em），
    // 要讓這些最壞的字對也不碰，需要 0.13～0.2em 的字距，為了少數字全文放寬太多，所以不設。
  },
];

export const FONT_OPTIONS = FONTS.map((f) => ({ value: f.id, label: f.label }));

/** 依編號找字型；找不到時回傳 undefined。 */
export function fontById(id: string): FontDef | undefined {
  return FONTS.find((f) => f.id === id);
}

/** CSS font-family 字串（含備援）。 */
export function fontStack(id: string, role: FontRole): string {
  const font = fontById(id);
  const fallback = role === 'hand' || font?.fallback === 'hand' ? 'var(--font-hand)' : 'var(--font-serif)';
  return font ? `'${font.family}', ${fallback}` : fallback;
}

/** 直排時的建議調整；不需要調整的字型回傳字距 0、行距倍數 1。 */
export function fontVertical(id: string): VerticalAdjust {
  return fontById(id)?.vertical ?? { letterSpacing: 0, lineHeight: 1 };
}
