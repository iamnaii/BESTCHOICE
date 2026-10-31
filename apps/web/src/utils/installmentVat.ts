/**
 * VAT ของตั้งค่าดอกเบี้ย (คำตัดสินเจ้าของ #22, 31 ต.ค. 2026) — อ่านจากบริษัท FINANCE ที่เดียว กติกาเดียวกับ server
 * (`resolveInstallmentVat` ใน `apps/api/src/utils/config.util.ts`): FINANCE ไม่จด VAT = 0 · มีอัตรา = อัตรานั้น ·
 * ไม่มีแถว FINANCE/ไม่มีอัตรา = `VAT_RATE` ของระบบ (รูปเปอร์เซ็นต์ "7" หรือรูปทศนิยมเดิม "0.07") · ไม่มีเลย = 7%.
 * ใช้แสดงผลอย่างเดียว — ตัวเลขที่ลงสัญญามาจากใบเสนอยอดของ server
 */
export interface CompanyVatRow {
  companyCode: string;
  vatRegistered: boolean;
  vatRate: number | string | null;
}

export interface InstallmentVat {
  /** เศษส่วน เช่น 0.07 */
  fraction: number;
  /** ข้อความสำหรับแสดง เช่น "7%" */
  percentText: string;
  source: 'FINANCE' | 'SYSTEM';
}

function percentText(fraction: number): string {
  return `${(fraction * 100).toFixed(2).replace(/\.?0+$/, '')}%`;
}

function parseSystemVat(raw: string | null | undefined): number {
  const n = Number(String(raw ?? '').trim());
  if (raw == null || String(raw).trim() === '' || !Number.isFinite(n) || n < 0) return 0.07;
  return n >= 1 ? n / 100 : n;
}

export function installmentVat(
  companies: readonly CompanyVatRow[] | undefined,
  systemVatRaw: string | null | undefined,
): InstallmentVat {
  const finance = companies?.find((c) => c.companyCode === 'FINANCE');
  if (finance && !finance.vatRegistered)
    return { fraction: 0, percentText: '0%', source: 'FINANCE' };
  if (finance && finance.vatRate != null) {
    const fraction = Number(finance.vatRate);
    return { fraction, percentText: percentText(fraction), source: 'FINANCE' };
  }
  const fraction = parseSystemVat(systemVatRaw);
  return { fraction, percentText: percentText(fraction), source: 'SYSTEM' };
}
