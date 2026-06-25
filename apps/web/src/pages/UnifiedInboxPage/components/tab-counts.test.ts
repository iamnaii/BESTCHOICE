import { describe, it, expect } from 'vitest';
import { deriveTabCounts } from './tab-counts';

const S = (over: Partial<{ unreadCount: number; assignedTo: { id: string } | null }>) => ({
  unreadCount: 0,
  assignedTo: null,
  ...over,
});

describe('deriveTabCounts', () => {
  it('counts unread rooms for all/unread, and my unread for mine', () => {
    const sessions = [
      S({ unreadCount: 2, assignedTo: { id: 'me' } }),
      S({ unreadCount: 1, assignedTo: { id: 'other' } }),
      S({ unreadCount: 0, assignedTo: { id: 'me' } }),
      S({ unreadCount: 5, assignedTo: null }),
    ];
    expect(deriveTabCounts(sessions, 'me')).toEqual({ mine: 1, all: 3, unread: 3 });
  });
  it('handles missing currentUserId + empty list', () => {
    expect(deriveTabCounts([], undefined)).toEqual({ mine: 0, all: 0, unread: 0 });
  });
});
