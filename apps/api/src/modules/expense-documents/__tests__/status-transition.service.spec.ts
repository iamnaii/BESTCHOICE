import { BadRequestException } from '@nestjs/common';
import { StatusTransitionService } from '../services/status-transition.service';

describe('StatusTransitionService', () => {
  const service = new StatusTransitionService();

  describe('canTransition', () => {
    it('DRAFT → POSTED allowed for EXPENSE Same-day (paymentMethod set)', () => {
      expect(() => service.assertCanPost({ type: 'EXPENSE', from: 'DRAFT', hasPaymentMethod: true })).not.toThrow();
    });
    it('DRAFT → ACCRUAL allowed for EXPENSE without payment method', () => {
      expect(() => service.assertCanPost({ type: 'EXPENSE', from: 'DRAFT', hasPaymentMethod: false })).not.toThrow();
    });
    it('reject post from POSTED', () => {
      expect(() => service.assertCanPost({ type: 'EXPENSE', from: 'POSTED', hasPaymentMethod: true })).toThrow(BadRequestException);
    });
    it('reject post from VOIDED', () => {
      expect(() => service.assertCanPost({ type: 'EXPENSE', from: 'VOIDED', hasPaymentMethod: true })).toThrow(BadRequestException);
    });
    it('reject post when totalAmount is placeholder value 0.01 (number)', () => {
      expect(() =>
        service.assertCanPost({ type: 'EXPENSE', from: 'DRAFT', hasPaymentMethod: true, totalAmount: 0.01 }),
      ).toThrow(BadRequestException);
    });
    it('reject post when totalAmount is placeholder value 0.01 (string)', () => {
      expect(() =>
        service.assertCanPost({ type: 'EXPENSE', from: 'DRAFT', hasPaymentMethod: true, totalAmount: '0.01' }),
      ).toThrow(BadRequestException);
    });
    it('allow post when totalAmount is above threshold', () => {
      expect(() =>
        service.assertCanPost({ type: 'EXPENSE', from: 'DRAFT', hasPaymentMethod: true, totalAmount: '100.00' }),
      ).not.toThrow();
    });
    it('allow post when totalAmount is omitted (backward compat)', () => {
      expect(() =>
        service.assertCanPost({ type: 'EXPENSE', from: 'DRAFT', hasPaymentMethod: true }),
      ).not.toThrow();
    });
  });

  describe('resolveTargetStatus', () => {
    it('returns POSTED for EXPENSE with paymentMethod', () => {
      expect(service.resolveTargetStatus('EXPENSE', true)).toBe('POSTED');
    });
    it('returns ACCRUAL for EXPENSE without paymentMethod', () => {
      expect(service.resolveTargetStatus('EXPENSE', false)).toBe('ACCRUAL');
    });
  });

  describe('assertCanVoid', () => {
    it('allow void from DRAFT', () => {
      expect(() => service.assertCanVoid({ from: 'DRAFT' })).not.toThrow();
    });
    it('allow void from ACCRUAL', () => {
      expect(() => service.assertCanVoid({ from: 'ACCRUAL' })).not.toThrow();
    });
    it('allow void from POSTED', () => {
      expect(() => service.assertCanVoid({ from: 'POSTED' })).not.toThrow();
    });
    it('reject void already VOIDED', () => {
      expect(() => service.assertCanVoid({ from: 'VOIDED' })).toThrow(BadRequestException);
    });
  });

  describe('assertCanEdit', () => {
    it('allow edit DRAFT', () => {
      expect(() => service.assertCanEdit({ from: 'DRAFT' })).not.toThrow();
    });
    it('reject edit POSTED', () => {
      expect(() => service.assertCanEdit({ from: 'POSTED' })).toThrow(BadRequestException);
    });
    it('reject edit ACCRUAL', () => {
      expect(() => service.assertCanEdit({ from: 'ACCRUAL' })).toThrow(BadRequestException);
    });
  });
});
