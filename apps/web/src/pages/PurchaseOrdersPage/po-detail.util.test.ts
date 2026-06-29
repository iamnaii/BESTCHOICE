import { describe, it, expect } from 'vitest';
import { timelineSteps } from './po-detail.util';

const stateOf = (steps: ReturnType<typeof timelineSteps>, key: string) =>
  steps.find((s) => s.key === key)?.state;

describe('timelineSteps', () => {
  it('has 5 steps in order: draft → approved → ordered → received → completed', () => {
    const steps = timelineSteps({ status: 'DRAFT' });
    expect(steps.map((s) => s.key)).toEqual(['draft', 'approved', 'ordered', 'received', 'completed']);
  });

  it('DRAFT: draft is current, rest upcoming', () => {
    const s = timelineSteps({ status: 'DRAFT' });
    expect(stateOf(s, 'draft')).toBe('current');
    expect(stateOf(s, 'approved')).toBe('upcoming');
  });

  it('ORDERED: draft+approved+ordered done, ordered is current, received upcoming', () => {
    const s = timelineSteps({ status: 'ORDERED' });
    expect(stateOf(s, 'draft')).toBe('done');
    expect(stateOf(s, 'approved')).toBe('done');
    expect(stateOf(s, 'ordered')).toBe('current');
    expect(stateOf(s, 'received')).toBe('upcoming');
  });

  it('PARTIALLY_RECEIVED: received is current, prior all done', () => {
    const s = timelineSteps({ status: 'PARTIALLY_RECEIVED' });
    expect(stateOf(s, 'ordered')).toBe('done');
    expect(stateOf(s, 'received')).toBe('current');
    expect(stateOf(s, 'completed')).toBe('upcoming');
  });

  it('FULLY_RECEIVED: every step done, completed current', () => {
    const s = timelineSteps({ status: 'FULLY_RECEIVED' });
    expect(stateOf(s, 'received')).toBe('done');
    expect(stateOf(s, 'completed')).toBe('current');
  });

  it('CANCELLED: all steps marked cancelled', () => {
    const s = timelineSteps({ status: 'CANCELLED' });
    expect(s.every((st) => st.state === 'cancelled')).toBe(true);
  });
});
