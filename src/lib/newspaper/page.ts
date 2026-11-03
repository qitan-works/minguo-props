// 整版報紙的字級：依紙張大小決定內文字高。純邏輯。

/** A4 用 3.3 mm 的字，A5 用 2.8 mm，介於中間的按比例。 */
export function cellSizeFor(width: number, height: number): number {
  const area = width * height;
  return area >= 60000 ? 3.3 : area <= 32000 ? 2.8 : 3.0;
}
