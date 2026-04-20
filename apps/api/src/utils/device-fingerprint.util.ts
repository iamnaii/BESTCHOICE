import { createHash } from 'crypto';

export interface FingerprintInput {
  userAgent?: string;
  ipPrefix?: string;
  acceptLanguage?: string;
}

/**
 * Compute a stable SHA-256 device fingerprint from request signals.
 * Inputs are joined with "|" so partial-absence doesn't collide across fields.
 */
export function computeDeviceFingerprint(input: FingerprintInput): string {
  const parts = [
    input.userAgent ?? '',
    input.ipPrefix ?? '',
    input.acceptLanguage ?? '',
  ];
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

/**
 * Collapse an IP address to a network prefix for fingerprinting.
 *
 * IPv4 — returns /24 prefix  (e.g. "1.2.3.4"   → "1.2.3")
 * IPv6 — returns /48 prefix  (e.g. "2001:db8::1" → "2001:db8:0")
 * Loopback / mapped / unknown → "unknown"
 */
export function computeIpPrefix(ip: string | undefined | null): string {
  if (!ip) return 'unknown';

  const raw = ip.trim();

  // Strip IPv6-mapped IPv4 (::ffff:1.2.3.4)
  const v4mapped = raw.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (v4mapped) {
    return ipv4Prefix(v4mapped[1]);
  }

  if (raw.includes(':')) {
    return ipv6Prefix(raw);
  }

  if (/^\d+\.\d+\.\d+\.\d+$/.test(raw)) {
    return ipv4Prefix(raw);
  }

  return 'unknown';
}

function ipv4Prefix(ip: string): string {
  const parts = ip.split('.');
  if (parts.length !== 4) return 'unknown';
  const valid = parts.every((p) => {
    const n = parseInt(p, 10);
    return !isNaN(n) && n >= 0 && n <= 255;
  });
  if (!valid) return 'unknown';
  // Loopback
  if (parts[0] === '127') return 'unknown';
  return parts.slice(0, 3).join('.');
}

function ipv6Prefix(ip: string): string {
  try {
    // Expand :: into full groups of zeros
    const expanded = expandIpv6(ip);
    if (!expanded) return 'unknown';
    const groups = expanded.split(':');
    // /48 = first 3 groups
    return groups.slice(0, 3).join(':');
  } catch {
    return 'unknown';
  }
}

function expandIpv6(ip: string): string | null {
  // Validate characters (hex + colon)
  if (!/^[0-9a-fA-F:]+$/.test(ip)) return null;

  const halves = ip.split('::');
  if (halves.length > 2) return null; // multiple :: → invalid

  if (halves.length === 1) {
    // No ::
    const groups = ip.split(':');
    if (groups.length !== 8) return null;
    return groups.map((g) => g.padStart(4, '0')).join(':');
  }

  // Has ::
  const [left, right] = halves;
  const leftGroups = left ? left.split(':') : [];
  const rightGroups = right ? right.split(':') : [];
  const missing = 8 - leftGroups.length - rightGroups.length;
  if (missing < 0) return null;
  const middle = Array(missing).fill('0000');
  return [...leftGroups, ...middle, ...rightGroups]
    .map((g) => g.padStart(4, '0'))
    .join(':');
}

/**
 * Derive a human-readable device label from a User-Agent string.
 * Returns a concise string like "Chrome 124 / macOS" or "Safari / iPhone"
 * suitable for storing in KnownDevice.deviceLabel.
 *
 * Falls back to a truncated UA when recognition fails.
 */
export function humanReadableDeviceLabel(userAgent?: string | null): string {
  if (!userAgent) return 'Unknown device';

  const ua = userAgent.trim();

  // Mobile OS detection (order matters — check mobile before desktop)
  const isIPhone = /iPhone/i.test(ua);
  const isIPad = /iPad/i.test(ua);
  const isAndroid = /Android/i.test(ua);

  // Browser detection
  const edgeMatch = ua.match(/Edg(?:e)?\/(\d+)/i);
  const chromeMatch = ua.match(/Chrome\/(\d+)/i);
  const firefoxMatch = ua.match(/Firefox\/(\d+)/i);
  const safariMatch = ua.match(/Version\/(\d+).*Safari/i);
  const operaMatch = ua.match(/OPR\/(\d+)/i) || ua.match(/Opera\/(\d+)/i);

  let browser = 'Browser';
  let version = '';

  if (operaMatch) {
    browser = 'Opera';
    version = operaMatch[1];
  } else if (edgeMatch) {
    browser = 'Edge';
    version = edgeMatch[1];
  } else if (firefoxMatch) {
    browser = 'Firefox';
    version = firefoxMatch[1];
  } else if (safariMatch && !chromeMatch) {
    browser = 'Safari';
    version = safariMatch[1];
  } else if (chromeMatch) {
    browser = 'Chrome';
    version = chromeMatch[1];
  } else if (/MSIE|Trident/i.test(ua)) {
    browser = 'IE';
  }

  const browserPart = version ? `${browser} ${version}` : browser;

  // OS detection
  let os = 'Unknown OS';
  if (isIPhone) {
    os = 'iPhone';
  } else if (isIPad) {
    os = 'iPad';
  } else if (isAndroid) {
    const androidVer = ua.match(/Android\s*([\d.]+)/i);
    os = androidVer ? `Android ${androidVer[1]}` : 'Android';
  } else if (/Windows NT/i.test(ua)) {
    const winVer = ua.match(/Windows NT ([\d.]+)/i);
    os = winVer ? windowsVersion(winVer[1]) : 'Windows';
  } else if (/Macintosh|Mac OS X/i.test(ua)) {
    os = 'macOS';
  } else if (/Linux/i.test(ua)) {
    os = 'Linux';
  } else if (/CrOS/i.test(ua)) {
    os = 'ChromeOS';
  }

  return `${browserPart} / ${os}`;
}

function windowsVersion(nt: string): string {
  const map: Record<string, string> = {
    '10.0': 'Windows 10/11',
    '6.3': 'Windows 8.1',
    '6.2': 'Windows 8',
    '6.1': 'Windows 7',
  };
  return map[nt] ?? 'Windows';
}
