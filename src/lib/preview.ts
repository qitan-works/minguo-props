// 預覽的大小（純邏輯）：整張、符合寬度、實際大小，或自訂倍率。
// 預設「整張」：整張道具一定看得到；放大後超出時在預覽欄裡上下左右捲動。

export type PreviewFit = 'page' | 'width' | 'actual' | 'custom';

export interface PreviewZoom {
  readonly fit: PreviewFit;
  /** 自訂倍率（fit = custom 時使用）。 */
  readonly zoom: number;
}

export interface Size {
  readonly w: number;
  readonly h: number;
}

export const DEFAULT_PREVIEW_ZOOM: PreviewZoom = { fit: 'page', zoom: 1 };
export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 4;
/** 放大、縮小一次的倍數。 */
export const ZOOM_STEP = 1.25;
/** 整張、符合寬度時最多放大的倍數（名片等小道具才不會大得離譜）。 */
export const FIT_MAX = 2.5;

const FITS: readonly PreviewFit[] = ['page', 'width', 'actual', 'custom'];

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** 依目前的選擇、道具原本的大小與可用的空間（都是 CSS 像素）算出縮放倍率。 */
export function previewScale(z: PreviewZoom, natural: Size, available: Size): number {
  if (!(natural.w > 0 && natural.h > 0)) return 1;
  const w = Math.max(1, available.w);
  const h = Math.max(1, available.h);
  let scale: number;
  switch (z.fit) {
    case 'page':
      scale = Math.min(FIT_MAX, w / natural.w, h / natural.h);
      break;
    case 'width':
      scale = Math.min(FIT_MAX, w / natural.w);
      break;
    case 'actual':
      scale = 1;
      break;
    case 'custom':
      scale = z.zoom;
      break;
  }
  return clamp(scale, ZOOM_MIN, ZOOM_MAX);
}

/** 從目前的倍率放大（dir = 1）或縮小（dir = -1）一級，變成自訂倍率。 */
export function zoomBy(current: number, dir: 1 | -1): PreviewZoom {
  const next = dir > 0 ? current * ZOOM_STEP : current / ZOOM_STEP;
  return { fit: 'custom', zoom: Math.round(clamp(next, ZOOM_MIN, ZOOM_MAX) * 1000) / 1000 };
}

/** 讀回存在 localStorage 的選擇；格式不對就用預設（整張）。 */
export function parsePreviewZoom(raw: string | null): PreviewZoom {
  if (!raw) return DEFAULT_PREVIEW_ZOOM;
  try {
    const v = JSON.parse(raw) as { fit?: unknown; zoom?: unknown };
    const fit = FITS.find((f) => f === v.fit);
    if (!fit) return DEFAULT_PREVIEW_ZOOM;
    const zoom = typeof v.zoom === 'number' && Number.isFinite(v.zoom) ? clamp(v.zoom, ZOOM_MIN, ZOOM_MAX) : 1;
    return { fit, zoom };
  } catch {
    return DEFAULT_PREVIEW_ZOOM;
  }
}

export function serializePreviewZoom(z: PreviewZoom): string {
  return JSON.stringify({ fit: z.fit, zoom: z.zoom });
}

/** 滾輪事件的方向：往上捲是 1（放大），往下是 -1；Shift＋滾輪在部分系統會變成橫向捲動，所以也看 deltaX。 */
export function wheelDirection(deltaY: number, deltaX: number): 1 | -1 | 0 {
  const d = deltaY !== 0 ? deltaY : deltaX;
  return d === 0 ? 0 : d > 0 ? -1 : 1;
}
