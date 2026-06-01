import { Test } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { ContactResolverService } from '../contact-resolver.service';

describe('ContactResolverService.nextContactCode', () => {
  let svc: ContactResolverService;
  let prisma: { $executeRawUnsafe: jest.Mock; contact: { findFirst: jest.Mock } };

  beforeEach(async () => {
    prisma = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
      contact: { findFirst: jest.fn() },
    };
    const mod = await Test.createTestingModule({
      providers: [
        ContactResolverService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    svc = mod.get(ContactResolverService);
  });

  it('starts at P-00001 when no contacts exist', async () => {
    prisma.contact.findFirst.mockResolvedValue(null);
    const code = await svc.nextContactCode(prisma as any);
    expect(code).toBe('P-00001');
    expect(prisma.$executeRawUnsafe).toHaveBeenCalled();
  });

  it('increments from the last code', async () => {
    prisma.contact.findFirst.mockResolvedValue({ contactCode: 'P-00042' });
    const code = await svc.nextContactCode(prisma as any);
    expect(code).toBe('P-00043');
  });
});
