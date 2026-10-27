import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';
import { Worker } from 'node:worker_threads';
export const CUSTOMER_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
/** Structural validation only, never a content/sensitivity classification. */
export async function validateCustomerDocument(file?: Express.Multer.File) {
  const invalid = () =>
    new BadRequestException(
      'รองรับ JPEG, PNG, WebP หรือ PDF ที่สมบูรณ์ ขนาด 1–10 MB เท่านั้น (ไม่รองรับ HEIC/GIF)',
    );
  if (
    !file?.buffer ||
    !file.buffer.length ||
    file.buffer.length > CUSTOMER_DOCUMENT_MAX_BYTES ||
    file.size !== file.buffer.length
  )
    throw invalid();
  const data = file.buffer;
  let mimeType: string;
  if (data.subarray(0, 5).toString() === '%PDF-') {
    if (
      file.mimetype !== 'application/pdf' ||
      !/%%EOF\s*$/.test(data.subarray(-1024).toString('latin1')) ||
      !/\b(obj|xref)\b/.test(data.toString('latin1'))
    )
      throw invalid();
    await new Promise<void>((resolve, reject) => {
      const worker = new Worker(
        `
        const { parentPort, workerData } = require('node:worker_threads');
        const { PDFDocument } = require(workerData.modulePath);
        PDFDocument.load(workerData.bytes, { ignoreEncryption: false, throwOnInvalidObject: true, updateMetadata: false })
          .then(pdf => { const pages = pdf.getPages(); if (!pages.length || pages.length > 200 || pages.some(p => !Number.isFinite(p.getWidth()) || !Number.isFinite(p.getHeight()) || p.getWidth() <= 0 || p.getHeight() <= 0)) throw Error('invalid'); parentPort.postMessage(true); })
          .catch(() => parentPort.postMessage(false));
      `,
        {
          eval: true,
          workerData: { modulePath: require.resolve('pdf-lib'), bytes: new Uint8Array(data) },
          resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16 },
        },
      );
      let complete = false;
      const finish = (valid: boolean) => {
        if (complete) return;
        complete = true;
        clearTimeout(timer);
        void worker.terminate().then(() => (valid ? resolve() : reject(invalid())));
      };
      const timer = setTimeout(() => finish(false), 3000);
      worker.once('message', (value) => finish(value === true));
      worker.once('error', () => finish(false));
      worker.once('exit', () => finish(false));
    });
    mimeType = 'application/pdf';
  } else {
    try {
      const image = sharp(data, { limitInputPixels: 40000000, failOn: 'warning' });
      const meta = await image.metadata();
      const formats: Record<string, string> = {
        jpeg: 'image/jpeg',
        png: 'image/png',
        webp: 'image/webp',
      };
      mimeType = formats[meta.format ?? ''];
      if (!mimeType || mimeType !== file.mimetype || (meta.pages ?? 1) > 1) throw invalid();
      // Decode actual pixels within a fixed bound; headers alone are insufficient.
      await image.timeout({ seconds: 3 }).resize(1, 1).raw().toBuffer();
    } catch {
      throw invalid();
    }
  }
  const fileName =
    file.originalname
      .normalize('NFKC')
      // eslint-disable-next-line no-control-regex -- Remove control/path characters from display/header names.
      .replace(/[\x00-\x1f\x7f/\\]/g, '_')
      .slice(0, 255)
      .trim() || 'document';
  return { fileName, mimeType, fileSize: data.length };
}
