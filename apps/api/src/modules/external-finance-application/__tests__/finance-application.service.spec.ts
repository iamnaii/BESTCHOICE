import { ForbiddenException, ConflictException } from '@nestjs/common';
import { FinanceApplicationService } from '../services/finance-application.service';

const room = { id: 'room-1', assignedToId: 'sales-2', customerId: null, deletedAt: null, channel: 'FACEBOOK' };
function makePrisma(overrides: Record<string, unknown> = {}) {
  const prisma: any = {
    chatRoom: { findFirst: jest.fn().mockResolvedValue(room) },
    externalFinanceCompany: { upsert: jest.fn().mockResolvedValue({ id: 'gfin-1' }) },
    externalFinanceApplication: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'app-1', ...data, files: [], events: [] })),
      update: jest.fn(),
    },
    externalFinanceApplicationEvent: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
    $executeRawUnsafe: jest.fn(),
    ...overrides,
  };
  return prisma;
}
const numbers = { next: jest.fn().mockResolvedValue('BC-260924-001') } as any;
const owner = { id: 'u-owner', role: 'OWNER' };
const sales = { id: 'sales-1', role: 'SALES' };

describe('FinanceApplicationService.createDraft', () => {
  it('creates a DRAFT with number, GFIN company and CREATED event', async () => {
    const prisma = makePrisma();
    const service = new FinanceApplicationService(prisma, numbers);
    const app = await service.createDraft('room-1', owner);
    expect(app.status).toBe('DRAFT');
    expect(prisma.externalFinanceApplication.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ number: 'BC-260924-001', financeCompanyId: 'gfin-1', roomId: 'room-1', createdById: 'u-owner', status: 'DRAFT' }),
    }));
    expect(prisma.externalFinanceApplicationEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ kind: 'CREATED', actorType: 'STAFF' }) }));
  });
  it('returns the existing open application instead of creating a second one', async () => {
    const existing = { id: 'app-0', status: 'SENT', roomId: 'room-1', files: [], events: [] };
    const prisma = makePrisma({ externalFinanceApplication: { findFirst: jest.fn().mockResolvedValue(existing), create: jest.fn() } });
    const service = new FinanceApplicationService(prisma, numbers);
    await expect(service.createDraft('room-1', owner)).resolves.toMatchObject({ id: 'app-0' });
    expect(prisma.externalFinanceApplication.create).not.toHaveBeenCalled();
  });
  it('rejects SALES on a room assigned to someone else', async () => {
    const service = new FinanceApplicationService(makePrisma(), numbers);
    await expect(service.createDraft('room-1', sales)).rejects.toThrow(ForbiddenException);
  });
});

describe('FinanceApplicationService.update', () => {
  it('blocks edits after send', async () => {
    const prisma = makePrisma({ externalFinanceApplication: { findFirst: jest.fn().mockResolvedValue({ id: 'app-1', status: 'SENT', roomId: 'room-1', room }), update: jest.fn() } });
    const service = new FinanceApplicationService(prisma, numbers);
    await expect(service.update('app-1', { productId: '2b5e3d1e-0000-4000-8000-000000000001' }, owner)).rejects.toThrow(ConflictException);
  });
});
