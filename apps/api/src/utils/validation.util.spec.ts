import {
  validateThaiNationalId,
  validateIMEI,
  validateThaiPhone,
  calculateAge,
  checkAgeEligibility,
  validateAddress,
  maskNationalId,
  validateLateFee,
  validateDownPayment,
  validateInstallmentMonths,
} from './validation.util';

describe('Validation Utilities', () => {
  // ─── Thai National ID ────────────────────────────────
  describe('validateThaiNationalId', () => {
    it('should return true for valid national ID', () => {
      // Use a well-known valid ID (checksum correct)
      expect(validateThaiNationalId('1100700418391')).toBe(true);
    });

    it('should return false for invalid checksum', () => {
      expect(validateThaiNationalId('1234567890120')).toBe(false);
    });

    it('should return false for too short input', () => {
      expect(validateThaiNationalId('12345')).toBe(false);
    });

    it('should return false for non-numeric input', () => {
      expect(validateThaiNationalId('12345678901ab')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(validateThaiNationalId('')).toBe(false);
    });

    it('should return false for 14 digits', () => {
      expect(validateThaiNationalId('12345678901234')).toBe(false);
    });
  });

  // ─── IMEI Validation ────────────────────────────────
  describe('validateIMEI', () => {
    it('should return true for valid IMEI (Luhn)', () => {
      // Known valid IMEI: 490154203237518
      expect(validateIMEI('490154203237518')).toBe(true);
    });

    it('should return false for invalid IMEI', () => {
      expect(validateIMEI('490154203237519')).toBe(false);
    });

    it('should return false for too short', () => {
      expect(validateIMEI('12345')).toBe(false);
    });

    it('should return false for non-numeric', () => {
      expect(validateIMEI('49015420323751a')).toBe(false);
    });

    it('should return false for 16 digits', () => {
      expect(validateIMEI('4901542032375180')).toBe(false);
    });
  });

  // ─── Thai Phone ────────────────────────────────────
  describe('validateThaiPhone', () => {
    it('should return true for valid phone starting with 0', () => {
      expect(validateThaiPhone('0812345678')).toBe(true);
    });

    it('should return true for 02 landline', () => {
      expect(validateThaiPhone('0212345678')).toBe(true);
    });

    it('should return false for phone not starting with 0', () => {
      expect(validateThaiPhone('8123456789')).toBe(false);
    });

    it('should return false for 9 digits', () => {
      expect(validateThaiPhone('081234567')).toBe(false);
    });

    it('should return false for 11 digits', () => {
      expect(validateThaiPhone('08123456789')).toBe(false);
    });
  });

  // ─── Age Calculation ────────────────────────────────
  describe('calculateAge', () => {
    it('should calculate correct age', () => {
      const birthDate = new Date(2000, 0, 1); // Jan 1, 2000
      const age = calculateAge(birthDate);
      expect(age).toBeGreaterThanOrEqual(25);
    });

    it('should handle birthday not yet occurred this year', () => {
      const now = new Date();
      const futureBirthday = new Date(now.getFullYear() - 20, now.getMonth() + 1, 1);
      const age = calculateAge(futureBirthday);
      expect(age).toBe(19);
    });
  });

  // ─── Age Eligibility ────────────────────────────────
  describe('checkAgeEligibility', () => {
    it('should reject under 17', () => {
      const now = new Date();
      const birthDate = new Date(now.getFullYear() - 16, now.getMonth(), now.getDate());
      const result = checkAgeEligibility(birthDate);
      expect(result.eligible).toBe(false);
      expect(result.requiresGuardian).toBe(false);
    });

    it('should require guardian for 17-19', () => {
      const now = new Date();
      const birthDate = new Date(now.getFullYear() - 18, now.getMonth(), now.getDate());
      const result = checkAgeEligibility(birthDate);
      expect(result.eligible).toBe(true);
      expect(result.requiresGuardian).toBe(true);
    });

    it('should allow 20+ without guardian', () => {
      const now = new Date();
      const birthDate = new Date(now.getFullYear() - 25, now.getMonth(), now.getDate());
      const result = checkAgeEligibility(birthDate);
      expect(result.eligible).toBe(true);
      expect(result.requiresGuardian).toBe(false);
    });
  });

  // ─── Address Validation ────────────────────────────
  describe('validateAddress', () => {
    it('should return false for null', () => {
      expect(validateAddress(null)).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(validateAddress('')).toBe(false);
    });

    it('should return false for short string', () => {
      expect(validateAddress('กรุงเทพ')).toBe(false);
    });

    it('should return true for valid address', () => {
      expect(validateAddress('123/456 ถนนสุขุมวิท กรุงเทพฯ 10110')).toBe(true);
    });
  });

  // ─── Mask National ID ──────────────────────────────
  describe('maskNationalId', () => {
    it('should mask 13-digit ID correctly', () => {
      const result = maskNationalId('1234567890123');
      expect(result).toBe('1-xxxx-xxxxx-0123');
    });

    it('should return input for short string', () => {
      expect(maskNationalId('123')).toBe('123');
    });

    it('should return empty for empty input', () => {
      expect(maskNationalId('')).toBe('');
    });
  });

  // ─── Late Fee Validation ───────────────────────────
  describe('validateLateFee', () => {
    it('should calculate fee correctly', () => {
      const result = validateLateFee(50, 100, 1000, 10);
      expect(result.fee).toBe(500);
      expect(result.capped).toBe(false);
    });

    it('should cap at max per day', () => {
      const result = validateLateFee(200, 100, 5000, 10);
      expect(result.fee).toBe(1000); // 100*10
      expect(result.capped).toBe(false);
    });

    it('should cap at fee cap', () => {
      const result = validateLateFee(50, 100, 200, 10);
      expect(result.fee).toBe(200);
      expect(result.capped).toBe(true);
    });
  });

  // ─── Down Payment Validation ───────────────────────
  describe('validateDownPayment', () => {
    it('should pass when down payment meets minimum', () => {
      const result = validateDownPayment(2000, 10000, 0.10);
      expect(result.valid).toBe(true);
      expect(result.minAmount).toBe(1000);
    });

    it('should fail when down payment is too low', () => {
      const result = validateDownPayment(500, 10000, 0.10);
      expect(result.valid).toBe(false);
    });

    it('should calculate actual percentage', () => {
      const result = validateDownPayment(3000, 10000, 0.10);
      expect(result.actualPct).toBeCloseTo(0.3);
    });
  });

  // ─── Installment Months Validation ─────────────────
  describe('validateInstallmentMonths', () => {
    it('should pass for months in range', () => {
      const result = validateInstallmentMonths(6, 1, 12);
      expect(result.valid).toBe(true);
    });

    it('should fail for months below minimum', () => {
      const result = validateInstallmentMonths(0, 1, 12);
      expect(result.valid).toBe(false);
      expect(result.message).toBeDefined();
    });

    it('should fail for months above maximum', () => {
      const result = validateInstallmentMonths(24, 1, 12);
      expect(result.valid).toBe(false);
    });
  });
});
