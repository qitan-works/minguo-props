// 把含文字層標記的文字畫成 DOM（只用 textContent，不用 innerHTML）。

import type { MadGlyph } from '../lib/madness.ts';
import { parseMarkup, type MarkKind, type Segment } from '../lib/markup.ts';
import { h } from './dom.ts';

function segmentNode(seg: Segment): Node {
  if (!seg.mark) return document.createTextNode(seg.text);
  return markedSpan(seg.mark, seg.text, seg.replacement);
}

export function markedSpan(mark: MarkKind, text: string, replacement?: string): HTMLElement {
  switch (mark) {
    case 'rewrite': {
      const ruby = h('ruby', { class: 'mk mk-rewrite' }, h('span', { class: 'mk-old', text }));
      if (replacement) ruby.appendChild(h('rt', { text: replacement }));
      return ruby;
    }
    case 'cutoff': {
      // 最後兩個字的筆畫被切掉一部分
      const chars = Array.from(text);
      const span = h('span', { class: 'mk mk-cutoff' });
      chars.forEach((ch, i) => {
        const fromEnd = chars.length - i;
        span.appendChild(fromEnd <= 2 ? h('span', { class: fromEnd === 1 ? 'mk-cut2' : 'mk-cut1', text: ch }) : document.createTextNode(ch));
      });
      return span;
    }
    default:
      return h('span', { class: ['mk', `mk-${mark}`], dataset: { mark }, text });
  }
}

/** 把一段文字（可含標記）放進 element。 */
export function fillMarked(el: HTMLElement, text: string): HTMLElement {
  for (const seg of parseMarkup(text)) el.appendChild(segmentNode(seg));
  return el;
}

/** 逐字已有標記的一行（報紙排版用）：把連續同標記的字合成一個 span。 */
export function fillMarkedLine(el: HTMLElement, text: string, marks: readonly (MarkKind | undefined)[] | undefined): HTMLElement {
  if (!marks || marks.every((m) => m === undefined)) {
    el.textContent = text;
    return el;
  }
  const chars = Array.from(text);
  let run = '';
  let runMark: MarkKind | undefined;
  const flush = (): void => {
    if (!run) return;
    el.appendChild(runMark ? markedSpan(runMark === 'rewrite' ? 'strike' : runMark, run) : document.createTextNode(run));
    run = '';
  };
  chars.forEach((ch, i) => {
    const m = marks[i];
    if (m !== runMark) {
      flush();
      runMark = m;
    }
    run += ch;
  });
  flush();
  return el;
}

/** 一個「越寫越亂」的字：位移旋轉、字級與字距、墨色、重描、墨團、橫躺倒寫、換字型。 */
function madSpan(ch: string, j: MadGlyph): HTMLElement {
  const span = h('span', {
    class: ['mad', j.alt && 'mad-alt'],
    text: ch,
    style: {
      transform: `translate(${j.dx.toFixed(3)}em, ${j.dy.toFixed(3)}em) rotate(${j.rotate.toFixed(1)}deg)`,
      'font-size': `${j.size.toFixed(3)}em`,
      'margin-inline-end': `${j.gap.toFixed(3)}em`,
      '--a': j.ink.toFixed(2),
    },
  });
  for (const o of j.overdraw) {
    span.appendChild(
      h('span', {
        class: 'mad-over',
        text: ch,
        attrs: { 'aria-hidden': 'true' },
        style: { transform: `translate(${o.dx.toFixed(3)}em, ${o.dy.toFixed(3)}em) rotate(${o.rotate.toFixed(1)}deg)`, '--a': o.ink.toFixed(2) },
      }),
    );
  }
  if (j.blob) {
    span.appendChild(
      h('span', {
        class: 'mad-blob',
        attrs: { 'aria-hidden': 'true' },
        style: { width: `${(j.blob.r * 2).toFixed(3)}em`, height: `${(j.blob.r * 2.3).toFixed(3)}em`, left: `${(0.5 + j.blob.dx - j.blob.r).toFixed(3)}em`, top: `${(0.5 + j.blob.dy - j.blob.r).toFixed(3)}em` },
      }),
    );
  }
  return span;
}

/** 每個字套上「越寫越亂」；回傳下一個字的序號（跨段落連續計數）。 */
export function fillMarkedMad(el: HTMLElement, text: string, index: number, glyph: (i: number) => MadGlyph | null): number {
  let i = index;
  const madChar = (ch: string): Node => {
    const j = glyph(i++);
    return j ? madSpan(ch, j) : document.createTextNode(ch);
  };
  for (const seg of parseMarkup(text)) {
    if (!seg.mark) {
      for (const ch of seg.text) el.appendChild(madChar(ch));
    } else if (seg.mark === 'rewrite' || seg.mark === 'cutoff') {
      el.appendChild(markedSpan(seg.mark, seg.text, seg.replacement));
      i += Array.from(seg.text + (seg.replacement ?? '')).length;
    } else {
      const span = h('span', { class: ['mk', `mk-${seg.mark}`], dataset: { mark: seg.mark } });
      for (const ch of seg.text) span.appendChild(madChar(ch));
      el.appendChild(span);
    }
  }
  return i;
}
