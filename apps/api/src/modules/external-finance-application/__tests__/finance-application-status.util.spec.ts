import { ConflictException } from '@nestjs/common';
import { applyTransition, isClosed } from '../finance-application-status.util';

describe('applyTransition', () => {
  it('walks the happy path DRAFT → SENT → ACKNOWLEDGED → MORE_INFO → SENT → APPROVED', () => {
    expect(applyTransition('DRAFT', 'SEND')).toBe('SENT');
    expect(applyTransition('SENT', 'PARTNER_ACK')).toBe('ACKNOWLEDGED');
    expect(applyTransition('ACKNOWLEDGED', 'PARTNER_MORE_INFO')).toBe('MORE_INFO');
    expect(applyTransition('MORE_INFO', 'RESEND')).toBe('SENT');
    expect(applyTransition('SENT', 'PARTNER_APPROVED')).toBe('APPROVED');
  });
  it('lets staff set a result from any open post-send status and cancel from any open status', () => {
    expect(applyTransition('ACKNOWLEDGED', 'STAFF_REJECTED')).toBe('REJECTED');
    expect(applyTransition('MORE_INFO', 'STAFF_APPROVED')).toBe('APPROVED');
    expect(applyTransition('DRAFT', 'CANCEL')).toBe('CANCELLED');
    expect(applyTransition('SENT', 'CANCEL')).toBe('CANCELLED');
  });
  it('rejects impossible moves with 409', () => {
    expect(() => applyTransition('DRAFT', 'PARTNER_ACK')).toThrow(ConflictException);
    expect(() => applyTransition('APPROVED', 'PARTNER_MORE_INFO')).toThrow(ConflictException);
    expect(() => applyTransition('CANCELLED', 'SEND')).toThrow(ConflictException);
    expect(() => applyTransition('DRAFT', 'RESEND')).toThrow(ConflictException);
  });
  it('staff may correct a result after close (APPROVED ↔ REJECTED) but partner may not', () => {
    expect(applyTransition('APPROVED', 'STAFF_REJECTED')).toBe('REJECTED');
    expect(() => applyTransition('REJECTED', 'PARTNER_APPROVED')).toThrow(ConflictException);
  });
  it('isClosed', () => {
    expect(isClosed('APPROVED')).toBe(true);
    expect(isClosed('REJECTED')).toBe(true);
    expect(isClosed('CANCELLED')).toBe(true);
    expect(isClosed('SENT')).toBe(false);
  });
});
