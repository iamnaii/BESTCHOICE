import { BadRequestException, ForbiddenException, ConflictException } from '@nestjs/common';
import { FinanceApplicationService } from '../services/finance-application.service';
import { hashLockKey } from '../../../utils/advisory-lock.util';
import { decryptPII, encryptPII } from '../../../utils/crypto.util';
import { hashShareToken } from '../finance-share-token.util';

const KEY = 'a'.repeat(64);
const room = { id: 'room-1', assignedToId: 'sales-2', customerId: null, deletedAt: null, channel: 'FACEBOOK' };
// spy (ไม่ใช่ identity) — พิสูจน์ว่า service ส่ง phoneEncrypted เข้า decryptCustomerFields จริง
// (fix round 1: ถ้า applicationInclude.customer.select ลืม phoneEncrypted จุดนี้จะไม่มี key ให้ decrypt)
const pii = {
  decryptCustomerFields: jest.fn((c: any) => ({
    ...c,
    phone: c?.phoneEncrypted ? String(c.phoneEncrypted).replace(/^enc:/, '') : (c?.phone ?? null),
  })),
} as any;
const config = {
  get: (key: string) =>
    key === 'SHARE_PAGE_BASE_URL' ? 'https://bestchoicephone.app' : key === 'PII_ENCRYPTION_KEY' ? KEY : undefined,
} as any;
function makePrisma(overrides: Record<string, unknown> = {}) {
  const prisma: any = {
    chatRoom: { findFirst: jest.fn().mockResolvedValue(room) },
    customer: { findFirst: jest.fn().mockResolvedValue(null) },
    externalFinanceCompany: { upsert: jest.fn().mockResolvedValue({ id: 'gfin-1' }) },
    externalFinanceApplication: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'app-1', ...data, shareTokenHash: null, shareTokenEnc: null, files: [], events: [] })),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn(),
    },
    externalFinanceApplicationFile: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    externalFinanceApplicationEvent: { create: jest.fn().mockResolvedValue({}) },
    product: { findFirst: jest.fn() },
    user: { findUnique: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
    $executeRawUnsafe: jest.fn(),
    ...overrides,
  };
  return prisma;
}
const numbers = { next: jest.fn().mockResolvedValue('BC-260924-001') } as any;
const makeStorage = () => ({ delete: jest.fn().mockResolvedValue(undefined) });
const makeCustomers = () => ({ update: jest.fn().mockResolvedValue({ id: 'c1' }) });
function makeService(prisma: any, storage = makeStorage(), customers = makeCustomers()) {
  return new FinanceApplicationService(prisma, numbers, pii, config, storage as any, customers as any);
}
const owner = { id: 'u-owner', role: 'OWNER' };
const sales = { id: 'sales-1', role: 'SALES' };

/** minor 8 — response ใด ๆ ต้องไม่มีคอลัมน์ลิงก์สาธารณะ */
function expectNoShareSecrets(value: unknown) {
  expect(value).not.toHaveProperty('shareTokenHash');
  expect(value).not.toHaveProperty('shareTokenEnc');
}

describe('FinanceApplicationService.createDraft', () => {
  it('creates a DRAFT with number, GFIN company and CREATED event', async () => {
    const prisma = makePrisma();
    const service = makeService(prisma);
    const app = await service.createDraft('room-1', owner);
    expect(app.status).toBe('DRAFT');
    expectNoShareSecrets(app);
    expect(prisma.externalFinanceApplication.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ number: 'BC-260924-001', financeCompanyId: 'gfin-1', roomId: 'room-1', createdById: 'u-owner', status: 'DRAFT' }),
    }));
    expect(prisma.externalFinanceApplicationEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ kind: 'CREATED', actorType: 'STAFF' }) }));
  });
  it('takes a room-scoped advisory lock before checking for an existing open application (race fix)', async () => {
    const prisma = makePrisma();
    const service = makeService(prisma);
    await service.createDraft('room-1', owner);
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
      `SELECT pg_advisory_xact_lock(${hashLockKey('finance-app-room:room-1')})`,
    );
    const lockOrder = prisma.$executeRawUnsafe.mock.invocationCallOrder[0];
    const findFirstOrder = prisma.externalFinanceApplication.findFirst.mock.invocationCallOrder[0];
    expect(lockOrder).toBeLessThan(findFirstOrder);
  });
  it('returns the existing open application instead of creating a second one', async () => {
    const existing = { id: 'app-0', status: 'SENT', roomId: 'room-1', files: [], events: [], shareTokenHash: 'h', shareTokenEnc: 'e' };
    const prisma = makePrisma({ externalFinanceApplication: { findFirst: jest.fn().mockResolvedValue(existing), create: jest.fn() } });
    const service = makeService(prisma);
    const app = await service.createDraft('room-1', owner);
    expect(app).toMatchObject({ id: 'app-0' });
    expectNoShareSecrets(app);
    expect(prisma.externalFinanceApplication.create).not.toHaveBeenCalled();
    // createDraft ดูเฉพาะใบที่ยังเปิด — ใบปิดแล้ว (ใบล่าสุดของ listForRoom) ต้องไม่กันการเริ่มใบใหม่ (I1)
    expect(prisma.externalFinanceApplication.findFirst.mock.calls[0][0].where.status).toEqual({ in: ['DRAFT', 'SENT', 'ACKNOWLEDGED', 'MORE_INFO'] });
  });
  it('rejects SALES on a room assigned to someone else', async () => {
    const service = makeService(makePrisma());
    await expect(service.createDraft('room-1', sales)).rejects.toThrow(ForbiddenException);
  });
  // final review C1 — เกือบทุกห้องผูก "ผู้สนใจอัตโนมัติจากแชท" ไว้ ถ้าคัดลอกมาใบยื่นจะข้ามขั้นอ่านบัตร/สร้างลูกค้า
  it('does not seed customerId from a chat placeholder (CHAT_* source, no phone, no national id)', async () => {
    const prisma = makePrisma({ chatRoom: { findFirst: jest.fn().mockResolvedValue({ ...room, customerId: 'c-ph' }) } });
    prisma.customer.findFirst.mockResolvedValue({ id: 'c-ph', acquisitionSource: 'CHAT_FACEBOOK', phone: null, nationalId: null, deletedAt: null });
    const service = makeService(prisma);
    await service.createDraft('room-1', owner);
    expect(prisma.externalFinanceApplication.create.mock.calls[0][0].data.customerId).toBeNull();
  });
  it('seeds customerId from a real customer of the room', async () => {
    const prisma = makePrisma({ chatRoom: { findFirst: jest.fn().mockResolvedValue({ ...room, customerId: 'c-real' }) } });
    prisma.customer.findFirst.mockResolvedValue({ id: 'c-real', acquisitionSource: 'CHAT_FACEBOOK', phone: '0812345678', nationalId: null, deletedAt: null });
    const service = makeService(prisma);
    await service.createDraft('room-1', owner);
    expect(prisma.externalFinanceApplication.create.mock.calls[0][0].data.customerId).toBe('c-real');
  });
});

describe('FinanceApplicationService.listForRoom', () => {
  const row = (over: Record<string, unknown>) => ({ roomId: 'room-1', files: [], events: [], shareTokenHash: 'h', shareTokenEnc: 'e', ...over });
  it('I1: with no open application the latest closed one of the room is current (not dropped to "ใบยื่นใหม่")', async () => {
    const prisma = makePrisma();
    prisma.externalFinanceApplication.findMany.mockResolvedValue([
      row({ id: 'a3', status: 'APPROVED', createdAt: new Date('2026-09-24') }),
      row({ id: 'a2', status: 'CANCELLED', createdAt: new Date('2026-09-23') }),
    ]);
    const result = await makeService(prisma).listForRoom('room-1', owner);
    expect(result.current?.id).toBe('a3');
    expect(result.history.map((h) => h.id)).toEqual(['a2']);
    expectNoShareSecrets(result.current);
    result.history.forEach(expectNoShareSecrets);
  });
  it('an open application of the room wins over a newer closed one', async () => {
    const prisma = makePrisma();
    prisma.externalFinanceApplication.findMany.mockResolvedValue([
      row({ id: 'a3', status: 'APPROVED' }),
      row({ id: 'a2', status: 'SENT' }),
    ]);
    const result = await makeService(prisma).listForRoom('room-1', owner);
    expect(result.current?.id).toBe('a2');
    expect(result.history.map((h) => h.id)).toEqual(['a3']);
  });
  it('an application of another room of the same customer is history, never current', async () => {
    const prisma = makePrisma({ chatRoom: { findFirst: jest.fn().mockResolvedValue({ ...room, assignedToId: null, customerId: 'c1' }) } });
    prisma.externalFinanceApplication.findMany.mockResolvedValue([row({ id: 'other', roomId: 'room-9', status: 'SENT' })]);
    const result = await makeService(prisma).listForRoom('room-1', owner);
    expect(result.current).toBeNull();
    expect(result.history.map((h) => h.id)).toEqual(['other']);
  });
  it('SALES: cross-room history excludes applications of rooms someone else holds (same rule as access())', async () => {
    const prisma = makePrisma({ chatRoom: { findFirst: jest.fn().mockResolvedValue({ ...room, assignedToId: 'sales-1', customerId: 'c1' }) } });
    await makeService(prisma).listForRoom('room-1', sales);
    const where = prisma.externalFinanceApplication.findMany.mock.calls[0][0].where;
    expect(where.AND).toContainEqual({ room: { OR: [{ assignedToId: null }, { assignedToId: 'sales-1' }] } });
    expect(where.AND).toContainEqual({ OR: [{ roomId: 'room-1' }, { customerId: 'c1' }] });
  });
  it('OWNER sees the whole customer history (no room filter)', async () => {
    const prisma = makePrisma({ chatRoom: { findFirst: jest.fn().mockResolvedValue({ ...room, customerId: 'c1' }) } });
    await makeService(prisma).listForRoom('room-1', owner);
    const where = prisma.externalFinanceApplication.findMany.mock.calls[0][0].where;
    expect(where.AND).toContainEqual({});
  });
});

describe('FinanceApplicationService.update', () => {
  const draftRow = (over: Record<string, unknown> = {}) => ({ id: 'app-1', status: 'DRAFT', roomId: 'room-1', productId: 'p-old', room, files: [], events: [], shareTokenHash: null, shareTokenEnc: null, ...over });
  it('blocks edits after send', async () => {
    const prisma = makePrisma({ externalFinanceApplication: { findFirst: jest.fn().mockResolvedValue({ id: 'app-1', status: 'SENT', roomId: 'room-1', room }), update: jest.fn() } });
    const service = makeService(prisma);
    await expect(service.update('app-1', { productId: '2b5e3d1e-0000-4000-8000-000000000001' }, owner)).rejects.toThrow(ConflictException);
  });
  it('I3: changing the device soft-deletes the unsent stock photos in the same tx and deletes their objects after commit', async () => {
    const prisma = makePrisma();
    prisma.externalFinanceApplication.findFirst.mockResolvedValue(draftRow());
    prisma.externalFinanceApplication.findUniqueOrThrow.mockResolvedValue(draftRow({ productId: 'p-new' }));
    prisma.product.findFirst.mockResolvedValue({ id: 'p-new', status: 'IN_STOCK' });
    // findMany ถูกกรองให้เหลือเฉพาะรูปสต๊อกที่ยังไม่ส่ง — ไฟล์ที่ส่งแล้ว/อัปโหลดเองไม่อยู่ในผล จึงไม่ถูกแตะ
    prisma.externalFinanceApplicationFile.findMany.mockResolvedValue([{ id: 'f-front', storageKey: 'k-front' }, { id: 'f-back', storageKey: 'k-back' }]);
    const storage = makeStorage();
    const view = await makeService(prisma, storage).update('app-1', { productId: 'p-new' }, owner);
    expect(prisma.externalFinanceApplicationFile.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { applicationId: 'app-1', deletedAt: null, sentAt: null, source: 'PRODUCT_PHOTO' },
    }));
    expect(prisma.externalFinanceApplicationFile.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['f-front', 'f-back'] } }, data: { deletedAt: expect.any(Date) } });
    // ล็อกเดียวกับ attach() ของไฟล์ — fromProduct ของเครื่องเดิมแนบรูปหลังล้างไม่ได้
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(`SELECT pg_advisory_xact_lock(${hashLockKey('finance-app-files:app-1')})`);
    expect(storage.delete.mock.calls.map((c: unknown[]) => c[0])).toEqual(['k-front', 'k-back']);
    expect(prisma.externalFinanceApplication.updateMany.mock.calls[0][0].data).toEqual({ productId: 'p-new' });
    expectNoShareSecrets(view);
  });
  it('clearing the device (productId null) also removes the unsent stock photos; a storage failure does not fail the request', async () => {
    const prisma = makePrisma();
    prisma.externalFinanceApplication.findFirst.mockResolvedValue(draftRow());
    prisma.externalFinanceApplication.findUniqueOrThrow.mockResolvedValue(draftRow({ productId: null }));
    prisma.externalFinanceApplicationFile.findMany.mockResolvedValue([{ id: 'f1', storageKey: 'k1' }]);
    const storage = { delete: jest.fn().mockRejectedValue(new Error('gcs down')) };
    await expect(makeService(prisma, storage as any).update('app-1', { productId: null as unknown as string }, owner)).resolves.toMatchObject({ productId: null });
    expect(prisma.externalFinanceApplicationFile.updateMany).toHaveBeenCalled();
    expect(prisma.externalFinanceApplication.updateMany.mock.calls[0][0].data).toEqual({ productId: null });
  });
  it('same device again / occupation-only edit does not touch files', async () => {
    const prisma = makePrisma();
    prisma.externalFinanceApplication.findFirst.mockResolvedValue(draftRow());
    prisma.externalFinanceApplication.findUniqueOrThrow.mockResolvedValue(draftRow({ occupationOverride: 'ค้าขาย' }));
    prisma.product.findFirst.mockResolvedValue({ id: 'p-old', status: 'IN_STOCK' });
    const storage = makeStorage();
    await makeService(prisma, storage).update('app-1', { productId: 'p-old', occupationOverride: 'ค้าขาย' }, owner);
    expect(prisma.externalFinanceApplicationFile.findMany).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });
  it('409 when the status changed between read and write (CAS)', async () => {
    const prisma = makePrisma();
    prisma.externalFinanceApplication.findFirst.mockResolvedValue(draftRow());
    prisma.externalFinanceApplication.updateMany.mockResolvedValue({ count: 0 });
    await expect(makeService(prisma).update('app-1', { occupationOverride: 'ค้าขาย' }, owner)).rejects.toThrow(ConflictException);
  });
});

describe('FinanceApplicationService.updateCustomerFields (C1)', () => {
  const linked = (over: Record<string, unknown> = {}) => ({ id: 'app-1', status: 'DRAFT', roomId: 'room-1', customerId: 'c1', room, files: [], events: [], shareTokenHash: null, shareTokenEnc: null, ...over });
  const realCustomer = { id: 'c1', birthDate: null, phoneEncrypted: null, acquisitionSource: null, phone: null, nationalId: 'enc-nid', deletedAt: null };
  it('goes through the room rule: SALES on a room someone else holds → 403, customer untouched', async () => {
    const prisma = makePrisma();
    prisma.externalFinanceApplication.findFirst.mockResolvedValue(linked());
    const customers = makeCustomers();
    await expect(makeService(prisma, makeStorage(), customers).updateCustomerFields('app-1', { phone: '0812345678' }, sales)).rejects.toThrow(ForbiddenException);
    expect(customers.update).not.toHaveBeenCalled();
  });
  it('delegates to CustomersService.update with the staff actor (normalisation, phone lock, duplicate 409, encryption live there)', async () => {
    const prisma = makePrisma();
    prisma.externalFinanceApplication.findFirst.mockResolvedValue(linked());
    prisma.customer.findFirst.mockResolvedValue(realCustomer);
    const customers = makeCustomers();
    const view = await makeService(prisma, makeStorage(), customers).updateCustomerFields('app-1', { phone: '0812345678', birthDate: '1997-12-27' }, owner);
    expect(customers.update).toHaveBeenCalledWith('c1', { phone: '0812345678', birthDate: '1997-12-27T00:00:00.000Z' }, { id: 'u-owner', role: 'OWNER' });
    expectNoShareSecrets(view);
  });
  it('refuses a chat placeholder (that path is fill-contact) — 409', async () => {
    const prisma = makePrisma();
    prisma.externalFinanceApplication.findFirst.mockResolvedValue(linked());
    prisma.customer.findFirst.mockResolvedValue({ ...realCustomer, acquisitionSource: 'CHAT_LINE', nationalId: null });
    const customers = makeCustomers();
    await expect(makeService(prisma, makeStorage(), customers).updateCustomerFields('app-1', { phone: '0812345678' }, owner)).rejects.toThrow(ConflictException);
    expect(customers.update).not.toHaveBeenCalled();
  });
  it('fill-only: an existing phone / birth date is not overwritten through this route', async () => {
    const prisma = makePrisma();
    prisma.externalFinanceApplication.findFirst.mockResolvedValue(linked());
    prisma.customer.findFirst.mockResolvedValue({ ...realCustomer, phoneEncrypted: 'enc:0899999999', phone: '0899999999', birthDate: new Date('1990-01-01') });
    const service = makeService(prisma);
    await expect(service.updateCustomerFields('app-1', { phone: '0812345678' }, owner)).rejects.toThrow('มีเบอร์โทรแล้ว');
    await expect(service.updateCustomerFields('app-1', { birthDate: '1997-12-27' }, owner)).rejects.toThrow('มีวันเกิดแล้ว');
  });
  it('rejects a closed application, an unlinked application, an empty body and a future birth date', async () => {
    const prisma = makePrisma();
    const service = makeService(prisma);
    prisma.externalFinanceApplication.findFirst.mockResolvedValueOnce(linked({ status: 'APPROVED' }));
    await expect(service.updateCustomerFields('app-1', { phone: '0812345678' }, owner)).rejects.toThrow(ConflictException);
    prisma.externalFinanceApplication.findFirst.mockResolvedValueOnce(linked({ customerId: null }));
    await expect(service.updateCustomerFields('app-1', { phone: '0812345678' }, owner)).rejects.toThrow(BadRequestException);
    prisma.externalFinanceApplication.findFirst.mockResolvedValueOnce(linked());
    await expect(service.updateCustomerFields('app-1', {}, owner)).rejects.toThrow(BadRequestException);
    prisma.externalFinanceApplication.findFirst.mockResolvedValueOnce(linked());
    prisma.customer.findFirst.mockResolvedValueOnce(realCustomer);
    await expect(service.updateCustomerFields('app-1', { birthDate: '2999-01-01' }, owner)).rejects.toThrow('อนาคต');
  });
});

const ready = {
  id: 'app-1', roomId: 'room-1', status: 'DRAFT', number: 'BC-260924-001', occupationOverride: null, messageOverride: null, messageText: null, room,
  shareTokenHash: null, shareTokenEnc: null, shareRevokedAt: null, shareExpiresAt: null,
  customer: { id: 'c1', name: 'สมหญิง ใจดี', phone: '0937581095', phoneEncrypted: 'enc:0937581095', occupation: 'พนักงานบริษัท', birthDate: new Date('1997-12-27') },
  product: { id: 'p1', name: 'iPhone 13 Pro Max', brand: 'Apple', model: '13 Pro Max', storage: '256GB', imeiSerial: '355908667841899', category: 'PHONE_USED', status: 'IN_STOCK' },
  files: [{ slot: 'ID_SELFIE', sentAt: null }, { slot: 'ID_CARD', sentAt: null }, { slot: 'INCOME', sentAt: null }],
  events: [],
};

describe('FinanceApplicationService.preview / send', () => {
  it('previews the 12-item text with the model name from stock and lists nothing missing', async () => {
    const prisma = makePrisma({ externalFinanceApplication: { findFirst: jest.fn().mockResolvedValue(ready) } });
    const service = makeService(prisma);
    const preview = await service.preview('app-1', owner);
    expect(preview.canSend).toBe(true);
    expect(preview.text).toContain('3.สนใจโทรศัพท์รุ่น : iPhone 13 Pro Max 256GB');
    expect(preview.text).toContain('4.มือ1/2 : 2');
    expect(preview.text).toContain('12.มีสายชาร์จหรือไม่? : -');
    expect(preview.text).toContain('{{link}}'.length ? 'เอกสารทั้งหมด 3 ไฟล์:' : '');
    expect(preview.text).toContain('093 758 1095'); // เบอร์ถอดรหัสจริงผ่าน pii.decryptCustomerFields (ไม่ใช่ plaintext เฉยๆ)
    // fix round 1 (Important 1): ถ้า applicationInclude.customer.select ลืม phoneEncrypted จะไม่มี key นี้ให้ผ่าน — เทสนี้จับได้
    expect(pii.decryptCustomerFields).toHaveBeenCalledWith(expect.objectContaining({ phoneEncrypted: expect.anything() }));
  });
  it('blocks send when occupation or a required slot is missing, naming both', async () => {
    const app = { ...ready, customer: { ...ready.customer, occupation: null }, files: ready.files.filter((f) => f.slot !== 'INCOME') };
    const prisma = makePrisma({ externalFinanceApplication: { findFirst: jest.fn().mockResolvedValue(app) } });
    const service = makeService(prisma);
    const preview = await service.preview('app-1', owner);
    expect(preview.canSend).toBe(false);
    expect(preview.missingFields).toEqual(['occupation']);
    expect(preview.missingRequiredSlots).toEqual(['INCOME']);
    await expect(service.send('app-1', { via: 'COPY' }, owner)).rejects.toThrow('อาชีพ');
  });
  it('send (COPY) issues a token, stamps files, stores the final text with the link and returns the url once', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = makePrisma({
      externalFinanceApplication: {
        findFirst: jest.fn().mockResolvedValue(ready), updateMany,
        findUniqueOrThrow: jest.fn().mockResolvedValue({ ...ready, status: 'SENT', shareTokenHash: 'h', shareTokenEnc: 'e' }),
      },
      externalFinanceApplicationFile: { updateMany: jest.fn().mockResolvedValue({ count: 3 }) },
      user: { findUnique: jest.fn().mockResolvedValue({ name: 'ป๊อปคอร์น' }) },
    });
    const service = makeService(prisma);
    const result = await service.send('app-1', { via: 'COPY' }, owner);
    expect(result.shareUrl).toMatch(/^https:\/\/bestchoicephone\.app\/api\/g\/[A-Za-z0-9_-]{43}$/);
    expect(result.messageText.endsWith(`เอกสารทั้งหมด 3 ไฟล์: ${result.shareUrl}`)).toBe(true);
    expect(result.messageText).toContain('ส่งโดย ป๊อปคอร์น · BESTCHOICE');
    // CAS บนสถานะที่อ่านมา (minor 9)
    expect(updateMany.mock.calls[0][0].where).toEqual({ id: 'app-1', status: 'DRAFT', deletedAt: null });
    const data = updateMany.mock.calls[0][0].data;
    expect(data.status).toBe('SENT');
    expect(data.sentVia).toBe('COPY');
    expect(data.shareTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(data.shareTokenEnc).not.toContain(result.shareUrl.split('/').pop());
    expect(prisma.externalFinanceApplicationFile.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ applicationId: 'app-1', sentAt: null }) }));
    expectNoShareSecrets(result.application);
  });
  it('send loses the CAS race (status changed concurrently) → 409, no event written', async () => {
    const prisma = makePrisma({
      externalFinanceApplication: { findFirst: jest.fn().mockResolvedValue(ready), updateMany: jest.fn().mockResolvedValue({ count: 0 }), findUniqueOrThrow: jest.fn() },
      user: { findUnique: jest.fn().mockResolvedValue({ name: 'ป๊อปคอร์น' }) },
    });
    await expect(makeService(prisma).send('app-1', { via: 'COPY' }, owner)).rejects.toThrow(ConflictException);
    expect(prisma.externalFinanceApplicationEvent.create).not.toHaveBeenCalled();
  });
  it('send via BOT is not available in PR 1', async () => {
    const prisma = makePrisma({ externalFinanceApplication: { findFirst: jest.fn().mockResolvedValue(ready) } });
    const service = makeService(prisma);
    await expect(service.send('app-1', { via: 'BOT' }, owner)).rejects.toThrow('PR 2');
  });
  it('staffResult APPROVED closes the application and stamps resultSource STAFF; cancel revokes the link — both CAS on the status read', async () => {
    const sent = { ...ready, status: 'SENT', shareTokenHash: 'h', shareTokenEnc: 'e', shareExpiresAt: new Date(Date.now() + 86400000) };
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = makePrisma({ externalFinanceApplication: { findFirst: jest.fn().mockResolvedValue(sent), updateMany, findUniqueOrThrow: jest.fn().mockResolvedValue(sent) } });
    const service = makeService(prisma);
    const result = await service.staffResult('app-1', { result: 'APPROVED' }, owner);
    expect(updateMany.mock.calls[0][0].where).toEqual({ id: 'app-1', status: 'SENT', deletedAt: null });
    expect(updateMany.mock.calls[0][0].data).toMatchObject({ status: 'APPROVED', resultSource: 'STAFF' });
    expect(updateMany.mock.calls[0][0].data.closedAt).toBeInstanceOf(Date);
    expectNoShareSecrets(result);
    const cancelled = await service.cancel('app-1', owner);
    expect(updateMany.mock.calls[1][0].where).toEqual({ id: 'app-1', status: 'SENT', deletedAt: null });
    expect(updateMany.mock.calls[1][0].data).toMatchObject({ status: 'CANCELLED' });
    expect(updateMany.mock.calls[1][0].data.shareRevokedAt).toBeInstanceOf(Date);
    expectNoShareSecrets(cancelled);
  });
  it('staffResult / cancel → 409 when a concurrent writer changed the status first', async () => {
    const sent = { ...ready, status: 'SENT', shareTokenHash: 'h', shareTokenEnc: 'e' };
    const prisma = makePrisma({ externalFinanceApplication: { findFirst: jest.fn().mockResolvedValue(sent), updateMany: jest.fn().mockResolvedValue({ count: 0 }), findUniqueOrThrow: jest.fn() } });
    const service = makeService(prisma);
    await expect(service.staffResult('app-1', { result: 'REJECTED' }, owner)).rejects.toThrow(ConflictException);
    await expect(service.cancel('app-1', owner)).rejects.toThrow(ConflictException);
    expect(prisma.externalFinanceApplicationEvent.create).not.toHaveBeenCalled();
  });
  it('get() never exposes the share hash / encrypted token', async () => {
    const prisma = makePrisma({ externalFinanceApplication: { findFirst: jest.fn().mockResolvedValue({ ...ready, shareTokenHash: 'h', shareTokenEnc: 'e' }) } });
    expectNoShareSecrets(await makeService(prisma).get('app-1', owner));
  });
});

describe('FinanceApplicationService share link — revoked links stay dead (I2)', () => {
  const OLD_RAW = 'o'.repeat(43);
  const oldUrl = `https://bestchoicephone.app/api/g/${OLD_RAW}`;
  const sentApp = (over: Record<string, unknown> = {}) => ({
    ...ready, status: 'MORE_INFO', shareTokenHash: hashShareToken(OLD_RAW), shareTokenEnc: encryptPII(OLD_RAW, KEY),
    shareExpiresAt: new Date(Date.now() + 86400000), shareRevokedAt: null,
    messageText: `1.ชื่อลูกค้า : สมหญิง\nเอกสารทั้งหมด 3 ไฟล์: ${oldUrl}`,
    files: [...ready.files.map((f) => ({ ...f, sentAt: new Date() })), { slot: 'DEVICE_SCREEN', sentAt: null }],
    ...over,
  });
  function build(app: Record<string, unknown>) {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = makePrisma({
      externalFinanceApplication: { findFirst: jest.fn().mockResolvedValue(app), updateMany, findUniqueOrThrow: jest.fn().mockResolvedValue(app) },
      externalFinanceApplicationFile: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    });
    return { prisma, updateMany, service: makeService(prisma) };
  }

  it('extend on a revoked link rotates the token: new hash + new ciphertext, stored text points at the new link, event meta rotated', async () => {
    const { prisma, updateMany, service } = build(sentApp({ shareRevokedAt: new Date() }));
    const result = await service.extendShare('app-1', owner);
    expect(result.rotated).toBe(true);
    const newRaw = result.url.split('/').pop()!;
    expect(newRaw).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newRaw).not.toBe(OLD_RAW);
    const { where, data } = updateMany.mock.calls[0][0];
    expect(where).toMatchObject({ id: 'app-1', shareTokenHash: hashShareToken(OLD_RAW), deletedAt: null });
    expect(data.shareTokenHash).toBe(hashShareToken(newRaw));
    expect(decryptPII(data.shareTokenEnc, KEY)).toBe(newRaw);
    expect(data.shareRevokedAt).toBeNull();
    expect(data.messageText).toContain(`/api/g/${newRaw}`);
    expect(data.messageText).not.toContain(OLD_RAW);
    expect(prisma.externalFinanceApplicationEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ kind: 'LINK_EXTENDED', meta: expect.objectContaining({ rotated: true }) }),
    });
  });
  it('extend on a live link keeps the same token (no rotation)', async () => {
    const { updateMany, service } = build(sentApp());
    const result = await service.extendShare('app-1', owner);
    expect(result).toMatchObject({ rotated: false, url: oldUrl });
    expect(updateMany.mock.calls[0][0].data).not.toHaveProperty('shareTokenHash');
    expect(updateMany.mock.calls[0][0].data).not.toHaveProperty('shareRevokedAt');
  });
  it('extend refuses a closed (e.g. cancelled) application — its link can never be re-enabled', async () => {
    const { updateMany, service } = build(sentApp({ status: 'CANCELLED', shareRevokedAt: new Date() }));
    await expect(service.extendShare('app-1', owner)).rejects.toThrow(ConflictException);
    expect(updateMany).not.toHaveBeenCalled();
  });
  it('resend on a revoked link rotates the token and the resend text carries the new link', async () => {
    const { prisma, updateMany, service } = build(sentApp({ shareRevokedAt: new Date() }));
    const result = await service.resend('app-1', owner);
    expect(result.rotated).toBe(true);
    const newRaw = result.shareUrl.split('/').pop()!;
    expect(newRaw).not.toBe(OLD_RAW);
    expect(result.messageText).toContain(`ลิงก์ใหม่ (ลิงก์เดิมถูกยกเลิกแล้ว): ${result.shareUrl}`);
    const { where, data } = updateMany.mock.calls[0][0];
    expect(where).toEqual({ id: 'app-1', status: 'MORE_INFO', shareTokenHash: hashShareToken(OLD_RAW), deletedAt: null });
    expect(data).toMatchObject({ status: 'SENT', shareTokenHash: hashShareToken(newRaw), shareRevokedAt: null });
    expect(prisma.externalFinanceApplicationEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ kind: 'RESENT', meta: { fileCount: 1, rotated: true } }),
    });
    expectNoShareSecrets(result.application);
  });
  it('resend on a live link reuses the link ("ลิงก์เดิม") and does not touch the token', async () => {
    const { updateMany, service } = build(sentApp());
    const result = await service.resend('app-1', owner);
    expect(result).toMatchObject({ rotated: false, shareUrl: oldUrl });
    expect(result.messageText).toContain(`ลิงก์เดิม: ${oldUrl}`);
    expect(updateMany.mock.calls[0][0].data).not.toHaveProperty('shareTokenHash');
  });
  it('resend → 409 when the status changed concurrently (CAS)', async () => {
    const { updateMany, service } = build(sentApp());
    updateMany.mockResolvedValue({ count: 0 });
    await expect(service.resend('app-1', owner)).rejects.toThrow(ConflictException);
  });
});
