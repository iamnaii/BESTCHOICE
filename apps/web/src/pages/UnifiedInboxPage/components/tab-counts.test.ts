import { describe, it, expect } from 'vitest';
import { deriveTabCounts, deriveChannelUnreadCounts } from './tab-counts';

const S = (over: Partial<{ unreadCount: number; assignedTo: { id: string } | null; waitingSince: string | null }>) => ({
  unreadCount: 0,
  assignedTo: null,
  waitingSince: null,
  ...over,
});

describe('deriveTabCounts', () => {
  it('counts unread rooms for all/unread, my unread for mine, and waiting rooms', () => {
    const sessions = [
      S({ unreadCount: 2, assignedTo: { id: 'me' }, waitingSince: '2026-09-05T01:00:00Z' }),
      S({ unreadCount: 1, assignedTo: { id: 'other' } }),
      S({ unreadCount: 0, assignedTo: { id: 'me' }, waitingSince: '2026-09-05T02:00:00Z' }),
      S({ unreadCount: 5, assignedTo: null }),
    ];
    expect(deriveTabCounts(sessions, 'me')).toEqual({ mine: 1, all: 3, unread: 3, waiting: 2 });
  });
  it('handles missing currentUserId + empty list', () => {
    expect(deriveTabCounts([], undefined)).toEqual({ mine: 0, all: 0, unread: 0, waiting: 0 });
  });
});

describe('deriveChannelUnreadCounts', () => {
  it('counts unread rooms per channel', () => {
    const sessions = [
      { unreadCount: 2, channel: 'LINE_FINANCE' },
      { unreadCount: 0, channel: 'LINE_FINANCE' },
      { unreadCount: 1, channel: 'FACEBOOK' },
      { unreadCount: 5, channel: 'FACEBOOK' },
      { unreadCount: 0, channel: 'WEB' },
    ];
    expect(deriveChannelUnreadCounts(sessions)).toEqual({ LINE_FINANCE: 1, FACEBOOK: 2 });
  });

  it('returns an empty object for no unread', () => {
    expect(deriveChannelUnreadCounts([{ unreadCount: 0, channel: 'WEB' }])).toEqual({});
  });
});
