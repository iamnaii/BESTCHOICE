import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';
import { RECEIPT_TOKEN_TTL_MS, SaleReceiptTokenService } from './sale-receipt-token.service';

/**
 * token ลิงก์สาธารณะของใบเสร็จขายสด — mint ครั้งเดียว ต่ออายุทุกครั้ง, หมดอายุ/ใบยกเลิก = ไม่พบ.
 */
describe('SaleReceiptTokenService', () => {
  const makeService = (env: Record<string, string | undefined> = {}) => {
    const prisma = {
      sale: { findFirst: jest.fn(), update: jest.fn() },
    };
    const config = { get: jest.fn((key: string) => env[key]) } as unknown as ConfigService;
    const service = new SaleReceiptTokenService(prisma as unknown as PrismaService, config);
    return { service, prisma };
  };

  describe('ensureToken', () => {
    it('mints a base64url token and sets expiry to now + 30 days when the sale has none', async () => {
      const { service, prisma } = makeService();
      prisma.sale.findFirst.mockResolvedValue({ id: 's1', receiptToken: null, receiptTokenExpiresAt: null });
      prisma.sale.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 's1', ...data }));

      const before = Date.now();
      const result = await service.ensureToken('s1');

      expect(prisma.sale.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 's1', deletedAt: null }) }));
      const data = prisma.sale.update.mock.calls[0][0].data;
      expect(typeof data.receiptToken).toBe('string');
      expect(data.receiptToken.length).toBeGreaterThanOrEqual(40);
      expect(data.receiptToken).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(result.token).toBe(data.receiptToken);
      const delta = result.expiresAt.getTime() - before;
      expect(delta).toBeGreaterThanOrEqual(RECEIPT_TOKEN_TTL_MS - 5_000);
      expect(delta).toBeLessThanOrEqual(RECEIPT_TOKEN_TTL_MS + 5_000);
    });

    it('keeps the existing token and only pushes the expiry forward', async () => {
      const { service, prisma } = makeService();
      prisma.sale.findFirst.mockResolvedValue({
        id: 's1',
        receiptToken: 'existing-token',
        receiptTokenExpiresAt: new Date('2020-01-01T00:00:00Z'),
      });
      prisma.sale.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 's1', ...data }));

      const result = await service.ensureToken('s1');

      const data = prisma.sale.update.mock.calls[0][0].data;
      expect(data.receiptToken).toBeUndefined();
      expect(result.token).toBe('existing-token');
      expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now() + RECEIPT_TOKEN_TTL_MS - 5_000);
    });

    it('throws NotFoundException when the sale is missing or soft-deleted', async () => {
      const { service, prisma } = makeService();
      prisma.sale.findFirst.mockResolvedValue(null);

      await expect(service.ensureToken('missing')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.sale.update).not.toHaveBeenCalled();
    });
  });

  describe('findSaleIdByToken', () => {
    it('returns the sale id when the token is live', async () => {
      const { service, prisma } = makeService();
      prisma.sale.findFirst.mockResolvedValue({ id: 's1', receiptTokenExpiresAt: new Date(Date.now() + 60_000) });

      await expect(service.findSaleIdByToken('tok')).resolves.toBe('s1');
      expect(prisma.sale.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ receiptToken: 'tok', deletedAt: null }) }),
      );
    });

    it('returns null when the token is expired', async () => {
      const { service, prisma } = makeService();
      prisma.sale.findFirst.mockResolvedValue({ id: 's1', receiptTokenExpiresAt: new Date(Date.now() - 1_000) });

      await expect(service.findSaleIdByToken('tok')).resolves.toBeNull();
    });

    it('returns null when no sale carries the token', async () => {
      const { service, prisma } = makeService();
      prisma.sale.findFirst.mockResolvedValue(null);

      await expect(service.findSaleIdByToken('tok')).resolves.toBeNull();
    });
  });

  describe('publicUrl', () => {
    it('falls back to localhost when no base URL env is set', () => {
      const { service } = makeService();
      expect(service.publicUrl('abc')).toBe('http://localhost:5173/r/abc');
    });

    it('prefers PAYMENT_LINK_BASE_URL over FRONTEND_URL and strips a trailing slash', () => {
      const { service } = makeService({ PAYMENT_LINK_BASE_URL: 'https://pay.example.com/', FRONTEND_URL: 'https://app.example.com' });
      expect(service.publicUrl('abc')).toBe('https://pay.example.com/r/abc');
    });

    it('uses FRONTEND_URL when PAYMENT_LINK_BASE_URL is absent', () => {
      const { service } = makeService({ FRONTEND_URL: 'https://app.example.com' });
      expect(service.publicUrl('abc')).toBe('https://app.example.com/r/abc');
    });
  });
});
