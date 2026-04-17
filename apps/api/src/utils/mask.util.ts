/** Mask phone number: 0812345678 → 081****678 */
export function maskPhone(phone: string): string {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + '****' + phone.slice(-3);
}

/** Mask email address: user@example.com → us****@example.com */
export function maskEmail(email: string): string {
  if (!email) return '***';
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  return local.slice(0, 2) + '****@' + domain;
}
