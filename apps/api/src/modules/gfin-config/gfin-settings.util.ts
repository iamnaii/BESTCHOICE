import { readIntFlag, readNumberFlag } from '../../utils/config.util';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * ค่าตั้งค่า GFIN นอกตารางราคา/เรท — อ่านจาก system_config (key `gfin.*`) พร้อม default
 *
 * ที่มาของค่า default (2026-09-11): หน้าคำนวณสินเชื่อของ GFIN — ดาวน์เลือกได้ขั้นละ 5% ถึง 80%,
 * ขั้นต่ำเป็นค่าต่อร้าน (ในภาพหน้าขอสินเชื่อของร้านเลือก 25%) · ค่าทำสัญญา 100 · เจ้าของกำหนดคอม
 * มือถือ 15% / iPad 5%
 */
export interface GfinSettings {
  minDownPct: number;
  maxDownPct: number;
  downStepPct: number;
  contractFee: number;
  commissionPctByCategory: { PHONE: number; TABLET: number };
}

export const GFIN_SETTINGS_KEYS = {
  minDownPct: 'gfin.minDownPct',
  commissionPhone: 'gfin.commissionPct.PHONE',
  commissionTablet: 'gfin.commissionPct.TABLET',
  contractFee: 'gfin.contractFee',
} as const;

export const GFIN_SETTINGS_DEFAULTS: GfinSettings = {
  minDownPct: 25,
  maxDownPct: 80,
  downStepPct: 5,
  contractFee: 100,
  commissionPctByCategory: { PHONE: 15, TABLET: 5 },
};

export async function loadGfinSettings(prisma: PrismaService): Promise<GfinSettings> {
  const d = GFIN_SETTINGS_DEFAULTS;
  const [minDownPct, commissionPhone, commissionTablet, contractFee] = await Promise.all([
    readIntFlag(prisma, GFIN_SETTINGS_KEYS.minDownPct, d.minDownPct, 0, d.maxDownPct),
    readIntFlag(prisma, GFIN_SETTINGS_KEYS.commissionPhone, d.commissionPctByCategory.PHONE, 0, 100),
    readIntFlag(prisma, GFIN_SETTINGS_KEYS.commissionTablet, d.commissionPctByCategory.TABLET, 0, 100),
    readNumberFlag(prisma, GFIN_SETTINGS_KEYS.contractFee, d.contractFee),
  ]);
  return {
    minDownPct,
    maxDownPct: d.maxDownPct,
    downStepPct: d.downStepPct,
    contractFee: contractFee >= 0 ? contractFee : d.contractFee,
    commissionPctByCategory: { PHONE: commissionPhone, TABLET: commissionTablet },
  };
}

/** % คอมมิชชั่นตั้งต้นตามหมวดสินค้า — TABLET ใช้ค่า iPad, ที่เหลือ (มือถือใหม่/มือสอง) ใช้ค่ามือถือ */
export function commissionPctForCategory(settings: GfinSettings, category: string): number {
  return category === 'TABLET'
    ? settings.commissionPctByCategory.TABLET
    : settings.commissionPctByCategory.PHONE;
}
