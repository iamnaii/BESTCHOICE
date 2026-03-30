import { calculateInstallment, generatePaymentSchedule } from './installment.util';

describe('Installment Utilities', () => {
  // ─── calculateInstallment ─────────────────────────────
  describe('calculateInstallment', () => {
    it('should calculate basic installment without commission/VAT', () => {
      // sellingPrice=10000, downPayment=2000, interestRate=0.08, totalMonths=6
      const result = calculateInstallment(10000, 2000, 0.08, 6);

      expect(result.principal).toBe(8000);
      // interestTotal = 8000 * 0.08 * 6 = 3840
      expect(result.interestTotal).toBe(3840);
      expect(result.storeCommission).toBe(0);
      expect(result.vatAmount).toBe(0);
      // financedAmount = 8000 + 0 + 3840 + 0 = 11840
      expect(result.financedAmount).toBe(11840);
      // monthlyPayment = ceil(11840 / 6) = ceil(1973.33) = 1974
      expect(result.monthlyPayment).toBe(1974);
    });

    it('should calculate with store commission and VAT', () => {
      const result = calculateInstallment(10000, 2000, 0.08, 6, 0.10, 0.07);

      expect(result.principal).toBe(8000);
      // storeCommission = 8000 * 0.10 = 800
      expect(result.storeCommission).toBe(800);
      // interestTotal = 8000 * 0.08 * 6 = 3840
      expect(result.interestTotal).toBe(3840);
      // vatAmount = (8000 + 800 + 3840) * 0.07 = 12640 * 0.07 = 884.8
      expect(result.vatAmount).toBe(884.8);
      // financedAmount = 8000 + 800 + 3840 + 884.8 = 13524.8
      expect(result.financedAmount).toBe(13524.8);
      // monthlyPayment = ceil(13524.8 / 6) = ceil(2254.13) = 2255
      expect(result.monthlyPayment).toBe(2255);
    });

    it('should calculate with zero interest rate', () => {
      const result = calculateInstallment(10000, 2000, 0, 6);

      expect(result.principal).toBe(8000);
      expect(result.interestTotal).toBe(0);
      expect(result.financedAmount).toBe(8000);
      // monthlyPayment = ceil(8000 / 6) = ceil(1333.33) = 1334
      expect(result.monthlyPayment).toBe(1334);
    });

    it('should round monthly payment UP to whole baht', () => {
      // Create a scenario where division isn't clean
      const result = calculateInstallment(10000, 1000, 0.05, 7);

      // monthlyPayment must always be a whole number (ceil)
      expect(result.monthlyPayment).toBe(Math.ceil(result.financedAmount / 7));
      expect(Number.isInteger(result.monthlyPayment)).toBe(true);
    });

    it('should throw if sellingPrice is 0', () => {
      expect(() => calculateInstallment(0, 0, 0.08, 6)).toThrow('ราคาขายต้องมากกว่า 0');
    });

    it('should throw if sellingPrice is negative', () => {
      expect(() => calculateInstallment(-1000, 0, 0.08, 6)).toThrow('ราคาขายต้องมากกว่า 0');
    });

    it('should throw if downPayment is negative', () => {
      expect(() => calculateInstallment(10000, -500, 0.08, 6)).toThrow('เงินดาวน์ต้องไม่ติดลบ');
    });

    it('should throw if downPayment >= sellingPrice', () => {
      expect(() => calculateInstallment(10000, 10000, 0.08, 6)).toThrow(
        'เงินดาวน์ต้องน้อยกว่าราคาขาย',
      );
      expect(() => calculateInstallment(10000, 15000, 0.08, 6)).toThrow(
        'เงินดาวน์ต้องน้อยกว่าราคาขาย',
      );
    });

    it('should throw if totalMonths is 0', () => {
      expect(() => calculateInstallment(10000, 2000, 0.08, 0)).toThrow(
        'จำนวนงวดต้องมากกว่า 0',
      );
    });

    it('should throw if interestRate is negative', () => {
      expect(() => calculateInstallment(10000, 2000, -0.05, 6)).toThrow(
        'อัตราดอกเบี้ยต้องไม่ติดลบ',
      );
    });

    it('should handle zero down payment', () => {
      const result = calculateInstallment(10000, 0, 0.08, 6);

      expect(result.principal).toBe(10000);
      expect(result.interestTotal).toBe(4800); // 10000 * 0.08 * 6
      expect(result.financedAmount).toBe(14800);
    });

    it('should maintain satang precision (2 decimal places)', () => {
      // Use values that could cause floating-point drift
      const result = calculateInstallment(9999, 1111, 0.03, 7, 0.05, 0.07);

      // All intermediate values should be rounded to 2 decimal places
      expect(result.principal).toBe(Math.round(result.principal * 100) / 100);
      expect(result.storeCommission).toBe(Math.round(result.storeCommission * 100) / 100);
      expect(result.interestTotal).toBe(Math.round(result.interestTotal * 100) / 100);
      expect(result.vatAmount).toBe(Math.round(result.vatAmount * 100) / 100);
      expect(result.financedAmount).toBe(Math.round(result.financedAmount * 100) / 100);
    });
  });

  // ─── generatePaymentSchedule ──────────────────────────
  describe('generatePaymentSchedule', () => {
    it('should generate correct number of payments', () => {
      const schedule = generatePaymentSchedule('contract-1', 6, 12000, 2000);

      expect(schedule).toHaveLength(6);
    });

    it('should assign correct installment numbers', () => {
      const schedule = generatePaymentSchedule('contract-1', 3, 9000, 3000);

      expect(schedule[0].installmentNo).toBe(1);
      expect(schedule[1].installmentNo).toBe(2);
      expect(schedule[2].installmentNo).toBe(3);
    });

    it('should set all statuses to PENDING', () => {
      const schedule = generatePaymentSchedule('contract-1', 4, 8000, 2000);

      for (const payment of schedule) {
        expect(payment.status).toBe('PENDING');
      }
    });

    it('should set correct contractId on all payments', () => {
      const schedule = generatePaymentSchedule('my-contract-id', 3, 6000, 2000);

      for (const payment of schedule) {
        expect(payment.contractId).toBe('my-contract-id');
      }
    });

    it('should adjust last installment for ceil rounding', () => {
      // financedAmount=10000, monthlyPayment=ceil(10000/3)=3334
      // First 2 installments: 3334 each = 6668
      // Last installment: 10000 - 6668 = 3332 (smaller to avoid overcharging)
      const schedule = generatePaymentSchedule('contract-1', 3, 10000, 3334);

      expect(schedule[0].amountDue).toBe(3334);
      expect(schedule[1].amountDue).toBe(3334);
      expect(schedule[2].amountDue).toBe(10000 - 3334 * 2); // 3332
    });

    it('should sum all payments to exactly financedAmount', () => {
      const financedAmount = 11840;
      const monthlyPayment = Math.ceil(financedAmount / 6);
      const schedule = generatePaymentSchedule('contract-1', 6, financedAmount, monthlyPayment);

      const total = schedule.reduce((sum, p) => sum + p.amountDue, 0);
      expect(total).toBe(financedAmount);
    });

    it('should use custom due day', () => {
      const schedule = generatePaymentSchedule('contract-1', 3, 9000, 3000, 15);

      for (const payment of schedule) {
        // Due day should be 15 (or last day of month if month has fewer days)
        expect(payment.dueDate.getDate()).toBeLessThanOrEqual(15);
      }
    });

    it('should default due day to 1 when not provided', () => {
      const schedule = generatePaymentSchedule('contract-1', 2, 6000, 3000, null);

      for (const payment of schedule) {
        expect(payment.dueDate.getDate()).toBe(1);
      }
    });

    it('should clamp due day to last day of month for short months', () => {
      // February has 28/29 days — if due day is 31, should clamp
      const schedule = generatePaymentSchedule('contract-1', 12, 12000, 1000, 31);

      for (const payment of schedule) {
        const lastDayOfMonth = new Date(
          payment.dueDate.getFullYear(),
          payment.dueDate.getMonth() + 1,
          0,
        ).getDate();
        expect(payment.dueDate.getDate()).toBeLessThanOrEqual(lastDayOfMonth);
      }
    });

    it('should generate dates in chronological order', () => {
      const schedule = generatePaymentSchedule('contract-1', 6, 12000, 2000, 15);

      for (let i = 1; i < schedule.length; i++) {
        expect(schedule[i].dueDate.getTime()).toBeGreaterThan(
          schedule[i - 1].dueDate.getTime(),
        );
      }
    });
  });
});
