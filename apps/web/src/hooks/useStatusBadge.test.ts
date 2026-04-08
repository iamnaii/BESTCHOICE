import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { getStatusBadge, getStatusMap, useStatusBadge } from './useStatusBadge';

describe('useStatusBadge / getStatusBadge', () => {
  describe('contract status', () => {
    it.each([
      ['DRAFT', 'ร่าง'],
      ['ACTIVE', 'ผ่อนอยู่'],
      ['OVERDUE', 'ค้างชำระ'],
      ['DEFAULT', 'ผิดนัด'],
      ['EARLY_PAYOFF', 'ปิดก่อน'],
      ['COMPLETED', 'ครบ'],
      ['EXCHANGED', 'เปลี่ยนเครื่อง'],
      ['CLOSED_BAD_DEBT', 'หนี้สูญ'],
    ])('maps %s to %s', (status, label) => {
      expect(getStatusBadge('contract', status).label).toBe(label);
    });

    it('returns a non-empty className for every mapped status', () => {
      for (const s of ['DRAFT', 'ACTIVE', 'OVERDUE', 'DEFAULT', 'COMPLETED']) {
        expect(getStatusBadge('contract', s).className).not.toBe('');
      }
    });
  });

  describe('payment status', () => {
    it.each([
      ['PENDING', 'รอชำระ'],
      ['PAID', 'ชำระแล้ว'],
      ['OVERDUE', 'เกินกำหนด'],
      ['PARTIALLY_PAID', 'ชำระบางส่วน'],
    ])('maps %s to %s', (status, label) => {
      expect(getStatusBadge('payment', status).label).toBe(label);
    });
  });

  describe('workflow status', () => {
    it('maps PENDING_REVIEW to "รออนุมัติ"', () => {
      expect(getStatusBadge('workflow', 'PENDING_REVIEW').label).toBe('รออนุมัติ');
    });

    it('maps APPROVED and REJECTED correctly', () => {
      expect(getStatusBadge('workflow', 'APPROVED').label).toBe('อนุมัติ');
      expect(getStatusBadge('workflow', 'REJECTED').label).toBe('ไม่อนุมัติ');
    });
  });

  describe('dunning status', () => {
    it.each([
      ['NONE', 'ปกติ'],
      ['REMINDER', 'แจ้งเตือน'],
      ['NOTICE', 'แจ้งค้างชำระ'],
      ['FINAL_WARNING', 'เตือนครั้งสุดท้าย'],
      ['LEGAL_ACTION', 'ดำเนินคดี'],
    ])('maps %s to %s', (status, label) => {
      expect(getStatusBadge('dunning', status).label).toBe(label);
    });
  });

  describe('fallback behaviour', () => {
    it('returns an empty-label fallback for null/undefined value', () => {
      expect(getStatusBadge('contract', null).label).toBe('');
      expect(getStatusBadge('contract', undefined).label).toBe('');
    });

    it('echoes the raw value as label when the status is unknown', () => {
      const badge = getStatusBadge('contract', 'NEVER_SEEN');
      expect(badge.label).toBe('NEVER_SEEN');
      // Still styled with the neutral fallback className
      expect(badge.className).toContain('bg-muted');
    });
  });

  describe('getStatusMap', () => {
    it('returns the full map for a given type', () => {
      const map = getStatusMap('contract');
      expect(Object.keys(map)).toContain('ACTIVE');
      expect(Object.keys(map)).toContain('COMPLETED');
      expect(map.ACTIVE.label).toBe('ผ่อนอยู่');
    });

    it('returns an empty object for unknown type via type-cast', () => {
      // @ts-expect-error testing runtime fallback for an invalid key
      expect(getStatusMap('nonsense')).toEqual({});
    });
  });

  describe('useStatusBadge hook', () => {
    it('exposes both getStatusBadge and getStatusMap', () => {
      const { result } = renderHook(() => useStatusBadge());
      expect(typeof result.current.getStatusBadge).toBe('function');
      expect(typeof result.current.getStatusMap).toBe('function');
    });

    it('hook-returned getStatusBadge produces identical output to the module export', () => {
      const { result } = renderHook(() => useStatusBadge());
      expect(result.current.getStatusBadge('contract', 'ACTIVE')).toEqual(
        getStatusBadge('contract', 'ACTIVE'),
      );
    });
  });
});
