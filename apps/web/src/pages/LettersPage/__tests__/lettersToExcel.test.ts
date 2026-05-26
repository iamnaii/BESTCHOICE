import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { lettersToExcel } from '../utils/lettersToExcel';

const sampleLetters = [
  {
    id: 'l1',
    letterNumber: 'ST-2026-00001',
    letterType: 'RETURN_DEVICE_45D',
    status: 'DISPATCHED',
    triggeredAt: '2026-05-20T08:00:00Z',
    pdfGeneratedAt: '2026-05-20T09:00:00Z',
    dispatchedAt: '2026-05-21T10:00:00Z',
    trackingNumber: 'EM123456789TH',
    deliveredAt: null,
    cancelReason: null,
    dispatchedBy: { name: 'admin' },
    contract: {
      contractNumber: 'C-2025-101',
      customer: { name: 'สมชาย' },
      branch: { name: 'ลาดพร้าว' },
    },
  },
] as any;

describe('lettersToExcel', () => {
  it('produces a workbook with 1 sheet and correct headers', async () => {
    const blob = await lettersToExcel(sampleLetters);
    expect(blob).toBeInstanceOf(Blob);
    const buffer = await blob.arrayBuffer();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const sheet = wb.worksheets[0];
    expect(sheet.name).toBe('Letters');
    const headerRow = sheet.getRow(1).values as string[];
    expect(headerRow).toContain('เลขจดหมาย');
    expect(headerRow).toContain('Tracking No.');
  });

  it('writes Thai-format dates', async () => {
    const blob = await lettersToExcel(sampleLetters);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await blob.arrayBuffer());
    const sheet = wb.worksheets[0];
    const dataRow = sheet.getRow(2).values as any[];
    const dispatchedCell = dataRow.find((v) => typeof v === 'string' && /\d{2}\/\d{2}\/\d{4}/.test(v));
    expect(dispatchedCell).toBeTruthy();
  });
});
