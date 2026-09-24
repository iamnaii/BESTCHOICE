import { ForbiddenException, ConflictException } from '@nestjs/common';
import { FinanceApplicationService } from '../services/finance-application.service';
import { hashLockKey } from '../../../utils/advisory-lock.util';

const room = { id: 'room-1', assignedToId: 'sales-2', customerId: null, deletedAt: null, channel: 'FACEBOOK' };
const pii = { decryptCustomerFields: (c: any) => c } as any;
const config = {
  get: (key: string) =>
    key === 'SHARE_PAGE_BASE_URL' ? 'https://bestchoicephone.app' : key === 'PII_ENCRYPTION_KEY' ? 'a'.repeat(64) : undefined,
} as any;
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
    user: { findUnique: jest.fn().mockResolvedValue(null) },
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
    const service = new FinanceApplicationService(prisma, numbers, pii, config);
    const app = await service.createDraft('room-1', owner);
    expect(app.status).toBe('DRAFT');
    expect(prisma.externalFinanceApplication.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ number: 'BC-260924-001', financeCompanyId: 'gfin-1', roomId: 'room-1', createdById: 'u-owner', status: 'DRAFT' }),
    }));
    expect(prisma.externalFinanceApplicationEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ kind: 'CREATED', actorType: 'STAFF' }) }));
  });
  it('takes a room-scoped advisory lock before checking for an existing open application (race fix)', async () => {
    const prisma = makePrisma();
    const service = new FinanceApplicationService(prisma, numbers, pii, config);
    await service.createDraft('room-1', owner);
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
      `SELECT pg_advisory_xact_lock(${hashLockKey('finance-app-room:room-1')})`,
    );
    const lockOrder = prisma.$executeRawUnsafe.mock.invocationCallOrder[0];
    const findFirstOrder = prisma.externalFinanceApplication.findFirst.mock.invocationCallOrder[0];
    expect(lockOrder).toBeLessThan(findFirstOrder);
  });
  it('returns the existing open application instead of creating a second one', async () => {
    const existing = { id: 'app-0', status: 'SENT', roomId: 'room-1', files: [], events: [] };
    const prisma = makePrisma({ externalFinanceApplication: { findFirst: jest.fn().mockResolvedValue(existing), create: jest.fn() } });
    const service = new FinanceApplicationService(prisma, numbers, pii, config);
    await expect(service.createDraft('room-1', owner)).resolves.toMatchObject({ id: 'app-0' });
    expect(prisma.externalFinanceApplication.create).not.toHaveBeenCalled();
  });
  it('rejects SALES on a room assigned to someone else', async () => {
    const service = new FinanceApplicationService(makePrisma(), numbers, pii, config);
    await expect(service.createDraft('room-1', sales)).rejects.toThrow(ForbiddenException);
  });
});

describe('FinanceApplicationService.update', () => {
  it('blocks edits after send', async () => {
    const prisma = makePrisma({ externalFinanceApplication: { findFirst: jest.fn().mockResolvedValue({ id: 'app-1', status: 'SENT', roomId: 'room-1', room }), update: jest.fn() } });
    const service = new FinanceApplicationService(prisma, numbers, pii, config);
    await expect(service.update('app-1', { productId: '2b5e3d1e-0000-4000-8000-000000000001' }, owner)).rejects.toThrow(ConflictException);
  });
});

const ready = {
  id: 'app-1', roomId: 'room-1', status: 'DRAFT', number: 'BC-260924-001', occupationOverride: null, messageOverride: null, room,
  customer: { id: 'c1', name: 'สมหญิง ใจดี', phone: '0937581095', occupation: 'พนักงานบริษัท', birthDate: new Date('1997-12-27') },
  product: { id: 'p1', name: 'iPhone 13 Pro Max', brand: 'Apple', model: '13 Pro Max', storage: '256GB', imeiSerial: '355908667841899', category: 'PHONE_USED', status: 'IN_STOCK' },
  files: [{ slot: 'ID_SELFIE', sentAt: null }, { slot: 'ID_CARD', sentAt: null }, { slot: 'INCOME', sentAt: null }],
  events: [],
};

describe('FinanceApplicationService.preview / send', () => {
  it('previews the 12-item text with the model name from stock and lists nothing missing', async () => {
    const prisma = makePrisma({ externalFinanceApplication: { findFirst: jest.fn().mockResolvedValue(ready) } });
    const service = new FinanceApplicationService(prisma, numbers, pii, config);
    const preview = await service.preview('app-1', owner);
    expect(preview.canSend).toBe(true);
    expect(preview.text).toContain('3.สนใจโทรศัพท์รุ่น : iPhone 13 Pro Max 256GB');
    expect(preview.text).toContain('4.มือ1/2 : 2');
    expect(preview.text).toContain('12.มีสายชาร์จหรือไม่? : -');
    expect(preview.text).toContain('{{link}}'.length ? 'เอกสารทั้งหมด 3 ไฟล์:' : '');
  });
  it('blocks send when occupation or a required slot is missing, naming both', async () => {
    const app = { ...ready, customer: { ...ready.customer, occupation: null }, files: ready.files.filter((f) => f.slot !== 'INCOME') };
    const prisma = makePrisma({ externalFinanceApplication: { findFirst: jest.fn().mockResolvedValue(app) } });
    const service = new FinanceApplicationService(prisma, numbers, pii, config);
    const preview = await service.preview('app-1', owner);
    expect(preview.canSend).toBe(false);
    expect(preview.missingFields).toEqual(['occupation']);
    expect(preview.missingRequiredSlots).toEqual(['INCOME']);
    await expect(service.send('app-1', { via: 'COPY' }, owner)).rejects.toThrow('อาชีพ');
  });
  it('send (COPY) issues a token, stamps files, stores the final text with the link and returns the url once', async () => {
    const update = jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...ready, ...data, files: ready.files }));
    const prisma = makePrisma({
      externalFinanceApplication: { findFirst: jest.fn().mockResolvedValue(ready), update },
      externalFinanceApplicationFile: { updateMany: jest.fn().mockResolvedValue({ count: 3 }) },
      user: { findUnique: jest.fn().mockResolvedValue({ name: 'ป๊อปคอร์น' }) },
    });
    const service = new FinanceApplicationService(prisma, numbers, pii, config);
    const result = await service.send('app-1', { via: 'COPY' }, owner);
    expect(result.shareUrl).toMatch(/^https:\/\/bestchoicephone\.app\/api\/g\/[A-Za-z0-9_-]{43}$/);
    expect(result.messageText.endsWith(`เอกสารทั้งหมด 3 ไฟล์: ${result.shareUrl}`)).toBe(true);
    expect(result.messageText).toContain('ส่งโดย ป๊อปคอร์น · BESTCHOICE');
    const data = update.mock.calls[0][0].data;
    expect(data.status).toBe('SENT');
    expect(data.sentVia).toBe('COPY');
    expect(data.shareTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(data.shareTokenEnc).not.toContain(result.shareUrl.split('/').pop());
    expect(prisma.externalFinanceApplicationFile.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ applicationId: 'app-1', sentAt: null }) }));
  });
  it('send via BOT is not available in PR 1', async () => {
    const prisma = makePrisma({ externalFinanceApplication: { findFirst: jest.fn().mockResolvedValue(ready) } });
    const service = new FinanceApplicationService(prisma, numbers, pii, config);
    await expect(service.send('app-1', { via: 'BOT' }, owner)).rejects.toThrow('PR 2');
  });
  it('staffResult APPROVED closes the application and stamps resultSource STAFF; cancel revokes the link', async () => {
    const sent = { ...ready, status: 'SENT', shareTokenHash: 'h', shareExpiresAt: new Date(Date.now() + 86400000) };
    const update = jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...sent, ...data }));
    const prisma = makePrisma({ externalFinanceApplication: { findFirst: jest.fn().mockResolvedValue(sent), update } });
    const service = new FinanceApplicationService(prisma, numbers, pii, config);
    await service.staffResult('app-1', { result: 'APPROVED' }, owner);
    expect(update.mock.calls[0][0].data).toMatchObject({ status: 'APPROVED', resultSource: 'STAFF' });
    expect(update.mock.calls[0][0].data.closedAt).toBeInstanceOf(Date);
    await service.cancel('app-1', owner);
    expect(update.mock.calls[1][0].data).toMatchObject({ status: 'CANCELLED' });
    expect(update.mock.calls[1][0].data.shareRevokedAt).toBeInstanceOf(Date);
  });
});
