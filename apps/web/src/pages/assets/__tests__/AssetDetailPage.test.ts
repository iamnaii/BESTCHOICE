import { describe, it, expect } from 'vitest';
import { mapAssetStatusToIcab } from '../AssetDetailPage';

/**
 * Asset lifecycle → bar's 4-state ICAB model. POSTED is the only state that
 * gets the bar's (purchase) reverse button; DISPOSED/WRITTEN_OFF map to POSTED
 * for display but reverse is held off there (separate disposal dialog handles
 * them — see canReverse gate in the page).
 */
describe('mapAssetStatusToIcab', () => {
  it('DRAFT stays DRAFT', () => {
    expect(mapAssetStatusToIcab('DRAFT')).toBe('DRAFT');
  });

  it('POSTED stays POSTED', () => {
    expect(mapAssetStatusToIcab('POSTED')).toBe('POSTED');
  });

  it('REVERSED stays REVERSED (terminal)', () => {
    expect(mapAssetStatusToIcab('REVERSED')).toBe('REVERSED');
  });

  it('DISPOSED / WRITTEN_OFF map to POSTED (booked; disposal reverse is separate)', () => {
    expect(mapAssetStatusToIcab('DISPOSED')).toBe('POSTED');
    expect(mapAssetStatusToIcab('WRITTEN_OFF')).toBe('POSTED');
  });
});
