import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { PromptPayQrService } from './promptpay-qr.service';

/**
 * Characterization tests for the PromptPay EMVCo QR payload builder (Wave 3 backfill).
 * This service had no spec yet emits the exact string customers scan to pay — a wrong
 * TLV field or CRC means a QR that fails or pays the wrong account.
 *
 * CRC oracle: `refCrc16` below is a CRC-16/CCITT-FALSE implementation anchored to the
 * algorithm's canonical check value ("123456789" -> 0x29B1). Because the oracle is
 * proven correct against the published check value, asserting the service's trailing
 * CRC equals the oracle's output is an independent verification, not a tautology.
 */

// CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF, no reflection, no final xor).
function refCrc16(data: string): string {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

const makeService = (id?: string, name = 'Test Shop') => {
  const svc = new PromptPayQrService({ get: () => undefined } as unknown as ConfigService);
  if (id) svc.setConfig(id, name);
  return svc;
};

describe('PromptPayQrService CRC oracle', () => {
  it('matches the canonical CRC-16/CCITT-FALSE check value', () => {
    expect(refCrc16('123456789')).toBe('29B1');
  });
});

describe('PromptPayQrService.generatePayload', () => {
  // EMVCo TLV blocks for phone 081-234-5678 (-> 0066 + 812345678):
  const PFI = '000201'; // Payload Format Indicator
  const POI = '010212'; // Point of Initiation Method (always "12" dynamic in this impl)
  const MAI_PHONE = '2939000016A00000067701011101130066812345678'; // tag 29 merchant acct
  const CURRENCY = '5303764'; // THB
  const COUNTRY = '5802TH';

  it('builds the full EMVCo payload (phone + amount) with a correct trailing CRC', () => {
    const svc = makeService('0812345678');
    const payload = svc.generatePayload(100);

    const beforeCrc = PFI + POI + MAI_PHONE + CURRENCY + COUNTRY + '5406100.00' + '6304';
    expect(payload).toBe(beforeCrc + refCrc16(beforeCrc));
  });

  it('omits the amount tag (54) when no amount is given, CRC still valid', () => {
    const svc = makeService('0812345678');
    const payload = svc.generatePayload();

    const beforeCrc = PFI + POI + MAI_PHONE + CURRENCY + COUNTRY + '6304';
    expect(payload).toBe(beforeCrc + refCrc16(beforeCrc));
    expect(payload).not.toContain('5406');
    // NOTE: POI stays "12" (dynamic) even with no amount — EMVCo would use "11"
    // for a static QR. Characterized as current behaviour; see review (D1/D5).
  });

  it('formats a 13-digit national/tax ID as merchant sub-tag 02 (no 0066 prefix)', () => {
    const svc = makeService('1234567890123');
    const payload = svc.generatePayload(50);

    // tag 29 -> aid: "00" + tlv(00, AID) + tlv(02, <13-digit id verbatim>)
    expect(payload).toContain('2939000016A00000067701011102131234567890123');
    expect(payload).toContain('540550.00'); // tlv(54, "50.00") -> len 05
    expect(payload.endsWith(refCrc16(payload.slice(0, -4)))).toBe(true);
  });

  it('formats the trailing CRC as 4 upper-hex chars after the 6304 marker', () => {
    const payload = makeService('0812345678').generatePayload(1);
    const crc = payload.slice(-4);
    expect(crc).toMatch(/^[0-9A-F]{4}$/);
    expect(payload.slice(-8, -4)).toBe('6304');
  });

  it('throws BadRequestException when PROMPTPAY_ID is not configured', () => {
    const svc = makeService(); // no setConfig, env returns undefined
    expect(() => svc.generatePayload(100)).toThrow(BadRequestException);
  });
});

describe('PromptPayQrService accessors', () => {
  it('masks the PromptPay id keeping first 3 and last 4', () => {
    expect(makeService('0812345678').getMaskedPromptPayId()).toBe('081-****-5678');
  });

  it('returns a short id unmasked and empty string when unset', () => {
    expect(makeService('12').getMaskedPromptPayId()).toBe('12');
    expect(makeService().getMaskedPromptPayId()).toBe('');
  });

  it('returns the configured account name (or empty string)', () => {
    expect(makeService('0812345678', 'BestChoice').getAccountName()).toBe('BestChoice');
    expect(makeService().getAccountName()).toBe('');
  });
});
