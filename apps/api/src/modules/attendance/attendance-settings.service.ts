import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { parseClock, resolveRules, type ScheduleRules } from './attendance-rules';

/**
 * ค่าตั้งค่าของการลงเวลา (ก้อน 10 D3 · สเปก §5, §9) — SystemConfig + ค่าทับรายสาขา
 * keys: attendance.work_start ('10:00') · attendance.work_end ('19:00') · attendance.late_grace_minutes (15) · attendance.photo_retention_days (365)
 */
export const ATTENDANCE_CONFIG_KEYS = {
  workStart: 'attendance.work_start',
  workEnd: 'attendance.work_end',
  lateGraceMinutes: 'attendance.late_grace_minutes',
  photoRetentionDays: 'attendance.photo_retention_days',
} as const;

export const ATTENDANCE_DEFAULTS: ScheduleRules & { photoRetentionDays: number } = {
  workStart: '10:00',
  workEnd: '19:00',
  lateGraceMinutes: 15,
  photoRetentionDays: 365,
};

export interface AttendanceSettings extends ScheduleRules {
  photoRetentionDays: number;
  branches: Array<{ branchId: string; branchName: string; workStart: string | null; workEnd: string | null }>;
}

type Db = Prisma.TransactionClient | PrismaService;

@Injectable()
export class AttendanceSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  private async readSystemRules(client: Db = this.prisma): Promise<ScheduleRules & { photoRetentionDays: number }> {
    const rows = await client.systemConfig.findMany({ where: { key: { in: Object.values(ATTENDANCE_CONFIG_KEYS) } } });
    const byKey = new Map(rows.map((r) => [r.key, r.value]));
    const str = (key: string, fallback: string) => byKey.get(key) ?? fallback;
    const num = (key: string, fallback: number) => {
      const raw = byKey.get(key);
      const n = raw === undefined ? NaN : Number(raw);
      return Number.isFinite(n) ? n : fallback;
    };
    return {
      workStart: str(ATTENDANCE_CONFIG_KEYS.workStart, ATTENDANCE_DEFAULTS.workStart),
      workEnd: str(ATTENDANCE_CONFIG_KEYS.workEnd, ATTENDANCE_DEFAULTS.workEnd),
      lateGraceMinutes: num(ATTENDANCE_CONFIG_KEYS.lateGraceMinutes, ATTENDANCE_DEFAULTS.lateGraceMinutes),
      photoRetentionDays: num(ATTENDANCE_CONFIG_KEYS.photoRetentionDays, ATTENDANCE_DEFAULTS.photoRetentionDays),
    };
  }

  /** กติกาของสาขา = ค่าระบบ ทับด้วย Branch.workStart/workEnd เมื่อตั้งไว้ */
  async getRules(branchId: string, client: Db = this.prisma): Promise<ScheduleRules> {
    // `client` = tx ของผู้เรียก (อ่านใน tx เดียวกัน ไม่ขอ connection เพิ่มจาก pool ขณะถือล็อก) ⇒ อ่านทีละคำสั่ง
    const system = await this.readSystemRules(client);
    const branch = await client.branch.findUnique({ where: { id: branchId }, select: { workStart: true, workEnd: true } });
    return resolveRules(system, { workStart: branch?.workStart ?? null, workEnd: branch?.workEnd ?? null });
  }

  async getPhotoRetentionDays(): Promise<number> {
    return (await this.readSystemRules()).photoRetentionDays;
  }

  async getSettings(): Promise<AttendanceSettings> {
    const [system, branches] = await Promise.all([
      this.readSystemRules(),
      this.prisma.branch.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true, name: true, workStart: true, workEnd: true }, orderBy: { name: 'asc' } }),
    ]);
    return { ...system, branches: branches.map((b) => ({ branchId: b.id, branchName: b.name, workStart: b.workStart, workEnd: b.workEnd })) };
  }

  async updateSettings(input: {
    workStart?: string;
    workEnd?: string;
    lateGraceMinutes?: number;
    photoRetentionDays?: number;
    branches?: Array<{ branchId: string; workStart?: string | null; workEnd?: string | null }>;
  }): Promise<AttendanceSettings> {
    for (const clock of [input.workStart, input.workEnd, ...(input.branches ?? []).flatMap((b) => [b.workStart, b.workEnd])]) {
      if (clock != null) {
        try { parseClock(clock); } catch { throw new BadRequestException(`รูปแบบเวลาไม่ถูกต้อง: ${clock} (ต้องเป็น HH:mm)`); }
      }
    }
    if (input.lateGraceMinutes != null && (input.lateGraceMinutes < 0 || input.lateGraceMinutes > 120)) throw new BadRequestException('ผ่อนผันสายต้องอยู่ระหว่าง 0–120 นาที');
    if (input.photoRetentionDays != null && (input.photoRetentionDays < 30 || input.photoRetentionDays > 3650)) throw new BadRequestException('อายุเก็บรูปต้องอยู่ระหว่าง 30–3650 วัน');
    const writes: Array<[string, string | undefined]> = [
      [ATTENDANCE_CONFIG_KEYS.workStart, input.workStart],
      [ATTENDANCE_CONFIG_KEYS.workEnd, input.workEnd],
      [ATTENDANCE_CONFIG_KEYS.lateGraceMinutes, input.lateGraceMinutes?.toString()],
      [ATTENDANCE_CONFIG_KEYS.photoRetentionDays, input.photoRetentionDays?.toString()],
    ];
    await this.prisma.$transaction(async (tx) => {
      for (const [key, value] of writes) {
        if (value === undefined) continue;
        await tx.systemConfig.upsert({ where: { key }, create: { key, value }, update: { value } });
      }
      for (const b of input.branches ?? []) {
        // ไม่ส่งคีย์ = ไม่แตะ · null = กลับไปใช้ค่าระบบ
        await tx.branch.update({ where: { id: b.branchId }, data: { ...(b.workStart !== undefined ? { workStart: b.workStart } : {}), ...(b.workEnd !== undefined ? { workEnd: b.workEnd } : {}) } });
      }
    });
    return this.getSettings();
  }
}
