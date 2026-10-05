import { parseBooleanFlag } from '../../../utils/config.util';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SHOP_OPEN_HOUR, SHOP_CLOSE_HOUR } from '../../../utils/shop-hours.util';
export interface SlaPolicy {
  ownerMinutes: number;
  managerMinutes: number;
  shopOpen: number;
  shopClose: number;
  financeOpen: number;
  financeClose: number;
}
export const DEFAULT_SLA_POLICY: SlaPolicy = {
  ownerMinutes: 5,
  managerMinutes: 15,
  shopOpen: SHOP_OPEN_HOUR,
  shopClose: SHOP_CLOSE_HOUR,
  financeOpen: 10,
  financeClose: 20,
};
export function validateSlaPolicy(policy: Pick<SlaPolicy, 'ownerMinutes' | 'managerMinutes'>) {
  if (
    !Number.isInteger(policy.ownerMinutes) ||
    !Number.isInteger(policy.managerMinutes) ||
    policy.ownerMinutes < 1 ||
    policy.managerMinutes < policy.ownerMinutes ||
    policy.managerMinutes > 1440
  )
    throw new BadRequestException(
      'เวลาเตือนหัวหน้าต้องไม่น้อยกว่าเวลาผู้ดูแล และอยู่ในช่วง 1–1440 นาที',
    );
}
export function policyVersion(policy: SlaPolicy) {
  validateSlaPolicy(policy);
  return 'v1:' + JSON.stringify(policy);
}
export function policyFromVersion(version: string): SlaPolicy {
  // These historical defaults must not change if the current shop schedule changes.
  if (version === 'initial-5-15' || version === 'legacy')
    return {
      ownerMinutes: 5,
      managerMinutes: 15,
      shopOpen: 10,
      shopClose: 19,
      financeOpen: 10,
      financeClose: 20,
    };
  if (!version.startsWith('v1:')) throw new BadRequestException('ไม่รู้จักรุ่นนโยบายแจ้งเตือน');
  const value: SlaPolicy = JSON.parse(version.slice(3));
  validateSlaPolicy(value);
  for (const [start, end] of [
    [value.shopOpen, value.shopClose],
    [value.financeOpen, value.financeClose],
  ]) {
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > 24 || end <= start)
      throw new BadRequestException('ช่วงเวลาทำงานไม่ถูกต้อง');
  }
  return value;
}
export async function readCurrentSlaPolicy(db: Prisma.TransactionClient): Promise<SlaPolicy> {
  const config = await db.systemConfig.findFirst({
    where: { key: 'chat_sla_policy', deletedAt: null },
  });
  return config ? policyFromVersion(config.value) : { ...DEFAULT_SLA_POLICY };
}
export function businessMinutesBetween(
  start: Date,
  end: Date,
  windows: Array<{ start: Date; end: Date }>,
): number {
  const from = start.getTime();
  const to = end.getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from)
    throw new BadRequestException('ช่วงเวลารอไม่ถูกต้อง');
  let lastEnd = -Infinity;
  let milliseconds = 0;
  for (const window of windows) {
    const open = window.start.getTime();
    const close = window.end.getTime();
    if (!Number.isFinite(open) || !Number.isFinite(close) || close <= open || open < lastEnd)
      throw new BadRequestException('ช่วงเวลาทำงานซ้อนกันหรือเรียงไม่ถูกต้อง');
    milliseconds += Math.max(0, Math.min(to, close) - Math.max(from, open));
    lastEnd = close;
  }
  return milliseconds / 60000;
}
export function businessWindows(
  start: Date,
  end: Date,
  company: 'SHOP' | 'FINANCE',
  policy = DEFAULT_SLA_POLICY,
) {
  const offset = 7 * 3600000;
  const day = 86400000;
  const from = start.getTime();
  const to = end.getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from)
    throw new BadRequestException('ช่วงเวลารอไม่ถูกต้อง');
  const open = company === 'SHOP' ? policy.shopOpen : policy.financeOpen;
  const close = company === 'SHOP' ? policy.shopClose : policy.financeClose;
  const windows: Array<{ start: Date; end: Date }> = [];
  for (let date = Math.floor((from + offset) / day) * day - offset; date <= to; date += day) {
    windows.push({ start: new Date(date + open * 3600000), end: new Date(date + close * 3600000) });
  }
  return windows;
}

/** The last actual activation is a cutover, not permission to replay old alerts. */
export async function readAlertGate(db: Prisma.TransactionClient, lock = false) {
  if (lock)
    await db.$queryRaw`SELECT id FROM system_config WHERE key IN ('chat_work_queue_enabled', 'chat_sla_alerts_enabled', 'in_app_notifications_enabled') FOR SHARE`;
  const flags = await db.systemConfig.findMany({
    where: {
      key: {
        in: ['chat_work_queue_enabled', 'chat_sla_alerts_enabled', 'in_app_notifications_enabled'],
      },
      deletedAt: null,
    },
  });
  const queue = flags.find((flag) => flag.key === 'chat_work_queue_enabled');
  const sla = flags.find((flag) => flag.key === 'chat_sla_alerts_enabled');
  const master = flags.find((flag) => flag.key === 'in_app_notifications_enabled');
  return {
    enabled:
      queue?.value === 'true' && sla?.value === 'true' && parseBooleanFlag(master?.value, true),
    cutover: new Date(
      Math.max(
        queue?.updatedAt.getTime() ?? 0,
        sla?.updatedAt.getTime() ?? 0,
        master?.updatedAt.getTime() ?? 0,
      ),
    ),
  };
}
