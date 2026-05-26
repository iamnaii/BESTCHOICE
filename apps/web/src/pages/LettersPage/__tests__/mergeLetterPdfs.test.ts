import { describe, it, expect, vi } from 'vitest';
import { jsPDF } from 'jspdf';
import { mergeLetterPdfs } from '../utils/mergeLetterPdfs';

vi.mock('@/pages/CollectionsPage/utils/letterPdfRenderer', () => ({
  renderLetterPdfDoc: vi.fn(async () => {
    const doc = new jsPDF();
    doc.text('test', 10, 10);
    return doc;
  }),
}));

describe('mergeLetterPdfs', () => {
  it('returns a single Blob containing all letters', async () => {
    const blob = await mergeLetterPdfs([
      { letterNumber: 'A', customerName: 'x' } as any,
      { letterNumber: 'B', customerName: 'y' } as any,
      { letterNumber: 'C', customerName: 'z' } as any,
    ]);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBeGreaterThan(0);
  });

  it('throws if items array is empty', async () => {
    await expect(mergeLetterPdfs([])).rejects.toThrow();
  });
});
