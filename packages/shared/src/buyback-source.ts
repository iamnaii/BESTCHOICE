/** Display the recorded source; never relabel a historical quote as today's benchmark. */
export function buybackSourceName(source?: string): string | undefined {
  if (!source) return undefined;
  try {
    const host = new URL(source).hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'applehouseth.com' || host === 'sure.applehouseth.com') return 'AppleHouse';
    if (host === 'yellobe.com') return 'Yellobe';
    return host;
  } catch {
    return source;
  }
}
