/**
 * รัน: DATABASE_URL=<ฐานทดสอบ> npx jest src/modules/overdue/consecutive-missed.db.spec.ts --runInBand
 *
 * Task 30 รอบ 5 (เจ้าของตัดสิน 01/11 ข้อ 2) — งวด "พลาด" นับ**หลังสิ้นวันครบกำหนด** ตามปฏิทินไทย: งวดที่ครบกำหนดวันนี้ยังไม่นับ
 * (เดิมรอบ 00:30 นับตั้งแต่ 00:00 ของวันครบกำหนด ⇒ สัญญาเปลี่ยนเป็น DEFAULT ในวันครบกำหนดงวดที่สอง) · นิยามเดียว
 * `ConsecutiveMissedService.getStreaks` (รอบเปลี่ยนสถานะ 00:30 · ค่าเผื่อหนี้สงสัยจะสูญ) · การเทียบวันใน SQL ต้องไม่พึ่ง time zone ของ session
 * ฐานข้อมูล (prod = UTC · ฐานบนเครื่อง = Asia/Bangkok) — รันกับ session ทั้งสองแบบบนฐานเดียวกัน
 */
import { PrismaClient } from '@prisma/client';
import { ConsecutiveMissedService } from './consecutive-missed.service';
import {
  FinanceFixtureBase,
  InstallmentFixture,
  assertTestDatabase,
  bangkokAt,
  createFinanceFixtureBase,
  createInstallmentFixture,
  dec,
  dueDateBkk,
  realBangkokDate,
  retireFixtures,
} from '../notifications/__tests__/finance-line-fixtures';

const prisma = new PrismaClient();
/** client ที่ session ฐานข้อมูลใช้ time zone ที่กำหนด (หนึ่ง connection — ค่า `TimeZone` ของ session คงที่) */
const clientInTimeZone = (tz: string) => {
  const url = new URL(process.env.DATABASE_URL!);
  url.searchParams.set('connection_limit', '1');
  url.searchParams.set('options', `-c TimeZone=${tz}`);
  return new PrismaClient({ datasources: { db: { url: url.toString() } } });
};
const sessions = { UTC: clientInTimeZone('UTC'), 'Asia/Bangkok': clientInTimeZone('Asia/Bangkok') };

const stamp = `t30m-${Date.now()}`;
const day = realBangkokDate();
let base: FinanceFixtureBase;
const fixtures: InstallmentFixture[] = [];
/** งวด 1 ค้าง + งวด 2 ครบกำหนดตาม `secondDueOffset` (วันไทยเทียบวันนี้) ยังไม่จ่าย */
let dueToday: InstallmentFixture;
let dueYesterday: InstallmentFixture;

async function twoUnpaid(label: string, secondDueOffset: number) {
  const f = await createInstallmentFixture(prisma, base, {
    label,
    dueDate: dueDateBkk(day, secondDueOffset - 30),
    paymentStatus: 'OVERDUE',
    contractStatus: 'OVERDUE',
  });
  const second = await prisma.payment.create({
    data: {
      contractId: f.contractId,
      installmentNo: 2,
      dueDate: dueDateBkk(day, secondDueOffset),
      amountDue: dec('1515.83'),
      lateFee: dec('0.00'),
      status: 'PENDING',
    },
  });
  fixtures.push(f, { ...f, paymentId: second.id });
  return f;
}

beforeAll(async () => {
  assertTestDatabase();
  base = await createFinanceFixtureBase(prisma, stamp);
  dueToday = await twoUnpaid('due0', 0);
  dueYesterday = await twoUnpaid('due-1', -1);
});

afterAll(async () => {
  await retireFixtures(prisma, fixtures);
  await Promise.all([prisma, ...Object.values(sessions)].map((c) => c.$disconnect()));
});

describe.each(Object.keys(sessions) as (keyof typeof sessions)[])(
  'session time zone ของฐานข้อมูล = %s',
  (tz) => {
    const streaksAt = async (asOf: Date) => {
      const map = await new ConsecutiveMissedService(sessions[tz] as never).getStreaks(
        { contractIds: [dueToday.contractId, dueYesterday.contractId] },
        asOf,
      );
      return {
        dueToday: map.get(dueToday.contractId),
        dueYesterday: map.get(dueYesterday.contractId),
      };
    };

    it('รอบ 00:30 ของวันครบกำหนดงวด 2 → งวด 2 ยังไม่นับเป็นพลาด · งวดที่ครบเมื่อวานนับ', async () => {
      await expect(streaksAt(bangkokAt(day, 0, 0, 30))).resolves.toEqual({
        dueToday: 1,
        dueYesterday: 2,
      });
    });

    it('ยังไม่สิ้นวันครบกำหนด (23:59 น. ไทย) → ยังไม่นับ', async () => {
      await expect(streaksAt(bangkokAt(day, 0, 23, 59))).resolves.toEqual({
        dueToday: 1,
        dueYesterday: 2,
      });
    });

    it('สิ้นวันครบกำหนดแล้ว (00:30 น. ของวันถัดไป) → นับ', async () => {
      await expect(streaksAt(bangkokAt(day, 1, 0, 30))).resolves.toEqual({
        dueToday: 2,
        dueYesterday: 2,
      });
    });
  },
);
