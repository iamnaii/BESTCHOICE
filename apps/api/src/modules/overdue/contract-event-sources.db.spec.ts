import { Prisma, PrismaClient } from '@prisma/client';
import { contractEventSources } from './contract-event-sources';

/**
 * พิสูจน์กับ Postgres จริง: contractId IN หลายสัญญา · ตัวกรองสถานะ/soft-delete เดิม · ช่วงเวลา · keyset เวลาเท่ากัน · หนังสือที่ dispatchedAt ว่าง
 * audit_logs ลบไม่ได้ (trigger audit_logs_no_delete) → แถว audit ของสเปคนี้ค้างในฐานทดสอบ แต่ผูก entity_id กับสัญญาที่สร้างใหม่ทุกรอบ จึงไม่ชนรอบถัดไป
 * ผู้ใช้ของสเปคจึง upsert ด้วยอีเมลคงที่และไม่ลบ (audit อ้าง user_id อยู่)
 * ต้องรันกับฐานที่ apply migration แล้ว: DATABASE_URL=<ฐานทดสอบ> npx jest <ไฟล์นี้> --runInBand
 */
describe('contractEventSources (real DB)', () => {
  const prisma = new PrismaClient();
  const stamp = Date.now();
  const dec = (value: string) => new Prisma.Decimal(value);
  const at = (iso: string) => new Date(iso);
  let userId = '';
  let branchId = '';
  let customerId = '';
  let ruleId = '';
  const productIds: string[] = [];
  const contractIds: string[] = [];
  const seeded = { callA: '', callB1: '', callB2: '', paymentA: '', dunningA: '', auditA: '', letterA: '', letterB: '' };

  beforeAll(async () => {
    const user = await prisma.user.upsert({
      where: { email: 'contract-event-sources.db-spec@bestchoice.test' },
      update: {},
      create: { email: 'contract-event-sources.db-spec@bestchoice.test', password: 'x', name: 'สเปคไทม์ไลน์สัญญา', role: 'OWNER' },
    });
    userId = user.id;
    branchId = (await prisma.branch.create({ data: { name: `contract-event-sources spec ${stamp}` } })).id;
    customerId = (await prisma.customer.create({ data: { name: `contract-event-sources spec ${stamp}` } })).id;

    for (const label of ['A', 'B', 'C']) {
      const product = await prisma.product.create({
        data: {
          name: `spec phone ${label}`,
          brand: 'Apple',
          model: 'iPhone 15',
          category: 'PHONE_NEW',
          costPrice: dec('20000.00'),
          branchId,
          imeiSerial: `CES-${stamp}-${label}`,
        },
      });
      productIds.push(product.id);
      const contract = await prisma.contract.create({
        data: {
          contractNumber: `CES-${stamp}-${label}`,
          customerId,
          productId: product.id,
          branchId,
          salespersonId: userId,
          planType: 'STORE_WITH_INTEREST',
          sellingPrice: dec('30000.00'),
          downPayment: dec('5000.00'),
          interestRate: dec('0.0500'),
          totalMonths: 12,
          interestTotal: dec('15000.00'),
          financedAmount: dec('25000.00'),
          monthlyPayment: dec('3333.33'),
          status: 'OVERDUE',
        },
      });
      contractIds.push(contract.id);
    }
    const [contractA, contractB, contractC] = contractIds;
    // dunning_rules_trigger_exclusive_chk: ต้องมี triggerDay หรือ eventTrigger อย่างใดอย่างหนึ่งพอดี
    ruleId = (await prisma.dunningRule.create({ data: { name: `spec rule ${stamp}`, triggerDay: 3, channel: 'LINE', messageTemplate: 'แจ้งเตือนค้างชำระ' } })).id;

    // สัญญา A — อย่างละหนึ่งแถวที่ต้องได้ + แถวที่ตัวกรองเดิมต้องตัดทิ้ง
    seeded.callA = (await prisma.callLog.create({ data: { contractId: contractA, callerId: userId, calledAt: at('2026-08-20T03:00:00.000Z'), result: 'PROMISED' } })).id;
    seeded.paymentA = (await prisma.payment.create({
      data: { contractId: contractA, installmentNo: 1, dueDate: at('2026-08-05T00:00:00.000Z'), amountDue: dec('3333.33'), amountPaid: dec('3333.33'), status: 'PAID', updatedAt: at('2026-08-19T03:00:00.000Z') },
    })).id;
    const pendingA = await prisma.payment.create({
      data: { contractId: contractA, installmentNo: 2, dueDate: at('2026-09-05T00:00:00.000Z'), amountDue: dec('3333.33'), status: 'PENDING' },
    });
    seeded.dunningA = (await prisma.dunningAction.create({
      data: { dunningRuleId: ruleId, contractId: contractA, channel: 'LINE', status: 'SENT', createdAt: at('2026-08-18T03:00:00.000Z') },
    })).id;
    await prisma.dunningAction.create({
      data: { dunningRuleId: ruleId, contractId: contractA, paymentId: pendingA.id, channel: 'LINE', status: 'SENT', createdAt: at('2026-08-18T04:00:00.000Z'), deletedAt: at('2026-08-18T05:00:00.000Z') },
    });
    seeded.auditA = (await prisma.auditLog.create({
      data: { userId, action: 'STATUS_CHANGE', entity: 'contract', entityId: contractA, newValue: { from: 'ACTIVE', to: 'OVERDUE' }, createdAt: at('2026-08-17T03:00:00.000Z') },
    })).id;
    await prisma.auditLog.create({ data: { userId, action: 'UPDATE', entity: 'contract', entityId: contractA, createdAt: at('2026-08-17T04:00:00.000Z') } });
    seeded.letterA = (await prisma.contractLetter.create({
      data: { contractId: contractA, letterType: 'RETURN_DEVICE_45D', letterNumber: `CES-${stamp}-A-45`, status: 'DISPATCHED', dispatchedAt: at('2026-08-16T03:00:00.000Z') },
    })).id;
    await prisma.contractLetter.create({
      data: { contractId: contractA, letterType: 'CONTRACT_TERMINATION_60D', letterNumber: `CES-${stamp}-A-60`, status: 'PENDING_DISPATCH' },
    });

    // สัญญา B — โทรสองครั้งเวลาเดียวกัน (keyset เทียบ id) + หนังสือที่ไม่มี dispatchedAt (ใช้ createdAt)
    seeded.callB1 = (await prisma.callLog.create({ data: { contractId: contractB, calledAt: at('2026-08-10T03:00:00.000Z'), result: 'NO_ANSWER' } })).id;
    seeded.callB2 = (await prisma.callLog.create({ data: { contractId: contractB, calledAt: at('2026-08-10T03:00:00.000Z'), result: 'NO_ANSWER' } })).id;
    seeded.letterB = (await prisma.contractLetter.create({
      data: { contractId: contractB, letterType: 'RETURN_DEVICE_45D', letterNumber: `CES-${stamp}-B-45`, status: 'DELIVERED', createdAt: at('2026-08-05T03:00:00.000Z') },
    })).id;

    // สัญญา C — ไม่ได้ขอ ต้องไม่โผล่
    await prisma.callLog.create({ data: { contractId: contractC, calledAt: at('2026-08-21T03:00:00.000Z'), result: 'ANSWERED' } });
  }, 60_000);

  afterAll(async () => {
    await prisma.dunningAction.deleteMany({ where: { contractId: { in: contractIds } } });
    await prisma.dunningRule.deleteMany({ where: { id: ruleId } });
    await prisma.callLog.deleteMany({ where: { contractId: { in: contractIds } } });
    await prisma.payment.deleteMany({ where: { contractId: { in: contractIds } } });
    await prisma.contractLetter.deleteMany({ where: { contractId: { in: contractIds } } });
    await prisma.contract.deleteMany({ where: { id: { in: contractIds } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.branch.deleteMany({ where: { id: branchId } });
    await prisma.$disconnect();
  }, 60_000);

  it('หลายสัญญา → ได้ทุก source ของ A และ B เท่านั้น · ตัด PENDING / soft-delete / action อื่น / หนังสือยังไม่ส่ง · ติด contractId และผู้โทร', async () => {
    const [contractA, contractB] = contractIds;
    const rows = await contractEventSources(prisma, [contractA, contractB]);

    expect(rows.map((row) => `${row.contractId}|${row.event.id}`).sort()).toEqual(
      [
        `${contractA}|call-${seeded.callA}`,
        `${contractA}|payment-${seeded.paymentA}`,
        `${contractA}|dunning-${seeded.dunningA}`,
        `${contractA}|audit-${seeded.auditA}`,
        `${contractA}|letter-${seeded.letterA}`,
        `${contractB}|call-${seeded.callB1}`,
        `${contractB}|call-${seeded.callB2}`,
        `${contractB}|letter-${seeded.letterB}`,
      ].sort(),
    );
    expect(rows.find((row) => row.event.id === `call-${seeded.callA}`)?.actorUserId).toBe(userId);
    expect(rows.find((row) => row.event.id === `audit-${seeded.auditA}`)?.event.title).toBe('สถานะสัญญาเปลี่ยน: ACTIVE → OVERDUE');
    expect(rows.find((row) => row.event.id === `payment-${seeded.paymentA}`)?.event.timestamp).toBe('2026-08-19T03:00:00.000Z');
    expect(rows.find((row) => row.event.id === `letter-${seeded.letterB}`)?.event.timestamp).toBe('2026-08-05T03:00:00.000Z');
  });

  it('from/to รวมขอบทั้งสองข้าง บนคอลัมน์เวลาของแต่ละ source', async () => {
    const [contractA, contractB] = contractIds;
    const rows = await contractEventSources(prisma, [contractA, contractB], {
      from: at('2026-08-10T03:00:00.000Z'),
      to: at('2026-08-18T03:00:00.000Z'),
    });

    expect(rows.map((row) => row.event.id).sort()).toEqual(
      [
        `dunning-${seeded.dunningA}`,
        `audit-${seeded.auditA}`,
        `letter-${seeded.letterA}`,
        `call-${seeded.callB1}`,
        `call-${seeded.callB2}`,
      ].sort(),
    );
  });

  it('before ที่เวลาเท่ากับโทรสองครั้งของ B → เหลือเฉพาะ id ที่น้อยกว่า + หนังสือที่ใช้ createdAt', async () => {
    const [contractA, contractB] = contractIds;
    const [lowerCall, higherCall] = [`call-${seeded.callB1}`, `call-${seeded.callB2}`].sort();
    const rows = await contractEventSources(prisma, [contractA, contractB], {
      before: { ts: '2026-08-10T03:00:00.000Z', id: higherCall },
    });

    expect(rows.map((row) => row.event.id).sort()).toEqual([lowerCall, `letter-${seeded.letterB}`].sort());
  });

  it('limit ใช้ต่อ source — limit 1 ได้โทรล่าสุดของทุกสัญญาที่ขอเพียงแถวเดียว', async () => {
    const [contractA, contractB] = contractIds;
    const rows = await contractEventSources(prisma, [contractA, contractB], { limit: 1 });

    expect(rows.filter((row) => row.event.type === 'CALL').map((row) => row.event.id)).toEqual([`call-${seeded.callA}`]);
    expect(rows.filter((row) => row.event.type === 'LETTER')).toHaveLength(1);
  });
});
