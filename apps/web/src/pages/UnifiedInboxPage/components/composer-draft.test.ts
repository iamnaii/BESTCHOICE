import { describe, it, expect } from 'vitest';
import { swapRoomDraft } from './composer-draft';

describe('swapRoomDraft', () => {
  it('saves the outgoing room text and returns "" for a room with no draft', () => {
    const drafts = new Map<string, string>();
    const incoming = swapRoomDraft(drafts, 'A', 'B', 'half-typed');
    expect(incoming).toBe('');
    expect(drafts.get('A')).toBe('half-typed');
  });

  it('returns the saved draft when reopening a room', () => {
    const drafts = new Map<string, string>([['B', 'wip reply']]);
    const incoming = swapRoomDraft(drafts, 'A', 'B', '');
    expect(incoming).toBe('wip reply');
  });

  it('deletes the outgoing entry when its text is empty (keeps the map small)', () => {
    const drafts = new Map<string, string>([['A', 'old']]);
    swapRoomDraft(drafts, 'A', 'B', '');
    expect(drafts.has('A')).toBe(false);
  });

  it('does not save when prevRoom is undefined (first open) and returns the current draft', () => {
    const drafts = new Map<string, string>([['A', 'restored']]);
    const incoming = swapRoomDraft(drafts, undefined, 'A', 'ignored-because-no-prev');
    expect(incoming).toBe('restored');
    expect(drafts.size).toBe(1);
  });

  it('returns "" when the incoming room is undefined', () => {
    const drafts = new Map<string, string>();
    expect(swapRoomDraft(drafts, 'A', undefined, 'text')).toBe('');
    expect(drafts.get('A')).toBe('text');
  });
});
