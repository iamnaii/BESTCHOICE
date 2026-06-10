import { BadRequestException } from '@nestjs/common';
import { encryptPII, decryptPII, isEncrypted } from '../../../utils/crypto.util';

/**
 * Normalize a Thai national id the SAME way CustomersService does
 * (customers.service.ts) — strip spaces + dashes, uppercase — BEFORE
 * hashing. Without identical normalization the trade-in seller hash would
 * never collide with the customer's nationalIdHash and the resolver would
 * fail to unify a seller who is also an existing customer.
 */
export function normalizeNationalId(raw: string): string {
  return raw.replace(/[\s-]/g, '').toUpperCase();
}

// ─── PII encryption helpers (Phase 3) ────────────────────
export function piiKey(): string {
  return process.env.PII_ENCRYPTION_KEY || '';
}

// ─── PII decryption helpers (Phase 5) ────────────────────

/**
 * Phase 5 read decrypt: maps transferAccountNumberEncrypted / transferAccountNameEncrypted
 * back to plaintext. Falls back to legacy plaintext columns when encrypted column is null.
 */
export function decryptTradeInPII<T extends Record<string, unknown>>(t: T | null): T | null {
  if (!t) return t;
  const key = piiKey();
  if (!key) return t;
  const dec = (encField: string, legacyField: string): string | null | undefined => {
    const enc = t[encField] as string | null | undefined;
    if (enc && typeof enc === 'string' && isEncrypted(enc)) {
      return decryptPII(enc, key);
    }
    return t[legacyField] as string | null | undefined;
  };
  return {
    ...t,
    transferAccountNumber: dec('transferAccountNumberEncrypted', 'transferAccountNumber'),
    transferAccountName: dec('transferAccountNameEncrypted', 'transferAccountName'),
  } as T;
}

export function decryptTradeInList<T extends Record<string, unknown>>(rows: T[]): T[] {
  return rows.map((r) => decryptTradeInPII(r) as T);
}

/**
 * Phase 3 dual-write: encrypt customer's bank info for trade-in payout.
 * Returns object to spread into Prisma update data.
 * Only includes encrypted fields when paymentMethod=TRANSFER (matches plaintext behavior).
 */
export function buildTradeInPiiEncryptedFields(input: {
  paymentMethod?: string;
  transferAccountNumber?: string | null;
  transferAccountName?: string | null;
}): Record<string, unknown> {
  const key = piiKey();
  const isTransfer = input.paymentMethod === 'TRANSFER';
  const enc = (v: string | null | undefined): string | null | undefined => {
    if (v === undefined) return undefined;
    if (v === null || v === '') return v;
    return key ? encryptPII(v, key) : v;
  };
  return {
    transferAccountNumberEncrypted: isTransfer ? enc(input.transferAccountNumber) : null,
    transferAccountNameEncrypted: isTransfer ? enc(input.transferAccountName) : null,
  };
}

// ─── Validation helpers ───────────────────────────────────
export function validateThaiNationalId(id: string): boolean {
  if (!/^\d{13}$/.test(id)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += parseInt(id[i]) * (13 - i);
  const check = (11 - (sum % 11)) % 10;
  return check === parseInt(id[12]);
}

/** Decode `data:image/jpeg;base64,...` หรือ raw base64 → Buffer + size guard */
export function decodeBase64Image(input: string): { buffer: Buffer; contentType: string } {
  const MAX_BYTES = 5 * 1024 * 1024; // 5MB
  const match = input.match(/^data:(image\/\w+);base64,(.+)$/);
  const base64 = match ? match[2] : input;
  const contentType = match ? match[1] : 'image/jpeg';
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length > MAX_BYTES) {
    throw new BadRequestException('รูปบัตรประชาชนต้องไม่เกิน 5MB');
  }
  if (buffer.length < 100) {
    throw new BadRequestException('รูปบัตรประชาชนเสียหายหรือว่างเปล่า');
  }
  return { buffer, contentType };
}
