import { Test } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { ContactResolverService } from '../contact-resolver.service';
import { ContactsService } from '../contacts.service';

describe('ContactsService.ensureRole', () => {
  let svc: ContactsService;
  let resolver: { ensureRole: jest.Mock };
  let audit: { log: jest.Mock };
  let prisma: { $transaction: jest.Mock };

  beforeEach(async () => {
    resolver = { ensureRole: jest.fn() };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    // run the callback with a dummy tx
    prisma = { $transaction: jest.fn((cb: (tx: unknown) => Promise<unknown>) => cb({})) };

    const mod = await Test.createTestingModule({
      providers: [
        ContactsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: ContactResolverService, useValue: resolver },
      ],
    }).compile();
    svc = mod.get(ContactsService);
  });

  it('audits CONTACT_ROLE_ADDED when a role was provisioned', async () => {
    resolver.ensureRole.mockResolvedValue({
      contactId: 'c1', role: 'SUPPLIER', supplierId: 'sup1', provisioned: true,
    });

    const result = await svc.ensureRole('c1', 'SUPPLIER', { userId: 'u1', ipAddress: '127.0.0.1' });

    expect(resolver.ensureRole).toHaveBeenCalledWith({}, 'c1', 'SUPPLIER');
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        action: 'CONTACT_ROLE_ADDED',
        entity: 'contact',
        entityId: 'c1',
        newValue: { role: 'SUPPLIER', supplierId: 'sup1' },
        ipAddress: '127.0.0.1',
      }),
    );
    expect(result.supplierId).toBe('sup1');
  });

  it('does NOT audit when nothing was provisioned (idempotent hit)', async () => {
    resolver.ensureRole.mockResolvedValue({
      contactId: 'c1', role: 'SUPPLIER', supplierId: 'sup1', provisioned: false,
    });

    await svc.ensureRole('c1', 'SUPPLIER', { userId: 'u1' });

    expect(audit.log).not.toHaveBeenCalled();
  });
});
