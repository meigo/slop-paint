/**
 * Flood fill (paint bucket) using a scanline algorithm.
 * Operates on raw ImageData for performance.
 */
export function floodFill(
  ctx: CanvasRenderingContext2D,
  startX: number,
  startY: number,
  fillColor: { r: number; g: number; b: number; a: number },
  tolerance: number = 32
) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;

  const sx = Math.round(startX);
  const sy = Math.round(startY);
  if (sx < 0 || sx >= w || sy < 0 || sy >= h) return;

  const startIdx = (sy * w + sx) * 4;
  const targetR = data[startIdx];
  const targetG = data[startIdx + 1];
  const targetB = data[startIdx + 2];
  const targetA = data[startIdx + 3];

  // Don't fill if clicking on the same color
  if (
    Math.abs(targetR - fillColor.r) <= tolerance &&
    Math.abs(targetG - fillColor.g) <= tolerance &&
    Math.abs(targetB - fillColor.b) <= tolerance &&
    Math.abs(targetA - fillColor.a) <= tolerance
  ) {
    return;
  }

  const visited = new Uint8Array(w * h);

  function matches(idx: number): boolean {
    if (visited[idx / 4]) return false;
    const i = idx;
    return (
      Math.abs(data[i] - targetR) <= tolerance &&
      Math.abs(data[i + 1] - targetG) <= tolerance &&
      Math.abs(data[i + 2] - targetB) <= tolerance &&
      Math.abs(data[i + 3] - targetA) <= tolerance
    );
  }

  function setPixel(idx: number) {
    data[idx] = fillColor.r;
    data[idx + 1] = fillColor.g;
    data[idx + 2] = fillColor.b;
    data[idx + 3] = fillColor.a;
    visited[idx / 4] = 1;
  }

  // Scanline flood fill
  const stack: [number, number][] = [[sx, sy]];

  while (stack.length > 0) {
    const [x, y] = stack.pop()!;
    let idx = (y * w + x) * 4;

    if (!matches(idx)) continue;

    // Find left edge
    let lx = x;
    while (lx > 0 && matches(((y * w) + lx - 1) * 4)) {
      lx--;
    }

    // Scan right, filling pixels
    let rx = lx;
    let aboveAdded = false;
    let belowAdded = false;

    while (rx < w) {
      idx = (y * w + rx) * 4;
      if (!matches(idx)) break;

      setPixel(idx);

      // Check pixel above
      if (y > 0) {
        const aboveIdx = ((y - 1) * w + rx) * 4;
        if (matches(aboveIdx)) {
          if (!aboveAdded) {
            stack.push([rx, y - 1]);
            aboveAdded = true;
          }
        } else {
          aboveAdded = false;
        }
      }

      // Check pixel below
      if (y < h - 1) {
        const belowIdx = ((y + 1) * w + rx) * 4;
        if (matches(belowIdx)) {
          if (!belowAdded) {
            stack.push([rx, y + 1]);
            belowAdded = true;
          }
        } else {
          belowAdded = false;
        }
      }

      rx++;
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

export function hexToRgba(hex: string, opacity: number): { r: number; g: number; b: number; a: number } {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const a = Math.round((opacity / 100) * 255);
  return { r, g, b, a };
}
