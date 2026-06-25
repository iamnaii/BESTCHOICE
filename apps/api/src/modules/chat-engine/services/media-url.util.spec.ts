import { isStorageKey, signMessageMedia } from './media-url.util';

describe('isStorageKey', () => {
  it('treats a bare storage path as a key', () => {
    expect(isStorageKey('staff-chat/room1/123.jpg')).toBe(true);
  });
  it('treats http(s) URLs as NOT keys (already servable)', () => {
    expect(isStorageKey('https://cdn.line.me/x.jpg')).toBe(false);
    expect(isStorageKey('http://example.com/x.png')).toBe(false);
  });
  it('treats line:// refs as NOT keys (lazy-fetched elsewhere)', () => {
    expect(isStorageKey('line://message/abc')).toBe(false);
  });
});

describe('signMessageMedia', () => {
  const sign = async (key: string) => `signed:${key}`;
  it('signs only storage-key mediaUrls, passes through the rest', async () => {
    const input = [
      { id: 'a', mediaUrl: 'staff-chat/r/1.jpg' },
      { id: 'b', mediaUrl: 'https://cdn/x.jpg' },
      { id: 'c', mediaUrl: 'line://m/2' },
      { id: 'd', mediaUrl: null },
    ];
    const out = await signMessageMedia(input, sign);
    expect(out[0].mediaUrl).toBe('signed:staff-chat/r/1.jpg');
    expect(out[1].mediaUrl).toBe('https://cdn/x.jpg');
    expect(out[2].mediaUrl).toBe('line://m/2');
    expect(out[3].mediaUrl).toBeNull();
  });
  it('preserves other fields and order', async () => {
    const out = await signMessageMedia([{ id: 'a', mediaUrl: 'k/1', extra: 7 }], sign);
    expect(out[0]).toEqual({ id: 'a', mediaUrl: 'signed:k/1', extra: 7 });
  });
});
