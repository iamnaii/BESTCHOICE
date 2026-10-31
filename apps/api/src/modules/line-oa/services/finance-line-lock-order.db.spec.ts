/**
 * รัน: DATABASE_URL=<ฐานทดสอบ> npx jest src/modules/line-oa/services/finance-line-lock-order.db.spec.ts --runInBand
 *
 * Task 29 (เจ้าของตัดสิน 31 ต.ค. 2026 — Task 27 review M-2) — ลำดับล็อกเดียวของทุกทางที่ผูก/ยกเลิกผูก LINE การเงิน:
 * **แถวลูกค้า (เรียง id) → แถว `customer_line_links` → `chat_rooms`**. เดิม `VerificationService.bind` ล็อกกลับด้าน (ห้อง/แถว link ก่อน
 * แล้วค่อยแถวลูกค้า) ขณะที่ทางยกเลิกผูกของพนักงาน (ปุ่ม `POST /customers/:id/finance-line/unlink` · `PATCH lineIdFinance: null`) ล็อกลูกค้าก่อน
 * ⇒ ลูกค้ายืนยัน OTP พร้อมกับพนักงานกดยกเลิกผูก = deadlock 40P01 (ฝั่งปุ่มลองใหม่เอง · PATCH/bind ได้ error).
 *
 * บังคับให้สองทรานแซกชันซ้อนกันจริงด้วยเทคนิคถือล็อก (แบบสเปค Task 27): อีกคอนเนกชันถือล็อกห้องแชทที่ bind ต้องแตะ → เริ่ม bind (ไปรอที่ห้อง) →
 * เริ่มทางยกเลิกผูก (ไปรอ) → ปล่อยห้อง. ลำดับเดิม: bind ถือแถว link แล้วรอแถวลูกค้า ส่วนพนักงานถือแถวลูกค้าแล้วรอแถว link = วงจร ·
 * ลำดับใหม่: ทั้งสองรอแถวลูกค้าก่อน ⇒ ทำทีละฝั่ง ไม่มีใครถูกฆ่า. ทางพนักงานใช้ PrismaClient แยก ⇒ เก็บ error ของทุกทรานแซกชันฝั่งพนักงานได้ (ปุ่มลองใหม่เองเมื่อโดน deadlock — ผลสุดท้ายสำเร็จ จึงต้องดูที่ error ระหว่างทาง)
 */
import { ChatChannel, LineChannelType, PrismaClient } from '@prisma/client';
import { AuditService } from '../../audit/audit.service';
import { VerificationService } from '../../chatbot-finance/services/verification.service';
import { CustomerWriteService } from '../../customers/services/customer-write.service';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));
jest.setTimeout(60_000);

const prisma = new PrismaClient();
/** ฝั่งพนักงานใช้คอนเนกชันชุดแยก — spy `$transaction` นับเฉพาะทรานแซกชันของทางยกเลิกผูก */
const staffPrisma = new PrismaClient();
const tag = `t29lk-${Date.now()}`;
const digits = String(Date.now()).slice(-7);
const customerIds: string[] = [];
const line = (name: string) => `U${tag}-${name}`;
const sms = { sendSmsFromQueue: jest.fn().mockResolvedValue(undefined) };
let verification: VerificationService;
let staffForm: CustomerWriteService;
let staffId = '';

async function customer(name: string, phoneSuffix: string, lineIdFinance: string | null = null) {
  const row = await prisma.customer.create({
    data: { name: `ทดสอบ ${name} ${tag}`, phone: `09${phoneSuffix}${digits}`, lineIdFinance },
  });
  customerIds.push(row.id);
  return row;
}

async function link(customerId: string, lineUserId: string) {
  await prisma.customerLineLink.create({
    data: { customerId, lineUserId, channel: LineChannelType.FINANCE },
  });
}

async function room(lineUserId: string, customerId: string) {
  return (
    await prisma.chatRoom.create({
      data: { lineUserId, channel: ChatChannel.LINE_FINANCE, customerId, verifiedAt: new Date() },
    })
  ).id;
}

/** ขอ OTP ไว้ก่อน (เส้นจริง — รอเวลาตอบขั้นต่ำ 1 วิ) แล้วคืนรหัสจาก SMS */
async function requestOtp(lineUserId: string, phone: string): Promise<string> {
  await verification.requestOtp({ lineUserId, phone });
  return (sms.sendSmsFromQueue.mock.calls.at(-1)?.[1] as string).match(/(\d{6})/)![1];
}

/** รอจนมีคอนเนกชันของฐานนี้รอล็อกอยู่อย่างน้อย n ตัว */
async function lockWaiters(n: number): Promise<void> {
  for (let i = 0; i < 200; i++) {
    const [{ waiting }] = await prisma.$queryRaw<{ waiting: number }[]>`
      SELECT count(*)::int AS waiting FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'`;
    if (waiting >= n) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`ไม่มีคอนเนกชันรอล็อกครบ ${n} ตัวภายใน 10 วิ`);
}

/**
 * ถือล็อกห้อง `roomId` ไว้ → เริ่ม bind (OTP) → รอจน bind ติด → เริ่มทางยกเลิกผูก → รอจนติด → ปล่อย ·
 * คืนผลทั้งสองฝั่ง + error ของทรานแซกชันฝั่งพนักงานที่ล้มระหว่างทาง (ปุ่มลองใหม่แล้วสำเร็จได้)
 */
async function raceBindAgainst(
  roomId: string,
  bindLine: string,
  otp: string,
  staffUnlink: () => Promise<unknown>,
) {
  let locked!: () => void;
  let release!: () => void;
  const lockedP = new Promise<void>((r) => (locked = r));
  const releaseP = new Promise<void>((r) => (release = r));
  const blocker = prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM chat_rooms WHERE id = ${roomId} FOR UPDATE`;
      locked();
      await releaseP;
    },
    { timeout: 30_000 },
  );
  await lockedP;
  const bindP = verification.verifyOtp({ lineUserId: bindLine, otp });
  await lockWaiters(1);
  const staffTxFailures: unknown[] = [];
  const original = staffPrisma.$transaction.bind(staffPrisma) as (
    ...args: unknown[]
  ) => Promise<unknown>;
  const txSpy = jest.spyOn(staffPrisma, '$transaction').mockImplementation(((...args: unknown[]) =>
    original(...args).catch((error: unknown) => {
      staffTxFailures.push(error);
      throw error;
    })) as never);
  const staffP = staffUnlink();
  await lockWaiters(2);
  release();
  await blocker;
  const [bind, staff] = await Promise.allSettled([bindP, staffP]);
  txSpy.mockRestore();
  return { bind, staff, staffTxFailures };
}

/** ฝั่งที่ล้ม = โยน error จริงออกมา (เช่น deadlock 40P01) ให้เห็นในผลเทส */
function settled<T>(result: PromiseSettledResult<T>): T {
  if (result.status === 'rejected') throw result.reason;
  return result.value;
}

const linkRow = (lineUserId: string) =>
  prisma.customerLineLink.findUniqueOrThrow({
    where: { lineUserId_channel: { lineUserId, channel: LineChannelType.FINANCE } },
  });

beforeAll(async () => {
  const dbName = new URL(process.env.DATABASE_URL ?? 'postgresql://unset/unset').pathname.slice(1);
  if (!/^test_db$|_test$/.test(dbName)) {
    throw new Error(`สเปคนี้เขียน/ลบแถวจริง — ต้องรันกับฐานทดสอบ แต่ได้ "${dbName}"`);
  }
  // audit_logs ลบไม่ได้ (trigger) ⇒ ผู้ใช้ของแถว audit อยู่ต่อในฐานทดสอบ (ฐานถูก drop หลังรัน)
  staffId = (
    await prisma.user.create({
      data: { email: `${tag}@test.local`, password: 'x', name: `พนักงาน ${tag}`, role: 'OWNER' },
    })
  ).id;
  verification = new VerificationService(
    prisma as never,
    sms as never,
    { isEnabled: jest.fn().mockResolvedValue(false) } as never,
    { log: jest.fn().mockResolvedValue(undefined) } as never,
    undefined,
    undefined,
    { get: jest.fn(() => ({ switchRichMenu: jest.fn() })) } as never,
  );
  const query = {
    findOne: (id: string) => staffPrisma.customer.findUniqueOrThrow({ where: { id } }),
  };
  staffForm = new CustomerWriteService(
    staffPrisma as never,
    {} as never,
    query as never,
    undefined,
    new AuditService(staffPrisma as never),
  );
});

afterAll(async () => {
  await prisma.chatRoom.deleteMany({ where: { lineUserId: { startsWith: `U${tag}` } } });
  await prisma.customerLineLink.deleteMany({ where: { customerId: { in: customerIds } } });
  await prisma.chatbotOtpRequest.deleteMany({ where: { lineUserId: { contains: tag } } });
  await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
  await prisma.$disconnect();
  await staffPrisma.$disconnect();
});

describe('ยืนยัน OTP พร้อมพนักงานยกเลิกผูก — ไม่มี deadlock (Task 29 · ลูกค้า → link → ห้อง)', () => {
  const staffPaths: [string, (customerId: string) => Promise<unknown>][] = [
    [
      'ปุ่ม POST /customers/:id/finance-line/unlink',
      (id) => staffForm.unlinkFinanceLineByStaff(id, { id: staffId }),
    ],
    [
      'PATCH /customers/:id {lineIdFinance: null}',
      (id) =>
        staffForm.update(id, { lineIdFinance: null } as never, { id: staffId, role: 'OWNER' }),
    ],
  ];

  it.each(staffPaths)(
    'ลูกค้ายืนยัน LINE เดิมซ้ำ ขณะพนักงานกด %s กับลูกค้าคนเดียวกัน → ทั้งสองสำเร็จในรอบเดียว · ผลสุดท้าย = ยกเลิกผูก',
    async (label, staffUnlink) => {
      const n = label.startsWith('ปุ่ม') ? '1' : '2';
      const c = await customer(`ยืนยันซ้ำ ${n}`, n, line(n));
      await link(c.id, line(n));
      const roomId = await room(line(n), c.id);
      const otp = await requestOtp(line(n), c.phone!);

      const { bind, staff, staffTxFailures } = await raceBindAgainst(roomId, line(n), otp, () =>
        staffUnlink(c.id),
      );

      expect(settled(bind)).toMatchObject({ customerId: c.id });
      settled(staff);
      expect(staffTxFailures).toEqual([]); // ไม่มีทรานแซกชันฝั่งพนักงานถูกฆ่าเพราะ deadlock (ปุ่มไม่ต้องลองใหม่)
      // bind ถือแถวลูกค้าก่อน ⇒ พนักงานรอจน bind commit แล้วจึงยกเลิกผูก
      expect((await linkRow(line(n))).unlinkedAt).toBeInstanceOf(Date);
      expect(
        (await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).lineIdFinance,
      ).toBeNull();
      expect(
        (await prisma.chatRoom.findUniqueOrThrow({ where: { id: roomId } })).verifiedAt,
      ).toBeNull();
    },
  );

  it('LINE ย้ายจากลูกค้า H ไป C ด้วย OTP ขณะพนักงานกดยกเลิกผูก H → ทั้งสองสำเร็จในรอบเดียว · LINE เป็นของ C', async () => {
    const h = await customer('เจ้าของเดิม', '3', line('3'));
    await link(h.id, line('3'));
    const hRoom = await room(line('3'), h.id);
    const c = await customer('เจ้าของใหม่', '4');
    const otp = await requestOtp(line('3'), c.phone!);

    const { bind, staff, staffTxFailures } = await raceBindAgainst(hRoom, line('3'), otp, () =>
      staffForm.unlinkFinanceLineByStaff(h.id, { id: staffId }),
    );

    expect(settled(bind)).toMatchObject({ customerId: c.id });
    expect(settled(staff)).toMatchObject({ unlinked: false });
    expect(staffTxFailures).toEqual([]);
    const row = await linkRow(line('3'));
    expect(row).toMatchObject({ customerId: c.id, unlinkedAt: null });
    const [hAfter, cAfter] = await Promise.all(
      [h.id, c.id].map((id) => prisma.customer.findUniqueOrThrow({ where: { id } })),
    );
    expect(hAfter.lineIdFinance).toBeNull();
    expect(cAfter.lineIdFinance).toBe(line('3'));
  });
});
