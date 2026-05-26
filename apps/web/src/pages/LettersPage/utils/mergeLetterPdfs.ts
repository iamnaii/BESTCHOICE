import { renderLetterPdfDoc, type LetterTemplateData } from '@/pages/CollectionsPage/utils/letterPdfRenderer';

/**
 * Render multiple letters and merge into a single multi-page PDF Blob.
 * Internally builds one jsPDF doc and copies pages from subsequent docs.
 */
export async function mergeLetterPdfs(items: LetterTemplateData[]): Promise<Blob> {
  if (items.length === 0) {
    throw new Error('mergeLetterPdfs: items must not be empty');
  }

  const baseDoc = await renderLetterPdfDoc(items[0]);

  for (let i = 1; i < items.length; i++) {
    const nextDoc = await renderLetterPdfDoc(items[i]);
    const pageCount = nextDoc.getNumberOfPages();
    for (let p = 1; p <= pageCount; p++) {
      baseDoc.addPage();
      nextDoc.setPage(p);
      baseDoc.setPage(baseDoc.getNumberOfPages());
      // jsPDF page copy: write internal page contents to base via operator stream copy
      const ops = (nextDoc as any).internal.pages[p].join('\n');
      (baseDoc as any).internal.pages[baseDoc.getNumberOfPages()] = ops.split('\n');
    }
  }

  return baseDoc.output('blob');
}
