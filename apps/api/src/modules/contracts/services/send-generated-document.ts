import { Response } from 'express';
/** This writer receives only a fully committed staged service result. */
export function sendGeneratedDocument(res: Response, value: unknown) {
  if (
    !value ||
    typeof value !== 'object' ||
    !('bytes' in value) ||
    !Buffer.isBuffer(value.bytes) ||
    !('contentType' in value) ||
    !['application/pdf', 'text/html; charset=utf-8'].includes(String(value.contentType))
  )
    throw new Error('Expected committed document result');
  if (res.destroyed || res.writableEnded) return;
  res.set({
    'Content-Type': String(value.contentType),
    'Content-Length': String(value.bytes.length),
    'Content-Disposition':
      'attachment; filename="document.' +
      (value.contentType === 'application/pdf' ? 'pdf' : 'html') +
      '"',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
    'Content-Security-Policy':
      "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; sandbox",
  });
  res.end(value.bytes);
}
