import {
  computeDeviceFingerprint,
  computeIpPrefix,
  humanReadableDeviceLabel,
} from './device-fingerprint.util';

describe('computeDeviceFingerprint', () => {
  const baseInput = {
    userAgent: 'Mozilla/5.0 Chrome/124',
    ipPrefix: '1.2.3',
    acceptLanguage: 'th-TH',
  };

  it('returns a 64-char hex string (SHA-256)', () => {
    const fp = computeDeviceFingerprint(baseInput);
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable — same inputs produce same fingerprint', () => {
    const fp1 = computeDeviceFingerprint(baseInput);
    const fp2 = computeDeviceFingerprint({ ...baseInput });
    expect(fp1).toBe(fp2);
  });

  it('changes when userAgent changes', () => {
    const fp1 = computeDeviceFingerprint(baseInput);
    const fp2 = computeDeviceFingerprint({ ...baseInput, userAgent: 'Firefox/125' });
    expect(fp1).not.toBe(fp2);
  });

  it('changes when ipPrefix changes', () => {
    const fp1 = computeDeviceFingerprint(baseInput);
    const fp2 = computeDeviceFingerprint({ ...baseInput, ipPrefix: '9.9.9' });
    expect(fp1).not.toBe(fp2);
  });

  it('handles missing optional fields gracefully (no crash)', () => {
    expect(() => computeDeviceFingerprint({})).not.toThrow();
    const fp = computeDeviceFingerprint({});
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });

  it('empty object and all-empty-string fields produce same fingerprint', () => {
    const fp1 = computeDeviceFingerprint({});
    const fp2 = computeDeviceFingerprint({ userAgent: '', ipPrefix: '', acceptLanguage: '' });
    expect(fp1).toBe(fp2);
  });
});

describe('computeIpPrefix', () => {
  it('IPv4 → /24 prefix', () => {
    expect(computeIpPrefix('1.2.3.4')).toBe('1.2.3');
  });

  it('another IPv4 → /24', () => {
    expect(computeIpPrefix('192.168.100.50')).toBe('192.168.100');
  });

  it('IPv4 loopback → unknown', () => {
    expect(computeIpPrefix('127.0.0.1')).toBe('unknown');
  });

  it('IPv6 → /48 prefix (3 groups)', () => {
    const prefix = computeIpPrefix('2001:0db8:0000:0000:0000:0000:0000:0001');
    expect(prefix).toBe('2001:0db8:0000');
  });

  it('IPv6 with :: expansion → /48 prefix', () => {
    const prefix = computeIpPrefix('2001:db8::1');
    // expanded first 3 groups
    expect(prefix).toMatch(/^2001:/);
  });

  it('IPv6-mapped IPv4 (::ffff:1.2.3.4) → IPv4 /24 prefix', () => {
    expect(computeIpPrefix('::ffff:1.2.3.4')).toBe('1.2.3');
  });

  it('null → unknown', () => {
    expect(computeIpPrefix(null)).toBe('unknown');
  });

  it('undefined → unknown', () => {
    expect(computeIpPrefix(undefined)).toBe('unknown');
  });

  it('garbage string → unknown', () => {
    expect(computeIpPrefix('not-an-ip')).toBe('unknown');
  });
});

describe('humanReadableDeviceLabel', () => {
  it('identifies Chrome on macOS', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
    expect(humanReadableDeviceLabel(ua)).toBe('Chrome 124 / macOS');
  });

  it('identifies Firefox on Windows 10', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0';
    expect(humanReadableDeviceLabel(ua)).toBe('Firefox 125 / Windows 10/11');
  });

  it('identifies Safari on iPhone', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
    expect(humanReadableDeviceLabel(ua)).toBe('Safari 17 / iPhone');
  });

  it('identifies Chrome on Android', () => {
    const ua =
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
    expect(humanReadableDeviceLabel(ua)).toBe('Chrome 124 / Android 14');
  });

  it('identifies Edge on Windows', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0';
    expect(humanReadableDeviceLabel(ua)).toBe('Edge 124 / Windows 10/11');
  });

  it('returns "Unknown device" for null/undefined UA', () => {
    expect(humanReadableDeviceLabel(null)).toBe('Unknown device');
    expect(humanReadableDeviceLabel(undefined)).toBe('Unknown device');
  });
});
