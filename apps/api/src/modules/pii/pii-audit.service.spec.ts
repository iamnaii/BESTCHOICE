import { Test } from '@nestjs/testing';
import { PiiAuditService } from './pii-audit.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('PiiAuditService', () => {
  let service: PiiAuditService;
  let prisma: { auditLog: { create: jest.Mock } };

  beforeEach(async () => {
    prisma = { auditLog: { create: jest.fn().mockResolvedValue({}) } };
    const module = await Test.createTestingModule({
      providers: [
        PiiAuditService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(PiiAuditService);
  });

  it('logs PII_DECRYPT_FULL action with all required fields', async () => {
    await service.logDecryption({
      userId: 'user-1',
      customerId: 'cust-1',
      fields: ['nationalId', 'phone'],
      role: 'OWNER',
      masked: false,
      ipAddress: '1.2.3.4',
      userAgent: 'Mozilla',
    });

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        action: 'PII_DECRYPT_FULL',
        entity: 'customer',
        entityId: 'cust-1',
        newValue: { fields: ['nationalId', 'phone'], role: 'OWNER' },
        ipAddress: '1.2.3.4',
        userAgent: 'Mozilla',
      }),
    });
  });

  it('logs PII_DECRYPT_MASKED when masked=true', async () => {
    await service.logDecryption({
      userId: 'user-2',
      customerId: 'cust-2',
      fields: ['nationalId'],
      role: 'SALES',
      masked: true,
    });

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'PII_DECRYPT_MASKED',
        userId: 'user-2',
      }),
    });
  });

  it('does not throw if audit insert fails (logs to console)', async () => {
    prisma.auditLog.create.mockRejectedValue(new Error('DB down'));
    await expect(
      service.logDecryption({
        userId: 'u',
        customerId: 'c',
        fields: ['phone'],
        role: 'OWNER',
        masked: false,
      }),
    ).resolves.not.toThrow();
  });
});
