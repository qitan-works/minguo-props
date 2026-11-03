// 瘋狂感的手寫（純邏輯）：「越寫越亂」——從第幾個字開始，越往後越亂。由種子決定，預覽與列印一致。
//
// 強度 60 要明顯，100 要接近失控：
// - 行歪斜偏離格線：每個字的橫向位移是沿著字序平滑變化的漂移，整行看起來歪斜、彎曲；
// - 字越寫越大（改變真正的字級，所以後面的行會變寬、壓過格線），字距忽大忽小、偶爾重疊；
// - 同一個字重描兩三次並微錯位，墨色忽深忽淺，偶有墨團；
// - 少數字橫躺或倒寫；
// - 可在中途換成另一個更潦草的手寫字型。
// 另有文字層面的改寫：夾雜塗改後重寫、同一句重複、同一句寫滿整頁。

import { gaussianish, int, range, rngFor } from './random.ts';

export interface MadnessOptions {
  /** 強度 0～100。 */
  readonly strength: number;
  /** 從第幾個字（0 起算）開始變亂。 */
  readonly start: number;
  readonly seed: number;
  /** 亂到這個進度（0～1）之後換成第二個手寫字型；不換時省略。 */
  readonly switchAt?: number;
}

export interface MadGlyph {
  /** 位移（以字高 em 計）。 */
  readonly dx: number;
  readonly dy: number;
  /** 旋轉角度（含橫躺、倒寫）。 */
  readonly rotate: number;
  /** 字級倍數（會影響排版：越寫越大）。 */
  readonly size: number;
  /** 這個字後面多留（或負數表示擠進）的距離（em）。 */
  readonly gap: number;
  /** 墨色濃淡 0～1。 */
  readonly ink: number;
  /** 重描的幾次（相對原字的微小錯位）。 */
  readonly overdraw: readonly { readonly dx: number; readonly dy: number; readonly rotate: number; readonly ink: number }[];
  /** 墨團（以 em 計的半徑與位置）。 */
  readonly blob: { readonly r: number; readonly dx: number; readonly dy: number } | null;
  /** 0 = 正常，90 = 橫躺，180 = 倒寫。 */
  readonly flip: 0 | 90 | 180;
  /** 使用第二個手寫字型。 */
  readonly alt: boolean;
}

/** 第二版的簡化介面：只有位移、旋轉、縮放與墨色。 */
export interface CharJitter {
  readonly dx: number;
  readonly dy: number;
  readonly rotate: number;
  readonly scale: number;
  readonly ink: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** 開始變亂之後的進度（0～1）與當下的亂度（0～1）。 */
export function madIntensity(index: number, total: number, o: MadnessOptions): { progress: number; k: number } | null {
  if (o.strength <= 0 || index < o.start || total <= 0) return null;
  const span = Math.max(1, total - o.start);
  const progress = Math.min(1, (index - o.start + 1) / span);
  const k = (Math.min(100, o.strength) / 100) * (0.25 + 0.75 * Math.pow(progress, 0.8));
  return { progress, k };
}

/** 沿字序平滑變化的漂移（幾個不同週期的正弦相加），讓整行歪斜、彎曲而不是每個字亂跳。 */
function drift(seed: number, index: number): number {
  const rng = rngFor(seed, 'mad:drift');
  let v = 0;
  for (let t = 0; t < 3; t++) {
    const period = range(rng, 9, 40);
    const phase = range(rng, 0, Math.PI * 2);
    const amp = range(rng, 0.5, 1);
    v += amp * Math.sin((index / period) * Math.PI * 2 + phase);
  }
  return v / 2.2;
}

/** 第 index 個字的亂法；在開始之前或強度為 0 時回傳 null。 */
export function madGlyph(index: number, total: number, o: MadnessOptions): MadGlyph | null {
  const m = madIntensity(index, total, o);
  if (!m) return null;
  const { progress, k } = m;
  const rng = rngFor(o.seed, `mad:${index}`);
  const flipRoll = rng();
  const flip: MadGlyph['flip'] = k > 0.5 && flipRoll < 0.03 * k * k ? (flipRoll < 0.015 * k * k ? 180 : 90) : 0;
  const overdraw: MadGlyph['overdraw'][number][] = [];
  if (rng() < 0.38 * k) {
    const copies = rng() < 0.4 ? 2 : 1;
    for (let c = 0; c < copies; c++) {
      overdraw.push({ dx: range(rng, -0.07, 0.07) * (1 + k), dy: range(rng, -0.07, 0.07) * (1 + k), rotate: range(rng, -4, 4) * (1 + k), ink: range(rng, 0.45, 0.9) });
    }
  }
  const blob = rng() < 0.035 * k ? { r: range(rng, 0.25, 0.55) * (0.6 + k), dx: range(rng, -0.3, 0.3), dy: range(rng, -0.2, 0.6) } : null;
  const inkRoll = rng();
  return {
    dx: clamp(drift(o.seed, index) * 1.05 * k + gaussianish(rng) * 0.15 * k, -1, 1),
    dy: clamp(gaussianish(rng) * 0.14 * k, -0.4, 0.4),
    rotate: clamp(gaussianish(rng) * 75 * k, -55, 55) + flip,
    size: clamp(1 + 0.62 * k * progress + gaussianish(rng) * 0.09 * k, 0.8, 1.7),
    gap: clamp(gaussianish(rng) * 0.22 * k + (rng() < 0.1 * k ? -0.32 * k : 0), -0.45, 0.6),
    ink: clamp(inkRoll < 0.15 * k ? 1 : 1 - Math.abs(gaussianish(rng)) * 1.1 * k, 0.3, 1),
    overdraw,
    blob,
    flip,
    alt: o.switchAt !== undefined && progress >= o.switchAt,
  };
}

/** 第二版的簡化介面（只取位移、旋轉、縮放與墨色）。 */
export function charJitter(index: number, total: number, o: MadnessOptions): CharJitter | null {
  const g = madGlyph(index, total, o);
  if (!g) return null;
  return { dx: g.dx, dy: g.dy, rotate: g.rotate, scale: g.size, ink: g.ink };
}

export interface MadTextOptions {
  readonly start: number;
  readonly seed: number;
  /** 夾雜塗改後重寫。 */
  readonly rewrite: boolean;
  /** 同一句重複。 */
  readonly repeat: boolean;
  /** 同一句寫滿整頁：把開始變亂後的第一句一直重複，直到總字數至少這麼多。 */
  readonly fill?: number;
}

/** 開始變亂之後的第一句（含句末標點）與它結束的位置。 */
function firstSentence(chars: readonly string[], start: number): { sentence: string; end: number } | null {
  if (chars.length <= start) return null;
  const rest = chars.slice(start).join('');
  const m = /[^。！？\n]+[。！？]?/.exec(rest);
  if (!m) return null;
  return { sentence: m[0].trim(), end: start + Array.from(rest.slice(0, m.index + m[0].length)).length };
}

/**
 * 依選項改寫文字（不含標記的純文字）：
 * - 同一句寫滿整頁：開始變亂之後的第一句一直重複，後面的原文不再出現；
 * - 重複：開始變亂之後的第一句，接著再寫兩遍；
 * - 塗改：開始變亂之後，每隔數字插入一段「寫錯、劃掉、重寫」（以 [刪:…] 標記）。
 */
export function madText(text: string, o: MadTextOptions): string {
  let chars = Array.from(text);
  if (o.fill && o.fill > 0) {
    const first = firstSentence(chars, o.start);
    if (first && first.sentence) {
      const out = chars.slice(0, first.end);
      const sentence = Array.from(first.sentence);
      while (out.length < o.fill) out.push(...sentence);
      chars = out;
    }
  } else if (o.repeat) {
    const first = firstSentence(chars, o.start);
    if (first) chars = [...chars.slice(0, first.end), ...Array.from(first.sentence + first.sentence), ...chars.slice(first.end)];
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
