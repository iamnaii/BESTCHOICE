import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SkipTracingService } from './skip-tracing.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

describe('SkipTracingService', () => {
  let service: SkipTracingService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let audit: any;

  const existingCustomer = {
    id: 'cust-1',
    phone: '0810000000',
    lineId: 'old-line',
    status: 'ACTIVE',
  };

  beforeEach(async () => {
    prisma = {
      customer: {
        findFirst: jest.fn().mockResolvedValue(existingCustomer),
        update: jest.fn().mockImplementation(async ({ data }) => ({
          ...existingCustomer,
          ...data,
        })),
      },
    };
    audit = { log: jest.fn().mockResolvedValue(undefined) };

    const mod = await Test.createTestingModule({
      providers: [
        SkipTracingService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();
    service = mod.get(SkipTracingService);
  });

  it('updates phone and writes SKIP_TRACING_UPDATE audit with old+new values', async () => {
    const result = await service.updateContact(
      'cust-1',
      { newPhone: '0820000000', reason: 'ญาติให้เบอร์ใหม่' },
      { userId: 'user-1', ipAddress: '127.0.0.1' },
    );

    expect(prisma.customer.update).toHaveBeenCalledWith({
      where: { id: 'cust-1' },
      data: { phone: '0820000000' },
      select: expect.any(Object),
    });
    expect(result.phone).toBe('0820000000');

    expect(audit.log).toHaveBeenCalledTimes(1);
    const entry = audit.log.mock.calls[0][0];
    expect(entry.action).toBe('SKIP_TRACING_UPDATE');
    expect(entry.entity).toBe('customer');
    expect(entry.entityId).toBe('cust-1');
    expect(entry.oldValue.phone).toBe('0810000000');
    expect(entry.newValue.phone).toBe('0820000000');
    expect(entry.newValue.reason).toBe('ญาติให้เบอร์ใหม่');
  });

  it('updates LINE ID without touching phone', async () => {
    const result = await service.updateContact(
      'cust-1',
      { newLineId: 'new-line-id', reason: 'เจอใน Facebook' },
      { userId: 'user-1' },
    );

    expect(prisma.customer.update).toHaveBeenCalledWith({
      where: { id: 'cust-1' },
      data: { lineId: 'new-line-id' },
      select: expect.any(Object),
    });
    expect(result.lineId).toBe('new-line-id');
    expect(result.phone).toBe('0810000000');

    const entry = audit.log.mock.calls[0][0];
    expect(entry.oldValue.lineId).toBe('old-line');
    expect(entry.newValue.lineId).toBe('new-line-id');
  });

  it('marks customer as LOST and writes audit', async () => {
    const result = await service.updateContact(
      'cust-1',
      { markAsLost: true, reason: 'หาทุกช่องทางแล้วไม่เจอ' },
      { userId: 'user-1' },
    );

    expect(prisma.customer.update).toHaveBeenCalledWith({
      where: { id: 'cust-1' },
      data: { status: 'LOST' },
      select: expect.any(Object),
    });
    expect(result.status).toBe('LOST');

    const entry = audit.log.mock.calls[0][0];
    expect(entry.oldValue.status).toBe('ACTIVE');
    expect(entry.newValue.status).toBe('LOST');
    expect(entry.newValue.reason).toBe('หาทุกช่องทางแล้วไม่เจอ');
  });

  it('throws BadRequest when no field is provided', async () => {
    await expect(
      service.updateContact('cust-1', { reason: 'ทดสอบ' }, { userId: 'u' }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.customer.update).not.toHaveBeenCalled();
  });

  it('throws NotFound when customer is missing or soft-deleted', async () => {
    prisma.customer.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.updateContact(
        'missing',
        { newPhone: '0820000000', reason: 'x' },
        { userId: 'u' },
      ),
    ).rejects.toThrow(NotFoundException);
  });
});
