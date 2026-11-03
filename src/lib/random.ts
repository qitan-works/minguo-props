// 固定種子的亂數。所有隨機效果都由「種子」決定：同一個種子永遠得到同樣的結果，
// 所以預覽與列印完全一致；種子存進 JSON，按「換一個」就是換一個種子。

export type Rng = () => number;

/** 種子的合法範圍：1 ～ 2^31−1 的整數。 */
export const MAX_SEED = 0x7fffffff;

export function isValidSeed(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_SEED;
}

/** mulberry32：快速、可重現的 32 位元亂數產生器，回傳 [0, 1)。 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a 雜湊，用來從同一個種子衍生出互不干擾的亂數流（例如「污漬」「火燒」各一條）。 */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 由主種子與標籤衍生出新的種子（結果仍在合法範圍內）。 */
export function deriveSeed(seed: number, label: string): number {
  const mixed = mulberry32((seed ^ hashString(label)) >>> 0)();
  return 1 + Math.floor(mixed * (MAX_SEED - 1));
}

export function rngFor(seed: number, label: string): Rng {
  return mulberry32(deriveSeed(seed, label));
}

export function range(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

export function int(rng: Rng, min: number, maxInclusive: number): number {
  return min + Math.floor(rng() * (maxInclusive - min + 1));
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new RangeError('不能從空陣列挑選');
  return items[Math.floor(rng() * items.length)] as T;
}

/** Fisher–Yates 洗牌，回傳新陣列。 */
export function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}

/** 近似常態分布（三個均勻亂數相加），平均 0、大約落在 −1 ～ 1。 */
export function gaussianish(rng: Rng): number {
  return (rng() + rng() + rng() - 1.5) / 1.5;
}

/** 產生一個新種子（介面的「換一個」按鈕用）。可傳入目前的種子，保證換出不同的值。 */
export function freshSeed(previous?: number, source: () => number = Math.random): number {
  for (let i = 0; i < 8; i++) {
    const seed = 1 + Math.floor(source() * (MAX_SEED - 1));
    if (seed !== previous) return seed;
  }
  return previous === 1 ? 2 : 1;
}
