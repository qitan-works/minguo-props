// 把含文字層標記的文字畫成 DOM（只用 textContent，不用 innerHTML）。

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
