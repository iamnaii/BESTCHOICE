const SENSITIVE_FIELDS = [
  // Auth credentials
  'password', 'token', 'secret', 'accessToken', 'refreshToken',
  'currentPassword', 'newPassword', 'confirmPassword',
  // PII — PDPA compliance
  'nationalId', 'vendorTaxId', 'taxId',
  'phone', 'mobilePhone', 'emergencyPhone',
  'email', 'lineId', 'lineUserId',
  'address', 'currentAddress', 'registeredAddress',
  'bankAccount', 'bankAccountNumber', 'accountNumber',
  // T2-C15: integration secrets stored under SystemConfig or passed in
  // third-party webhook payloads. These leak through the audit log as
  // "newValue" otherwise.
  'bankApiKey', 'paymentGateway', 'peakSecretKey', 'mdmApiKey',
  'connectId', 'userToken', 'appSecret', 'webhookSecret',
  'secretKey', 'smsApiSecret',
];

/**
 * T2-C15: pattern-match catch-all for secret-shaped keys we haven't
 * listed explicitly (e.g. `xyzApiKey`, `someSecret`, `myToken`). Keeps
 * us safe when new fields are added to SystemConfig without touching
 * this file.
 */
const SENSITIVE_FIELD_PATTERNS: RegExp[] = [
  /secret/i,
  /api[_-]?key/i,
  /token/i,
  /password/i,
  /credential/i,
  /private[_-]?key/i,
];

function isSensitiveKey(key: string): boolean {
  if (SENSITIVE_FIELDS.includes(key)) return true;
  return SENSITIVE_FIELD_PATTERNS.some((re) => re.test(key));
}

/** Sanitize JSON audit values without modifying the caller's payload. */
export function sanitizeAuditValue(value: unknown, fileField = false): unknown {
  if (typeof value === 'string' && (/^data:/i.test(value) || (fileField && value.length > 0))) {
    return '[FILE_DATA]';
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeAuditValue(item, fileField));
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    // Bulk settings carry their sensitive field name as { key, value }.
    const sensitiveSetting = typeof record.key === 'string' && isSensitiveKey(record.key);
    return Object.fromEntries(
      Object.entries(record).map(([key, item]) => [
        key,
        isSensitiveKey(key) || (key === 'value' && sensitiveSetting)
          ? '[REDACTED]'
          : sanitizeAuditValue(item, /base64$/i.test(key)),
      ]),
    );
  }
  return value;
}
