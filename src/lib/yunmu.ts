// 韻目代日：民國時期電報為節省字數，以平水韻的韻目字代表日期，以地支代表月份。
//
// 規則（每一日取「第 N 個韻目」）：
// - 1～15 日：上平聲十五韻（東冬江支微魚虞齊佳灰真文元寒刪）為主，
//   下平聲十五韻（先蕭肴豪歌麻陽庚青蒸尤侵覃鹽咸）為別用。
// - 16～29 日：取上聲或去聲的第 N 韻：16 銑、17 篠、18 巧、19 皓、21 馬、22 養、
//   25 有、26 寢、27 感、28 儉（上聲，即「琰」韻）；20 號、23 漾、24 敬、29 豔（去聲）。
// - 30 日：理應用去聲第三十韻「陷」，但習慣避用，多寫「卅」。
// - 31 日：平水韻沒有第三十一韻，採公曆後另訂「世」或「引」。
// - 月份以地支代：子＝一月、丑＝二月……亥＝十二月（亦有以「建子」為十一月的少數說法，本程式不採用）。
//
// 出處與核對：
// - 維基百科〈代日韻目〉（https://zh.wikipedia.org/zh-tw/代日韻目，〈韻目代日〉重新導向至此）
//   與其討論頁（記載 1949～1950 年國立臺灣大學公告以「陷」代三十日的實例）。
// - 中央研究院近代史研究所檔案館〈電報代月代日〉（https://archives.sinica.edu.tw/project/98）。
// - 古文維基百科〈韻目代日〉（https://zh-classical.wikipedia.org/wiki/韻目代日），載地支代月。
// - 史例：馬日事變（1927 年 5 月 21 日）、文夕大火（1938 年 11 月 12 日夜）、
//   豔電（1938 年 12 月 29 日）、皓電（1940 年 10 月 19 日）、佳電（1940 年 11 月 9 日）、
//   齊電（1940 年 12 月 8 日）；皆與本表相符，並寫進 test/yunmu.test.ts。
// - 平水韻韻目次序：維基文庫〈平水韻〉（https://zh.wikisource.org/zh-hant/平水韻）。

export interface YunmuDay {
  readonly day: number;
  /** 常用字（民國電報最常見的寫法）。 */
  readonly primary: string;
  /** 別用字（同樣代表這一日的其他韻目或寫法）。 */
  readonly alternates: readonly string[];
}

export const YUNMU_DAYS: readonly YunmuDay[] = [
  { day: 1, primary: '東', alternates: ['先'] },
  { day: 2, primary: '冬', alternates: ['蕭'] },
  { day: 3, primary: '江', alternates: ['肴'] },
  { day: 4, primary: '支', alternates: ['豪'] },
  { day: 5, primary: '微', alternates: ['歌'] },
  { day: 6, primary: '魚', alternates: ['麻'] },
  { day: 7, primary: '虞', alternates: ['陽'] },
  { day: 8, primary: '齊', alternates: ['庚'] },
  { day: 9, primary: '佳', alternates: ['青'] },
  { day: 10, primary: '灰', alternates: ['蒸'] },
  { day: 11, primary: '真', alternates: ['尤'] },
  { day: 12, primary: '文', alternates: ['侵'] },
  { day: 13, primary: '元', alternates: ['覃'] },
  { day: 14, primary: '寒', alternates: ['鹽'] },
  { day: 15, primary: '刪', alternates: ['咸'] },
  { day: 16, primary: '銑', alternates: [] },
  { day: 17, primary: '篠', alternates: [] },
  { day: 18, primary: '巧', alternates: [] },
  { day: 19, primary: '皓', alternates: [] },
  { day: 20, primary: '號', alternates: [] },
  { day: 21, primary: '馬', alternates: [] },
  { day: 22, primary: '養', alternates: [] },
  { day: 23, primary: '漾', alternates: [] },
  { day: 24, primary: '敬', alternates: [] },
  { day: 25, primary: '有', alternates: [] },
  { day: 26, primary: '寢', alternates: [] },
  { day: 27, primary: '感', alternates: [] },
  { day: 28, primary: '儉', alternates: [] },
  { day: 29, primary: '豔', alternates: ['艷'] },
  { day: 30, primary: '卅', alternates: ['陷'] },
  { day: 31, primary: '世', alternates: ['引'] },
];

/** 地支代月：子＝一月……亥＝十二月。 */
export const DIZHI_MONTHS = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'] as const;

/** 常見異體與簡體寫法，查詢時視為同一字。 */
const VARIANTS: Readonly<Record<string, string>> = {
  删: '刪',
  号: '號',
  俭: '儉',
  艳: '豔',
  寑: '寢',
  寝: '寢',
  眞: '真',
  筱: '篠',
  东: '東',
  鱼: '魚',
  齐: '齊',
  萧: '蕭',
  盐: '鹽',
  铣: '銑',
  马: '馬',
  养: '養',
  阳: '陽',
};

const BY_CHAR: ReadonlyMap<string, number> = (() => {
  const map = new Map<string, number>();
  for (const entry of YUNMU_DAYS) {
    map.set(entry.primary, entry.day);
    for (const alt of entry.alternates) map.set(alt, entry.day);
  }
  return map;
})();

function assertDay(day: number): void {
  if (!Number.isInteger(day) || day < 1 || day > 31) throw new RangeError(`日期必須是 1～31：${day}`);
}

/** 日 → 韻目字。alternate 為 true 時，有別用字就用別用字（例如 1 日用「先」）。 */
export function dayToYunmu(day: number, alternate = false): string {
  assertDay(day);
  const entry = YUNMU_DAYS[day - 1];
  if (!entry) throw new RangeError(`日期必須是 1～31：${day}`);
  return alternate ? (entry.alternates[0] ?? entry.primary) : entry.primary;
}

/** 韻目字 → 日；不是韻目字時回傳 undefined。接受常見異體與簡體。 */
export function yunmuToDay(char: string): number | undefined {
  const normalized = VARIANTS[char] ?? char;
  return BY_CHAR.get(normalized);
}

/** 月 → 地支。 */
export function monthToDizhi(month: number): string {
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new RangeError(`月份必須是 1～12：${month}`);
  return DIZHI_MONTHS[month - 1] ?? '子';
}

/** 地支 → 月；不是地支時回傳 undefined。 */
export function dizhiToMonth(char: string): number | undefined {
  const i = (DIZHI_MONTHS as readonly string[]).indexOf(char);
  return i === -1 ? undefined : i + 1;
}

export interface TelegramDateOptions {
  /** 同時以地支代月（例如五月廿一日 →「辰馬」）。預設 false。 */
  readonly withMonth?: boolean;
  /** 使用別用字。預設 false。 */
  readonly alternate?: boolean;
}

/** 電報落款的代日字串，例如 21 日 →「馬」，加上月份 →「辰馬」。 */
export function telegramDateCode(month: number, day: number, options: TelegramDateOptions = {}): string {
  const dayChar = dayToYunmu(day, options.alternate ?? false);
  return options.withMonth ? `${monthToDizhi(month)}${dayChar}` : dayChar;
}
