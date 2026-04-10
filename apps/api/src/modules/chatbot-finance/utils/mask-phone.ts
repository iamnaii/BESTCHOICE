/** Mask phone number: 0891234567 → 089-***-4567 */
export function maskPhone(phone: string): string {
  if (phone.length < 7) return phone;
  return `${phone.slice(0, 3)}-***-${phone.slice(-4)}`;
}
