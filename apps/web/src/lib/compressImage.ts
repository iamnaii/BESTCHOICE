/**
 * Compress an image file to a base64 data URL suitable for OCR.
 * Resizes to maxWidth (default 1600px) and compresses as JPEG (quality 0.8).
 * ID cards don't need full-resolution photos — 1600px is plenty for Claude Vision.
 */
/**
 * Read EXIF orientation from a JPEG file.
 * Returns orientation value 1-8, or 1 (normal) if not found.
 */
function readExifOrientation(file: File): Promise<number> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const view = new DataView(e.target?.result as ArrayBuffer);
      // Check for JPEG SOI marker
      if (view.byteLength < 2 || view.getUint16(0) !== 0xFFD8) {
        resolve(1);
        return;
      }
      let offset = 2;
      while (offset < view.byteLength - 2) {
        const marker = view.getUint16(offset);
        offset += 2;
        if (marker === 0xFFE1) {
          // APP1 (EXIF)
          const length = view.getUint16(offset);
          offset += 2;
          // Check "Exif\0\0"
          if (view.getUint32(offset) !== 0x45786966) { resolve(1); return; }
          const tiffStart = offset + 6;
          const bigEndian = view.getUint16(tiffStart) === 0x4D4D;
          const ifdOffset = view.getUint32(tiffStart + 4, !bigEndian);
          const entries = view.getUint16(tiffStart + ifdOffset, !bigEndian);
          for (let i = 0; i < entries; i++) {
            const entryOffset = tiffStart + ifdOffset + 2 + i * 12;
            if (entryOffset + 12 > view.byteLength) break;
            if (view.getUint16(entryOffset, !bigEndian) === 0x0112) {
              resolve(view.getUint16(entryOffset + 8, !bigEndian));
              return;
            }
          }
          resolve(1);
          return;
        } else if ((marker & 0xFF00) === 0xFF00) {
          offset += view.getUint16(offset);
        } else {
          break;
        }
      }
      resolve(1);
    };
    reader.onerror = () => resolve(1);
    // Only read first 64KB for EXIF — no need to load entire file
    reader.readAsArrayBuffer(file.slice(0, 65536));
  });
}

/**
 * Apply EXIF orientation transform to canvas context.
 */
function applyOrientation(ctx: CanvasRenderingContext2D, orientation: number, w: number, h: number) {
  switch (orientation) {
    case 2: ctx.transform(-1, 0, 0, 1, w, 0); break;
    case 3: ctx.transform(-1, 0, 0, -1, w, h); break;
    case 4: ctx.transform(1, 0, 0, -1, 0, h); break;
    case 5: ctx.transform(0, 1, 1, 0, 0, 0); break;
    case 6: ctx.transform(0, 1, -1, 0, h, 0); break;
    case 7: ctx.transform(0, -1, -1, 0, h, w); break;
    case 8: ctx.transform(0, -1, 1, 0, 0, w); break;
  }
}

export async function compressImageForOcr(
  file: File,
  maxWidth = 1600,
  quality = 0.8,
): Promise<string> {
  const orientation = await readExifOrientation(file);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;

      // Only downscale, never upscale
      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }

      // For orientations 5-8, width and height are swapped
      const swapped = orientation >= 5 && orientation <= 8;
      const canvas = document.createElement('canvas');
      canvas.width = swapped ? height : width;
      canvas.height = swapped ? width : height;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas not supported'));
        return;
      }

      if (orientation > 1) {
        applyOrientation(ctx, orientation, width, height);
      }
      ctx.drawImage(img, 0, 0, width, height);

      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      URL.revokeObjectURL(img.src);
      resolve(dataUrl);
    };
    img.onerror = () => {
      URL.revokeObjectURL(img.src);
      reject(new Error('ไม่สามารถอ่านไฟล์รูปภาพได้'));
    };
    img.src = URL.createObjectURL(file);
  });
}
