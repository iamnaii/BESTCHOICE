import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DocumentRenderingService } from './document-rendering.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { SettingsService } from '../../settings/settings.service';
import { formatDateMedium } from '../../../utils/thai-date.util';

const service = () => new DocumentRenderingService(
  {} as PrismaService,
  { configured: false } as StorageService,
  { findAll: jest.fn().mockResolvedValue([]) } as unknown as SettingsService,
);
const contract = (paymentDueDay: number, year = 2026) => ({
  id: 'test-payday', contractNumber: 'TEST-PAYDAY', createdAt: new Date(year, 0, 31),
  paymentDueDay, totalMonths: 3, monthlyPayment: 1000, financedAmount: 3000,
  sellingPrice: 4000, downPayment: 1000, interestRate: 0, interestTotal: 0,
  customer: { name: 'ลูกค้าทดสอบ', references: [] }, product: {}, branch: {},
  payments: [], signatures: [],
});

describe('contract document due dates', () => {
  it.each([25, 29, 30, 31])('renders payday %i inside each month when no payment rows exist', async (day) => {
    const html = await service().replacePlaceholders('{payment_schedule_table}', contract(day));
    for (const date of [new Date(2026, 1, Math.min(day, 28)), new Date(2026, 2, day), new Date(2026, 3, Math.min(day, 30))]) {
      expect(html).toContain(formatDateMedium(date));
    }
  });

  it('renders February 29 for an end-of-month payday in a leap year', async () => {
    const html = await service().replacePlaceholders('{first_payment_due}', contract(31, 2028));
    expect(html).toBe(formatDateMedium(new Date(2028, 1, 29)));
  });

  it('preserves an existing payment date instead of recalculating from the customer payday', async () => {
    const dueDate = new Date(2026, 2, 7);
    const html = await service().replacePlaceholders('{first_payment_due}', {
      ...contract(31), payments: [{ installmentNo: 1, dueDate, amountDue: 1000 }],
    });
    expect(html).toBe(formatDateMedium(dueDate));
  });
});

  it('renders total payable from installment rows including the final remainder, separately from principal', async () => {
    const html = await service().replacePlaceholders('{{= CONTRACT.TOTAL_AMOUNT}} / {financed_amount}', {
      ...contract(31), financedAmount: 10000, totalMonths: 12,
      payments: Array.from({ length: 12 }, (_, index) => ({ installmentNo: index + 1, dueDate: new Date(2026, index + 1, 25), amountDue: index === 11 ? 1515.87 : 1515.83 })),
    });
    expect(html).toBe('18,190.00 / 18,190');
  });

  it('prints the full hire-purchase amount in the existing production template', async () => {
    const template = readFileSync(join(__dirname, '../templates/hire-purchase-contract.html'), 'utf8');
    const html = await service().replacePlaceholders(template, { ...contract(31), financedAmount: 10000,
      payments: [{ installmentNo: 1, dueDate: new Date(2026, 1, 28), amountDue: 18190 }] });
    expect(html).toMatch(/รวมเป็นจำนวนเงินทั้งสิ้น[^\n]*18,190/);
    expect(html).toMatch(/เงินค่าเช่ารวมภาษีมูลค่าเพิ่ม[^\n]*18,190/);
  });
