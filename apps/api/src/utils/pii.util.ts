import { createHmac } from 'crypto';

/**
 * Deterministic hash for PII lookup. Uses HMAC-SHA-256 with PII_HASH_SALT.
 * Same input + salt → same hash, enabling unique constraint + lookup queries.
 * Cannot be reversed; attacker needs plaintext to test.
 */
export function hashPII(plaintext: string, salt: string): string {
  if (!salt) throw new Error('PII_HASH_SALT required');
  if (salt.length < 32) throw new Error('PII_HASH_SALT must be >= 32 chars');
  if (!plaintext) return '';
  return createHmac('sha256', salt).update(plaintext).digest('hex');
}

/**
 * Mask 13-digit Thai national ID: show 5 first + 1 last.
 * Example: "1234567890123" → "12345-XXXXX-XX-3"
 */
export function maskNationalId(value: string): string {
  if (!value) return '';
  if (value.length !== 13) return value;
  return `${value.slice(0, 5)}-XXXXX-XX-${value.slice(-1)}`;
}

/**
 * Mask Thai mobile phone: show 3-char prefix + last 2.
 * Example: "0812345678" → "081-XXX-XX78"
 */
export function maskPhone(value: string): string {
  if (!value) return '';
  const digits = value.replace(/\D/g, '');
  if (digits.length < 10) return value;
  return `${digits.slice(0, 3)}-XXX-XX${digits.slice(-2)}`;
}

/**
 * Mask bank account: show last 2 chars only.
 */
export function maskBankAccount(value: string): string {
  if (!value) return '';
  if (value.length <= 2) return value;
  return 'X'.repeat(value.length - 2) + value.slice(-2);
}

/**
 * Mask email local-part: show first char only.
 * Example: "john.doe@example.com" → "j*******@example.com"
 */
export function maskEmail(value: string): string {
  if (!value || !value.includes('@')) return value;
  const [local, domain] = value.split('@');
  if (local.length <= 1) return value;
  return `${local[0]}${'*'.repeat(local.length - 1)}@${domain}`;
}
