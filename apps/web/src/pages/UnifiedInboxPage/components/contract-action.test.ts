import { describe, it, expect } from 'vitest';
import { decideContractTarget } from './contract-action';

describe('decideContractTarget', () => {
  it('returns none for an empty list', () => {
    expect(decideContractTarget([])).toEqual({ kind: 'none' });
  });

  it('returns the single contract when there is exactly one', () => {
    const c = { id: 'c1' };
    expect(decideContractTarget([c])).toEqual({ kind: 'single', contract: c });
  });

  it('returns pick when there are 2+ contracts (do NOT auto-pick the first)', () => {
    expect(decideContractTarget([{ id: 'c1' }, { id: 'c2' }])).toEqual({ kind: 'pick' });
  });
});
