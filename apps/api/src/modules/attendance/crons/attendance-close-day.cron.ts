import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { AttendanceDeviceService } from '../attendance-device.service';
import { dbDate, workDateOf, workDateString } from '../attendance-rules';
import { FLAG_DEVICE_UNAVAILABLE } from '../attendance.service';
import { FLAG_MISSING_OUT } from '../kiosk-punch.service';

/**
 * ปิดวัน 00:05 เวลาไทย (ก้อน 10 D3 · สเปก §5 §10) — วันเป้าหมาย = วันไทยก่อนหน้า
 * 1. แถวที่ IN แล้วไม่ OUT → ธง MISSING_OUT · OT/ชั่วโมงทำงาน = 0 (ผจก.แก้พร้อมเหตุผลได้)
 * 2. สาขาที่ไม่มีการตอกเลยทั้งวัน (เครื่องล็อก/ดับ/ไม่มีเน็ต) → ไม่นับใครขาด · ติดธง DEVICE_UNAVAILABLE ให้คนไม่มีแถว · Todo ถึงเจ้าของ
 * 3. สาขาปกติ → พนักงานที่มีรหัสตอกบัตรแต่ไม่มีแถว = แถว WORK ไม่มีเวลา (ขาด) · คนที่ยังไม่มีรหัสไม่ถูกนับ · แถวที่มีอยู่ (วันหยุด/ลา) ไม่แตะ
 * idempotent: รันซ้ำไม่สร้างซ้ำ · ไม่โยน error ออกจาก tick (Sentry)
 * หลาย instance (Cloud Run รัน scheduler ทุก instance): ขอ `pg_try_advisory_xact_lock` ใน transaction เดียวแบบ
 * `RecurringBillsCron` — ใครได้ล็อกทำงาน อีกตัวข้าม (`skipped`) · ทำงานด้วย root prisma ระหว่างที่ tx ถือล็อก ·
 * แถวขาดงานสร้างด้วย `createMany skipDuplicates` (unique (user_id, work_date)) · ติดธงด้วย `lockedUpdate` ที่ล็อกแถววัน
 * เรียง (user_id, work_date) ก่อน update — ลำดับเดียวกับผู้เขียนแถววันอื่น (กัน deadlock กับ updateMany ที่ล็อกตามลำดับสแกน) ·
 * Todo "เครื่องใช้ไม่ได้" ออกเฉพาะรอบที่มีแถวเปลี่ยนจริง (รันซ้ำไม่แจ้งซ้ำ)
 */
export interface CloseDayResult {
  targetDate: string;
  closed: number;
  absent: number;
  unavailableBranches: string[];
  /** instance อื่นถือล็อกรอบนี้อยู่ — รอบนี้ไม่ได้ทำอะไร */
  skipped?: boolean;
}

@Injectable()
export class AttendanceCloseDayCron {
  private readonly logger = new Logger(AttendanceCloseDayCron.name);
  static readonly LOCK_KEY = 'attendance:close-day';
  /** เวลาสูงสุดที่ถือล็อก/connection — รอบปกติจบในหลักวินาที */
  static readonly LOCK_TIMEOUT_MS = 10 * 60_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly devices: AttendanceDeviceService,
  ) {}

  @Cron('5 0 * * *', { timeZone: 'Asia/Bangkok' })
  async tick(): Promise<void> {
    await this.run(new Date());
  }

  async run(now: Date = new Date()): Promise<CloseDayResult> {
    const target = workDateOf(new Date(workDateOf(now).getTime() - 60_000)); // เที่ยงคืนไทยของเมื่อวาน
    const targetDate = workDateString(target);
    const result: CloseDayResult = { targetDate, closed: 0, absent: 0, unavailableBranches: [] };
    try {
      const ran = await this.prisma.$transaction(
        async (tx) => {
          const rows = await tx.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtext(${AttendanceCloseDayCron.LOCK_KEY})) AS locked`;
          if (!rows?.[0]?.locked) return false;
          await this.closeDay(target, result);
          return true;
        },
        { timeout: AttendanceCloseDayCron.LOCK_TIMEOUT_MS },
      );
      if (!ran) {
        result.skipped = true;
        this.logger.log(`[attendance-close-day] ${targetDate}: instance อื่นถือล็อกรอบนี้อยู่ — ข้าม`);
        return result;
      }
      this.logger.log(`[attendance-close-day] ${targetDate}: closed ${result.closed} · absent ${result.absent} · unavailable ${result.unavailableBranches.length}`);
    } catch (err) {
      this.logger.error(`[attendance-close-day] tick failed: ${(err as Error).message}`);
      Sentry.captureException(err, { tags: { subsystem: 'attendance', cron: 'close-day', scope: 'tick' }, extra: { targetDate } });
    }
    return result;
  }

  /**
   * ติดธง/แก้แถววันแบบล็อกแถวเรียง (user_id, work_date) ก่อน — `updateMany` ตรง ๆ ล็อกตามลำดับสแกน ⇒ deadlock ได้กับผู้เขียน
   * ที่ล็อกเรียงลำดับ · เงื่อนไขเดิมใส่ซ้ำตอน update ⇒ แถวที่เปลี่ยนระหว่างอ่านกับล็อก (เช่น เพิ่งตอกออก) ไม่ถูกแตะ
   */
  private async lockedUpdate(where: Prisma.AttendanceDayWhereInput, data: Prisma.AttendanceDayUpdateManyMutationInput): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.attendanceDay.findMany({ where, select: { id: true }, orderBy: [{ userId: 'asc' }, { workDate: 'asc' }] });
      if (rows.length === 0) return 0;
      const ids = rows.map((r) => r.id);
      await tx.$queryRaw`SELECT id FROM attendance_days WHERE id IN (${Prisma.join(ids)}) ORDER BY user_id, work_date FOR UPDATE`;
      return (await tx.attendanceDay.updateMany({ where: { AND: [where, { id: { in: ids } }] }, data })).count;
    });
  }

  private async closeDay(target: Date, result: CloseDayResult): Promise<void> {
    const key = dbDate(target);
    const targetDate = result.targetDate;
    result.closed = await this.lockedUpdate(
      { workDate: key, deletedAt: null, clockIn: { not: null }, clockOut: null, NOT: { flags: { has: FLAG_MISSING_OUT } } },
      { flags: { push: FLAG_MISSING_OUT }, otHours: 0, workedMinutes: 0 },
    );

    const branches = await this.prisma.branch.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true, name: true } });
    const dayStart = target;
    const dayEnd = new Date(target.getTime() + 24 * 3600_000);
    for (const branch of branches) {
      try {
        // สาขาที่ยังไม่มีเครื่องตอกบัตร (ณ วันนั้น) = ยังไม่เริ่มใช้ระบบ — ไม่นับขาด ไม่แจ้ง "เครื่องใช้ไม่ได้" ทุกวัน (รีวิว minor)
        const devicesThen = await this.prisma.attendanceDevice.count({ where: { branchId: branch.id, deletedAt: null, createdAt: { lt: dayEnd } } });
        if (devicesThen === 0) continue;
        const staff = (
          await this.prisma.user.findMany({
            where: { branchId: branch.id, deletedAt: null, isActive: true, isSystemUser: false, attendancePinHash: { not: null } },
            select: { id: true, branchId: true, attendancePinHash: true },
          })
        ).filter((u) => !!u.attendancePinHash); // คนที่ยังไม่มีรหัสตอกบัตร = ยังไม่เริ่มใช้ระบบ ไม่ถูกนับขาด
        if (!staff.length) continue;
        const existing = await this.prisma.attendanceDay.findMany({ where: { workDate: key, deletedAt: null, userId: { in: staff.map((u) => u.id) } }, select: { userId: true } });
        const haveRow = new Set(existing.map((r) => r.userId));
        const missing = staff.filter((u) => !haveRow.has(u.id));

        const punches = await this.prisma.attendancePunch.count({ where: { branchId: branch.id, at: { gte: dayStart, lt: dayEnd } } });
        const unavailable = punches === 0;
        if (!unavailable && !missing.length) continue;
        // unique (user_id, work_date) — instance/รอบอื่นสร้างไปแล้ว = ข้าม (ไม่ throw ไม่นับซ้ำ)
        const created = missing.length
          ? (
              await this.prisma.attendanceDay.createMany({
                data: missing.map((u) => ({ userId: u.id, branchId: branch.id, workDate: key, dayKind: 'WORK' as const, flags: unavailable ? [FLAG_DEVICE_UNAVAILABLE] : [] })),
                skipDuplicates: true,
              })
            ).count
          : 0;
        if (!unavailable) result.absent += created;
        if (unavailable) {
          // แถว WORK ที่ตั้งไว้ล่วงหน้า (ตารางหยุด/ลา) แต่ไม่มีการตอกเลยทั้งสาขา = เครื่องใช้ไม่ได้ ไม่ใช่ขาด (รีวิวรอบ 2 C7)
          const flagged = await this.lockedUpdate(
            { workDate: key, branchId: branch.id, deletedAt: null, dayKind: 'WORK', clockIn: null, NOT: { flags: { has: FLAG_DEVICE_UNAVAILABLE } } },
            { flags: { push: FLAG_DEVICE_UNAVAILABLE } },
          );
          result.unavailableBranches.push(branch.id);
          // รันซ้ำ (แถวสร้าง/ติดธงไปแล้ว) ไม่แจ้งซ้ำ
          if (created + flagged === 0) continue;
          await this.devices.createOwnerTodo({
            title: `สาขา ${branch.name} ไม่มีการตอกบัตรวันที่ ${targetDate}`,
            description: `ไม่มีรายการตอกเข้า/ออกเลยทั้งวัน (เครื่องตอกบัตรอาจดับ ล็อก หรือไม่มีเน็ต) — ระบบไม่นับใครขาด แถวของวันติดธง "เครื่องใช้ไม่ได้" ให้ ผจก.บันทึกย้อนหลังพร้อมเหตุผลที่เมนู ลงเวลา › แก้ไข`,
            priority: 'MEDIUM',
          });
        }
      } catch (err) {
        this.logger.error(`[attendance-close-day] branch ${branch.id}: ${(err as Error).message}`);
        Sentry.captureException(err, { tags: { subsystem: 'attendance', cron: 'close-day', scope: 'branch' }, extra: { branchId: branch.id, targetDate } });
      }
    }
  }
}
