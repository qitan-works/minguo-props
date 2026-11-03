// 字型分片：決定每個分片收哪些字，並產生 @font-face 的 unicode-range。
//
// - 第 0 片：預設內容與填版素材用到的字（加上 ASCII）。打開網站、只看預設內容時只會下載這一片。
// - 其餘的字依碼位排序，再依字形大小（原字型 glyf 表的位元組數）平均切成幾片。
// - 直排標點：字型沒有 vert 功能時，HarfBuzz（Chromium 與 Firefox 都用它排版）會把「，」「。」「（」等
//   換成 Unicode 的直排形式（U+FE10～FE19、U+FE30～FE4F），但只在「同一個字型檔」裡有那個字形時才換。
//   所以直排形式一定要跟對應的橫排標點放在同一片。對照表照抄 HarfBuzz src/hb-unicode.hh 的
//   vertical_char_for()。
// - unicode-range：只列出有字的碼位，但為了讓 CSS 短一點，連續的一段可以跨過「沒有人要求、
//   也不在任何分片裡」的碼位。這樣各片的範圍一定不重疊，而且每個要求收錄的字只會落在收了它的那一片
//   （或不在任何一片：缺字時直接用備援字型，不會白白下載）。

/** HarfBuzz 的 vertical_char_for()：橫排標點 → 直排形式。 */
export const VERTICAL_FORMS: ReadonlyMap<number, number> = new Map([
  [0x2013, 0xfe32], [0x2014, 0xfe31], [0x2025, 0xfe30], [0x2026, 0xfe19],
  [0x3001, 0xfe11], [0x3002, 0xfe12], [0x3008, 0xfe3f], [0x3009, 0xfe40], [0x300a, 0xfe3d], [0x300b, 0xfe3e],
  [0x300c, 0xfe41], [0x300d, 0xfe42], [0x300e, 0xfe43], [0x300f, 0xfe44], [0x3010, 0xfe3b], [0x3011, 0xfe3c],
  [0x3014, 0xfe39], [0x3015, 0xfe3a], [0x3016, 0xfe17], [0x3017, 0xfe18],
  [0xfe4f, 0xfe34],
  [0xff01, 0xfe15], [0xff08, 0xfe35], [0xff09, 0xfe36], [0xff0c, 0xfe10], [0xff1a, 0xfe13], [0xff1b, 0xfe14],
  [0xff1f, 0xfe16], [0xff3b, 0xfe47], [0xff3d, 0xfe48], [0xff3f, 0xfe33], [0xff5b, 0xfe37], [0xff5d, 0xfe38],
]);

/** 第 0 片：first 裡這套字型有的字，加上它們的直排形式。回傳依碼位排序的碼位。 */
export function firstSlice(covered: ReadonlySet<number>, first: ReadonlySet<number>): number[] {
  const slice0 = new Set([...first].filter((cp) => covered.has(cp)));
  for (const cp of [...slice0]) {
    const v = VERTICAL_FORMS.get(cp);
    if (v !== undefined && covered.has(v)) slice0.add(v);
  }
  return [...slice0].sort((a, b) => a - b);
}

export interface RestInput {
  /** 這套字型要收、而且原字型有字形的碼位。 */
  readonly covered: ReadonlySet<number>;
  /** 已經放進第 0 片的碼位。 */
  readonly taken: ReadonlySet<number>;
  /** 每個碼位的大小估計值。 */
  readonly weight: (cp: number) => number;
  /** 每片的目標大小（與 weight 同單位）。 */
  readonly budget: number;
}

/** 其餘的字依碼位排序後切成大小相近的幾片（片數＝總量÷目標大小，四捨五入）。 */
export function restSlices(input: RestInput): number[][] {
  const { covered, taken, weight, budget } = input;
  // 直排形式跟著它的橫排標點走；橫排標點不在這套字型裡的直排形式照一般的字處理
  const attached = new Map<number, number>();
  for (const [h, v] of VERTICAL_FORMS) {
    if (covered.has(h) && covered.has(v) && !taken.has(h) && !taken.has(v)) attached.set(h, v);
  }
  const attachedTargets = new Set(attached.values());
  const rest = [...covered].filter((cp) => !taken.has(cp) && !attachedTargets.has(cp)).sort((a, b) => a - b);
  if (rest.length === 0) return [];

  const unitWeight = (cp: number): number => weight(cp) + (attached.has(cp) ? weight(attached.get(cp) as number) : 0);
  const total = rest.reduce((s, cp) => s + unitWeight(cp), 0);
  const count = Math.max(1, Math.round(total / budget));
  const target = total / count;
  const slices: number[][] = [];
  let current: number[] = [];
  let acc = 0;
  let k = 1;
  for (const cp of rest) {
    current.push(cp);
    const v = attached.get(cp);
    if (v !== undefined) current.push(v);
    acc += unitWeight(cp);
    if (acc >= target * k && k < count) {
      slices.push(current.sort((a, b) => a - b));
      current = [];
      k++;
    }
  }
  if (current.length > 0) slices.push(current.sort((a, b) => a - b));
  return slices;
}

const hex = (cp: number): string => cp.toString(16);

/**
 * 為每片產生 unicode-range（逗號分隔，如「U+20-7e,U+4e00-4e05」）。
 * known：所有「要求收錄」的碼位（含原字型沒有的字）。連續的一段只跨過不在 known、也不在任何分片的碼位。
 */
export function unicodeRanges(slices: readonly (readonly number[])[], known: ReadonlySet<number>): string[] {
  const owner = new Map<number, number>();
  slices.forEach((s, i) => {
    for (const cp of s) {
      if (owner.has(cp)) throw new Error(`U+${hex(cp)} 同時在兩個分片裡`);
      owner.set(cp, i);
    }
  });
  const all = [...new Set([...known, ...owner.keys()])].sort((a, b) => a - b);
  const ranges: string[][] = slices.map(() => []);
  let runOwner = -1;
  let runStart = 0;
  let runEnd = 0;
  const flush = (): void => {
    if (runOwner >= 0) (ranges[runOwner] as string[]).push(runStart === runEnd ? `U+${hex(runStart)}` : `U+${hex(runStart)}-${hex(runEnd)}`);
  };
  for (const cp of all) {
    const o = owner.get(cp) ?? -1;
    if (o === runOwner && o >= 0) {
      runEnd = cp;
      continue;
    }
    flush();
    runOwner = o;
    runStart = cp;
    runEnd = cp;
  }
  flush();
  return ranges.map((r) => r.join(','));
}

/** 解析 unicode-range（本專案產生的格式），回傳 [起, 迄] 的陣列。 */
export function parseUnicodeRange(range: string): [number, number][] {
  return range.split(',').map((part) => {
    const m = /^U\+([0-9a-f]{1,6})(?:-([0-9a-f]{1,6}))?$/i.exec(part.trim());
    if (!m) throw new Error(`unicode-range 格式錯誤：${part}`);
    const start = Number.parseInt(m[1] as string, 16);
    const end = m[2] ? Number.parseInt(m[2], 16) : start;
    if (end < start) throw new Error(`unicode-range 起訖顛倒：${part}`);
    return [start, end];
  });
}

/** 碼位是否落在 unicode-range 內。 */
export function inRanges(ranges: readonly (readonly [number, number])[], cp: number): boolean {
  return ranges.some(([a, b]) => cp >= a && cp <= b);
}
