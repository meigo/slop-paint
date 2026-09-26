import type { RefSource } from "./layers";
import { fitDecodedSize, newRefId } from "./ref-placement";

/** Decode an image file into a reference's source: the bytes kept whole (they go into the PSD as
 *  the Smart Object's embedded file) and a drawing copy capped to what an iPad canvas allows. */
export async function decodeRefSource(
  bytes: Uint8Array,
  name: string,
  id: string = newRefId(),
): Promise<RefSource> {
  const bmp = await createImageBitmap(new Blob([bytes as BlobPart]));
  try {
    const size = fitDecodedSize(bmp.width, bmp.height);
    const image = document.createElement("canvas");
    image.width = size.w;
    image.height = size.h;
    const ctx = image.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bmp, 0, 0, size.w, size.h);
    return { id, name, bytes, width: bmp.width, height: bmp.height, image };
  } finally {
    bmp.close();
  }
}
