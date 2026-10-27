import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  STAFF_EVENT_CATALOG,
  STAFF_NOTIFY_DEFAULT_MONTHLY_CAP,
  STAFF_NOTIFY_MONTHLY_CAP_KEY,
  STAFF_NOTIFY_RULES_KEY,
  STAFF_ROLES,
  isStaffEventKey,
  type StaffEventKey,
  type StaffNotifyRule,
  type StaffRole,
} from './staff-event-catalog';

export type StaffNotifyRules = Record<StaffEventKey, StaffNotifyRule>;

/**
 * กติกาผู้รับต่อเหตุการณ์ — เก็บใน SystemConfig `staff_notify_rules` (JSON ครบทุกคีย์) ทับค่าเริ่มต้นจากแคตตาล็อก
 * ค่าในฐานเสียหาย/ไม่ครบ → ใช้ค่าเริ่มต้นของคีย์นั้น (ไม่ล้ม) · เขียนต้องผ่าน validate ก่อนเสมอ
 */
@Injectable()
export class StaffNotifyRulesService {
  private readonly logger = new Logger(StaffNotifyRulesService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  static defaults(): StaffNotifyRules {
    return Object.fromEntries(STAFF_EVENT_CATALOG.map((c) => [c.key, { ...c.defaults, roles: [...c.defaults.roles] }])) as StaffNotifyRules;
  }

  async getEffectiveRules(): Promise<StaffNotifyRules> {
    const rules = StaffNotifyRulesService.defaults();
    const row = await this.prisma.systemConfig.findFirst({ where: { key: STAFF_NOTIFY_RULES_KEY, deletedAt: null }, select: { value: true } });
    if (!row) return rules;
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.value);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    } catch (err) {
      this.logger.error(`[staff-notify] ${STAFF_NOTIFY_RULES_KEY} เสียหาย ใช้ค่าเริ่มต้น: ${(err as Error).message}`);
      Sentry.captureMessage(`staff_notify_rules corrupt: ${(err as Error).message}`, { level: 'error' });
      return rules;
    }
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!isStaffEventKey(key) || !value || typeof value !== 'object') continue; // คีย์ที่เลิกใช้แล้ว/ขยะ — ข้ามเงียบ
      const v = value as Partial<Record<keyof StaffNotifyRule, unknown>>;
      const base = rules[key];
      rules[key] = {
        enabled: typeof v.enabled === 'boolean' ? v.enabled : base.enabled,
        roles: Array.isArray(v.roles) ? (v.roles.filter((r): r is StaffRole => (STAFF_ROLES as readonly string[]).includes(String(r)))) : base.roles,
        branchScoped: typeof v.branchScoped === 'boolean' ? v.branchScoped : base.branchScoped,
        includeGroup: typeof v.includeGroup === 'boolean' ? v.includeGroup : base.includeGroup,
      };
    }
    return rules;
  }

  async getRule(key: StaffEventKey): Promise<StaffNotifyRule> {
    return (await this.getEffectiveRules())[key];
  }

  /** ตรวจก้อนที่ส่งมา — คีย์ต้องอยู่ในแคตตาล็อก ชนิดต้องถูก บทบาทต้องอยู่ใน STAFF_ROLES · คีย์ที่ไม่ส่ง = ค่าเริ่มต้น */
  validateRules(input: unknown): StaffNotifyRules {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('รูปแบบกติกาไม่ถูกต้อง');
    const rules = StaffNotifyRulesService.defaults();
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (!isStaffEventKey(key)) throw new BadRequestException(`ไม่รู้จักเหตุการณ์ "${key}"`);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException(`กติกาของ "${key}" ไม่ถูกต้อง`);
      const v = value as Record<string, unknown>;
      for (const flag of ['enabled', 'branchScoped', 'includeGroup'] as const) {
        if (typeof v[flag] !== 'boolean') throw new BadRequestException(`ค่า ${flag} ของ "${key}" ต้องเป็น true/false`);
      }
      if (!Array.isArray(v.roles)) throw new BadRequestException(`บทบาทของ "${key}" ต้องเป็นรายการ`);
      const roles: StaffRole[] = [];
      for (const r of v.roles) {
        if (!(STAFF_ROLES as readonly string[]).includes(String(r))) throw new BadRequestException(`บทบาท "${String(r)}" ตั้งเป็นผู้รับไม่ได้`);
        if (!roles.includes(r as StaffRole)) roles.push(r as StaffRole);
      }
      rules[key] = { enabled: v.enabled as boolean, roles, branchScoped: v.branchScoped as boolean, includeGroup: v.includeGroup as boolean };
    }
    return rules;
  }

  async saveRules(input: unknown, actorId: string): Promise<StaffNotifyRules> {
    const rules = this.validateRules(input);
    const before = await this.getEffectiveRules();
    const value = JSON.stringify(rules);
    await this.prisma.systemConfig.upsert({
      where: { key: STAFF_NOTIFY_RULES_KEY },
      create: { key: STAFF_NOTIFY_RULES_KEY, value, label: 'กติกาแจ้งพนักงานทาง LINE (ผู้รับต่อเหตุการณ์)' },
      update: { value, deletedAt: null },
    });
    // ผ่าน AuditService หลัง commit → แถวอยู่ใน Merkle chain (database.md · รีวิว M3)
    await this.audit.log({ action: 'STAFF_NOTIFY_RULES_UPDATED', entity: 'system_config', entityId: STAFF_NOTIFY_RULES_KEY, userId: actorId, oldValue: before as unknown as Record<string, unknown>, newValue: rules as unknown as Record<string, unknown> });
    return rules;
  }

  /** เพดานข้อความต่อเดือน (นับต่อผู้รับ) — ค่าเริ่มต้น 280 · ค่าเสียหาย = ค่าเริ่มต้น */
  async getMonthlyCap(): Promise<number> {
    const row = await this.prisma.systemConfig.findFirst({ where: { key: STAFF_NOTIFY_MONTHLY_CAP_KEY, deletedAt: null }, select: { value: true } });
    const n = row ? Number(row.value) : NaN;
    return Number.isInteger(n) && n >= 1 && n <= 100_000 ? n : STAFF_NOTIFY_DEFAULT_MONTHLY_CAP;
  }

  async saveMonthlyCap(cap: unknown, actorId: string): Promise<number> {
    const n = Number(cap);
    if (!Number.isInteger(n) || n < 1 || n > 100_000) throw new BadRequestException('เพดานข้อความต่อเดือนต้องเป็นจำนวนเต็ม 1–100000');
    const before = await this.getMonthlyCap();
    await this.prisma.systemConfig.upsert({
      where: { key: STAFF_NOTIFY_MONTHLY_CAP_KEY },
      create: { key: STAFF_NOTIFY_MONTHLY_CAP_KEY, value: String(n), label: 'เพดานข้อความ LINE พนักงานต่อเดือน' },
      update: { value: String(n), deletedAt: null },
    });
    await this.audit.log({ action: 'STAFF_NOTIFY_CAP_UPDATED', entity: 'system_config', entityId: STAFF_NOTIFY_MONTHLY_CAP_KEY, userId: actorId, oldValue: { cap: before }, newValue: { cap: n } });
    return n;
  }
}
