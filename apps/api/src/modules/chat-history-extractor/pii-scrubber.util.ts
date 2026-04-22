const THAI_ID_RE = /\b\d{13}\b/g;
const DOB_RE = /\b(0?[1-9]|[12]\d|3[01])\/(0?[1-9]|1[0-2])\/(19|20)\d{2}\b/g;

export function scrubPii(text: string): string {
  return text.replace(THAI_ID_RE, '[REDACTED_ID]').replace(DOB_RE, '[REDACTED_DOB]');
}
