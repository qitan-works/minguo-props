// 鉛字印刷的質感（純邏輯）：每個字微小的位移與旋轉、墨色深淺、偶爾斷筆或缺角、
// 直行微微歪斜、欄線粗細不均與斷點、整版在紙上微斜與四邊留白不等。強度 0～100，
// 全部由種子決定，預覽與列印一致。

import { gaussianish, int, range, type Rng } from '../random.ts';

export interface PressGlyph {
  /** 位移（em）。 */
  readonly dx: number;
  readonly dy: number;
  /** 旋轉（度）。 */
  readonly rot: number;
  /** 墨色濃淡 0～1。 */
  readonly ink: number;
  /** 缺角或斷筆的樣式：0 = 完好，1～4 = 四種缺口。 */
  readonly chip: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** strength 為 0～100。 */
export function pressGlyph(rng: Rng, strength: number): PressGlyph {
  const k = clamp(strength, 0, 100) / 100;
  return {
    dx: clamp(gaussianish(rng) * 0.035 * k, -0.08, 0.08),
    dy: clamp(gaussianish(rng) * 0.03 * k, -0.08, 0.08),
    rot: clamp(gaussianish(rng) * 1.6 * k, -4, 4),
    ink: clamp(1 - Math.abs(gaussianish(rng)) * 0.22 * k - (rng() < 0.04 * k ? 0.25 : 0), 0.45, 1),
    chip: rng() < 0.014 * k ? int(rng, 1, 4) : 0,
  };
}

/** 一直行的歪斜角度（度）。 */
export function columnSkew(rng: Rng, strength: number): number {
  return clamp(gaussianish(rng) * 0.22 * (strength / 100), -0.6, 0.6);
}

export interface PagePlacement {
  /** 整版旋轉角度（度）。 */
  readonly rotate: number;
  /** 位移（公釐）：讓四邊留白不等。 */
  readonly dx: number;
  readonly dy: number;
}

export function pagePlacement(rng: Rng, strength: number): PagePlacement {
  const k = clamp(strength, 0, 100) / 100;
  return {
    rotate: clamp(gaussianish(rng) * 0.32 * k, -0.7, 0.7),
    dx: clamp(gaussianish(rng) * 1.6 * k, -3, 3),
    dy: clamp(gaussianish(rng) * 1.3 * k, -2.5, 2.5),
  };
}

export interface RuleInk {
  /** 線寬（公釐）。 */
  readonly width: number;
  /** stroke-dasharray（公釐）；沒有斷點時為空字串。 */
  readonly dash: string;
  readonly opacity: number;
}

/** 欄線：粗細不均，偶有斷點。length 為線長（公釐）。 */
export function ruleInk(rng: Rng, strength: number, base: number, length: number): RuleInk {
  const k = clamp(strength, 0, 100) / 100;
  const width = clamp(base * (1 + gaussianish(rng) * 0.28 * k), base * 0.55, base * 1.7);
  let dash = '';
  if (k > 0 && rng() < 0.55 * k && length > 12) {
    const parts: number[] = [];
    let pos = 0;
    while (pos < length) {
      const on = range(rng, 8, 40);
      const off = rng() < 0.5 ? range(rng, 0.25, 0.9) * (0.4 + k) : range(rng, 0.05, 0.2);
      parts.push(Number(on.toFixed(2)), Number(off.toFixed(2)));
      pos += on + off;
    }
    dash = parts.join(' ');
  }
  return { width: Number(width.toFixed(3)), dash, opacity: Number(clamp(1 - Math.abs(gaussianish(rng)) * 0.18 * k, 0.6, 1).toFixed(2)) };
}
