import { agingBucket } from './aging-bucket.util';

describe('agingBucket (canonical 4-way AR aging boundary)', () => {
  const L = ['a', 'b', 'c', 'd'] as const;

  it('maps ≤30 days to bucket 0 (incl. boundary 30, zero, negative)', () => {
    expect(agingBucket(0, L)).toBe('a');
    expect(agingBucket(30, L)).toBe('a');
    expect(agingBucket(-5, L)).toBe('a');
  });

  it('maps 31-60 to bucket 1 (boundaries 31 and 60)', () => {
    expect(agingBucket(31, L)).toBe('b');
    expect(agingBucket(60, L)).toBe('b');
  });

  it('maps 61-90 to bucket 2 (boundaries 61 and 90)', () => {
    expect(agingBucket(61, L)).toBe('c');
    expect(agingBucket(90, L)).toBe('c');
  });

  it('maps 91+ to bucket 3', () => {
    expect(agingBucket(91, L)).toBe('d');
    expect(agingBucket(9999, L)).toBe('d');
  });
});
