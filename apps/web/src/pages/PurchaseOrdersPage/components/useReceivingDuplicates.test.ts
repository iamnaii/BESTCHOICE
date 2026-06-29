import { describe, it, expect } from 'vitest';
import { computeDuplicateIndices } from './useReceivingDuplicates';
import type { ReceivingUnitForm } from '../types';

const u = (over: Partial<ReceivingUnitForm>): ReceivingUnitForm => ({
  poItemId: '',
  label: '',
  category: 'PHONE_NEW',
  imeiSerial: '',
  serialNumber: '',
  status: 'PASS',
  rejectReason: '',
  defectReason: '',
  batteryHealth: '',
  warrantyExpired: false,
  warrantyExpireDate: '',
  hasBox: true,
  checklist: [],
  sellingPrice: '',
  photos: [],
  costPrice: '',
  ...over,
});

describe('computeDuplicateIndices', () => {
  it('flags both PASS units that share an IMEI', () => {
    const set = computeDuplicateIndices([
      u({ imeiSerial: 'A' }),
      u({ imeiSerial: 'A' }),
      u({ imeiSerial: 'B' }),
    ]);
    expect([...set].sort()).toEqual([0, 1]);
  });

  it('ignores empty IMEIs and REJECT units', () => {
    const set = computeDuplicateIndices([
      u({ imeiSerial: '' }),
      u({ imeiSerial: '' }),
      u({ status: 'REJECT', imeiSerial: 'A' }),
      u({ imeiSerial: 'A' }),
    ]);
    expect(set.size).toBe(0);
  });

  it('is case/space-insensitive', () => {
    const set = computeDuplicateIndices([u({ imeiSerial: ' a1 ' }), u({ imeiSerial: 'A1' })]);
    expect([...set].sort()).toEqual([0, 1]);
  });
});
