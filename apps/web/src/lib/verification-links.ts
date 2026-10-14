/** Keep already-issued QR links working without guessing one document type from another. */
export function legacyVerificationPath(identifier: string, search = ''): string | null {
  if (/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(identifier)) {
    return `/verify/contracts/${encodeURIComponent(identifier)}${search}`;
  }
  // RT is also a valid configurable expense prefix. An old URL contains no type.
  if (isAmbiguousLegacyNumber(identifier)) return null;
  // Expense prefixes are configurable; support all four issued number layouts.
  if (/^[a-z]{2,4}-(?:\d{4}|\d{6}|\d{8})-\d+$/i.test(identifier)) {
    return `/expenses/verify-number/${encodeURIComponent(identifier)}`;
  }
  return null;
}

export function isAmbiguousLegacyNumber(identifier: string): boolean {
  return /^RT-\d{6}-\d+$/i.test(identifier);
}

export function receiptVerificationPath(receiptNumber: string): string {
  return `/receipts/verify/${encodeURIComponent(receiptNumber)}`;
}

/** Only restore a local route, never a protocol-relative URL or a login loop. */
export function safeLoginReturnPath(value: unknown, fallback: string): string {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    /[\\\r\n]/.test(value)
  )
    return fallback;
  if (value.split(/[?#]/)[0].replace(/\/+$/, '') === '/login') return fallback;
  return value;
}
