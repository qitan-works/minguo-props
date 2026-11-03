// pnpm fonts:generate 的來源設定：要下載哪些檔案（網址、大小、SHA-256 全部釘死）、
// 每套字型從哪個檔案來、要切子集（subset）還是原封不動包成 WOFF 1.0（woff）。
// 字型的顯示名稱、授權、著作權等資料在 src/fonts.ts；兩邊以 id 對應，測試會檢查一致。

export interface SourceFile {
  /** 存進快取目錄（.cache/fonts/）的檔名。 */
  readonly cache: string;
  readonly url: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface FontRecipe {
  /** 與 src/fonts.ts 的 id 相同，也是輸出目錄 fonts/<id>/ 的名稱。 */
  readonly id: string;
  readonly source: SourceFile;
  /** 壓縮檔（tar.gz）裡的路徑；來源本身就是字型檔時省略。 */
  readonly member?: string;
  /** subset：切子集、依 unicode-range 分片、轉 WOFF2；woff：原封不動包成 WOFF 1.0。 */
  readonly mode: 'subset' | 'woff';
  /** 寫進修改聲明的「原始檔」說明（只用於 subset）。 */
  readonly origin: string;
  /**
   * 直排標點怎麼處理（只用於 subset）：
   * - 'font'（預設）：用字型自己的標點；
   * - 'fallback'：字型沒有 vert 功能、也沒有 Unicode 直排形式（U+FE10～FE4F）時，HarfBuzz 能換成直排形式的
   *   標點（「，」「。」「「」」「（」等，見 VERTICAL_FORMS）不收進子集，讓瀏覽器改用備援字型（霞鶩文楷）顯示：
   *   備援字型有 vert 功能，直排時括號會轉向、逗號句號會移到右上角。否則直排時括號不轉、句讀擠在左下角。
   */
  readonly verticalPunctuation?: 'font' | 'fallback';
}

/**
 * 修改聲明的日期（寫進子集字型 name 表的 nameID 10）。GPL 第 2 條 (a) 款要求修改過的檔案
 * 註明修改內容與日期；改變子集內容的設定（字集、分片方式、HarfBuzz 版本等）時，請一併更新。
 */
export const MODIFIED_DATE = '2026-11-03';

/** 本專案網址（寫進修改聲明）。 */
export const PROJECT_URL = 'https://github.com/qitan-works/minguo-props';

/** 王漢宗自由字型 1.3.0（Google Code 封存的原始 tarball；GPL-2.0-or-later）。 */
export const WANGFONTS: SourceFile = {
  cache: 'wangfonts-1.3.0.tar.gz',
  url: 'https://storage.googleapis.com/google-code-archive-downloads/v2/code.google.com/wangfonts/wangfonts-1.3.0.tar.gz',
  bytes: 134_133_251,
  sha256: '76449c671ba9f7e56518b3db5810c5033a3ae9fef386a6c8b6eb5e15591a53e7',
};

/** 清松手寫體：jasonhandwriting/JasonHandwriting 的固定 commit。 */
export const JASON_COMMIT = 'e488583c07077850aa4a2a6280baa20374cccde2';
const jason = (file: string, bytes: number, sha256: string): SourceFile => ({
  cache: `JasonHandwriting-${JASON_COMMIT.slice(0, 12)}-${file}`,
  url: `https://raw.githubusercontent.com/jasonhandwriting/JasonHandwriting/${JASON_COMMIT}/${file}`,
  bytes,
  sha256,
});

/** 辰宇落雁體：Chenyu-otf/chenyuluoyan_thin 的固定 commit。 */
export const CHENYU_COMMIT = '6e36815b0bec9f4f948298698d00b27a5f0b65c1';

const wang = (id: string, file: string): FontRecipe => ({
  id,
  source: WANGFONTS,
  member: `wangfonts/${file}`,
  mode: 'subset',
  origin: `${file} in wangfonts-1.3.0.tar.gz (${WANGFONTS.url})`,
});

const jasonFont = (id: string, file: string, bytes: number, sha256: string): FontRecipe => {
  const source = jason(file, bytes, sha256);
  // 清松手寫體沒有 vert 功能，也沒有任何直排形式
  return { id, source, mode: 'subset', origin: `${file} (${source.url})`, verticalPunctuation: 'fallback' };
};

export const RECIPES: readonly FontRecipe[] = [
  wang('wang-zhong-ming', 'wt002.ttf'),
  wang('wang-te-ming', 'wt004.ttf'),
  wang('wang-chao-ming', 'wt005.ttf'),
  wang('wang-te-hei', 'wt014.ttf'),
  wang('wang-zhong-li', 'wt021.ttf'),
  wang('wang-zhong-fangsong', 'wt024.ttf'),
  wang('wang-yan-kai', 'wt064.ttf'),
  wang('wang-zhong-xing', 'wt071.ttf'),
  wang('wang-gangbi-xingkai', 'wthc06.ttf'),
  jasonFont('jason-xingkai', 'JasonHandwriting5.ttf', 5_923_696, '2f0a54b56a79961e44f38d95ea293d113362e6eff438a2c351e60390d60f7960'),
  jasonFont('jason-piaoyi', 'JasonHandwriting7.ttf', 9_254_640, '415a3b569ae977de87377a892f250e53c8d12139e0f47ef7cadd8a8a359c288e'),
  jasonFont('jason-suixing', 'JasonHandwriting8.ttf', 8_030_664, '1437de4a5fee29a5c6b43450df56e734af9cddb5b3a68d236cf5f42be178c93f'),
  {
    id: 'chenyu-luoyan',
    source: {
      cache: `chenyuluoyan_thin-${CHENYU_COMMIT.slice(0, 12)}-ChenYuluoyan-2.0-Thin.ttf`,
      url: `https://raw.githubusercontent.com/Chenyu-otf/chenyuluoyan_thin/${CHENYU_COMMIT}/ChenYuluoyan-2.0-Thin.ttf`,
      bytes: 9_522_140,
      sha256: '1289e42a6d1ec995d0cb23aee89efc69fc95749fbd54a610057a3e992dc453db',
    },
    mode: 'woff',
    origin: 'ChenYuluoyan-2.0-Thin.ttf',
  },
];

/**
 * 每套子集字型都收的字（除了 Big5 常用字與預設、填版文字之外）：
 * ASCII、全形標點與符號、直排標點、報紙常用的符號（破折號、刪節號、箭頭、圈號、幾何圖形、星號、括號數字）。
 */
export const EXTRA_RANGES: readonly (readonly [number, number])[] = [
  [0x0020, 0x007e], // ASCII
  [0x2010, 0x2027], // 破折號、引號、刪節號等
  [0x2030, 0x203b], // 千分號、參考號等
  [0x2190, 0x21ff], // 箭頭
  [0x2460, 0x2473], // ①～⑳
  [0x25a0, 0x25ff], // 幾何圖形（□■○●◎◆◇▲◁▷ 等）
  [0x2605, 0x2606], // ★☆
  [0x3000, 0x303f], // 中日韓符號與標點
  [0x3220, 0x3243], // ㈠～㈩ 等括號漢字
  [0xfe10, 0xfe1f], // 直排標點
  [0xfe30, 0xfe4f], // 中日韓相容形式（直排括號等）
  [0xff00, 0xffef], // 全形 ASCII 與半形片假名等
];

/**
 * 第 0 片以外每個分片的目標大小（WOFF2 位元組）。實際切法：依原字型 glyf 表裡各字形的位元組數，
 * 乘上第 0 片實測的壓縮率估計大小，平均切成「總量÷目標」片（四捨五入），所以各片大約 170～230 KB。
 */
export const SLICE_TARGET_BYTES = 200_000;
