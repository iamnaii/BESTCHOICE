/**
 * Mask a Thai name for privacy: "สมชาย จันทร์ดี" → "สม*** จั***"
 */
export function maskThaiName(name: string): string {
  return name
    .split(' ')
    .map((part) => (part.length <= 2 ? part + '***' : part.substring(0, 2) + '***'))
    .join(' ');
}
