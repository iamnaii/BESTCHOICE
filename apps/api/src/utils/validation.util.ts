/**
 * Validation utilities for Thai legal compliance
 * ป.พ.พ. มาตรา 572-576, พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562
 */

/**
 * Validate Thai national ID checksum (13 digits)
 * คำนวณ checksum เลขบัตรประชาชน 13 หลัก
 */
export function validateThaiNationalId(id: string): boolean {
  if (!/^\d{13}$/.test(id)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(id[i]) * (13 - i);
  }
  const check = (11 - (sum % 11)) % 10;
  return check === parseInt(id[12]);
}

/**
 * Validate IMEI number using Luhn algorithm (15 digits)
 * ตรวจ IMEI 15 หลัก ตาม Luhn algorithm
 */
export function validateIMEI(imei: string): boolean {
  if (!/^\d{15}$/.test(imei)) return false;

  let sum = 0;
  for (let i = 0; i < 15; i++) {
    let digit = parseInt(imei[i]);
    if (i % 2 !== 0) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

/**
 * Validate Thai phone number (10 digits starting with 0)
 */
export function validateThaiPhone(phone: string): boolean {
  return /^0[0-9]{9}$/.test(phone);
}

/**
 * Calculate age from birthdate
 */
export function calculateAge(birthDate: Date): number {
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}

/**
 * Check customer age eligibility for installment contract
 * Returns: { eligible: boolean; requiresGuardian: boolean; message?: string }
 */
export function checkAgeEligibility(birthDate: Date): {
  eligible: boolean;
  requiresGuardian: boolean;
  age: number;
  message?: string;
} {
  const age = calculateAge(birthDate);

  if (age < 17) {
    return {
      eligible: false,
      requiresGuardian: false,
      age,
      message: 'ผู้ซื้อต้องมีอายุ 17 ปีขึ้นไป ไม่สามารถทำสัญญาผ่อนชำระได้',
    };
  }

  if (age < 20) {
    return {
      eligible: true,
      requiresGuardian: true,
      age,
      message: 'ผู้ซื้ออายุต่ำกว่า 20 ปี ต้องมีผู้ปกครองลงนามยินยอม',
    };
  }

  return {
    eligible: true,
    requiresGuardian: false,
    age,
  };
}

/**
 * Validate address is not empty (must have meaningful content)
 */
export function validateAddress(address: string | null | undefined): boolean {
  if (!address) return false;
  const trimmed = address.trim();
  return trimmed.length >= 10; // minimum meaningful address length
}

/**
 * Mask Thai national ID for display: show first 1 and last 4 digits
 */
export function maskNationalId(id: string): string {
  if (!id || id.length < 5) return id;
  return id[0] + '-xxxx-xxxxx-' + id.slice(-4);
}

/**
 * Validate late fee does not exceed caps
 */
export function validateLateFee(
  feePerDay: number,
  maxFeePerDay: number,
  feeCap: number,
  daysLate: number,
): { fee: number; capped: boolean } {
  const effectiveFeePerDay = Math.min(feePerDay, maxFeePerDay);
  const rawFee = effectiveFeePerDay * daysLate;
  const fee = Math.min(rawFee, feeCap);
  return { fee, capped: rawFee > feeCap };
}

/**
 * Validate down payment meets minimum percentage
 */
export function validateDownPayment(
  downPayment: number,
  sellingPrice: number,
  minPct: number,
): { valid: boolean; minAmount: number; actualPct: number } {
  const minAmount = sellingPrice * minPct;
  const actualPct = sellingPrice > 0 ? downPayment / sellingPrice : 0;
  return {
    valid: downPayment >= minAmount,
    minAmount,
    actualPct,
  };
}

/**
 * Validate installment months within allowed range
 */
export function validateInstallmentMonths(
  months: number,
  min: number,
  max: number,
): { valid: boolean; message?: string } {
  if (months < min || months > max) {
    return {
      valid: false,
      message: `จำนวนงวดต้องอยู่ระหว่าง ${min}-${max} เดือน`,
    };
  }
  return { valid: true };
}

/**
 * Check required contract fields for legal compliance
 * Returns list of missing fields
 */
export function checkRequiredContractFields(data: {
  customerName?: string;
  customerNationalId?: string;
  customerPhone?: string;
  customerAddressIdCard?: string;
  customerAddressCurrent?: string;
  references?: any[];
  productName?: string;
  productImei?: string;
  sellingPrice?: number;
  downPayment?: number;
  totalMonths?: number;
  monthlyPayment?: number;
}): string[] {
  const missing: string[] = [];

  if (!data.customerName) missing.push('ชื่อ-นามสกุลผู้ซื้อ');
  if (!data.customerNationalId) missing.push('เลขบัตรประชาชนผู้ซื้อ');
  if (!data.customerPhone) missing.push('เบอร์โทรศัพท์ผู้ซื้อ');
  if (!data.customerAddressIdCard) missing.push('ที่อยู่ตามบัตรประชาชน');
  if (!data.customerAddressCurrent) missing.push('ที่อยู่ปัจจุบัน');
  if (!data.references || data.references.length === 0) {
    missing.push('บุคคลค้ำประกัน/ผู้ติดต่อฉุกเฉิน อย่างน้อย 1 คน');
  }
  if (!data.productName) missing.push('ชื่อสินค้า');
  if (!data.productImei) missing.push('IMEI / Serial Number');
  if (!data.sellingPrice || data.sellingPrice <= 0) missing.push('ราคาขาย');
  if (data.downPayment === undefined || data.downPayment === null) missing.push('เงินดาวน์');
  if (!data.totalMonths || data.totalMonths <= 0) missing.push('จำนวนงวด');

  return missing;
}

/**
 * Check required documents checklist before approval
 * Returns { complete: boolean; checklist: { type: string; label: string; present: boolean }[] }
 */
export function checkRequiredDocuments(
  documents: { documentType: string }[],
  requiresGuardian: boolean,
): { complete: boolean; checklist: { type: string; label: string; present: boolean }[] } {
  const required = [
    { type: 'SIGNED_CONTRACT', label: 'สัญญาผ่อนชำระ PDF' },
    { type: 'ID_CARD_COPY', label: 'สำเนาบัตรประชาชน (หน้า)' },
    { type: 'KYC_SELFIE', label: 'รูปถ่ายลูกค้าถือบัตรประชาชน' },
    { type: 'DEVICE_PHOTO', label: 'รูปถ่ายสินค้า + IMEI' },
    { type: 'DOWN_PAYMENT_RECEIPT', label: 'หลักฐานการชำระเงินดาวน์' },
    { type: 'PDPA_CONSENT', label: 'เอกสาร Consent PDPA' },
  ];

  if (requiresGuardian) {
    required.push({ type: 'GUARDIAN_DOC', label: 'เอกสารผู้ปกครอง (อายุ 17-19)' });
  }

  const docTypes = new Set(documents.map((d) => d.documentType));
  const checklist = required.map((r) => ({
    ...r,
    present: docTypes.has(r.type),
  }));

  return {
    complete: checklist.every((c) => c.present),
    checklist,
  };
}

/**
 * Check required signatures (4 signers) for contract
 */
export function checkRequiredSignatures(
  signatures: { signerType: string }[],
  requiresGuardian: boolean,
): { complete: boolean; checklist: { type: string; label: string; signed: boolean }[] } {
  const required = [
    { type: 'CUSTOMER', label: 'ผู้ซื้อ (ผู้เช่าซื้อ)' },
    { type: 'COMPANY', label: 'ผู้ขาย (ผู้ให้เช่าซื้อ)' },
    { type: 'WITNESS_1', label: 'พยาน 1' },
    { type: 'WITNESS_2', label: 'พยาน 2' },
  ];

  if (requiresGuardian) {
    required.push({ type: 'GUARDIAN', label: 'ผู้ปกครอง' });
  }

  const sigTypes = new Set(signatures.map((s) => s.signerType));
  // Also accept legacy 'STAFF' as 'COMPANY'
  if (sigTypes.has('STAFF')) sigTypes.add('COMPANY');

  const checklist = required.map((r) => ({
    ...r,
    signed: sigTypes.has(r.type),
  }));

  return {
    complete: checklist.every((c) => c.signed),
    checklist,
  };
}
