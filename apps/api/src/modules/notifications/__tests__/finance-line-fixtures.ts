/**
 * Task 30 — แถวทดสอบบน Postgres จริงสำหรับผู้ส่งข้อความการเงินทาง LINE (เตือนค่างวด / ทวงหนี้):
 * ลูกค้า + แถว OTP (`customer_line_links` ช่อง FINANCE) + consent PDPA + สัญญา + งวด
 *
 * ไม่ใช่ไฟล์ spec — ผู้เรียกคือ `*.db.spec.ts` ที่รันกับฐานทดสอบ (ชื่อลงท้าย `_test` · ฐานถูก drop หลังรัน)
 */
import {
  ContractStatus,
  LineChannelType,
  PaymentStatus,
  Prisma,
  PrismaClient,
} from '@prisma/client';

export const dec = (v: string) => new Prisma.Decimal(v);

/** สเปคเขียนแถวจริง — ปฏิเสธฐานที่ไม่ใช่ฐานทดสอบ (ชื่อเดียวกับสเปค DB ตัวอื่น) */
export function assertTestDatabase(): void {
  const dbName = new URL(process.env.DATABASE_URL ?? 'postgresql://unset/unset').pathname.slice(1);
  if (!/^test_db$|_test$/.test(dbName)) {
    throw new Error(`สเปคนี้เขียนแถวจริง — ต้องรันกับฐานทดสอบ แต่ได้ "${dbName}"`);
  }
}

export interface FinanceFixtureBase {
  stamp: string;
  branchId: string;
  salespersonId: string;
}

export async function createFinanceFixtureBase(
  prisma: PrismaClient,
  stamp: string,
): Promise<FinanceFixtureBase> {
  const branchId = (await prisma.branch.create({ data: { name: `${stamp} สาขา` } })).id;
  const salespersonId = (
    await prisma.user.create({
      data: {
        email: `${stamp}-owner@bestchoice.test`,
        password: 'x',
        name: 'owner',
        role: 'OWNER',
      },
    })
  ).id;
  return { stamp, branchId, salespersonId };
}

export interface InstallmentFixtureInput {
  label: string;
  dueDate: Date;
  /** วันที่ผูก LINE การเงินด้วย OTP (`customer_line_links.linkedAt`) · `null` = ไม่ผูก */
  linkedAt?: Date | null;
  /** consent PDPA สถานะ GRANTED — ค่าเริ่มต้นมี */
  consent?: boolean;
  /** `Contract.legacyContractCode` — สัญญานำเข้าจากระบบเดิม */
  legacyCode?: string | null;
  contractStatus?: ContractStatus;
  paymentStatus?: PaymentStatus;
  amountDue?: string;
  lateFee?: string;
  /** ใช้ลูกค้าเดิม (สัญญาที่สองของลูกค้าคนเดียวกัน) — ไม่สร้างลูกค้า/แถว OTP/consent ใหม่ */
  customer?: { customerId: string; lineUserId: string };
}

export interface InstallmentFixture {
  customerId: string;
  contractId: string;
  contractNumber: string;
  paymentId: string;
  lineUserId: string;
}

export async function createInstallmentFixture(
  prisma: PrismaClient,
  base: FinanceFixtureBase,
  input: InstallmentFixtureInput,
): Promise<InstallmentFixture> {
  const { stamp, branchId, salespersonId } = base;
  const lineUserId = input.customer?.lineUserId ?? `U${stamp}-${input.label}`;
  const customer = input.customer
    ? { id: input.customer.customerId }
    : await prisma.customer.create({ data: { name: `ทดสอบ ${stamp} ${input.label}` } });
  const linkedAt = input.linkedAt === undefined ? new Date() : input.linkedAt;
  if (linkedAt && !input.customer) {
    await prisma.customerLineLink.create({
      data: { customerId: customer.id, lineUserId, channel: LineChannelType.FINANCE, linkedAt },
    });
  }
  if ((input.consent ?? true) && !input.customer) {
    await prisma.pDPAConsent.create({
      data: {
        customerId: customer.id,
        consentVersion: '1.0',
        privacyNoticeText: 'ทดสอบ',
        status: 'GRANTED',
        grantedAt: new Date(),
      },
    });
  }
  const product = await prisma.product.create({
    data: {
      name: `spec ${input.label}`,
      brand: 'Apple',
      model: 'iPhone 15',
      category: 'PHONE_NEW',
      costPrice: dec('20000.00'),
      branchId,
      imeiSerial: `${stamp}-${input.label}`,
    },
  });
  const contractNumber = `${stamp}-${input.label}`;
  const contract = await prisma.contract.create({
    data: {
      contractNumber,
      customerId: customer.id,
      productId: product.id,
      branchId,
      salespersonId,
      planType: 'STORE_WITH_INTEREST',
      sellingPrice: dec('30000.00'),
      downPayment: dec('5000.00'),
      interestRate: dec('0.0500'),
      totalMonths: 12,
      interestTotal: dec('15000.00'),
      financedAmount: dec('25000.00'),
      monthlyPayment: dec('1515.83'),
      status: input.contractStatus ?? 'ACTIVE',
      legacyContractCode: input.legacyCode ?? null,
    },
  });
  const payment = await prisma.payment.create({
    data: {
      contractId: contract.id,
      installmentNo: 1,
      dueDate: input.dueDate,
      amountDue: dec(input.amountDue ?? '1515.83'),
      lateFee: dec(input.lateFee ?? '0.00'),
      status: input.paymentStatus ?? 'PENDING',
    },
  });
  return {
    customerId: customer.id,
    contractId: contract.id,
    contractNumber,
    paymentId: payment.id,
    lineUserId,
  };
}

/** เลิกให้ cron เห็นงวดของเคสที่จบแล้ว (เคสถัดไปในวันเดียวกันจะไม่เจอซ้ำ) — แถวทิ้งไว้ ฐานถูก drop หลังรัน */
export async function retireFixtures(prisma: PrismaClient, fixtures: InstallmentFixture[]) {
  await prisma.payment.updateMany({
    where: { id: { in: fixtures.map((f) => f.paymentId) } },
    data: { status: 'PAID' },
  });
}

/**
 * เวลาปลอมเฉพาะ `Date` (timer/Prisma ใช้เวลาจริง) — `createdAt` ของแถวใช้นาฬิกาฐานข้อมูล (เวลาจริง) จึงต้องอยู่ "วันนี้" ตามปฏิทินไทย
 * จริงเสมอ: ใช้ `bangkokTodayAt(hh, mm)` = วันนี้ (ไทย) เวลา hh:mm น.
 */
export function useFakeDate(now: Date): void {
  jest.useFakeTimers({
    now,
    doNotFake: [
      'hrtime',
      'nextTick',
      'performance',
      'queueMicrotask',
      'setImmediate',
      'clearImmediate',
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
    ],
  });
}

const BKK_OFFSET_MS = 7 * 60 * 60 * 1000;

/** วันปฏิทินไทยของเวลาจริงตอนเรียก (ก่อนปลอมเวลา) */
export function realBangkokDate(): { y: number; m: number; d: number } {
  const bkk = new Date(Date.now() + BKK_OFFSET_MS);
  return { y: bkk.getUTCFullYear(), m: bkk.getUTCMonth(), d: bkk.getUTCDate() };
}

/** วันนี้ (ไทย) + dayOffset วัน เวลา hh:mm น. เวลาไทย */
export function bangkokAt(
  day: { y: number; m: number; d: number },
  dayOffset: number,
  hh: number,
  mm = 0,
): Date {
  return new Date(Date.UTC(day.y, day.m, day.d + dayOffset, hh, mm) - BKK_OFFSET_MS);
}

/** วันครบกำหนดแบบที่ระบบเก็บ (เที่ยงคืน UTC ของวันที่) — ตกในหน้าต่างของทั้ง A1 (วัน UTC) และบอท (วันไทย) */
export function dueDateUtc(day: { y: number; m: number; d: number }, dayOffset: number): Date {
  return new Date(Date.UTC(day.y, day.m, day.d + dayOffset));
}
