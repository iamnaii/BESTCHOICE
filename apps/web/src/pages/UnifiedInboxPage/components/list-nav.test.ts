import { describe, it, expect } from 'vitest';
import { nextRoomIndex } from './list-nav';

describe('nextRoomIndex', () => {
  it('returns -1 for an empty list', () => {
    expect(nextRoomIndex(0, 1, 0)).toBe(-1);
  });
  it('selects first on down / last on up when nothing is selected', () => {
    expect(nextRoomIndex(-1, 1, 5)).toBe(0);
    expect(nextRoomIndex(-1, -1, 5)).toBe(4);
  });
  it('moves and clamps at the ends (no wrap)', () => {
    expect(nextRoomIndex(0, 1, 5)).toBe(1);
    expect(nextRoomIndex(4, 1, 5)).toBe(4);
    expect(nextRoomIndex(0, -1, 5)).toBe(0);
  });
});
