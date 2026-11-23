import { describe, expect, it } from 'vitest';
import { sellThaiPartSuffix } from './sell-device-eligibility';

describe('sell device part number policy', () => {
  it.each([
    ['iPhone 12', 'MGJA3TH/A', 'TH/A'], ['iPhone 13', 'MLPH3TH/A', 'TH/A'],
    ['iPhone 13 Pro', 'MLVA3TH/A', 'TH/A'], ['iPhone 14', 'MPV03ZP/A', 'ZP/A'],
    ['iPhone 14 Pro Max', 'MQ9P3ZP/A', 'ZP/A'], ['iPhone 15', 'MTP03ZP/A', 'ZP/A'],
    ['iPhone 16', 'MYE93ZP/A', 'ZP/A'], ['iPhone 16 Pro Max', 'MYWW3ZP/A', 'ZP/A'],
    ['iPhone 17', 'MG6L4ZP/A', 'ZP/A'], ['iPhone 17 Pro Max', 'MFYP4ZP/A', 'ZP/A'],
    ['iPhone Air', 'MG2M4ZP/A', 'ZP/A'],
  ])('supports verified Thai retail family %s and code %s', (model, _code, suffix) => {
    expect(sellThaiPartSuffix(model)).toBe(suffix);
  });
  it('does not invent a suffix for unverified models', () => {
    expect(sellThaiPartSuffix('iPhone 18')).toBeNull();
  });
});
