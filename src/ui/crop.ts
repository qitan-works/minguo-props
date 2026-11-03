// 自由裁切：在預覽上用多邊形（逐點點擊）或手繪套索框出要保留的部分。
// 座標換算成紙面公釐後存進 JSON；之後由紙邊樣式（手撕、火燒…）沿這個外形加工。

import type { Point } from '../lib/geometry.ts';
import { PX_PER_MM } from '../lib/geometry.ts';
import { h, s } from './dom.ts';

export type CropTool = 'polygon' | 'lasso';

export interface CropSession {
  cancel(): void;
}

/** 在 stage 裡第一張紙上開始畫裁切範圍。完成時回傳紙面座標（公釐）的多邊形。 */
export function startCropDrawing(
  stage: HTMLElement,
  tool: CropTool,
  onDone: (points: Point[]) => void,
  onEnd: () => void,
): CropSession | null {
  const paper = stage.querySelector<HTMLElement>('.paper');
  if (!paper) return null;
  const widthMm = paper.offsetWidth / PX_PER_MM;
  const heightMm = paper.offsetHeight / PX_PER_MM;
  const stageBox = stage.getBoundingClientRect();
  const box = paper.getBoundingClientRect();

  const svg = s('svg', {
    class: 'crop-svg',
    attrs: { viewBox: `0 0 ${widthMm} ${heightMm}`, preserveAspectRatio: 'none' },
  });
  const line = s('polyline', { class: 'crop-line', attrs: { points: '' } });
  svg.appendChild(line);
  const overlay = h(
    'div',
    {
      class: 'crop-overlay',
      attrs: { role: 'application', 'aria-label': '在紙上畫出要保留的範圍' },
      style: {
        left: `${box.left - stageBox.left + stage.scrollLeft}px`,
        top: `${box.top - stageBox.top + stage.scrollTop}px`,
        width: `${box.width}px`,
        height: `${box.height}px`,
      },
    },
    svg,
  );
  const hint = h('div', {
    class: 'crop-hint',
    text: tool === 'polygon' ? '逐點點擊畫出多邊形，點回第一個點或按 Enter 完成，Esc 取消。' : '按住滑鼠（或手指）畫一圈，放開即完成；Esc 取消。',
  });
  stage.append(overlay, hint);

  const points: Point[] = [];
  const toMm = (e: PointerEvent | MouseEvent): Point => {
    const r = overlay.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(widthMm, ((e.clientX - r.left) / r.width) * widthMm)),
      y: Math.max(0, Math.min(heightMm, ((e.clientY - r.top) / r.height) * heightMm)),
    };
  };
  const redraw = (): void => {
    line.setAttribute('points', points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' '));
  };
  let finished = false;
  const end = (): void => {
    if (finished) return;
    finished = true;
    overlay.remove();
    hint.remove();
    document.removeEventListener('keydown', onKey);
    onEnd();
  };
  const finish = (): void => {
    if (points.length >= 3) onDone(points.map((p) => ({ x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 })));
    end();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') end();
    if (e.key === 'Enter') finish();
  };
  document.addEventListener('keydown', onKey);

  if (tool === 'polygon') {
    overlay.addEventListener('click', (e) => {
      const p = toMm(e);
      const first = points[0];
      if (first && points.length >= 3 && Math.hypot(p.x - first.x, p.y - first.y) < 4) {
        finish();
        return;
      }
      points.push(p);
      redraw();
    });
  } else {
    let drawing = false;
    overlay.addEventListener('pointerdown', (e) => {
      drawing = true;
      overlay.setPointerCapture(e.pointerId);
      points.length = 0;
      points.push(toMm(e));
      redraw();
    });
    overlay.addEventListener('pointermove', (e) => {
      if (!drawing) return;
      const p = toMm(e);
      const last = points[points.length - 1];
      if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= 1.2) {
        points.push(p);
        redraw();
      }
    });
    overlay.addEventListener('pointerup', () => {
      if (!drawing) return;
      drawing = false;
      // 套索點太多時抽稀（上限 300 點）
      while (points.length > 300) {
        for (let i = points.length - 2; i > 0; i -= 2) points.splice(i, 1);
      }
      finish();
    });
  }
  return { cancel: end };
}
