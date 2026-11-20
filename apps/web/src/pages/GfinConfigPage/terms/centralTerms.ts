import Decimal from 'decimal.js';
import type { GfinSettingsApi, RateFactorApi } from '@/pages/ProductDetailPage/utils/gfinQuote';

/** % ค่าคอมที่เลือกได้ = % ที่มีตารางค่างวดเปิดอยู่ (สเปก §2 — ไม่งั้น GFIN คิดผ่อนไม่ได้ทุกเครื่อง) */
export function commissionOptions(factors: RateFactorApi[]): number[] {
  return [...new Set(factors.filter((f) => f.isActive).map((f) => f.shopCommissionPct))].sort((a, b) => a - b);
}

/** ชิปค่างวดของยอดจัด 10,000 บาท (ใบข้อ 4) — สูตรเดียวกับ GFIN: ceil(ยอดจัด × เรท) + ค่าธรรมเนียม */
export function rateChips(factors: RateFactorApi[], pct: number): { months: number; monthly: number }[] {
  return factors
    .filter((f) => f.isActive && f.shopCommissionPct === pct)
    .sort((a, b) => a.months - b.months)
    .map((f) => ({
      months: f.months,
      monthly: new Decimal(10000).mul(f.factor).ceil().add(f.feePerInstallment).toNumber(),
    }));
}

export function formatSheetDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${d}/${m}/${y}` : iso;
}

export function sheetVersionText(s: Pick<GfinSettingsApi, 'sheetVersion' | 'sheetEffectiveDate'>): string {
  if (!s.sheetVersion) return 'ยังไม่ได้ระบุเวอร์ชันใบเงื่อนไข';
  const date = s.sheetEffectiveDate ? ` · ใช้ตั้งแต่ ${formatSheetDate(s.sheetEffectiveDate)}` : '';
  return `ใบเงื่อนไข G Finn Version ${s.sheetVersion}${date}`;
}

export interface CentralForm {
  minDownPct: string;
  commissionPhone: string;
  contractFee: string;
}
export interface SettingsBody {
  minDownPct?: number;
  commissionPhone?: number;
  contractFee?: number;
}

/** ส่งเฉพาะช่องที่เปลี่ยน — ค่าคอม iPad ไม่อยู่ในฟอร์มนี้ (สเปก §1 ไม่อยู่ในรอบนี้) */
export function settingsPatch(
  s: GfinSettingsApi,
  form: CentralForm,
  allowedCommissions: number[],
): { ok: true; body: SettingsBody } | { ok: false; message: string } {
  if (!form.minDownPct.trim()) return { ok: false, message: 'กรุณากรอกเงินดาวน์ขั้นต่ำ' };
  if (!form.contractFee.trim()) return { ok: false, message: 'กรุณากรอกค่าทำสัญญา' };
  const down = Number(form.minDownPct);
  const commission = Number(form.commissionPhone);
  const fee = Number(form.contractFee);
  if (!(Number.isInteger(down) && down >= 0 && down <= 80))
    return { ok: false, message: 'ดาวน์ขั้นต่ำต้องเป็นจำนวนเต็ม 0–80%' };
  if (!Number.isFinite(fee) || fee < 0) return { ok: false, message: 'ค่าทำสัญญาต้องเป็น 0 บาทขึ้นไป' };
  if (!/^\d+(\.\d{1,2})?$/.test(form.contractFee.trim()))
    return { ok: false, message: 'ค่าทำสัญญามีทศนิยมได้ไม่เกิน 2 ตำแหน่ง' };
  if (!Number.isFinite(commission) || (commission !== s.commissionPctByCategory.PHONE && !allowedCommissions.includes(commission)))
    return { ok: false, message: 'ค่าคอมนี้ยังไม่มีตารางค่างวด' };
  const body: SettingsBody = {};
  if (down !== s.minDownPct) body.minDownPct = down;
  if (commission !== s.commissionPctByCategory.PHONE) body.commissionPhone = commission;
  if (fee !== s.contractFee) body.contractFee = fee;
  if (Object.keys(body).length === 0) return { ok: false, message: 'ยังไม่ได้เปลี่ยนอะไร' };
  return { ok: true, body };
}
