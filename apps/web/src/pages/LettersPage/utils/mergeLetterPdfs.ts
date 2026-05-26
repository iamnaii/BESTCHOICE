import { PDFDocument } from 'pdf-lib';
import { renderLetterPdfDoc, type LetterTemplateData } from '@/pages/CollectionsPage/utils/letterPdfRenderer';

/**
 * Render multiple letters and merge into a single multi-page PDF Blob.
 *
 * Renders each letter individually via jsPDF (preserving Thai font + layout),
 * then uses pdf-lib to merge them into one document. pdf-lib uses public API
 * for page copy (copyPages + addPage), so this is robust against jsPDF version
 * bumps — unlike the previous approach that touched jsPDF internals.
 */
export async function mergeLetterPdfs(items: LetterTemplateData[]): Promise<Blob> {
  if (items.length === 0) {
    throw new Error('mergeLetterPdfs: items must not be empty');
  }

  const mergedDoc = await PDFDocument.create();

  for (const item of items) {
    const jsPdfDoc = await renderLetterPdfDoc(item);
    const bytes = jsPdfDoc.output('arraybuffer');
    const singleDoc = await PDFDocument.load(bytes);
    const copiedPages = await mergedDoc.copyPages(singleDoc, singleDoc.getPageIndices());
    for (const page of copiedPages) {
      mergedDoc.addPage(page);
    }
  }

  const mergedBytes = await mergedDoc.save();
  const arrayBuffer = mergedBytes.buffer.slice(
    mergedBytes.byteOffset,
    mergedBytes.byteOffset + mergedBytes.byteLength,
  ) as ArrayBuffer;
  return new Blob([arrayBuffer], { type: 'application/pdf' });
}
