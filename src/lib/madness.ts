// 瘋狂感的手寫（純邏輯）：「越寫越亂」——從第幾個字開始，每個字隨機偏移、旋轉、縮放、
// 筆壓深淺，越往後越亂；也可以夾雜塗改後重寫、同一句重複。由種子決定，預覽與列印一致。

import { gaussianish, int, rngFor } from './random.ts';

export interface MadnessOptions {
  /** 強度 0～100。 */
  readonly strength: number;
  /** 從第幾個字（0 起算）開始變亂。 */
  readonly start: number;
  readonly seed: number;
}

export interface CharJitter {
  /** 偏移（以字高 em 計）。 */
  readonly dx: number;
  readonly dy: number;
  /** 旋轉角度。 */
  readonly rotate: number;
  readonly scale: number;
  /** 筆壓：墨色濃淡 0～1。 */
  readonly ink: number;
}

/** 第 index 個字的亂度；在開始之前或強度為 0 時回傳 null。 */
export function charJitter(index: number, total: number, o: MadnessOptions): CharJitter | null {
  if (o.strength <= 0 || index < o.start || total <= 0) return null;
  const span = Math.max(1, total - o.start);
  const progress = Math.min(1, (index - o.start + 1) / span);
  const k = (Math.min(100, o.strength) / 100) * (0.25 + 0.75 * Math.pow(progress, 0.8));
  const rng = rngFor(o.seed, `mad:${index}`);
  const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
  return {
    dx: clamp(gaussianish(rng) * 0.3 * k, -0.45, 0.45),
    dy: clamp(gaussianish(rng) * 0.3 * k, -0.45, 0.45),
    rotate: clamp(gaussianish(rng) * 34 * k, -45, 45),
    scale: clamp(1 + gaussianish(rng) * 0.3 * k, 0.7, 1.45),
    ink: clamp(1 - rng() * 0.55 * k, 0.4, 1),
  };
}

export interface MadTextOptions {
  readonly start: number;
  readonly seed: number;
  /** 夾雜塗改後重寫。 */
  readonly rewrite: boolean;
  /** 同一句重複。 */
  readonly repeat: boolean;
}

/**
 * 依選項改寫文字（不含標記的純文字）：
 * - 重複：開始變亂之後的第一句，接著再寫兩遍；
 * - 塗改：開始變亂之後，每隔數字插入一段「寫錯、劃掉、重寫」（以 [刪:…] 標記）。
 */
export function madText(text: string, o: MadTextOptions): string {
  let chars = Array.from(text);
  if (o.repeat && chars.length > o.start) {
    const rest = chars.slice(o.start).join('');
    const m = /[^。！？\n]+[。！？]?/.exec(rest);
    if (m) {
      const at = o.start + Array.from(rest.slice(0, m.index + m[0].length)).length;
      const sentence = m[0].trim();
      chars = [...chars.slice(0, at), ...Array.from(sentence + sentence), ...chars.slice(at)];
    }
  }
  if (!o.rewrite) return chars.join('');
  const rng = rngFor(o.seed, 'mad:rewrite');
  let out = chars.slice(0, o.start).join('');
  let i = o.start;
  let next = o.start + int(rng, 6, 14);
  while (i < chars.length) {
    const ch = chars[i] as string;
    if (i >= next && /\p{Script=Han}/u.test(ch)) {
      const snippet = chars.slice(i, i + int(rng, 1, 2)).join('');
      out += `[刪:${snippet}]`;
      next = i + int(rng, 8, 18);
    }
    out += ch;
    i++;
  }
  return out;
}
