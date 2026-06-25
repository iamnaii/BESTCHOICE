/**
 * A stored chat media reference is a storage key (servable only via a signed
 * URL) unless it's already an http(s) URL (e.g. inbound LINE media) or a
 * line:// ref (fetched lazily through the media-content endpoint).
 */
export function isStorageKey(mediaUrl: string): boolean {
  return !/^https?:\/\//i.test(mediaUrl) && !mediaUrl.startsWith('line://');
}

/** Replace storage-key mediaUrls with signed URLs; pass everything else through. */
export async function signMessageMedia<T extends { mediaUrl: string | null }>(
  messages: T[],
  sign: (key: string) => Promise<string>,
): Promise<T[]> {
  return Promise.all(
    messages.map(async (m) =>
      m.mediaUrl && isStorageKey(m.mediaUrl) ? { ...m, mediaUrl: await sign(m.mediaUrl) } : m,
    ),
  );
}
