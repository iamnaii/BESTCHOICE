/**
 * Data masking utilities for PDPA compliance
 * ปกปิดข้อมูลส่วนบุคคลตาม พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562
 */

/**
 * Mask national ID: show first 1 and last 4 digits only
 * e.g. 1-xxxx-xxxxx-xx-1234 → "1-xxxx-xxxxx-1234"
 */
export function maskNationalId(nationalId: string): string {
  if (!nationalId || nationalId.length < 13) return nationalId || '-';
  const digits = nationalId.replace(/\D/g, '');
  if (digits.length !== 13) return nationalId;
  return `${digits[0]}-xxxx-xxxxx-${digits.slice(9, 11)}-${digits[12]}`;
}

/**
 * Format national ID with full digits (for authorized views)
 */
export function formatNationalId(nationalId: string): string {
  if (!nationalId) return '-';
  return nationalId.replace(/(\d{1})(\d{4})(\d{5})(\d{2})(\d{1})/, '$1-$2-$3-$4-$5');
}

/**
 * Mask phone number: show last 4 digits only
 * e.g. 08x-xxx-1234
 */
export function maskPhone(phone: string): string {
  if (!phone || phone.length < 4) return phone || '-';
  const digits = phone.replace(/\D/g, '');
  return `xxx-xxx-${digits.slice(-4)}`;
}

/**
 * Mask bank account number: show last 5 digits only (PDPA).
 * e.g. "123-4-56789-0" → "xxx-x-xxxxx-x-9xxxx" → "xxx-x-xxxxx-6789-0" mask form.
 * Pattern: keep the last 5 digits, mask everything else with "x" while
 * preserving "-" separators.
 */
export function maskAccountNumber(accountNumber: string | null | undefined): string {
  if (!accountNumber) return '-';
  const digits = accountNumber.replace(/\D/g, '');
  if (digits.length <= 5) return accountNumber;
  const tail = digits.slice(-5);
  const masked = digits.slice(0, -5).replace(/\d/g, 'x') + tail;
  // Reapply original separators: walk original string, swap digits for masked chars.
  let i = 0;
  let out = '';
  for (const ch of accountNumber) {
    if (/\d/.test(ch)) {
      out += masked[i] ?? 'x';
      i += 1;
    } else {
      out += ch;
    }
  }
  return out;
}
