import { ExternalFinanceDocSlot } from '@prisma/client';
import {
  FINANCE_SLOT_LABELS,
  FINANCE_SLOT_ORDER,
  FINANCE_REQUIRED_SLOTS,
} from '@installment/shared';

export const FINANCE_APP_ROLES = ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES'] as const;
export const GFIN_COMPANY_NAME = 'GFIN';
export const SHARE_TTL_DAYS = 7;
export const MAX_FILES = 40;
export const MAX_BYTES = 10 * 1024 * 1024;
export const STORAGE_PREFIX = 'external-finance';

/** ป้ายช่อง — แหล่งเดียวอยู่ใน packages/shared (เว็บใช้ชุดเดียวกัน); satisfies = ตรวจว่าครบทุกค่าของ Prisma enum */
export const SLOT_LABELS = FINANCE_SLOT_LABELS satisfies Record<ExternalFinanceDocSlot, string>;
export const SLOT_ORDER: ExternalFinanceDocSlot[] = FINANCE_SLOT_ORDER;
/** ช่องที่ต้องมีไฟล์ก่อนส่ง (spec §8) */
export const REQUIRED_SLOTS: ExternalFinanceDocSlot[] = FINANCE_REQUIRED_SLOTS;

export type FinanceActor = { id: string; role: string; branchId?: string | null; name?: string | null };

/** LINE Messaging API: text message สูงสุด 5,000 ตัวอักษร (spec §10) */
export const LINE_TEXT_MAX = 5000;
/** ตั้งค่ากลุ่มไลน์/แม่แบบ/ส่งข้อความทดสอบ (spec §11) */
export const GFIN_SETTINGS_ROLES = ['OWNER', 'FINANCE_MANAGER'] as const;
