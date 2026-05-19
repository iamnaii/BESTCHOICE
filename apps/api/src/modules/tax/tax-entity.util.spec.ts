import { BadRequestException } from '@nestjs/common';
import { ensureTaxTypeAllowedForEntity, ALLOWED_BY_ENTITY } from './tax-entity.util';

describe('tax-entity.util', () => {
  it('FINANCE allows PP30', () => {
    expect(() => ensureTaxTypeAllowedForEntity('FINANCE', 'PP30')).not.toThrow();
  });

  it('SHOP rejects PP30 (not VAT registered)', () => {
    expect(() => ensureTaxTypeAllowedForEntity('SHOP', 'PP30')).toThrow(BadRequestException);
  });

  it('both entities allow PND series', () => {
    for (const t of ['PND1', 'PND3', 'PND53', 'PND50', 'PND51']) {
      expect(() => ensureTaxTypeAllowedForEntity('SHOP', t)).not.toThrow();
      expect(() => ensureTaxTypeAllowedForEntity('FINANCE', t)).not.toThrow();
    }
  });

  it('rejects unknown report type', () => {
    expect(() => ensureTaxTypeAllowedForEntity('FINANCE', 'PND99')).toThrow(BadRequestException);
  });

  it('ALLOWED_BY_ENTITY has expected entries', () => {
    expect(ALLOWED_BY_ENTITY.FINANCE).toContain('PP30');
    expect(ALLOWED_BY_ENTITY.SHOP).not.toContain('PP30');
  });

  it('error message includes entity name and allowed types', () => {
    let message = '';
    try {
      ensureTaxTypeAllowedForEntity('SHOP', 'PP30');
    } catch (e) {
      message = (e as BadRequestException).message;
    }
    expect(message).toContain('PP30');
    expect(message).toContain('SHOP');
    expect(message).toContain('PND1');
  });
});
