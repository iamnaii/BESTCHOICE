import { createHash, randomBytes } from 'crypto';

/** โทเคนดิบ 256 บิต (base64url 43 ตัว) + sha256 hex ของมัน — หน้าลิงก์สาธารณะค้นด้วย hash เท่านั้น (spec §12) */
export function hashShareToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

export function newShareToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('base64url');
  return { raw, hash: hashShareToken(raw) };
}
