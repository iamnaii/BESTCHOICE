import { authenticator } from '@otplib/preset-default';
import * as QRCode from 'qrcode';
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'crypto';
// Note: promisify(scrypt) only accepts 3 args — use manual wrapper to pass options

function scryptAsync(
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: object,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

// Allow ±30s clock drift (1 TOTP window before and after)
authenticator.options = { window: 1 };

const ISSUER = 'BESTCHOICE';
const BACKUP_CODE_BYTES = 4; // 4 bytes → 8 hex chars uppercase
const SCRYPT_KEYLEN = 64;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };

/**
 * Generate a new TOTP base32 secret.
 */
export function generateTotpSecret(): string {
  return authenticator.generateSecret();
}

/**
 * Verify a 6-digit TOTP token against a base32 secret.
 * Accepts ±30s clock drift (window: 1).
 */
export function verifyTotp(token: string, secret: string): boolean {
  try {
    return authenticator.verify({ token, secret });
  } catch {
    return false;
  }
}

/**
 * Generate an otpauth:// URL for QR code display.
 * Label format: "email" — issuer is always "BESTCHOICE".
 */
export function generateOtpAuthUrl({
  secret,
  label,
}: {
  secret: string;
  label: string;
}): string {
  return authenticator.keyuri(label, ISSUER, secret);
}

/**
 * Generate a QR code data URL (base64 PNG) from an otpauth URL.
 */
export async function generateQrCodeDataUrl(otpauthUrl: string): Promise<string> {
  return QRCode.toDataURL(otpauthUrl);
}

/**
 * Generate `count` backup codes (default 10).
 * Each code is BACKUP_CODE_BYTES random bytes as uppercase hex (8 chars).
 */
export function generateBackupCodes(count = 10): string[] {
  return Array.from({ length: count }, () =>
    randomBytes(BACKUP_CODE_BYTES).toString('hex').toUpperCase(),
  );
}

/**
 * Hash a backup code using scrypt for storage.
 * Returns a string in the format: "salt:hash" (both hex).
 */
export async function hashBackupCode(code: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = (await scryptAsync(code, salt, SCRYPT_KEYLEN, SCRYPT_PARAMS)) as Buffer;
  return salt.toString('hex') + ':' + hash.toString('hex');
}

/**
 * Timing-safe verify: compare a plaintext backup code against a stored hash.
 * stored format: "salt:hash" (both hex).
 */
export async function verifyBackupCode(code: string, stored: string): Promise<boolean> {
  if (!stored || !stored.includes(':')) return false;
  const [saltHex, hashHex] = stored.split(':');
  const salt = Buffer.from(saltHex, 'hex');
  const expectedHash = Buffer.from(hashHex, 'hex');
  const actualHash = (await scryptAsync(code, salt, SCRYPT_KEYLEN, SCRYPT_PARAMS)) as Buffer;
  if (actualHash.length !== expectedHash.length) return false;
  return timingSafeEqual(actualHash, expectedHash);
}
