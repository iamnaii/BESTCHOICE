import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ContactsService } from './contacts.service';

/**
 * mapping v5 (เจ้าของ 2026-10-20 "ทำรหัสย่อยได้เลย"): the PEAK export resolves
 * sub-codes from Contact.peakContactCode, so the accountant needs a way to set
 * that code per contact. Unit spec with a mocked Prisma (no DB).
 */
describe('ContactsService.setPeakContactCode', () => {
  let prisma: any;
  let audit: { log: jest.Mock };
  let service: ContactsService;

  beforeEach(() => {
    prisma = {
      contact: {
        findFirst: jest.fn(),
        update: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
          id: 'ct-1',
          contactCode: 'P-00001',
          peakContactCode: data.peakContactCode ?? null,
        })),
      },
    };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    service = new ContactsService(prisma, audit as any, {} as any);
  });

  it('stores a trimmed code and writes an audit row with before/after', async () => {
    prisma.contact.findFirst.mockResolvedValue({ id: 'ct-1', contactCode: 'P-00001', peakContactCode: null });
    const result = await service.setPeakContactCode('ct-1', ' C00790 ', { userId: 'u-1' });
    expect(prisma.contact.update).toHaveBeenCalledWith({
      where: { id: 'ct-1' },
      data: { peakContactCode: 'C00790' },
      select: { id: true, contactCode: true, peakContactCode: true },
    });
    expect(result.peakContactCode).toBe('C00790');
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CONTACT_PEAK_CODE_SET',
        entity: 'contact',
        entityId: 'ct-1',
        userId: 'u-1',
        oldValue: { peakContactCode: null },
        newValue: { peakContactCode: 'C00790', contactCode: 'P-00001' },
      }),
    );
  });

  it('clears the code when given null or an empty string', async () => {
    prisma.contact.findFirst.mockResolvedValue({ id: 'ct-1', contactCode: 'P-00001', peakContactCode: 'C00790' });
    await service.setPeakContactCode('ct-1', '   ', { userId: 'u-1' });
    expect(prisma.contact.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { peakContactCode: null } }),
    );
  });

  it('rejects codes outside the PEAK pattern (A-Z 0-9 - _ . · max 20)', async () => {
    prisma.contact.findFirst.mockResolvedValue({ id: 'ct-1', contactCode: 'P-00001', peakContactCode: null });
    await expect(service.setPeakContactCode('ct-1', 'C 00790', { userId: 'u-1' })).rejects.toThrow(BadRequestException);
    await expect(service.setPeakContactCode('ct-1', 'x'.repeat(21), { userId: 'u-1' })).rejects.toThrow(BadRequestException);
    expect(prisma.contact.update).not.toHaveBeenCalled();
  });

  it('404s for an unknown or deleted contact', async () => {
    prisma.contact.findFirst.mockResolvedValue(null);
    await expect(service.setPeakContactCode('nope', 'C00790', { userId: 'u-1' })).rejects.toThrow(NotFoundException);
    expect(prisma.contact.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'nope', deletedAt: null } }),
    );
  });

  it('is a no-op (no update, no audit) when the code is unchanged', async () => {
    prisma.contact.findFirst.mockResolvedValue({ id: 'ct-1', contactCode: 'P-00001', peakContactCode: 'C00790' });
    const result = await service.setPeakContactCode('ct-1', 'C00790', { userId: 'u-1' });
    expect(prisma.contact.update).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
    expect(result.peakContactCode).toBe('C00790');
  });
});
