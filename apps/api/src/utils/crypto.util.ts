import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGO = 'aes-256-cbc';

/**
 * Encrypt a plaintext string using AES-256-CBC.
 * Returns `iv:ciphertext` hex string, or the original value if no key.
 */
export function encryptPII(plaintext: string, key: string): string {
  if (!key || key.length < 32 || !plaintext) return plaintext;
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGO, Buffer.from(key, 'hex'), iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

/**
 * Decrypt an `iv:ciphertext` hex string back to plaintext.
 * Returns the original value if it doesn't look encrypted (no colon separator).
 */
export function decryptPII(ciphertext: string, key: string): string {
  if (!key || key.length < 32 || !ciphertext || !ciphertext.includes(':')) return ciphertext;
  try {
    const [ivHex, encrypted] = ciphertext.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = createDecipheriv(ALGO, Buffer.from(key, 'hex'), iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    // If decryption fails (e.g., plaintext data), return as-is
    return ciphertext;
  }
}

/**
 * Check if a value looks like it's already encrypted (iv:hex format).
 */
export function isEncrypted(value: string): boolean {
  if (!value || !value.includes(':')) return false;
  const [ivHex] = value.split(':');
  return ivHex.length === 32 && /^[0-9a-f]+$/i.test(ivHex);
}
