/**
 * Compress an image file to a base64 data URL suitable for OCR.
 * Resizes to maxWidth (default 1600px) and compresses as JPEG (quality 0.8).
 * ID cards don't need full-resolution photos — 1600px is plenty for Claude Vision.
 */
export function compressImageForOcr(
  file: File,
  maxWidth = 1600,
  quality = 0.8,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;

      // Only downscale, never upscale
      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas not supported'));
        return;
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
