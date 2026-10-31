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
 * ลำดับใหม่: ทั้งสองรอแถวลูกค้าก่อน ⇒ ทำทีละฝั่ง ไม่มีใครถูกฆ่า. แต่ละฝั่งใช้ PrismaClient ของตัวเอง ⇒ เก็บ error ของทุกทรานแซกชันได้
 * (ปุ่ม และตั้งแต่ fix round 1 `bind` ลองใหม่เองเมื่อโดน deadlock — ผลสุดท้ายสำเร็จ จึงต้องดูที่ error ระหว่างทาง).
 *
 * Task 29 fix round 1 (review I-1) — ทางเดิมที่ล็อก "ห้อง → ลูกค้า" สวนกับ `bind` ลำดับใหม่: ผูกห้องกับลูกค้าในกล่องข้อความ
 * (`RoomManagerService.linkCustomer`) และผลวิเคราะห์สเตทเม้นจากแชทเสร็จ (`RoomCreditService.analyze`) — ทั้งคู่ล็อกห้องแล้วนำเข้าผลวิเคราะห์
 * ซึ่งล็อกแถวลูกค้า (`linkRoomCreditHistory` → `lockCreditCustomer`) ⇒ ตอนนี้ล็อกลูกค้าก่อนห้องเหมือนกัน (ปักด้วยสองเคสท้ายไฟล์)
 */
import { Readable } from 'stream';
import { ChatChannel, LineChannelType, PrismaClient } from '@prisma/client';
import { AuditService } from '../../audit/audit.service';
import { VerificationService } from '../../chatbot-finance/services/verification.service';
import { RoomManagerService } from '../../chat-engine/services/room-manager.service';
import { RoomCreditService } from '../../credit-check/services/room-credit.service';
import { CustomerWriteService } from '../../customers/services/customer-write.service';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));
jest.setTimeout(60_000);

/** fixture · ตัวถือล็อก · ตัวนับผู้รอล็อก */
const prisma = new PrismaClient();
/** แต่ละฝั่งใช้คอนเนกชันชุดแยก — spy `$transaction` เก็บ error ระหว่างทางของฝั่งนั้น (ลองใหม่สำเร็จก็ยังเห็น) */
const otpPrisma = new PrismaClient();
const staffPrisma = new PrismaClient();
const roomPrisma = new PrismaClient();
const txFailures: { side: string; error: unknown }[] = [];
const spies: jest.SpyInstance[] = [];
let rooms: RoomManagerService;
let roomCredit: RoomCreditService;
/** OCR ของการวิเคราะห์สเตทเม้น — ค้างไว้จนเทสปล่อย (ให้ทรานแซกชันตอนวิเคราะห์เสร็จเริ่มในจังหวะที่กำหนด) */
let ocrReached!: () => void;
let ocrGate: Promise<void> = Promise.resolve();
const tag = `t29lk-${Date.now()}`;
const digits = String(Date.now()).slice(-7);
const line = (name: string) => `U${tag}-${name}`;
const sms = { sendSmsFromQueue: jest.fn().mockResolvedValue(undefined) };
let verification: VerificationService;
let staffForm: CustomerWriteService;
let staffId = '';

async function customer(name: string, phoneSuffix: string, lineIdFinance: string | null = null) {
  const row = await prisma.customer.create({
    data: { name: `ทดสอบ ${name} ${tag}`, phone: `09${phoneSuffix}${digits}`, lineIdFinance },
  });
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

/** เก็บ error ของทุก `$transaction` ของ client (ส่งต่อ error ตามเดิม — พฤติกรรมไม่เปลี่ยน) */
function captureTxFailures(client: PrismaClient, side: string) {
  const original = client.$transaction.bind(client) as (...args: unknown[]) => Promise<unknown>;
  spies.push(
    jest.spyOn(client, '$transaction').mockImplementation(((...args: unknown[]) =>
      original(...args).catch((error: unknown) => {
        txFailures.push({ side, error });
        throw error;
      })) as never),
  );
}

/**
 * ถือล็อกห้อง `roomId` ไว้ → เริ่มฝั่งแรก → รอจนติด → เริ่มฝั่งที่สอง → รอจนติด → ปล่อย · คืนผลทั้งสองฝั่ง
 * (error ระหว่างทางของทุกฝั่งอยู่ใน `txFailures`)
 */
async function raceOnRoom(
  roomId: string,
  first: () => Promise<unknown>,
  second: () => Promise<unknown>,
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
  const firstP = first();
  await lockWaiters(1);
  const secondP = second();
  await lockWaiters(2);
  release();
  await blocker;
  return Promise.allSettled([firstP, secondP]);
}

/** bind (OTP) เริ่มก่อนทางยกเลิกผูกของพนักงาน */
async function raceBindAgainst(
  roomId: string,
  bindLine: string,
  otp: string,
  staffUnlink: () => Promise<unknown>,
) {
  const [bind, staff] = await raceOnRoom(
    roomId,
    () => verification.verifyOtp({ lineUserId: bindLine, otp }),
    staffUnlink,
  );
  return { bind, staff };
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
    otpPrisma as never,
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
  rooms = new RoomManagerService(roomPrisma as never, {} as never, undefined, undefined);
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
  roomCredit = new RoomCreditService(
    roomPrisma as never,
    { getStream: jest.fn(async () => Readable.from([png])) } as never,
    {
      analyzeBankStatement: jest.fn(async () => {
        ocrReached();
        await ocrGate;
        return { monthlyIncome: 25000, totalIncome: 75000, statementMonths: 3, confidence: 0.9 };
      }),
    } as never,
  );
  captureTxFailures(otpPrisma, 'bind');
  captureTxFailures(staffPrisma, 'staff');
  captureTxFailures(roomPrisma, 'room');
});

beforeEach(() => {
  txFailures.length = 0;
});

// แถวทดสอบทิ้งไว้ในฐานทดสอบ (ผลวิเคราะห์/ใบเช็คเครดิต/audit ผูก FK แบบ Restrict — ฐานถูก drop หลังรัน)
afterAll(async () => {
  spies.forEach((spy) => spy.mockRestore());
  await Promise.all([prisma, otpPrisma, staffPrisma, roomPrisma].map((c) => c.$disconnect()));
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

      const { bind, staff } = await raceBindAgainst(roomId, line(n), otp, () => staffUnlink(c.id));

      expect(settled(bind)).toMatchObject({ customerId: c.id });
      settled(staff);
      expect(txFailures).toEqual([]); // ไม่มีทรานแซกชันฝั่งไหนถูกฆ่าเพราะ deadlock (ไม่ต้องลองใหม่)
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

    const { bind, staff } = await raceBindAgainst(hRoom, line('3'), otp, () =>
      staffForm.unlinkFinanceLineByStaff(h.id, { id: staffId }),
    );

    expect(settled(bind)).toMatchObject({ customerId: c.id });
    expect(settled(staff)).toMatchObject({ unlinked: false });
    expect(txFailures).toEqual([]);
    const row = await linkRow(line('3'));
    expect(row).toMatchObject({ customerId: c.id, unlinkedAt: null });
    const [hAfter, cAfter] = await Promise.all(
      [h.id, c.id].map((id) => prisma.customer.findUniqueOrThrow({ where: { id } })),
    );
    expect(hAfter.lineIdFinance).toBeNull();
    expect(cAfter.lineIdFinance).toBe(line('3'));
  });
});

describe('ทาง "ห้อง → ลูกค้า" เดิม แข่งกับยืนยัน OTP — ไม่มี deadlock (Task 29 fix round 1 · review I-1)', () => {
  /** ลูกค้าที่จะยืนยัน OTP + ห้อง LINE การเงินของ LINE นั้น (ผูกลูกค้าแล้วหรือยัง) */
  async function fixture(n: string, roomCustomerId: 'none' | 'owner') {
    const c = await customer(`ห้อง→ลูกค้า ${n}`, n);
    const roomId = (
      await prisma.chatRoom.create({
        data: {
          lineUserId: line(n),
          channel: ChatChannel.LINE_FINANCE,
          customerId: roomCustomerId === 'owner' ? c.id : null,
        },
      })
    ).id;
    const otp = await requestOtp(line(n), c.phone!);
    return { c, roomId, otp };
  }

  const imported = (roomId: string) =>
    prisma.roomCreditAnalysis.findFirstOrThrow({
      where: { roomId },
      include: { creditCheck: true },
    });

  it('ผูกห้องกับลูกค้าในกล่องข้อความ (มีผลวิเคราะห์สเตทเม้นรอนำเข้า) ขณะลูกค้าคนนั้นยืนยัน OTP ของ LINE ห้องนั้น → ทั้งสองสำเร็จในรอบเดียว', async () => {
    const { c, roomId, otp } = await fixture('5', 'none');
    await prisma.roomCreditAnalysis.create({
      data: { roomId, fileIds: [], status: 'COMPLETED', result: { monthlyIncome: 10000 } },
    });

    const [linked, bind] = await raceOnRoom(
      roomId,
      () => rooms.linkCustomer(roomId, c.id, { id: staffId, role: 'OWNER' }),
      () => verification.verifyOtp({ lineUserId: line('5'), otp }),
    );

    expect(settled(linked)).toMatchObject({ id: roomId, customerId: c.id });
    expect(settled(bind)).toMatchObject({ customerId: c.id });
    expect(txFailures).toEqual([]);
    expect((await imported(roomId)).creditCheck).toMatchObject({ customerId: c.id });
    expect(await linkRow(line('5'))).toMatchObject({ customerId: c.id, unlinkedAt: null });
  });

  it('ผลวิเคราะห์สเตทเม้นจากแชทเสร็จ (ห้องผูกลูกค้าแล้ว) ขณะลูกค้าคนนั้นยืนยัน OTP ของ LINE ห้องนั้น → ทั้งสองสำเร็จในรอบเดียว', async () => {
    const { c, roomId, otp } = await fixture('6', 'owner');
    const file = await prisma.roomCreditFile.create({
      data: {
        roomId,
        key: `room-credit/${tag}-6.png`,
        name: 's.png',
        mimeType: 'image/png',
        size: 12,
      },
    });
    let release!: () => void;
    const reached = new Promise<void>((r) => (ocrReached = r));
    ocrGate = new Promise<void>((r) => (release = r));
    // ทรานแซกชันแรกของ analyze (สร้างแถว ANALYZING) จบก่อนเริ่มแข่ง — แข่งเฉพาะทรานแซกชันตอนวิเคราะห์เสร็จ
    const analysis = roomCredit.analyze(roomId, [file.id], { id: staffId, role: 'OWNER' });
    await reached;

    const [analyzed, bind] = await raceOnRoom(
      roomId,
      () => {
        release();
        return analysis;
      },
      () => verification.verifyOtp({ lineUserId: line('6'), otp }),
    );

    settled(analyzed);
    expect(settled(bind)).toMatchObject({ customerId: c.id });
    expect(txFailures).toEqual([]);
    const row = await imported(roomId);
    expect(row.status).toBe('COMPLETED');
    expect(row.creditCheck).toMatchObject({ customerId: c.id });
  });
});
