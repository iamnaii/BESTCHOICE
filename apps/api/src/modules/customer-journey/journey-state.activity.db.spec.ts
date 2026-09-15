import { Prisma, PrismaClient } from '@prisma/client';
import { addBkkDays, bangkokStartOfDay } from '../../utils/date.util';
import { JourneyStateService } from './journey-state.service';
import { journeyDedupeKey } from './journey-data-schemas';

/**
 * ตัวตรวจความเคลื่อนไหว (summary 15 นาที · cron 48 ชม.) และด่าน entry-guard กับ Postgres จริง
 * audit_logs ลบไม่ได้ (trigger audit_logs_no_delete) ⇒ ผู้ใช้ของ spec ถูกปล่อยไว้
 */
describe('JourneyStateService — ความเคลื่อนไหว + entry-guard (real DB)', () => {
  const prisma = new PrismaClient();
  const service = new JourneyStateService(prisma as any);
  const stamp = Date.now();
  const tail = String(stamp).slice(-7);
  const at = (value: string) => new Date(value);
  const customerIds: string[] = [];
  const roomIds: string[] = [];
  const saleIds: string[] = [];
  const contractIds: string[] = [];
  const journalIds: string[] = [];
  let branchId: string;
  let productId: string;
  let userId: string;
  let companyId: string;

  async function customer(data: Prisma.CustomerUncheckedCreateInput) {
    const row = await prisma.customer.create({ data });
    customerIds.push(row.id);
    return row;
  }
  /** JE ที่ POSTED แล้ว + บรรทัด Dr/Cr คู่หนึ่ง — metadata เลียนแบบ template จริง */
  async function journal(label: string, postedAt: Date, metadata: Prisma.InputJsonObject) {
    const row = await prisma.journalEntry.create({
      data: {
        entryNumber: `JG-JE-${tail}-${journalIds.length}`, companyId, entryDate: postedAt, postedAt, status: 'POSTED', createdById: userId,
        description: `journey guard ${label}`, metadata,
        lines: { create: [{ accountCode: '11-2101', debit: 100 }, { accountCode: '21-1101', credit: 100 }] },
      },
    });
    journalIds.push(row.id);
    return row;
  }
  async function activatedEntry(customerId: string, contractId: string, occurredAt: Date) {
    await prisma.customerJourneyEntry.create({
      data: {
        customerId, originCustomerId: customerId, origin: 'SYSTEM', kind: 'CONTRACT_ACTIVATED', occurredAt, actorType: 'STAFF',
        refType: 'contract', refId: contractId, dedupeKey: journeyDedupeKey('CONTRACT_ACTIVATED', contractId),
      },
    });
  }
  async function contract(customerId: string, status: 'DRAFT' | 'ACTIVE' | 'OVERDUE' | 'CANCELED', createdAt: string) {
    const row = await prisma.contract.create({
      data: {
        contractNumber: `JG-${tail}-${contractIds.length}`, customerId, productId, branchId, salespersonId: userId, planType: 'STORE_WITH_INTEREST',
        sellingPrice: 25000, downPayment: 5000, interestRate: 0.02, totalMonths: 10, interestTotal: 4000, financedAmount: 20000, monthlyPayment: 2400,
        status, createdAt: at(createdAt),
      },
    });
    contractIds.push(row.id);
    return row;
  }
  async function installmentSale(customerId: string, createdAt: string, contractId: string) {
    const row = await prisma.sale.create({
      data: { saleNumber: `JG-${tail}-${saleIds.length}`, saleType: 'INSTALLMENT', customerId, productId, branchId, salespersonId: userId, sellingPrice: 25000, netAmount: 25000, contractId, createdAt: at(createdAt) },
    });
    saleIds.push(row.id);
  }

  beforeAll(async () => {
    branchId = (await prisma.branch.create({ data: { name: `journey activity spec ${stamp}` } })).id;
    userId = (await prisma.user.create({ data: { email: `journey-activity-${stamp}@spec.local`, password: 'x', name: 'journey activity spec' } })).id;
    productId = (await prisma.product.create({ data: { name: 'journey activity phone', brand: 'Apple', model: 'iPhone 15', category: 'PHONE_NEW', costPrice: 20000, branchId } })).id;
    companyId = (await prisma.companyInfo.create({ data: { nameTh: `journey guard spec ${stamp}`, taxId: '0000000000000', address: '-', directorName: '-' } })).id;
  });

  afterAll(async () => {
    await prisma.journalLine.deleteMany({ where: { journalEntryId: { in: journalIds } } });
    await prisma.journalEntry.deleteMany({ where: { id: { in: journalIds } } });
    await prisma.companyInfo.deleteMany({ where: { id: companyId } });
    await prisma.customerJourneyEntry.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customerJourneyState.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.sale.deleteMany({ where: { id: { in: saleIds } } });
    await prisma.contract.deleteMany({ where: { id: { in: contractIds } } });
    await prisma.chatRoom.deleteMany({ where: { id: { in: roomIds } } });
    await prisma.customer.updateMany({ where: { id: { in: customerIds } }, data: { mergedIntoId: null } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.branch.deleteMany({ where: { id: branchId } });
    await prisma.$disconnect();
  });

  it('placeholder ที่รวมแล้วขยับ → activeCustomerIdsSince ชี้กลับคนจริง · hasActivitySince ของครอบครัวตามเวลา', async () => {
    const target = await customer({ name: 'journey activity target', phone: `084${tail}` });
    const placeholder = await customer({
      name: 'journey activity placeholder', phone: null, acquisitionSource: 'CHAT_LINE_SHOP', deletedAt: new Date(), mergedIntoId: target.id,
    });
    const room = await prisma.chatRoom.create({ data: { channel: 'LINE_SHOP', externalUserId: `journey-activity-${stamp}`, customerId: target.id } });
    roomIds.push(room.id);
    await prisma.auditLog.create({ data: { userId, action: 'AI_LEAD_CAPTURED', entity: 'customer', entityId: placeholder.id } });

    const active = await service.activeCustomerIdsSince(new Date(Date.now() - 10 * 60_000));
    expect(active).toContain(target.id);
    expect(active).not.toContain(placeholder.id);
    expect(await service.hasActivitySince([target.id, placeholder.id], new Date(Date.now() - 60_000))).toBe(true);
    expect(await service.hasActivitySince([target.id, placeholder.id], new Date(Date.now() + 60_000))).toBe(false);
  });

  describe('entry-guard: สัญญาที่เปิดจริง (JE เปิดสัญญา POSTED) เมื่อวานแต่ไม่มี entry CONTRACT_ACTIVATED', () => {
    // ช่วงเดียวกับ cron: รันตี 4 วันที่ 11 มี.ค. 2031 เวลาไทย ⇒ ตรวจวันที่ 10 ทั้งวัน · วันนี้ = 11
    const now = at('2031-03-10T21:00:00.000Z');
    const lt = bangkokStartOfDay(now);
    const gte = addBkkDays(lt, -1);
    const minutes = (base: Date, count: number) => new Date(base.getTime() + count * 60_000);
    const k: Record<string, string> = {};
    let result: string[] = [];
    /** ฐานทดสอบใช้ร่วมกับ spec อื่น ⇒ ดูเฉพาะสัญญาของ spec นี้ แต่ลำดับต้องคงตามผลจริง */
    const mine = () => result.filter((id) => contractIds.includes(id));

    beforeAll(async () => {
      const c = await customer({ name: 'journey guard installment', phone: `083${tail}`, createdAt: at('2031-03-01T00:00:00.000Z') });

      // (1) POS: สัญญา DRAFT + ใบขายผ่อนเมื่อวาน ยังไม่เปิด → ไม่มี JE เปิดสัญญา
      const draft = await contract(c.id, 'DRAFT', minutes(gte, 60).toISOString());
      await installmentSale(c.id, minutes(gte, 61).toISOString(), draft.id);
      k.draft = draft.id;

      // (2) เปิดเมื่อวาน + มี entry
      const withEntry = await contract(c.id, 'ACTIVE', '2031-03-01T01:00:00.000Z');
      await journal('1A with entry', minutes(gte, 120), { tag: '1A', contractId: withEntry.id });
      await activatedEntry(c.id, withEntry.id, minutes(gte, 120));
      k.withEntry = withEntry.id;

      // (3) เปิดเมื่อวานพอดีขอบล่าง (postedAt = gte) ไม่มี entry — ใบขายสร้างไว้ตั้งแต่ก่อนหน้า (POS เปิดวันหลัง)
      const missing = await contract(c.id, 'ACTIVE', '2031-03-01T02:00:00.000Z');
      await installmentSale(c.id, '2031-03-01T02:05:00.000Z', missing.id);
      await journal('1A missing entry', gte, { tag: '1A', contractId: missing.id });
      k.missing = missing.id;

      // (4) เปิดวันนี้ (postedAt = lt พอดี = เที่ยงคืนต้นวันนี้) ไม่มี entry
      const today = await contract(c.id, 'ACTIVE', '2031-03-01T03:00:00.000Z');
      await journal('1A today', lt, { tag: '1A', contractId: today.id });
      k.today = today.id;

      // (5) สัญญาใหม่ของการเปลี่ยนเครื่อง เปิดเมื่อวาน ไม่มีใบขาย ไม่มี entry
      const exchange = await contract(c.id, 'ACTIVE', '2031-03-01T04:00:00.000Z');
      await journal('exchange A.1', minutes(lt, -1), {
        flow: 'exchange-new-contract-1a', idempotencyKey: exchange.id, contractId: exchange.id, newContractId: exchange.id,
      });
      k.exchange = exchange.id;

      // (6) เปิดก่อนหน้า (ไม่มี entry) แล้วถูกกลับรายการเมื่อวาน — ใบกลับรายการต้องไม่ถูกนับเป็นการเปิด
      const canceled = await contract(c.id, 'CANCELED', '2031-03-01T05:00:00.000Z');
      const canceled1A = await journal('1A canceled', at('2031-03-05T03:00:00.000Z'), { tag: '1A', contractId: canceled.id, reversed: true });
      await journal('cancellation mirror', minutes(gte, 180), {
        tag: 'REVERSAL', flow: 'contract-cancellation', idempotencyKey: `contract-cancellation:${canceled1A.id}`,
        originalEntryId: canceled1A.id, reversesEntryId: canceled1A.id, contractId: canceled.id,
      });
      k.canceled = canceled.id;

      const swapCanceled = await contract(c.id, 'CANCELED', '2031-03-01T06:00:00.000Z');
      const swap1A = await journal('exchange A.1 canceled', at('2031-03-05T04:00:00.000Z'), {
        flow: 'exchange-new-contract-1a', idempotencyKey: swapCanceled.id, contractId: swapCanceled.id, newContractId: swapCanceled.id, reversed: true,
      });
      await journal('exchange-cancel mirror', minutes(gte, 181), {
        tag: 'REVERSAL', flow: 'exchange-cancel', idempotencyKey: `cancel:${swap1A.id}`,
        originalEntryId: swap1A.id, reversesEntryId: swap1A.id, contractId: swapCanceled.id, newContractId: swapCanceled.id,
      });
      k.swapCanceled = swapCanceled.id;

      // (6b) ใบกลับรายการในอนาคตที่ลอก metadata ของใบเปิดมาทั้งก้อน — ข้ามด้วย reversesEntryId
      const copied = await contract(c.id, 'CANCELED', '2031-03-01T07:00:00.000Z');
      const copied1A = await journal('1A copied', at('2031-03-05T05:00:00.000Z'), { tag: '1A', contractId: copied.id, reversed: true });
      await journal('mirror copying 1A metadata', minutes(gte, 182), { tag: '1A', contractId: copied.id, reversesEntryId: copied1A.id });
      k.copied = copied.id;

      result = await service.contractsMissingActivationEntry({ gte, lt });
    });

    it('(1) ใบขายผ่อน + สัญญา DRAFT ที่สร้างเมื่อวานแต่ยังไม่เปิด → ไม่ถูกรายงาน', () => {
      expect(result).not.toContain(k.draft);
    });

    it('(2) เปิดเมื่อวาน (JE 1A เมื่อวาน) และมี entry CONTRACT_ACTIVATED → ไม่ถูกรายงาน', () => {
      expect(result).not.toContain(k.withEntry);
    });

    it('(3) เปิดเมื่อวานแต่ไม่มี entry → ถูกรายงาน (นับ postedAt = gte)', () => {
      expect(result).toContain(k.missing);
    });

    it('(4) เปิดวันนี้ → ไม่ถูกรายงาน (ไม่นับ postedAt = lt)', () => {
      expect(result).not.toContain(k.today);
    });

    it('(5) สัญญาเปลี่ยนเครื่องเปิดเมื่อวาน (flow exchange-new-contract-1a) ไม่มี entry → ถูกรายงาน', () => {
      expect(result).toContain(k.exchange);
    });

    it('(6) ใบกลับรายการที่โพสต์เมื่อวานของสัญญาที่เปิดก่อนหน้า → ไม่ถูกรายงาน', () => {
      expect(result).not.toContain(k.canceled);
      expect(result).not.toContain(k.swapCanceled);
      expect(result).not.toContain(k.copied);
    });

    it('ผลรวมของ spec นี้ = (3) + (5) เรียงตาม id และผลทั้งก้อนเรียงแล้ว', () => {
      expect(mine()).toEqual([k.missing, k.exchange].sort());
      expect(result).toEqual([...result].sort());
    });
  });
});
