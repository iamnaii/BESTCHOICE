import { ChatChannel, DunningActionStatus, DunningChannel, MessageRole, Prisma, PrismaClient } from '@prisma/client';
import { NotFoundException } from '@nestjs/common';
import { JOURNEY_EVENT_GROUPS, type JourneyListResponse } from '@installment/shared';
import type { PrismaService } from '../../prisma/prisma.service';
import { CustomerJourneyService } from './customer-journey.service';
import { JourneyStateService } from './journey-state.service';
import { JourneySummaryService } from './journey-summary.service';
import { journeyDedupeKey } from './journey-data-schemas';

const FORBIDDEN_KEYS = ['phone', 'phoneSecondary', 'nationalId', 'address', 'addressCurrent', 'addressIdCard', 'addressWork', 'text', 'content', 'messageContent', 'notes', 'note', 'voiceMemoUrl', 'overrideReason', 'customerName', 'reviewNotes', 'voidReason', 'defectDescription', 'reason'];
const EVENT_KEYS = ['id', 'type', 'group', 'stage', 'timestamp', 'title', 'subtitle', 'actor', 'reliability', 'origin', 'href', 'metadata'];
function allKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => allKeys(v, keys));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) { keys.add(k); allKeys(v, keys); }
  return keys;
}

/** PDPA snapshot ของคำตอบ GET /customers/:id/journey ทั้งก้อน กับ Postgres จริง — ต้อง apply migration ของ Task 1 แล้ว · audit_logs ลบไม่ได้ ค้างในฐานทดสอบโดยตั้งใจ */
describe('CustomerJourneyService.list (real DB) — PDPA · สิทธิ์ · รวมผู้สนใจ · หน้า', () => {
  const prisma = new PrismaClient();
  const db = prisma as unknown as PrismaService;
  const service = new CustomerJourneyService(db, new JourneySummaryService(db, new JourneyStateService(db)));
  const stamp = Date.now();
  const phone = `08${String(stamp).slice(-8)}`;
  const nationalId = `3${String(stamp).padStart(12, '0').slice(-12)}`;
  const address = 'บ้านเลขที่ 88/8 ซอยสเปคการเดินทาง';
  const ids = { staff: '', other: '', target: '', placeholder: '', deleted: '', open: '', assigned: '', buyer: '', branch: '', product: '', contract: '', rule: '' };
  // OD-10: ข้อความที่ต้องไม่หลุดไปถึง SALES ในกลุ่มชำระเงิน/ติดตามหนี้ (ข้อมูลสังเคราะห์ของสเปค)
  const callNote = `โน้ตโทรสเปค ${phone} ${address}`;
  const dunningText = `ข้อความทวงสเปค คุณสมหมาย โทร ${phone}`;
  const dec = (value: string) => new Prisma.Decimal(value);
  const OWNER = { id: 'owner-spec', role: 'OWNER' };
  const query = { groups: [...JOURNEY_EVENT_GROUPS], limit: 100 };
  const page = async (id: string, actor: { id: string; role: string }, extra: Record<string, unknown> = {}) => {
    const result = await service.list(id, { ...query, ...extra }, actor);
    if (!('events' in result)) throw new Error('ได้ redirect');
    return result as JourneyListResponse;
  };

  beforeAll(async () => {
    const upsert = (email: string, name: string) => prisma.user.upsert({ where: { email }, update: {}, create: { email, password: 'journey-spec', name, role: 'SALES' } });
    ids.staff = (await upsert('journey-spec-staff@example.test', 'พนักงานสเปคการเดินทาง')).id;
    ids.other = (await upsert('journey-spec-other@example.test', 'พนักงานอีกคน')).id;
    ids.target = (await prisma.customer.create({ data: { name: 'สมหมาย สเปคการเดินทาง', phone, nationalId, addressCurrent: address } })).id;
    ids.placeholder = (await prisma.customer.create({ data: { name: 'Facebook #spec', acquisitionSource: 'CHAT_FACEBOOK', deletedAt: new Date(), mergedIntoId: ids.target } })).id;
    ids.deleted = (await prisma.customer.create({ data: { name: 'journey deleted spec', deletedAt: new Date() } })).id;
    ids.open = (await prisma.chatRoom.create({ data: { channel: ChatChannel.FACEBOOK, externalUserId: `journey-pdpa-open-${stamp}`, customerId: ids.target } })).id;
    ids.assigned = (await prisma.chatRoom.create({ data: { channel: ChatChannel.LINE_SHOP, externalUserId: `journey-pdpa-assigned-${stamp}`, customerId: ids.target, assignedToId: ids.other } })).id;
    await prisma.chatMessage.createMany({ data: [
      { roomId: ids.open, role: MessageRole.CUSTOMER, text: `ผมสมหมาย เบอร์ ${phone}` },
      { roomId: ids.open, role: MessageRole.STAFF, text: `ส่งที่ ${address}` },
      { roomId: ids.assigned, role: MessageRole.CUSTOMER, text: 'ห้องที่คนอื่นดูแล' },
    ] });
    await prisma.todo.create({ data: { title: `โทรหา ${phone}`, description: address, createdById: ids.staff, roomId: ids.open, dueDate: new Date(Date.now() + 86_400_000) } });
    await prisma.auditLog.create({ data: { userId: ids.staff, action: 'AI_LEAD_CAPTURED', entity: 'customer', entityId: ids.placeholder, newValue: { customerName: 'สมหมาย', phone, address, packageChoice: 'A', downAmount: 1990 } } });
    await prisma.creditCheck.create({ data: { customerId: ids.target } });
    await prisma.customerTag.create({ data: { customerId: ids.target, tag: 'VIP', source: 'MANUAL', appliedByUserId: ids.staff, reason: `ลูกค้า ${phone}` } });
    const entry = { customerId: ids.target, occurredAt: new Date(), actorType: 'STAFF', actorUserId: ids.staff };
    await prisma.customerJourneyEntry.create({ data: { ...entry, originCustomerId: ids.placeholder, origin: 'SYSTEM', kind: 'PLACEHOLDER_MERGED', dedupeKey: journeyDedupeKey('PLACEHOLDER_MERGED', ids.placeholder), data: { roomCount: 1 } } });
    await prisma.customerJourneyEntry.create({ data: { ...entry, originCustomerId: ids.target, origin: 'MANUAL', kind: 'TOUCHPOINT', roomId: ids.assigned, channel: 'PHONE', outcome: 'APPOINTED', note: `โทร ${phone}` } });

    // OD-10: ลูกค้าที่มีสัญญา — ชำระแล้ว 1 งวด · โทรติดตามพร้อมโน้ต · ทวงทาง LINE พร้อมข้อความ
    ids.buyer = (await prisma.customer.create({ data: { name: `journey pdpa buyer ${stamp}` } })).id;
    ids.branch = (await prisma.branch.create({ data: { name: `journey pdpa spec ${stamp}` } })).id;
    ids.product = (await prisma.product.create({
      data: { name: 'journey pdpa phone', brand: 'Apple', model: 'iPhone 15', category: 'PHONE_NEW', costPrice: dec('20000.00'), branchId: ids.branch, imeiSerial: `JPD-${stamp}` },
    })).id;
    ids.contract = (await prisma.contract.create({
      data: {
        contractNumber: `JPD-${stamp}`, customerId: ids.buyer, productId: ids.product, branchId: ids.branch, salespersonId: ids.staff, planType: 'STORE_WITH_INTEREST',
        sellingPrice: dec('12000.00'), downPayment: dec('0.00'), interestRate: dec('0.0000'), totalMonths: 12, interestTotal: dec('0.00'),
        financedAmount: dec('12000.00'), monthlyPayment: dec('1000.00'), status: 'OVERDUE',
      },
    })).id;
    await prisma.payment.create({ data: { contractId: ids.contract, installmentNo: 1, dueDate: new Date(Date.UTC(2026, 7, 1)), amountDue: dec('1000.00'), amountPaid: dec('1000.00'), status: 'PAID' } });
    await prisma.callLog.create({ data: { contractId: ids.contract, callerId: ids.staff, calledAt: new Date(), result: 'PROMISED', notes: callNote } });
    ids.rule = (await prisma.dunningRule.create({ data: { name: `journey pdpa rule ${stamp}`, triggerDay: 7, channel: DunningChannel.LINE, messageTemplate: 'journey pdpa template' } })).id;
    await prisma.dunningAction.create({ data: { dunningRuleId: ids.rule, contractId: ids.contract, channel: DunningChannel.LINE, status: DunningActionStatus.SENT, messageContent: dunningText } });
  });

  afterAll(async () => {
    const customerIds = [ids.target, ids.placeholder, ids.deleted, ids.buyer];
    await prisma.dunningAction.deleteMany({ where: { contractId: ids.contract } });
    await prisma.dunningRule.deleteMany({ where: { id: ids.rule } });
    await prisma.callLog.deleteMany({ where: { contractId: ids.contract } });
    await prisma.payment.deleteMany({ where: { contractId: ids.contract } });
    await prisma.contract.deleteMany({ where: { id: ids.contract } });
    await prisma.product.deleteMany({ where: { id: ids.product } });
    const roomIds = [ids.open, ids.assigned];
    await prisma.customerJourneyEntry.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.todo.deleteMany({ where: { roomId: { in: roomIds } } });
    await prisma.chatMessage.deleteMany({ where: { roomId: { in: roomIds } } });
    await prisma.chatRoom.deleteMany({ where: { id: { in: roomIds } } });
    await prisma.creditCheck.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customerTag.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: [ids.placeholder, ids.deleted] } } });
    await prisma.customer.deleteMany({ where: { id: { in: [ids.target, ids.buyer] } } });
    await prisma.branch.deleteMany({ where: { id: ids.branch } });
    await prisma.$disconnect();
  });

  it('redirect placeholder ที่รวมแล้ว · 404 ลบด้วยเหตุอื่น · หน้าลูกค้ามีประวัติของ placeholder', async () => {
    await expect(service.list(ids.placeholder, {}, OWNER)).resolves.toEqual({ redirectToCustomerId: ids.target });
    await expect(service.list(ids.deleted, {}, OWNER)).rejects.toThrow(NotFoundException);
    const result = await page(ids.target, OWNER);
    expect(result.mergedCustomerIds).toEqual([ids.placeholder]);
    const types = result.events.map((e) => e.type);
    for (const type of ['CHAT_ROOM_OPENED', 'CHAT_DAY', 'APPOINTMENT', 'AI_LEAD_CAPTURED', 'CUSTOMER_CREATED_BY_STAFF', 'CREDIT_CHECK_OPENED', 'TAG_ADDED', 'PLACEHOLDER_MERGED', 'TOUCHPOINT']) expect(types).toContain(type);
  });

  it('PDPA snapshot: ไม่มีคีย์ต้องห้าม ไม่มีข้อความแชท/เบอร์/บัตร/ที่อยู่ · รูปรายการอยู่ในชุดคีย์ที่อนุญาต', async () => {
    const result = await page(ids.target, OWNER);
    const keys = allKeys(result);
    expect(FORBIDDEN_KEYS.filter((k) => keys.has(k))).toEqual([]);
    const json = JSON.stringify(result);
    for (const secret of [phone, nationalId, address, 'สมหมาย', 'ห้องที่คนอื่นดูแล']) expect(json).not.toContain(secret);
    for (const event of result.events) {
      expect(Object.keys(event).filter((k) => !EVENT_KEYS.includes(k))).toEqual([]);
      expect(Object.keys(event.actor ?? {}).filter((k) => !['type', 'id', 'name'].includes(k))).toEqual([]);
    }
  });

  it('SALES ไม่เห็นห้อง/บันทึกของห้องที่คนอื่นดูแล · ACCOUNTANT ไม่ได้ chat แม้ขอมา', async () => {
    const sales = await page(ids.target, { id: ids.staff, role: 'SALES' });
    expect(sales.events.some((e) => e.href === `/inbox/${ids.assigned}` || e.type === 'TOUCHPOINT')).toBe(false);
    expect(sales.events.some((e) => e.href === `/inbox/${ids.open}`)).toBe(true);
    const accountant = await page(ids.target, { id: 'acc-spec', role: 'ACCOUNTANT' });
    expect(accountant.events.filter((e) => e.group === 'chat')).toEqual([]);
    expect(accountant.events.map((e) => e.type)).toEqual(expect.arrayContaining(['CREDIT_CHECK_OPENED', 'TAG_ADDED']));
  });

  it('OD-10: SALES เห็นชำระเงินและติดตามหนี้ของสัญญา — ไม่มีโน้ตโทร ข้อความทวง เบอร์ ที่อยู่ · metadata อยู่ในชุดคีย์ที่อนุญาต', async () => {
    const sales = await page(ids.buyer, { id: ids.other, role: 'SALES' });
    expect(sales.events.map((e) => e.type)).toEqual(expect.arrayContaining(['PAYMENT_RECEIVED', 'COLLECTION_CALL', 'COLLECTION_DUNNING']));
    const keys = allKeys(sales);
    expect(FORBIDDEN_KEYS.filter((k) => keys.has(k))).toEqual([]);
    const json = JSON.stringify(sales);
    for (const secret of [phone, address, 'โน้ตโทรสเปค', 'ข้อความทวงสเปค']) expect(json).not.toContain(secret);
    const allowedMetadata = ['amount', 'method', 'result', 'status', 'channel', 'action', 'letterNumber'];
    for (const event of sales.events.filter((e) => e.group === 'payment' || e.group === 'collections')) {
      expect(Object.keys(event).filter((k) => !EVENT_KEYS.includes(k))).toEqual([]);
      expect(event).not.toHaveProperty('subtitle');
      expect(Object.keys(event.metadata ?? {}).filter((k) => !allowedMetadata.includes(k))).toEqual([]);
    }
  });

  it('เดินทีละ 2 จนหมด ได้ลำดับเดียวกับหน้าเดียว ไม่ซ้ำ ไม่ข้าม', async () => {
    const full = (await page(ids.target, OWNER)).events.map((e) => e.id);
    const walked: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 50; guard += 1) {
      const next = await page(ids.target, OWNER, { limit: 2, cursor });
      walked.push(...next.events.map((e) => e.id));
      if (!next.nextCursor) break;
      cursor = next.nextCursor;
    }
    expect(walked).toEqual(full);
  });

  it('include=summary,counts: summary ที่แนบมาไม่มีเบอร์/เลขบัตร/ที่อยู่/ชื่อ · counts (entries สแกนทีละกลุ่มกับ DB จริง) มีแต่ชื่อกลุ่ม', async () => {
    const result = await page(ids.target, OWNER, { include: ['summary', 'counts'] });
    expect(result.summary).toMatchObject({ stage: expect.any(String), steps: expect.any(Array) });
    expect(result.counts).toMatchObject({ chat: expect.any(Number), system: expect.any(Number) });
    const json = JSON.stringify({ summary: result.summary, counts: result.counts });
    for (const secret of [phone, nationalId, address, 'สมหมาย']) expect(json).not.toContain(secret);
    expect(Object.keys(result.counts ?? {}).every((key) => (JOURNEY_EVENT_GROUPS as readonly string[]).includes(key))).toBe(true);
  });
});
