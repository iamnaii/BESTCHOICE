import { ReceiptQueryService } from './receipt-query.service';

/**
 * findByPublicToken — the lookup backing the public (no-JWT) CN PDF endpoint
 * (receipts-public.controller.ts). Collapses "unknown token", "soft-deleted
 * receipt", and "not a CN receipt" all to `null` so the controller can give a
 * single generic 404 without ever confirming which case it was.
 */
describe('ReceiptQueryService.findByPublicToken', () => {
  let service: ReceiptQueryService;
  let prisma: { receipt: { findUnique: jest.Mock } };

  beforeEach(() => {
    prisma = { receipt: { findUnique: jest.fn() } };
    service = new ReceiptQueryService(prisma as never);
  });

  it('returns the receipt when the token resolves to a live CN receipt', async () => {
    const expiresAt = new Date(Date.now() + 1000);
    prisma.receipt.findUnique.mockResolvedValue({
      id: 'rcpt-1',
      receiptNumber: 'RT-202607-00099',
      cnSource: 'WRITE_OFF',
      publicTokenExpiresAt: expiresAt,
      deletedAt: null,
    });

    const result = await service.findByPublicToken('good-token');

    expect(prisma.receipt.findUnique).toHaveBeenCalledWith({
      where: { publicToken: 'good-token' },
      select: {
        id: true,
        receiptNumber: true,
        cnSource: true,
        publicTokenExpiresAt: true,
        deletedAt: true,
      },
    });
    expect(result).toEqual(
      expect.objectContaining({ id: 'rcpt-1', publicTokenExpiresAt: expiresAt }),
    );
  });

  it('returns null when the token does not exist', async () => {
    prisma.receipt.findUnique.mockResolvedValue(null);
    await expect(service.findByPublicToken('bogus')).resolves.toBeNull();
  });

  it('returns null when the receipt is soft-deleted', async () => {
    prisma.receipt.findUnique.mockResolvedValue({
      id: 'rcpt-1',
      receiptNumber: 'RT-1',
      cnSource: 'WRITE_OFF',
      publicTokenExpiresAt: new Date(Date.now() + 1000),
      deletedAt: new Date(),
    });
    await expect(service.findByPublicToken('deleted-token')).resolves.toBeNull();
  });

  it('returns null when cnSource is null (not a Credit Note receipt)', async () => {
    prisma.receipt.findUnique.mockResolvedValue({
      id: 'rcpt-1',
      receiptNumber: 'RT-1',
      cnSource: null,
      publicTokenExpiresAt: new Date(Date.now() + 1000),
      deletedAt: null,
    });
    await expect(service.findByPublicToken('non-cn-token')).resolves.toBeNull();
  });
});
