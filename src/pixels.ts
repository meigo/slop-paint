/**
 * Write `data` onto `ctx`'s canvas at device (x, y), replacing those pixels.
 *
 * `putImageData` does that and ignores the transform, but on iPad WebKit a later
 * `drawImage` of the same canvas — how `composite()` puts a layer on screen — can
 * keep the previous image. Undo then empties its stack while the stroke stays
 * visible, until the next real draw. A canvas made for this write has no cached
 * image: one `putImageData` there, then `drawImage` onto the layer, is what the
 * screen updates from. `willReadFrequently` keeps that source unaccelerated, which
 * is the mode where `putImageData` stays coherent.
 *
 * A clip still applies (unlike `putImageData`). Callers write with none in effect.
 */
export function blitImageData(ctx: CanvasRenderingContext2D, data: ImageData, x = 0, y = 0): void {
  const src = document.createElement("canvas");
  src.width = data.width;
  src.height = data.height;
  // iOS drops an over-limit canvas to 0×0 instead of throwing.
  if (src.width !== data.width || src.height !== data.height) {
    ctx.putImageData(data, x, y);
    return;
  }
  src.getContext("2d", { willReadFrequently: true })!.putImageData(data, 0, 0);
  ctx.save();
  ctx.resetTransform();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.filter = "none";
  ctx.shadowColor = "rgba(0,0,0,0)";
  ctx.shadowBlur = 0;
  ctx.clearRect(x, y, data.width, data.height);
  ctx.drawImage(src, x, y);
  ctx.restore();
  // Release the backing store now. Canvas memory is what runs out on an iPad.
  src.width = 0;
  src.height = 0;
}
