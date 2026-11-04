// 古物（第五版，純邏輯）：古籍殘頁的排字與朱筆圈點、碑文拓片的剝落與拓包痕跡、符籙的筆畫。
// 全部由種子決定；符籙的筆畫是程式隨機組合的原創圖形，不抄任何真實流派的符。座標單位公釐。

import type { Point } from './geometry.ts';
import { gaussianish, int, pick, range, rngFor, type Rng } from './random.ts';

const TAU = Math.PI * 2;

// ---- 古籍殘頁 ----

export interface BookChar {
  readonly ch: string;
  /** 這個字後面原本有句讀（朱筆在字的右下角點一點）。 */
  readonly stop: boolean;
  /** 被朱筆圈起來強調的字（字右側一個小圈）。 */
  readonly circled: boolean;
}

export interface BookLayout {
  /** 由右而左的每一行，每行由上而下。 */
  readonly columns: BookChar[][];
  /** 排不下而沒有印出的字數。 */
  readonly overflow: number;
}

const STOPS = new Set(['，', '。', '、', '；', '：', '！', '？', ',', '.', ';', ':', '!', '?']);
const DROP = new Set(['「', '」', '『', '』', '（', '）', '《', '》', '〈', '〉', '“', '”', '‘', '’', ' ', '　', '\n', '\r', '\t']);

/**
 * 把正文排進 cols 行、每行 perCol 字。刻本沒有標點：標點拿掉，改記在前一個字上（朱筆句讀）。
 * circleRate 0～1：隨機挑幾段（三到六字）加上朱筆圈，由種子決定。
 */
export function layoutBook(text: string, cols: number, perCol: number, seed: number, circleRate = 0): BookLayout {
  const chars: { ch: string; stop: boolean }[] = [];
  for (const ch of Array.from(text)) {
    if (STOPS.has(ch)) {
      const last = chars[chars.length - 1];
      if (last) last.stop = true;
    } else if (!DROP.has(ch)) chars.push({ ch, stop: false });
  }
  const circled = new Set<number>();
  if (circleRate > 0) {
    const rng = rngFor(seed, 'book-circles');
    const runs = Math.round((chars.length / 40) * circleRate * 3);
    for (let i = 0; i < runs; i++) {
      const start = int(rng, 0, Math.max(0, chars.length - 4));
      const len = int(rng, 3, 6);
      for (let k = start; k < Math.min(chars.length, start + len); k++) {
        circled.add(k);
        if (chars[k]?.stop) break;
      }
    }
  }
  const columns: BookChar[][] = [];
  const total = Math.max(0, cols) * Math.max(1, perCol);
  for (let c = 0; c < cols; c++) columns.push(chars.slice(c * perCol, (c + 1) * perCol).map((x, i) => ({ ...x, circled: circled.has(c * perCol + i) })));
  return { columns, overflow: Math.max(0, chars.length - total) };
}

// ---- 碑文拓片 ----

export interface RubbingPlan {
  /** 剝落、看不出字的格子（行, 字）。 */
  readonly missing: ReadonlySet<string>;
  /** 石面剝落的範圍（拓不上墨，露出紙色），紙面公釐。 */
  readonly flakes: Point[][];
  /** 拓包拍打的深淺：圓心、半徑、深（正）或淺（負）。 */
  readonly dabs: readonly { readonly x: number; readonly y: number; readonly r: number; readonly tone: number }[];
  /** 拓片摺疊收藏留下的摺痕（水平與垂直的位置，0～1）。 */
  readonly folds: { readonly h: readonly number[]; readonly v: readonly number[] };
  /** 墨拓範圍的外緣（拓包拍到邊上時不整齊）。 */
  readonly edge: Point[];
}

/** 不規則的團塊。 */
export function blob(rng: Rng, cx: number, cy: number, r: number, rough: number, n = 18): Point[] {
  const ph = range(rng, 0, TAU);
  const f = int(rng, 2, 5);
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * TAU;
    const k = 1 + rough * (0.25 * Math.sin(a * f + ph) + 0.3 * gaussianish(rng));
    return { x: cx + Math.cos(a) * r * k, y: cy + Math.sin(a) * r * k };
  });
}

/**
 * 碑面 area（紙面公釐）上 cols 行 × rows 字。damage 0～100：剝落的字與石面剝落的範圍多寡。
 * 剝落的格子集中在幾塊（石碑通常是邊角或一道裂痕整片剝落），不是平均灑。
 */
export function planRubbing(
  seed: number,
  area: { x: number; y: number; w: number; h: number },
  cols: number,
  rows: number,
  damage: number,
  inkArea: { x: number; y: number; w: number; h: number } = area,
): RubbingPlan {
  const rng = rngFor(seed, 'rubbing');
  const k = Math.max(0, Math.min(100, damage)) / 100;
  const missing = new Set<string>();
  const flakes: Point[][] = [];
  const cw = area.w / Math.max(1, cols);
  const rh = area.h / Math.max(1, rows);
  const centers = int(rng, 1, 2) + Math.round(k * 4);
  for (let i = 0; i < centers; i++) {
    // 邊角或任意位置
    const corner = rng() < 0.55;
    const cx = corner ? (rng() < 0.5 ? area.x + range(rng, 0, area.w * 0.2) : area.x + area.w - range(rng, 0, area.w * 0.2)) : range(rng, area.x, area.x + area.w);
    const cy = corner ? (rng() < 0.5 ? area.y + range(rng, 0, area.h * 0.2) : area.y + area.h - range(rng, 0, area.h * 0.2)) : range(rng, area.y, area.y + area.h);
    const r = Math.min(area.w, area.h) * range(rng, 0.05, 0.12) * (0.6 + k);
    flakes.push(blob(rng, cx, cy, r, 0.9, 22));
    for (let c = 0; c < cols; c++) {
      for (let j = 0; j < rows; j++) {
        const x = area.x + area.w - (c + 0.5) * cw;
        const y = area.y + (j + 0.5) * rh;
        if (Math.hypot(x - cx, y - cy) < r * 0.85) missing.add(`${c},${j}`);
      }
    }
  }
  // 零星剝落的單字
  const singles = Math.round(cols * rows * 0.03 * k);
  for (let i = 0; i < singles; i++) {
    const c = int(rng, 0, cols - 1);
    const j = int(rng, 0, rows - 1);
    missing.add(`${c},${j}`);
    flakes.push(blob(rng, area.x + area.w - (c + 0.5) * cw + gaussianish(rng) * cw * 0.2, area.y + (j + 0.5) * rh, Math.min(cw, rh) * range(rng, 0.35, 0.6), 0.7, 14));
  }
  const dabs = Array.from({ length: 28 }, () => ({ x: range(rng, inkArea.x, inkArea.x + inkArea.w), y: range(rng, inkArea.y, inkArea.y + inkArea.h), r: range(rng, 6, 22), tone: range(rng, -1, 1) }));
  const folds = { h: [1 / 3, 2 / 3].map((t) => t + gaussianish(rng) * 0.02), v: [0.5 + gaussianish(rng) * 0.02] };
  // 外緣：沿矩形每 3 公釐取一點，往內外抖動
  const edge: Point[] = [];
  const along = (x0: number, y0: number, x1: number, y1: number): void => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(2, Math.round(len / 3));
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const nx = -(y1 - y0) / len;
      const ny = (x1 - x0) / len;
      const o = gaussianish(rng) * 1.4;
      edge.push({ x: x0 + (x1 - x0) * t + nx * o, y: y0 + (y1 - y0) * t + ny * o });
    }
  };
  const { x, y, w, h } = { x: inkArea.x - 2, y: inkArea.y - 2, w: inkArea.w + 4, h: inkArea.h + 4 };
  along(x, y, x + w, y);
  along(x + w, y, x + w, y + h);
  along(x + w, y + h, x, y + h);
  along(x, y + h, x, y);
  return { missing, flakes, dabs, folds, edge };
}

// ---- 符籙 ----

/** 一筆：沿中心線、依筆壓粗細產生的多邊形（起筆重、收筆尖），可再加墨點。 */
export interface BrushStroke {
  readonly outline: Point[];
}

/** 平滑的中心線 → 筆畫外形。width(t) 由起筆的頓、行筆、收筆的尖組成。 */
export function brush(line: readonly Point[], width: number, rng: Rng, taper = 1): BrushStroke {
  const pts = smooth(line, 3);
  const n = pts.length;
  const left: Point[] = [];
  const right: Point[] = [];
  const press = range(rng, 1.1, 1.45);
  for (let i = 0; i < n; i++) {
    const t = n <= 1 ? 0 : i / (n - 1);
    const a = pts[Math.max(0, i - 1)] as Point;
    const b = pts[Math.min(n - 1, i + 1)] as Point;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / len;
    const ny = (b.x - a.x) / len;
    // 起筆一頓（較粗）、中段略細、收筆漸尖
    const w = width * (t < 0.12 ? press - (press - 1) * (t / 0.12) * 0.6 : 1 - Math.max(0, (t - 0.65) / 0.35) * 0.85 * taper) * (1 + gaussianish(rng) * 0.06);
    const p = pts[i] as Point;
    left.push({ x: p.x + (nx * w) / 2, y: p.y + (ny * w) / 2 });
    right.push({ x: p.x - (nx * w) / 2, y: p.y - (ny * w) / 2 });
  }
  return { outline: [...left, ...right.reverse()] };
}

/** Chaikin 平滑。 */
function smooth(line: readonly Point[], times: number): Point[] {
  let pts = [...line];
  for (let k = 0; k < times && pts.length > 2; k++) {
    const next: Point[] = [pts[0] as Point];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i] as Point;
      const b = pts[i + 1] as Point;
      next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 }, { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    next.push(pts[pts.length - 1] as Point);
    pts = next;
  }
  return pts;
}

export interface TalismanPlan {
  readonly strokes: BrushStroke[];
  readonly dots: { readonly x: number; readonly y: number; readonly r: number }[];
  /** 符膽中間寫字的位置（直排一行），寬 w、上 y0、下 y1。 */
  readonly textBox: { readonly x: number; readonly y0: number; readonly y1: number; readonly w: number };
}

/**
 * 符的結構：符頭（上方的冠：幾道帶鉤的短豎與一道弧）、符膽（中軸與兩側的迴圈、折線、眼形）、
 * 符腳（中軸往下延伸，收成螺旋或折尾）。complexity 0～100 決定筆畫多寡。都是隨機組合的原創圖形。
 */
export function planTalisman(seed: number, w: number, h: number, complexity: number): TalismanPlan {
  const rng = rngFor(seed, 'talisman');
  const k = Math.max(0, Math.min(100, complexity)) / 100;
  const cx = w / 2;
  const sw = Math.max(1.4, w * 0.035);
  const strokes: BrushStroke[] = [];
  const dots: TalismanPlan['dots'][number][] = [];
  const line = (pts: Point[], width = sw, taper = 1): void => {
    strokes.push(brush(pts, width, rng, taper));
  };
  const jitter = (p: Point, a = 0.6): Point => ({ x: p.x + gaussianish(rng) * a, y: p.y + gaussianish(rng) * a });

  // 符頭：3 或 5 道短豎，頂端向外鉤；上面一道弧（冠）；最上方三點
  const headTop = h * 0.06;
  const headBottom = h * 0.2;
  const prongs = pick(rng, [3, 3, 5]);
  const span = w * range(rng, 0.42, 0.6);
  for (let i = 0; i < prongs; i++) {
    const x = cx - span / 2 + (span * i) / (prongs - 1);
    const out = (x - cx) / (span / 2 || 1);
    line([jitter({ x: x + out * 2.2, y: headTop + h * 0.035 }), { x: x + out * 0.6, y: headTop + h * 0.05 }, jitter({ x, y: headTop + h * 0.085 }), jitter({ x, y: headBottom })], sw * 0.9);
  }
  const arcY = headTop + h * range(rng, 0.03, 0.05);
  line(Array.from({ length: 9 }, (_, i) => {
    const t = i / 8;
    return jitter({ x: cx - span * 0.62 + span * 1.24 * t, y: arcY - Math.sin(t * Math.PI) * h * 0.035 }, 0.3);
  }), sw * 0.8, 0.6);
  for (let i = -1; i <= 1; i++) dots.push({ x: cx + i * w * 0.12, y: headTop - h * 0.01 + Math.abs(i) * h * 0.008, r: sw * range(rng, 0.55, 0.8) });
  // 符頭下的一道橫（壓住冠）
  line([jitter({ x: cx - span * 0.55, y: headBottom + 1.5 }), jitter({ x: cx + span * 0.55, y: headBottom + 0.5 })], sw * 1.1);

  // 中軸：從符頭下到符腳
  const bodyTop = headBottom + h * 0.03;
  const bodyBottom = h * 0.72;
  const footBottom = h * 0.95;
  const spine: Point[] = [];
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    spine.push({ x: cx + Math.sin(t * Math.PI * range(rng, 1.5, 2.5)) * w * 0.02, y: bodyTop + (footBottom - bodyTop) * 0.82 * t });
  }
  line(spine, sw * 1.05, 0.4);

  // 符膽：兩側對稱略有差異的迴圈、折線、眼形，數量依 complexity
  const textBox = { x: cx, y0: bodyTop + h * 0.06, y1: bodyTop + h * 0.06 + h * 0.2, w: w * 0.3 };
  const clusters = 2 + Math.round(k * 4);
  for (let i = 0; i < clusters; i++) {
    const y = range(rng, bodyTop + h * 0.02, bodyBottom);
    if (y > textBox.y0 - 3 && y < textBox.y1 + 3 && rng() < 0.7) continue;
    for (const side of [-1, 1]) {
      const x = cx + side * w * range(rng, 0.18, 0.3);
      const kind = int(rng, 0, 3);
      if (kind === 0) {
        // 迴圈：從中軸拉出一個圈再收回
        const r = w * range(rng, 0.06, 0.1);
        line(Array.from({ length: 16 }, (_, j) => {
          const a = (j / 15) * TAU * 1.15 - Math.PI / 2;
          return { x: x + Math.cos(a) * r * side, y: y + Math.sin(a) * r };
        }).reverse().concat([{ x: cx + side * 1.5, y: y + r * 1.4 }]), sw * 0.8);
      } else if (kind === 1) {
        // 折線（如雷紋）
        const n = int(rng, 3, 5);
        const pts: Point[] = [{ x: cx + side * 1.2, y }];
        for (let j = 1; j <= n; j++) pts.push({ x: cx + side * (w * 0.08 * j), y: y + (j % 2 === 0 ? -1 : 1) * h * 0.018 });
        line(pts.map((p) => jitter(p, 0.3)), sw * 0.75);
      } else if (kind === 2) {
        // 眼形：一個橢圓加中間一點
        const rx = w * range(rng, 0.07, 0.1);
        const ry = rx * range(rng, 0.45, 0.6);
        line(Array.from({ length: 18 }, (_, j) => {
          const a = (j / 17) * TAU;
          return { x: x + Math.cos(a) * rx, y: y + Math.sin(a) * ry };
        }), sw * 0.7, 0.2);
        dots.push({ x, y, r: sw * 0.7 });
      } else {
        // 一撇一捺
        line([{ x: cx + side * 1, y: y - h * 0.02 }, jitter({ x: x + side * w * 0.05, y: y + h * 0.03 })], sw * 0.9);
      }
    }
  }

  // 符腳：中軸末端收成螺旋或折尾，兩側各一道短鉤
  const end = spine[spine.length - 1] as Point;
  if (rng() < 0.6) {
    const turns = range(rng, 1.6, 2.6);
    const r0 = w * range(rng, 0.12, 0.17);
    const pts: Point[] = [];
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      const a = Math.PI / 2 + t * turns * TAU;
      const r = r0 * (1 - t * 0.85);
      pts.push({ x: end.x + Math.cos(a) * r - Math.cos(Math.PI / 2) * r0, y: end.y + r0 - Math.sin(a) * r });
    }
    line([end, ...pts], sw * 0.9, 0.8);
  } else {
    const pts: Point[] = [end];
    let y = end.y;
    for (let i = 0; i < 5; i++) {
      y += h * 0.018;
      pts.push({ x: cx + (i % 2 === 0 ? 1 : -1) * w * 0.1, y });
    }
    line(pts.map((p) => jitter(p, 0.3)), sw * 0.9);
  }
  for (const side of [-1, 1]) {
    const y = range(rng, bodyBottom, footBottom - h * 0.08);
    line([{ x: cx + side * 1, y }, { x: cx + side * w * 0.16, y: y + h * 0.02 }, jitter({ x: cx + side * w * 0.2, y: y - h * 0.01 })], sw * 0.8);
  }
  return { strokes, dots, textBox };
}
