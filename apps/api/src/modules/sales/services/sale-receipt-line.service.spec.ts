import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { LineOaService } from '../../line-oa/line-oa.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { buildSaleReceiptFlex, SaleReceiptLineService } from './sale-receipt-line.service';
import { SaleReceiptTokenService } from './sale-receipt-token.service';

/**
 * ส่งใบเสร็จขายสดทาง LINE OA ร้าน — ไม่ throw เมื่อส่งไม่ได้ (ลูกค้าไม่ผูก LINE / push ล้ม)
 * และบันทึก NotificationLog ทุกครั้ง แบบเดียวกับ `sale-warranty-notifier.service.ts`.
 */
describe('SaleReceiptLineService.send', () => {
  const D = (v: string) => new Prisma.Decimal(v);
  const owner = { id: 'u1', role: 'OWNER', branchId: null };
  const sale = (overrides: Record<string, unknown> = {}) => ({
    id: 's1',
    saleNumber: 'SL-20261022-0001',
    saleType: 'CASH',
    netAmount: D('22900'),
    downPaymentAmount: null,
    deletedAt: null,
    customer: { id: 'c1', lineIdShop: 'U123' },
    product: { brand: 'Apple', model: 'iPhone 15 Pro Max', storage: '256GB' },
    ...overrides,
  });

  let prisma: { sale: { findFirst: jest.Mock }; notificationLog: { create: jest.Mock } };
  let line: { sendFlexMessage: jest.Mock };
  let tokens: { ensureToken: jest.Mock; publicUrl: jest.Mock };
  let service: SaleReceiptLineService;

  beforeEach(() => {
    prisma = { sale: { findFirst: jest.fn() }, notificationLog: { create: jest.fn().mockResolvedValue({}) } };
    line = { sendFlexMessage: jest.fn().mockResolvedValue(undefined) };
    tokens = {
      ensureToken: jest.fn().mockResolvedValue({ token: 'tok', expiresAt: new Date() }),
      publicUrl: jest.fn((t: string) => `https://app.example.com/r/${t}`),
    };
    service = new SaleReceiptLineService(
      prisma as unknown as PrismaService,
      line as unknown as LineOaService,
      tokens as unknown as SaleReceiptTokenService,
    );
  });

  it('returns NO_LINE_LINK and logs FAILED when the customer has no shop LINE id', async () => {
    prisma.sale.findFirst.mockResolvedValue(sale({ customer: { id: 'c1', lineIdShop: null } }));

    await expect(service.send('s1', owner)).resolves.toEqual({ delivered: false, reason: 'NO_LINE_LINK' });
    expect(line.sendFlexMessage).not.toHaveBeenCalled();
    expect(prisma.notificationLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        channel: 'LINE', channelKey: 'line-shop', status: 'FAILED', subject: 'ใบเสร็จรับเงิน',
        relatedId: 's1', customerId: 'c1', category: 'TRANSACTIONAL',
      }),
    });
  });

  it('pushes the Flex to the shop channel, logs SENT and refreshes the token', async () => {
    prisma.sale.findFirst.mockResolvedValue(sale());

    await expect(service.send('s1', owner)).resolves.toEqual({ delivered: true });
    expect(tokens.ensureToken).toHaveBeenCalledWith('s1');
    const [to, flex, channel] = line.sendFlexMessage.mock.calls[0];
    expect(to).toBe('U123');
    expect(channel).toBe('line-shop');
    expect(flex.altText).toBe('ใบเสร็จรับเงิน SL-20261022-0001');
    expect(JSON.stringify(flex)).toContain('https://app.example.com/r/tok');
    expect(prisma.notificationLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'SENT', recipient: 'U123', sentAt: expect.any(Date) }),
    });
  });

  it('returns PUSH_FAILED and logs the error when LINE rejects the push', async () => {
    prisma.sale.findFirst.mockResolvedValue(sale());
    line.sendFlexMessage.mockRejectedValue(new Error('LINE 400 invalid user'));

    await expect(service.send('s1', owner)).resolves.toEqual({ delivered: false, reason: 'PUSH_FAILED' });
    expect(prisma.notificationLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'FAILED', errorMsg: expect.stringContaining('LINE 400') }),
    });
  });

  it('refuses voided and installment sales, and 404s outside the actor branch', async () => {
    prisma.sale.findFirst.mockResolvedValue(sale({ deletedAt: new Date() }));
    await expect(service.send('s1', owner)).rejects.toBeInstanceOf(BadRequestException);

    prisma.sale.findFirst.mockResolvedValue(sale({ saleType: 'INSTALLMENT' }));
    await expect(service.send('s1', owner)).rejects.toBeInstanceOf(BadRequestException);

    prisma.sale.findFirst.mockResolvedValue(null);
    await expect(service.send('s1', { id: 'u2', role: 'SALES', branchId: 'A' })).rejects.toBeInstanceOf(NotFoundException);
    expect(JSON.stringify(prisma.sale.findFirst.mock.calls[2][0].where)).toContain('"branchId":"A"');
    expect(line.sendFlexMessage).not.toHaveBeenCalled();
  });
});

describe('buildSaleReceiptFlex', () => {
  it('builds a bubble with the sale number, amount, open button and 30-day note', () => {
    const flex = buildSaleReceiptFlex({
      saleNumber: 'SL-1', deviceName: 'Apple iPhone 15', amountLabel: 'ยอดสุทธิ', amountText: '22,900.00 บาท',
      url: 'https://app.example.com/r/tok',
    });
    const json = JSON.stringify(flex);
    expect(flex.type).toBe('flex');
    expect(json).toContain('ใบเสร็จรับเงิน');
    expect(json).toContain('เลขที่ SL-1');
    expect(json).toContain('Apple iPhone 15');
    expect(json).toContain('ยอดสุทธิ');
    expect(json).toContain('22,900.00 บาท');
    expect(json).toContain('"type":"uri","label":"เปิดใบเสร็จ","uri":"https://app.example.com/r/tok"');
    expect(json).toContain('ลิงก์ใช้ได้ 30 วัน');
  });
});
