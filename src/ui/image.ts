// 照片處理：用 FileReader 讀進瀏覽器，再以 canvas 縮小並轉成 JPEG。
// 全程只在本機進行，不會上傳；重新編碼也會去掉相機寫入的 EXIF（例如拍攝地點）。

import { MAX_IMAGE_DATA_URL_LENGTH, isSafeImageDataUrl } from '../props/schema.ts';

const MAX_FILE_BYTES = 30 * 1024 * 1024;
const MAX_EDGE = 1600;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('無法讀取照片。'));
    });
    reader.addEventListener('error', () => reject(new Error('無法讀取照片。')));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.addEventListener('load', () => resolve(img));
    img.addEventListener('error', () => reject(new Error('這個檔案不是瀏覽器能顯示的圖片。')));
    img.src = src;
  });
}

export async function readImageAsDataUrl(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
    throw new Error('只支援 PNG、JPEG、WebP 或 GIF 圖片。');
  }
  if (file.size > MAX_FILE_BYTES) throw new Error('照片太大（上限 30 MB）。');
  const original = await readAsDataUrl(file);
  const img = await loadImage(original);
  const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('瀏覽器無法處理照片。');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  let url = canvas.toDataURL('image/jpeg', 0.85);
  if (url.length > MAX_IMAGE_DATA_URL_LENGTH) url = canvas.toDataURL('image/jpeg', 0.6);
  if (!isSafeImageDataUrl(url)) throw new Error('照片處理後仍然太大，請換一張較小的照片。');
  return url;
}
